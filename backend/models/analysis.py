from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index

from backend.database import Base


class AnalysisCache(Base):
    __tablename__ = "analysis_cache"
    __table_args__ = (
        Index("idx_cache_username_types", "chess_com_username", "game_types"),
        Index("idx_cache_expires_at", "expires_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    chess_com_username = Column(String, index=True, nullable=False)
    game_types = Column(String, nullable=False)
    raw_games_json = Column(Text, nullable=False)
    fetched_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)


class StudyPlan(Base):
    __tablename__ = "study_plans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    chess_com_username = Column(String, nullable=False)
    plan_text = Column(Text, nullable=False)
    stats_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
