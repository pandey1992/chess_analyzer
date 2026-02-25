import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import settings
from backend.database import get_db
from backend.models.payment import CoachingBooking, PaymentOrder, UserEntitlement
from backend.models.user import User
from backend.services.pro_access import get_user_entitlement, has_active_pro_access
from backend.utils.helpers import verify_token

logger = logging.getLogger("chess_analyzer.payments")
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

PURPOSE_PRO = "pro_monthly"
PURPOSE_COACHING = "coaching_booking"


class PaymentConfigResponse(BaseModel):
    enabled: bool
    key_id: str
    currency: str = "INR"
    pro_monthly_amount_inr: int
    coaching_amount_inr: int


class CustomerInfo(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    email: EmailStr
    phone: str = Field(..., min_length=8, max_length=20)
    notes: str = Field(default="", max_length=500)


class CreateOrderRequest(BaseModel):
    purpose: str = Field(..., pattern=r"^(pro_monthly|coaching_booking)$")
    customer: Optional[CustomerInfo] = None


class CreateOrderResponse(BaseModel):
    order_id: str
    amount_paise: int
    currency: str
    key_id: str
    purpose: str


class VerifyPaymentRequest(BaseModel):
    purpose: str = Field(..., pattern=r"^(pro_monthly|coaching_booking)$")
    razorpay_order_id: str = Field(..., min_length=8, max_length=80)
    razorpay_payment_id: str = Field(..., min_length=8, max_length=80)
    razorpay_signature: str = Field(..., min_length=16, max_length=256)


class VerifyPaymentResponse(BaseModel):
    verified: bool
    message: str
    pro_expires_at: Optional[str] = None


class ProStatusResponse(BaseModel):
    active: bool
    pro_expires_at: Optional[str] = None


async def _optional_current_user(
    request: Request,
    db: AsyncSession,
) -> Optional[User]:
    auth_header = request.headers.get("authorization", "").strip()
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        payload = verify_token(token)
        user_id = payload.get("sub")
        if not user_id:
            return None
        result = await db.execute(select(User).where(User.id == int(user_id)))
        return result.scalar_one_or_none()
    except Exception:
        return None


def _razorpay_enabled() -> bool:
    return bool(settings.razorpay_key_id and settings.razorpay_key_secret)


def _verify_signature(order_id: str, payment_id: str, signature: str) -> bool:
    payload = f"{order_id}|{payment_id}".encode("utf-8")
    digest = hmac.new(
        settings.razorpay_key_secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(digest, signature)


def _price_for_purpose_in_paise(purpose: str) -> int:
    if purpose == PURPOSE_PRO:
        return int(settings.pro_monthly_price_inr) * 100
    if purpose == PURPOSE_COACHING:
        return int(settings.coaching_price_inr) * 100
    raise HTTPException(status_code=400, detail="Unsupported payment purpose")


@router.get("/config", response_model=PaymentConfigResponse)
async def get_payment_config():
    return PaymentConfigResponse(
        enabled=_razorpay_enabled(),
        key_id=settings.razorpay_key_id or "",
        pro_monthly_amount_inr=settings.pro_monthly_price_inr,
        coaching_amount_inr=settings.coaching_price_inr,
    )


@router.get("/pro/status", response_model=ProStatusResponse)
@limiter.limit("30/minute")
async def get_pro_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user = await _optional_current_user(request, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login required")

    entitlement = await get_user_entitlement(db, user.id)
    active = await has_active_pro_access(db, user.id)
    return ProStatusResponse(
        active=active,
        pro_expires_at=entitlement.pro_expires_at.isoformat() if entitlement and entitlement.pro_expires_at else None,
    )


@router.post("/order", response_model=CreateOrderResponse)
@limiter.limit("20/minute")
async def create_order(
    body: CreateOrderRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if not _razorpay_enabled():
        raise HTTPException(status_code=503, detail="Payments are not configured")

    user = await _optional_current_user(request, db)
    if body.purpose == PURPOSE_PRO and not user:
        raise HTTPException(status_code=401, detail="Login required to unlock Pro")
    if body.purpose == PURPOSE_COACHING and not body.customer:
        raise HTTPException(status_code=400, detail="Customer details are required for coaching booking")

    amount_paise = _price_for_purpose_in_paise(body.purpose)
    receipt = f"{body.purpose[:4]}_{int(datetime.utcnow().timestamp())}_{secrets.token_hex(4)}"
    notes = {
        "purpose": body.purpose,
        "user_id": str(user.id) if user else "",
    }
    if body.customer:
        notes["name"] = body.customer.name
        notes["email"] = body.customer.email
        notes["phone"] = body.customer.phone

    payload = {
        "amount": amount_paise,
        "currency": "INR",
        "receipt": receipt,
        "notes": notes,
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.razorpay.com/v1/orders",
                auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
                json=payload,
            )
    except httpx.RequestError as exc:
        logger.error("Razorpay order request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach payment provider")

    if resp.status_code >= 400:
        logger.warning("Razorpay order creation failed (%s): %s", resp.status_code, resp.text[:300])
        raise HTTPException(status_code=502, detail="Failed to create payment order")

    data = resp.json()
    provider_order_id = data.get("id")
    if not provider_order_id:
        raise HTTPException(status_code=502, detail="Invalid payment provider response")

    metadata = {
        "purpose": body.purpose,
        "customer": body.customer.model_dump() if body.customer else None,
    }
    db.add(
        PaymentOrder(
            user_id=user.id if user else None,
            purpose=body.purpose,
            amount_paise=amount_paise,
            currency="INR",
            status="created",
            provider_order_id=provider_order_id,
            receipt=receipt,
            metadata_json=json.dumps(metadata),
        )
    )
    await db.commit()

    return CreateOrderResponse(
        order_id=provider_order_id,
        amount_paise=amount_paise,
        currency="INR",
        key_id=settings.razorpay_key_id,
        purpose=body.purpose,
    )


@router.post("/verify", response_model=VerifyPaymentResponse)
@limiter.limit("30/minute")
async def verify_payment(
    body: VerifyPaymentRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if not _razorpay_enabled():
        raise HTTPException(status_code=503, detail="Payments are not configured")

    user = await _optional_current_user(request, db)
    result = await db.execute(
        select(PaymentOrder).where(PaymentOrder.provider_order_id == body.razorpay_order_id)
    )
    payment_order = result.scalar_one_or_none()
    if not payment_order:
        raise HTTPException(status_code=404, detail="Payment order not found")
    if payment_order.purpose != body.purpose:
        raise HTTPException(status_code=400, detail="Payment purpose mismatch")
    if payment_order.purpose == PURPOSE_PRO and (not user or payment_order.user_id != user.id):
        raise HTTPException(status_code=403, detail="This order belongs to a different account")

    if payment_order.status == "paid":
        entitlement = None
        if payment_order.user_id:
            entitlement = await get_user_entitlement(db, payment_order.user_id)
        return VerifyPaymentResponse(
            verified=True,
            message="Payment already verified",
            pro_expires_at=entitlement.pro_expires_at.isoformat() if entitlement and entitlement.pro_expires_at else None,
        )

    if not _verify_signature(
        body.razorpay_order_id,
        body.razorpay_payment_id,
        body.razorpay_signature,
    ):
        payment_order.status = "failed"
        await db.commit()
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    payment_order.status = "paid"
    payment_order.provider_payment_id = body.razorpay_payment_id
    payment_order.provider_signature = body.razorpay_signature
    payment_order.paid_at = datetime.utcnow()

    pro_expires_at: Optional[datetime] = None

    if payment_order.purpose == PURPOSE_PRO and payment_order.user_id:
        entitlement = await get_user_entitlement(db, payment_order.user_id)
        now = datetime.utcnow()
        if not entitlement:
            entitlement = UserEntitlement(
                user_id=payment_order.user_id,
                pro_expires_at=now + timedelta(days=30),
                created_at=now,
                updated_at=now,
            )
            db.add(entitlement)
        else:
            start = entitlement.pro_expires_at if entitlement.pro_expires_at and entitlement.pro_expires_at > now else now
            entitlement.pro_expires_at = start + timedelta(days=30)
            entitlement.updated_at = now
        pro_expires_at = entitlement.pro_expires_at

    if payment_order.purpose == PURPOSE_COACHING:
        existing = await db.execute(
            select(CoachingBooking).where(CoachingBooking.payment_order_id == payment_order.id)
        )
        booking = existing.scalar_one_or_none()
        if not booking:
            metadata = {}
            try:
                metadata = json.loads(payment_order.metadata_json or "{}")
            except Exception:
                pass
            customer = metadata.get("customer") or {}
            db.add(
                CoachingBooking(
                    payment_order_id=payment_order.id,
                    user_id=payment_order.user_id,
                    name=(customer.get("name") or "Customer").strip()[:80],
                    email=(customer.get("email") or "unknown@example.com").strip()[:120],
                    phone=(customer.get("phone") or "").strip()[:20],
                    notes=(customer.get("notes") or "").strip()[:500],
                )
            )

    await db.commit()

    return VerifyPaymentResponse(
        verified=True,
        message="Payment verified successfully",
        pro_expires_at=pro_expires_at.isoformat() if pro_expires_at else None,
    )
