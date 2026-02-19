import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import settings
from backend.database import get_db
from backend.models.pro_puzzle import ProPuzzle, ProPuzzleAttempt
from backend.models.user import User
from backend.services.stockfish_analyzer import extract_mistake_puzzles
from backend.utils.helpers import oauth2_scheme, verify_token

logger = logging.getLogger("chess_analyzer.pro")
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


class PuzzleGameInput(BaseModel):
    pgn: str = Field(..., min_length=20)
    url: Optional[str] = None


class GeneratePuzzlesRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    games: List[PuzzleGameInput] = Field(default_factory=list)
    max_games: int = Field(default=15, ge=1, le=50)
    max_puzzles: int = Field(default=20, ge=1, le=50)
    min_cp_loss: int = Field(default=120, ge=60, le=500)


class ProPuzzleResponse(BaseModel):
    id: int
    fen: str
    move_number: int
    bad_move_san: Optional[str]
    best_move_hint: str
    hint_piece: Optional[str]
    hint_from_file: Optional[str]
    cp_loss: float
    game_url: Optional[str]
    created_at: str


class AttemptPuzzleRequest(BaseModel):
    move: str = Field(..., min_length=1, max_length=40)


class AttemptPuzzleResponse(BaseModel):
    correct: bool
    best_move: str
    message: str


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = verify_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def _normalize_move(move_text: str) -> str:
    normalized = move_text.strip().lower()
    for ch in ["+", "#", "!", "?", " "]:
        normalized = normalized.replace(ch, "")
    return normalized


def _to_puzzle_response(p: ProPuzzle) -> ProPuzzleResponse:
    san = (p.best_move_san or "").strip()
    if not san:
        hint_piece = None
    elif san[0] in {"K", "Q", "R", "B", "N"}:
        hint_piece = {
            "K": "King",
            "Q": "Queen",
            "R": "Rook",
            "B": "Bishop",
            "N": "Knight",
        }.get(san[0], None)
    else:
        hint_piece = "Pawn"

    hint_from_file = None
    if p.best_move_uci and len(p.best_move_uci) >= 2:
        f = p.best_move_uci[0].lower()
        if f in {"a", "b", "c", "d", "e", "f", "g", "h"}:
            hint_from_file = f

    return ProPuzzleResponse(
        id=p.id,
        fen=p.fen,
        move_number=p.move_number,
        bad_move_san=p.bad_move_san,
        best_move_hint="Find the best move for this position",
        hint_piece=hint_piece,
        hint_from_file=hint_from_file,
        cp_loss=round(float(p.cp_loss), 1),
        game_url=p.game_url,
        created_at=p.created_at.isoformat(),
    )


@router.post("/puzzles/generate")
@limiter.limit("10/minute")
async def generate_puzzles(
    request: Request,
    body: GeneratePuzzlesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not body.games:
        return {"generated": 0, "puzzles": []}

    stockfish_path = settings.stockfish_path
    generated = []
    dedupe = set()

    max_games_cfg = min(body.max_games, settings.pro_puzzle_max_games)
    max_puzzles_cfg = min(body.max_puzzles, settings.pro_puzzle_max_puzzles)
    depth_cfg = settings.pro_puzzle_depth
    fallback_depth_cfg = settings.pro_puzzle_fallback_depth

    # Render free tier protection: reduce CPU-heavy puzzle generation in production.
    if settings.is_production:
        max_games_cfg = min(max_games_cfg, 6)
        max_puzzles_cfg = min(max_puzzles_cfg, 10)
        depth_cfg = min(depth_cfg, 11)
        fallback_depth_cfg = min(fallback_depth_cfg, 9)

    selected_games = body.games[:max_games_cfg]
    max_per_game = max(1, max_puzzles_cfg // max(1, len(selected_games)))

    for game in selected_games:
        try:
            candidates = extract_mistake_puzzles(
                pgn_text=game.pgn,
                username=body.username,
                stockfish_path=stockfish_path,
                depth=depth_cfg,
                min_cp_loss=body.min_cp_loss,
                max_puzzles=max_per_game,
            )
        except Exception:
            logger.exception("Puzzle extraction failed for one game; continuing")
            continue
        for c in candidates:
            key = f"{c['fen']}|{c['best_move_uci']}"
            if key in dedupe:
                continue
            dedupe.add(key)
            puzzle = ProPuzzle(
                user_id=current_user.id,
                source_username=body.username,
                game_url=game.url,
                fen=c["fen"],
                move_number=c["move_number"],
                bad_move_san=c.get("bad_move_san"),
                bad_move_uci=c.get("bad_move_uci"),
                best_move_san=c["best_move_san"],
                best_move_uci=c["best_move_uci"],
                accepted_moves_json=json.dumps(c["accepted_moves"]),
                cp_loss=c["cp_loss"],
            )
            db.add(puzzle)
            generated.append(puzzle)
            if len(generated) >= max_puzzles_cfg:
                break
        if len(generated) >= max_puzzles_cfg:
            break

    # Fallback pass: if nothing generated, relax threshold to capture candidate mistakes.
    if not generated and body.min_cp_loss > 80:
        relaxed_threshold = 80
        for game in selected_games:
            try:
                candidates = extract_mistake_puzzles(
                    pgn_text=game.pgn,
                    username=body.username,
                    stockfish_path=stockfish_path,
                    depth=fallback_depth_cfg,
                    min_cp_loss=relaxed_threshold,
                    max_puzzles=max_per_game,
                )
            except Exception:
                logger.exception("Fallback puzzle extraction failed for one game; continuing")
                continue
            for c in candidates:
                key = f"{c['fen']}|{c['best_move_uci']}"
                if key in dedupe:
                    continue
                dedupe.add(key)
                puzzle = ProPuzzle(
                    user_id=current_user.id,
                    source_username=body.username,
                    game_url=game.url,
                    fen=c["fen"],
                    move_number=c["move_number"],
                    bad_move_san=c.get("bad_move_san"),
                    bad_move_uci=c.get("bad_move_uci"),
                    best_move_san=c["best_move_san"],
                    best_move_uci=c["best_move_uci"],
                    accepted_moves_json=json.dumps(c["accepted_moves"]),
                    cp_loss=c["cp_loss"],
                )
                db.add(puzzle)
                generated.append(puzzle)
                if len(generated) >= max_puzzles_cfg:
                    break
            if len(generated) >= max_puzzles_cfg:
                break

    if generated:
        await db.commit()
        for puzzle in generated:
            await db.refresh(puzzle)

    return {
        "generated": len(generated),
        "limits": {
            "max_games_used": max_games_cfg,
            "max_puzzles_used": max_puzzles_cfg,
            "depth_used": depth_cfg,
            "fallback_depth_used": fallback_depth_cfg,
        },
        "puzzles": [_to_puzzle_response(p).model_dump() for p in generated],
    }


@router.get("/puzzles")
@limiter.limit("30/minute")
async def list_puzzles(
    request: Request,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    limit = max(1, min(limit, 100))
    result = await db.execute(
        select(ProPuzzle)
        .where(ProPuzzle.user_id == current_user.id)
        .order_by(desc(ProPuzzle.created_at))
        .limit(limit)
    )
    puzzles = result.scalars().all()
    return {"puzzles": [_to_puzzle_response(p).model_dump() for p in puzzles]}


@router.post("/puzzles/{puzzle_id}/attempt", response_model=AttemptPuzzleResponse)
@limiter.limit("60/minute")
async def attempt_puzzle(
    puzzle_id: int,
    body: AttemptPuzzleRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProPuzzle).where(
            ProPuzzle.id == puzzle_id,
            ProPuzzle.user_id == current_user.id,
        )
    )
    puzzle = result.scalar_one_or_none()
    if not puzzle:
        raise HTTPException(status_code=404, detail="Puzzle not found")

    accepted = set(json.loads(puzzle.accepted_moves_json or "[]"))
    move = _normalize_move(body.move)
    correct = move in accepted

    db.add(
        ProPuzzleAttempt(
            puzzle_id=puzzle.id,
            user_id=current_user.id,
            submitted_move=body.move.strip(),
            is_correct=1 if correct else 0,
        )
    )
    await db.commit()

    if correct:
        return AttemptPuzzleResponse(
            correct=True,
            best_move=puzzle.best_move_san,
            message="Correct. Puzzle solved.",
        )
    return AttemptPuzzleResponse(
        correct=False,
        best_move=puzzle.best_move_san,
        message=f"Not quite. Best move was {puzzle.best_move_san}.",
    )
