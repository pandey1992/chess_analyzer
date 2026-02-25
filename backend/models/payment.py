from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from backend.database import Base


class PaymentOrder(Base):
    __tablename__ = "payment_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    purpose = Column(String, nullable=False, index=True)  # pro_monthly | coaching_booking
    amount_paise = Column(Integer, nullable=False)
    currency = Column(String, nullable=False, default="INR")
    status = Column(String, nullable=False, default="created", index=True)  # created | paid | failed
    provider_order_id = Column(String, unique=True, nullable=False, index=True)
    provider_payment_id = Column(String, nullable=True, index=True)
    provider_signature = Column(String, nullable=True)
    receipt = Column(String, nullable=False, unique=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    paid_at = Column(DateTime, nullable=True)


class UserEntitlement(Base):
    __tablename__ = "user_entitlements"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_user_entitlements_user_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    pro_expires_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CoachingBooking(Base):
    __tablename__ = "coaching_bookings"
    __table_args__ = (
        UniqueConstraint("payment_order_id", name="uq_coaching_bookings_payment_order_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    payment_order_id = Column(Integer, ForeignKey("payment_orders.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
