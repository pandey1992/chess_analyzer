import logging
import re
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import settings

logger = logging.getLogger("chess_analyzer.chess_api")
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

ALLOWED_GAME_TYPES = {"rapid", "blitz", "bullet", "daily"}
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,50}$")


@router.get("/games/{username}")
@limiter.limit("20/minute")
async def fetch_games(
    request: Request,
    username: str,
    game_types: str = Query(default="rapid,blitz", max_length=100),
):
    """
    Proxy to Chess.com API. Fetches last 6 months of games.
    Eliminates CORS proxy dependency from frontend.
    """
    # Validate username format
    if not USERNAME_PATTERN.match(username):
        raise HTTPException(status_code=400, detail="Invalid username format")

    # Validate game types
    game_type_list = [gt.strip() for gt in game_types.split(",")]
    for gt in game_type_list:
        if gt not in ALLOWED_GAME_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid game type: {gt}. Allowed: {', '.join(ALLOWED_GAME_TYPES)}",
            )

    all_games = []
    current_date = datetime.now()

    headers = {
        "User-Agent": "ChessAnalyzer/1.0 (Chess analysis tool; contact: chessanalyzer.org)",
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        for i in range(6):
            month = current_date.month - i
            year = current_date.year
            while month <= 0:
                month += 12
                year -= 1
            month_str = str(month).zfill(2)

            url = f"{settings.chess_com_api_base}/player/{username}/games/{year}/{month_str}"

            try:
                response = await client.get(url, headers=headers)

                if response.status_code == 404:
                    continue
                if response.status_code == 429:
                    logger.warning(f"Chess.com rate limited us for {username} ({year}/{month_str})")
                    continue
                if response.status_code != 200:
                    logger.warning(f"Chess.com returned {response.status_code} for {username} ({year}/{month_str})")
                    continue

                data = response.json()
                if "games" in data:
                    filtered = [
                        game for game in data["games"]
                        if game.get("time_class") in game_type_list
                    ]
                    all_games.extend(filtered)

            except httpx.RequestError as e:
                logger.error(f"Chess.com API error for {username} ({year}/{month_str}): {e}")
                continue

    if not all_games:
        # Verify the user exists
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                user_check = await client.get(
                    f"{settings.chess_com_api_base}/player/{username}",
                    headers=headers,
                )
                if user_check.status_code == 404:
                    raise HTTPException(status_code=404, detail="User not found on Chess.com")
            except httpx.RequestError as e:
                logger.error(f"Chess.com user check failed for {username}: {e}")

    logger.info(f"Fetched {len(all_games)} games for {username}")
    return {"games": all_games, "total": len(all_games)}
