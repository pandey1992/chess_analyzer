import asyncio
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
from backend.services.email_service import send_email
from backend.services.pro_access import get_user_entitlement, has_active_pro_access
from backend.utils.helpers import verify_token

logger = logging.getLogger("chess_analyzer.payments")
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

PURPOSE_PRO = "pro_monthly"
PURPOSE_COACHING = "coaching_booking"
COACHING_PLAN_HOURLY = "hourly_1"
COACHING_PLAN_MONTHLY = "monthly_10"


class PaymentConfigResponse(BaseModel):
    enabled: bool
    key_id: str
    currency: str = "INR"
    pro_monthly_amount_inr: int
    coaching_hourly_amount_inr: int
    coaching_monthly_amount_inr: int
    transactional_emails_enabled: bool


class CustomerInfo(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    email: EmailStr
    phone: str = Field(..., min_length=8, max_length=20)
    notes: str = Field(default="", max_length=500)


class CreateOrderRequest(BaseModel):
    purpose: str = Field(..., pattern=r"^(pro_monthly|coaching_booking)$")
    coaching_plan: Optional[str] = Field(default=None, pattern=r"^(hourly_1|monthly_10)$")
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
    payment_id: Optional[str] = None


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


def _verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    if not settings.razorpay_webhook_secret:
        return False
    digest = hmac.new(
        settings.razorpay_webhook_secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(digest, signature or "")


async def _fetch_razorpay_payment(payment_id: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"https://api.razorpay.com/v1/payments/{payment_id}",
                auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
            )
    except httpx.RequestError as exc:
        logger.error("Razorpay payment fetch failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not verify payment with provider")

    if resp.status_code >= 400:
        logger.warning("Razorpay payment fetch failed (%s): %s", resp.status_code, resp.text[:300])
        raise HTTPException(status_code=502, detail="Payment provider verification failed")
    return resp.json()


def _coaching_plan_label(coaching_plan: str) -> str:
    if coaching_plan == COACHING_PLAN_HOURLY:
        return "1 hour session"
    if coaching_plan == COACHING_PLAN_MONTHLY:
        return "1 month pack (10 sessions)"
    return "coaching"


async def _send_payment_confirmation_emails(
    *,
    purpose: str,
    amount_paise: int,
    order_id: str,
    payment_id: str,
    customer_name: str,
    customer_email: str,
    coaching_plan: str = "",
    pro_expires_at: Optional[datetime] = None,
) -> None:
    amount_inr = (amount_paise or 0) / 100
    plan_text = _coaching_plan_label(coaching_plan) if purpose == PURPOSE_COACHING else "Pro monthly"
    expiry_text = pro_expires_at.strftime("%Y-%m-%d %H:%M UTC") if pro_expires_at else "N/A"

    user_subject = "Payment Confirmation - Chess AI Coach"
    user_body = (
        f"Hi {customer_name or 'Player'},\n\n"
        "Your payment was received successfully.\n\n"
        f"Purpose: {'Pro Subscription' if purpose == PURPOSE_PRO else 'Personal Coaching'}\n"
        f"Plan: {plan_text}\n"
        f"Amount: INR {amount_inr:.2f}\n"
        f"Order ID: {order_id}\n"
        f"Payment ID: {payment_id}\n"
        f"Pro Expiry: {expiry_text}\n\n"
        "Thank you,\nChess AI Coach"
    )

    admin_subject = "New Successful Payment - Chess AI Coach"
    admin_body = (
        "A payment was verified successfully.\n\n"
        f"Customer: {customer_name or 'N/A'}\n"
        f"Customer Email: {customer_email or 'N/A'}\n"
        f"Purpose: {'Pro Subscription' if purpose == PURPOSE_PRO else 'Personal Coaching'}\n"
        f"Plan: {plan_text}\n"
        f"Amount: INR {amount_inr:.2f}\n"
        f"Order ID: {order_id}\n"
        f"Payment ID: {payment_id}\n"
        f"Pro Expiry: {expiry_text}\n"
    )

    if customer_email:
        await send_email(customer_email, user_subject, user_body)
    if settings.payment_admin_email:
        await send_email(settings.payment_admin_email, admin_subject, admin_body)


def _queue_payment_confirmation_emails(**kwargs) -> None:
    if not settings.transactional_emails_enabled:
        logger.info("Transactional emails disabled; skipping payment confirmation send")
        return

    async def _runner() -> None:
        try:
            await _send_payment_confirmation_emails(**kwargs)
        except Exception:
            logger.exception("Unexpected error while sending payment confirmation emails")

    asyncio.create_task(_runner())


def _price_for_purpose_in_paise(purpose: str, coaching_plan: Optional[str] = None) -> int:
    if purpose == PURPOSE_PRO:
        return int(settings.pro_monthly_price_inr) * 100
    if purpose == PURPOSE_COACHING:
        if coaching_plan == COACHING_PLAN_HOURLY:
            return int(settings.coaching_hourly_price_inr) * 100
        if coaching_plan == COACHING_PLAN_MONTHLY:
            return int(settings.coaching_monthly_10_price_inr) * 100
        raise HTTPException(status_code=400, detail="Invalid coaching plan")
    raise HTTPException(status_code=400, detail="Unsupported payment purpose")


@router.get("/config", response_model=PaymentConfigResponse)
async def get_payment_config():
    return PaymentConfigResponse(
        enabled=_razorpay_enabled(),
        key_id=settings.razorpay_key_id or "",
        pro_monthly_amount_inr=settings.pro_monthly_price_inr,
        coaching_hourly_amount_inr=settings.coaching_hourly_price_inr,
        coaching_monthly_amount_inr=settings.coaching_monthly_10_price_inr,
        transactional_emails_enabled=settings.transactional_emails_enabled,
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
    if body.purpose == PURPOSE_COACHING and not body.coaching_plan:
        raise HTTPException(status_code=400, detail="coaching_plan is required for coaching booking")

    amount_paise = _price_for_purpose_in_paise(body.purpose, body.coaching_plan)
    receipt = f"{body.purpose[:4]}_{int(datetime.utcnow().timestamp())}_{secrets.token_hex(4)}"
    notes = {
        "purpose": body.purpose,
        "user_id": str(user.id) if user else "",
    }
    if body.coaching_plan:
        notes["coaching_plan"] = body.coaching_plan
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
        "coaching_plan": body.coaching_plan,
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


async def _finalize_successful_payment(
    *,
    db: AsyncSession,
    payment_order: PaymentOrder,
    payment_id: str,
    signature: str,
) -> tuple[Optional[datetime], bool, str, str, str]:
    """
    Returns:
    - pro_expires_at
    - transitioned_to_paid (False if already paid)
    - customer_name
    - customer_email
    - coaching_plan
    """
    if payment_order.status == "paid":
        entitlement = await get_user_entitlement(db, payment_order.user_id) if payment_order.user_id else None
        metadata = {}
        try:
            metadata = json.loads(payment_order.metadata_json or "{}")
        except Exception:
            pass
        customer = metadata.get("customer") or {}
        return (
            entitlement.pro_expires_at if entitlement else None,
            False,
            (customer.get("name") or "").strip(),
            (customer.get("email") or "").strip(),
            (metadata.get("coaching_plan") or "").strip(),
        )

    payment_order.status = "paid"
    payment_order.provider_payment_id = payment_id
    payment_order.provider_signature = signature
    payment_order.paid_at = datetime.utcnow()

    pro_expires_at: Optional[datetime] = None
    customer_name = ""
    customer_email = ""
    coaching_plan = ""

    if payment_order.purpose == PURPOSE_PRO and payment_order.user_id:
        user_res = await db.execute(select(User).where(User.id == int(payment_order.user_id)))
        user = user_res.scalar_one_or_none()
        if user:
            customer_name = (user.username or "").strip()
            customer_email = (user.email or "").strip()

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
        metadata = {}
        try:
            metadata = json.loads(payment_order.metadata_json or "{}")
        except Exception:
            pass
        customer = metadata.get("customer") or {}
        coaching_plan = (metadata.get("coaching_plan") or "").strip()
        customer_name = (customer.get("name") or "Customer").strip()
        customer_email = (customer.get("email") or "").strip()

        if not booking:
            note_text = (customer.get("notes") or "").strip()
            plan_label = _coaching_plan_label(coaching_plan)
            if plan_label:
                note_text = f"Plan: {plan_label}" + (f" | {note_text}" if note_text else "")
            db.add(
                CoachingBooking(
                    payment_order_id=payment_order.id,
                    user_id=payment_order.user_id,
                    name=customer_name[:80] or "Customer",
                    email=customer_email[:120] or "unknown@example.com",
                    phone=(customer.get("phone") or "").strip()[:20],
                    notes=note_text[:500],
                )
            )

    await db.commit()
    return pro_expires_at, True, customer_name, customer_email, coaching_plan


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

    if not _verify_signature(
        body.razorpay_order_id,
        body.razorpay_payment_id,
        body.razorpay_signature,
    ):
        payment_order.status = "failed"
        await db.commit()
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    provider_payment = await _fetch_razorpay_payment(body.razorpay_payment_id)
    provider_order_id = (provider_payment.get("order_id") or "").strip()
    provider_amount = int(provider_payment.get("amount") or 0)
    provider_currency = (provider_payment.get("currency") or "").strip().upper()
    provider_status = (provider_payment.get("status") or "").strip().lower()

    if provider_order_id != body.razorpay_order_id:
        payment_order.status = "failed"
        await db.commit()
        raise HTTPException(status_code=400, detail="Provider order mismatch during verification")
    if provider_amount != int(payment_order.amount_paise):
        payment_order.status = "failed"
        await db.commit()
        raise HTTPException(status_code=400, detail="Provider amount mismatch during verification")
    if provider_currency != (payment_order.currency or "INR").upper():
        payment_order.status = "failed"
        await db.commit()
        raise HTTPException(status_code=400, detail="Provider currency mismatch during verification")
    if provider_status not in {"authorized", "captured"}:
        payment_order.status = "failed"
        await db.commit()
        raise HTTPException(status_code=400, detail="Payment not completed at provider")

    pro_expires_at, transitioned, customer_name, customer_email, coaching_plan = await _finalize_successful_payment(
        db=db,
        payment_order=payment_order,
        payment_id=body.razorpay_payment_id,
        signature=body.razorpay_signature,
    )
    if transitioned:
        _queue_payment_confirmation_emails(
            purpose=payment_order.purpose,
            amount_paise=payment_order.amount_paise,
            order_id=payment_order.provider_order_id,
            payment_id=body.razorpay_payment_id,
            customer_name=customer_name,
            customer_email=customer_email,
            coaching_plan=coaching_plan,
            pro_expires_at=pro_expires_at,
        )

    return VerifyPaymentResponse(
        verified=True,
        message="Payment verified successfully" if transitioned else "Payment already verified",
        pro_expires_at=pro_expires_at.isoformat() if pro_expires_at else None,
        payment_id=body.razorpay_payment_id,
    )


@router.post("/webhook/razorpay")
@limiter.limit("120/minute")
async def razorpay_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if not settings.razorpay_webhook_secret:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    raw_body = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    if not _verify_webhook_signature(raw_body, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    event = (payload.get("event") or "").strip()
    payment_entity = (((payload.get("payload") or {}).get("payment") or {}).get("entity") or {})
    payment_id = (payment_entity.get("id") or "").strip()
    order_id = (payment_entity.get("order_id") or "").strip()
    provider_status = (payment_entity.get("status") or "").strip().lower()
    provider_amount = int(payment_entity.get("amount") or 0)
    provider_currency = (payment_entity.get("currency") or "").strip().upper()

    if not order_id or not payment_id:
        return {"status": "ignored", "reason": "missing_order_or_payment_id"}
    if event not in {"payment.captured", "order.paid"}:
        return {"status": "ignored", "reason": f"event_{event or 'unknown'}"}
    if provider_status not in {"authorized", "captured"}:
        return {"status": "ignored", "reason": f"payment_status_{provider_status or 'unknown'}"}

    result = await db.execute(
        select(PaymentOrder).where(PaymentOrder.provider_order_id == order_id)
    )
    payment_order = result.scalar_one_or_none()
    if not payment_order:
        return {"status": "ignored", "reason": "order_not_found"}

    if provider_amount != int(payment_order.amount_paise) or provider_currency != (payment_order.currency or "INR").upper():
        payment_order.status = "failed"
        await db.commit()
        return {"status": "ignored", "reason": "amount_or_currency_mismatch"}

    pro_expires_at, transitioned, customer_name, customer_email, coaching_plan = await _finalize_successful_payment(
        db=db,
        payment_order=payment_order,
        payment_id=payment_id,
        signature=f"webhook:{event}",
    )
    if transitioned:
        _queue_payment_confirmation_emails(
            purpose=payment_order.purpose,
            amount_paise=payment_order.amount_paise,
            order_id=payment_order.provider_order_id,
            payment_id=payment_id,
            customer_name=customer_name,
            customer_email=customer_email,
            coaching_plan=coaching_plan,
            pro_expires_at=pro_expires_at,
        )

    return {"status": "ok", "transitioned": transitioned}
