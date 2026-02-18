from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, String, Text

from backend.database import Base


class ProPuzzle(Base):
    __tablename__ = "pro_puzzles"
    __table_args__ = (
        Index("idx_pro_puzzles_user_id", "user_id"),
        Index("idx_pro_puzzles_created_at", "created_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_username = Column(String(80), nullable=False)
    game_url = Column(String(500), nullable=True)
    fen = Column(Text, nullable=False)
    move_number = Column(Integer, nullable=False)
    bad_move_san = Column(String(40), nullable=True)
    bad_move_uci = Column(String(12), nullable=True)
    best_move_san = Column(String(40), nullable=False)
    best_move_uci = Column(String(12), nullable=False)
    accepted_moves_json = Column(Text, nullable=False)  # JSON list of SAN/UCI aliases
    cp_loss = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ProPuzzleAttempt(Base):
    __tablename__ = "pro_puzzle_attempts"
    __table_args__ = (
        Index("idx_pro_attempts_puzzle_id", "puzzle_id"),
        Index("idx_pro_attempts_user_id", "user_id"),
        Index("idx_pro_attempts_created_at", "created_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    puzzle_id = Column(Integer, ForeignKey("pro_puzzles.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    submitted_move = Column(String(40), nullable=False)
    is_correct = Column(Integer, nullable=False, default=0)  # 0/1 for sqlite compatibility
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
