import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import settings

logger = logging.getLogger("chess_analyzer.groq_api")
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


class OpeningInfo(BaseModel):
    name: str
    win_rate: float
    record: str


class EndgameInfo(BaseModel):
    losses: int
    percentage: float


class StudyPlanRequest(BaseModel):
    username: str
    total_games: int
    wins: int
    losses: int
    draws: int
    opening_phase_losses: int
    middlegame_losses: int
    endgame_losses: int
    time_pressure_losses: int
    white_wins: int
    white_losses: int
    white_draws: int
    black_wins: int
    black_losses: int
    black_draws: int
    worst_openings: list[dict]
    best_openings: list[dict]
    endgame_types: Optional[dict] = None
    weaknesses: list[str] = []
    strengths: list[str] = []
    specific_issues: dict = {}


@router.post("/study-plan")
@limiter.limit("5/hour")
async def generate_study_plan(request_body: StudyPlanRequest, request: Request):
    """
    Accepts analysis stats from frontend, constructs prompt,
    calls Groq API with server-side API key.
    """
    total_losses = request_body.losses if request_body.losses > 0 else 1

    opening_pct = f"{(request_body.opening_phase_losses / total_losses * 100):.1f}"
    middlegame_pct = f"{(request_body.middlegame_losses / total_losses * 100):.1f}"
    endgame_pct = f"{(request_body.endgame_losses / total_losses * 100):.1f}"
    timeout_rate = f"{(request_body.time_pressure_losses / total_losses * 100):.1f}"

    # Determine worst phase
    phases = [
        ("Opening", request_body.opening_phase_losses),
        ("Middlegame", request_body.middlegame_losses),
        ("Endgame", request_body.endgame_losses),
    ]
    worst_phase = max(phases, key=lambda x: x[1])[0]

    # Color performance
    white_games = request_body.white_wins + request_body.white_losses + request_body.white_draws
    black_games = request_body.black_wins + request_body.black_losses + request_body.black_draws
    white_win_rate = f"{(request_body.white_wins / white_games * 100):.1f}" if white_games > 0 else "0"
    black_win_rate = f"{(request_body.black_wins / black_games * 100):.1f}" if black_games > 0 else "0"
    color_imbalance = abs(float(white_win_rate) - float(black_win_rate))

    overall_win_rate = f"{(request_body.wins / request_body.total_games * 100):.1f}" if request_body.total_games > 0 else "0"

    # Format openings
    worst_openings_text = ""
    if request_body.worst_openings:
        worst_openings_text = "Weakest Openings:\n" + "\n".join(
            f"  - {o.get('name', 'Unknown')}: {o.get('win_rate', 0)}% ({o.get('record', '')})"
            for o in request_body.worst_openings
        )
    else:
        worst_openings_text = "- Need more games for opening analysis"

    # Format endgame issues
    endgame_types_text = "- Endgame performance acceptable"
    specific_endgame_types = request_body.specific_issues.get("endgameTypes", [])
    if specific_endgame_types:
        endgame_types_text = "Specific endgame weaknesses:\n" + "\n".join(
            f"  - {t}" for t in specific_endgame_types
        )

    # Format weaknesses and strengths
    weaknesses_text = "\n".join(f"- {w}" for w in request_body.weaknesses) if request_body.weaknesses else "- General improvement needed"
    strengths_text = "\n".join(f"- {s}" for s in request_body.strengths) if request_body.strengths else "- Building on current foundation"

    # Build specific focus areas
    focus_areas = []
    if request_body.specific_issues.get("openingProblems"):
        focus_areas.append("- Opening theory and principles")
    if request_body.specific_issues.get("timePressure"):
        focus_areas.append("- Time management and clock discipline")
    if request_body.specific_issues.get("colorWeakness"):
        focus_areas.append(f"- {request_body.specific_issues['colorWeakness']} piece play")
    if request_body.specific_issues.get("endgameTypes"):
        focus_areas.append("- Endgame technique in: " + ", ".join(request_body.specific_issues["endgameTypes"]))
    focus_text = "\n".join(focus_areas)

    color_imbalance_text = ""
    if color_imbalance >= 12:
        color_imbalance_text = f"- Warning: IMBALANCE DETECTED: {color_imbalance:.1f}% difference"

    time_pressure_text = ""
    if request_body.time_pressure_losses >= total_losses * 0.15:
        time_pressure_text = "- Warning: CRITICAL TIME PRESSURE ISSUE"

    prompt = f"""You are a professional chess coach analyzing a tournament player's performance. Create a detailed, actionable 4-week study plan.

COMPREHENSIVE PLAYER STATISTICS:

OVERALL PERFORMANCE:
- Total Games Analyzed: {request_body.total_games}
- Win Rate: {overall_win_rate}%
- Record: {request_body.wins}W - {request_body.losses}L - {request_body.draws}D

CRITICAL WEAKNESSES (PRIORITIZE THESE):
{weaknesses_text}

PHASE BREAKDOWN:
- Opening Phase Losses: {request_body.opening_phase_losses} ({opening_pct}% of total losses)
- Middlegame Losses: {request_body.middlegame_losses} ({middlegame_pct}% of total losses)
- Endgame Losses: {request_body.endgame_losses} ({endgame_pct}% of total losses)
- WORST PHASE: {worst_phase}

COLOR PERFORMANCE:
- As White: {white_win_rate}% win rate ({request_body.white_wins}W - {request_body.white_losses}L - {request_body.white_draws}D)
- As Black: {black_win_rate}% win rate ({request_body.black_wins}W - {request_body.black_losses}L - {request_body.black_draws}D)
{color_imbalance_text}

TIME MANAGEMENT:
- Timeout Losses: {request_body.time_pressure_losses} ({timeout_rate}% of all losses)
{time_pressure_text}

OPENING REPERTOIRE:
{worst_openings_text}

ENDGAME ISSUES:
{endgame_types_text}

YOUR STRENGTHS:
{strengths_text}

SPECIFIC FOCUS AREAS IDENTIFIED:
{focus_text}

TASK: Create a comprehensive, personalized 4-week study plan that:

1. **PRIORITIZES THE MOST CRITICAL WEAKNESSES FIRST** (especially {worst_phase} phase and any critical issues)
2. Provides week-by-week breakdown with specific daily focus areas (30-60 min sessions)
3. Includes concrete, actionable tasks for each day
4. Recommends resources ONLY from the APPROVED LIST below — do NOT invent or hallucinate any URLs
5. Sets measurable improvement goals
6. Addresses time management if it's an issue
7. Balances opening study, tactical training, endgame practice, and game analysis
8. Makes it practical for someone with limited time

APPROVED RESOURCE LIST (use ONLY these links — do NOT generate any other URLs):
- Tactics Training: https://lichess.org/training (free unlimited puzzles)
- Endgame Puzzles: https://lichess.org/training/endgame
- Lichess Practice Positions: https://lichess.org/practice (common positions to master)
- Lichess Opening Explorer: https://lichess.org/opening
- Lichess Studies: https://lichess.org/study (community studies)
- Chess.com Lessons: https://www.chess.com/lessons
- Chess.com Opening Lessons: https://www.chess.com/lessons/openings
- Chess.com Strategy Lessons: https://www.chess.com/lessons/strategy
- Chess.com Puzzles: https://www.chess.com/puzzles
- Chess.com Endgame Practice: https://www.chess.com/practice/drills/endgame-practice
- Chess.com Opening Explorer: https://www.chess.com/openings
- YouTube — GothamChess (IM Levy Rozman): https://www.youtube.com/@GothamChess (openings, beginner-intermediate)
- YouTube — GM Daniel Naroditsky: https://www.youtube.com/@DanielNaroditskyGM (endgames, rating climbs, all levels)
- YouTube — Hanging Pawns (Stjepan Tomic): https://www.youtube.com/@HangingPawns (strategy, middlegame, advanced)
- YouTube — John Bartholomew (IM): https://www.youtube.com/@JohnBartholomewChess (structured lessons, climbing ratings)
- YouTube — ChessNetwork: https://www.youtube.com/@ChessNetwork (openings, master games)
- YouTube — St. Louis Chess Club: https://www.youtube.com/@STLChessClub (GM lectures, all topics)
- YouTube — Eric Rosen (IM): https://www.youtube.com/@Eric-Rosen (creative strategies, instructive)
- Book: "Silman's Complete Endgame Course" by Jeremy Silman (endgames)
- Book: "Logical Chess: Move by Move" by Irving Chernev (game understanding)
- Book: "My System" by Aron Nimzowitsch (positional play)
- Book: "Tactics Time" by Tim Brennan (tactical patterns)

IMPORTANT: When recommending YouTube channels, link to the channel URL from the list above. Do NOT create specific video links as they may not exist. Instead, say "Search [channel name] for [topic]".

Format each week clearly with:
## Week [Number]: [Theme]
### Day 1-7: Specific daily tasks
- Include exact exercises, puzzle counts, and resource recommendations from the approved list

Make this actionable and specific, not generic advice. The player needs concrete steps to improve."""

    system_message = "You are a professional chess coach with expertise in player development and personalized training plans. You create detailed, actionable study plans based on game analysis data."

    # Call Groq API
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {settings.groq_api_key}",
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": system_message},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.7,
                    "max_tokens": 4000,
                },
            )

            if response.status_code != 200:
                error_data = response.json()
                error_msg = error_data.get("error", {}).get("message", "Unknown error")
                logger.error(f"Groq API error {response.status_code}: {error_msg}")
                raise HTTPException(
                    status_code=502,
                    detail="AI service temporarily unavailable. Please try again later.",
                )

            data = response.json()
            plan = data["choices"][0]["message"]["content"]
            logger.info(f"Study plan generated for {request_body.username} ({request_body.total_games} games)")
            return {"plan": plan}

        except httpx.RequestError as e:
            logger.error(f"Groq API connection error: {e}")
            raise HTTPException(
                status_code=502,
                detail="AI service temporarily unavailable. Please try again later.",
            )
