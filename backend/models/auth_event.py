from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String

from backend.database import Base


class AuthEvent(Base):
    __tablename__ = "auth_events"
    __table_args__ = (
        Index("idx_auth_events_created_at", "created_at"),
        Index("idx_auth_events_event_type", "event_type"),
        Index("idx_auth_events_user_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    event_type = Column(String(20), nullable=False)  # signup | login
    email = Column(String, nullable=True)
    username = Column(String, nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
