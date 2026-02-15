import json
import logging
import re
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import settings

logger = logging.getLogger("chess_analyzer.chess_api")
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

ALLOWED_GAME_TYPES = {"rapid", "blitz", "bullet", "daily"}
LICHESS_ALLOWED_GAME_TYPES = {"rapid", "blitz", "bullet", "classical", "correspondence"}
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,50}$")

# Mapping from our generic game types to Lichess perfType values
GAME_TYPE_TO_LICHESS = {
    "rapid": "rapid",
    "blitz": "blitz",
    "bullet": "bullet",
    "daily": "correspondence",
}


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


@router.get("/lichess/games/{username}")
@limiter.limit("20/minute")
async def fetch_lichess_games(
    request: Request,
    username: str,
    game_types: str = Query(default="rapid,blitz", max_length=100),
):
    """
    Proxy to Lichess API. Fetches last 6 months of games.
    Returns games normalized to a common format compatible with the frontend analysis.
    """
    # Validate username format
    if not USERNAME_PATTERN.match(username):
        raise HTTPException(status_code=400, detail="Invalid username format")

    # Validate and map game types
    game_type_list = [gt.strip() for gt in game_types.split(",")]
    perf_types = []
    for gt in game_type_list:
        if gt not in GAME_TYPE_TO_LICHESS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid game type: {gt}. Allowed: {', '.join(GAME_TYPE_TO_LICHESS.keys())}",
            )
        perf_types.append(GAME_TYPE_TO_LICHESS[gt])

    # Calculate 6 months ago in milliseconds
    since_date = datetime.now() - timedelta(days=180)
    since_ms = int(since_date.timestamp() * 1000)

    headers = {
        "User-Agent": "ChessAnalyzer/1.0 (Chess analysis tool)",
        "Accept": "application/x-ndjson",
    }

    params = {
        "since": since_ms,
        "perfType": ",".join(perf_types),
        "max": 500,
        "opening": "true",
        "pgnInJson": "true",
        "moves": "true",
        "clocks": "false",
        "evals": "false",
        "rated": "true",
        "sort": "dateDesc",
    }

    all_games = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        url = f"{settings.lichess_api_base}/games/user/{username}"

        try:
            # Lichess streams NDJSON, read the full response
            response = await client.get(url, headers=headers, params=params)

            if response.status_code == 404:
                raise HTTPException(status_code=404, detail="User not found on Lichess")
            if response.status_code == 429:
                logger.warning(f"Lichess rate limited us for {username}")
                raise HTTPException(status_code=429, detail="Rate limited by Lichess. Please try again in a minute.")
            if response.status_code != 200:
                logger.warning(f"Lichess returned {response.status_code} for {username}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Lichess API error: {response.status_code}",
                )

            # Parse NDJSON (newline-delimited JSON)
            for line in response.text.strip().split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    game = json.loads(line)
                    normalized = _normalize_lichess_game(game, username)
                    if normalized:
                        all_games.append(normalized)
                except json.JSONDecodeError:
                    continue

        except httpx.RequestError as e:
            logger.error(f"Lichess API error for {username}: {e}")
            raise HTTPException(status_code=502, detail="Failed to connect to Lichess API")

    if not all_games:
        # Verify the user exists
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                user_check = await client.get(
                    f"{settings.lichess_api_base}/user/{username}",
                    headers={"Accept": "application/json"},
                )
                if user_check.status_code == 404:
                    raise HTTPException(status_code=404, detail="User not found on Lichess")
            except httpx.RequestError as e:
                logger.error(f"Lichess user check failed for {username}: {e}")

    logger.info(f"Fetched {len(all_games)} Lichess games for {username}")
    return {"games": all_games, "total": len(all_games)}


def _normalize_lichess_game(game: dict, username: str):
    """
    Normalize a Lichess game object to match the Chess.com format
    expected by the frontend analysis engine.
    """
    try:
        players = game.get("players", {})
        white_player = players.get("white", {})
        black_player = players.get("black", {})

        white_user = white_player.get("user", {})
        black_user = black_player.get("user", {})

        # Lichess uses 'winner' field + 'status' for results
        winner = game.get("winner")  # "white", "black", or absent (draw)
        status = game.get("status", "")  # "mate", "resign", "timeout", "draw", "stalemate", "outoftime"

        # Map to Chess.com-style result strings
        white_result = _lichess_result(winner, status, "white")
        black_result = _lichess_result(winner, status, "black")

        # Get opening info
        opening = game.get("opening", {})
        eco = opening.get("eco", "")
        opening_name = opening.get("name", "Unknown Opening")

        # Get PGN - Lichess provides it via pgnInJson
        pgn = game.get("pgn", "")

        # If no PGN but moves exist, construct a minimal PGN
        if not pgn and game.get("moves"):
            moves_str = game["moves"]
            # Lichess 'moves' is space-separated SAN moves
            # Build numbered PGN from SAN moves
            move_list = moves_str.split()
            pgn_moves = []
            for i in range(0, len(move_list), 2):
                move_num = (i // 2) + 1
                white_move = move_list[i]
                black_move = move_list[i + 1] if i + 1 < len(move_list) else ""
                if black_move:
                    pgn_moves.append(f"{move_num}. {white_move} {black_move}")
                else:
                    pgn_moves.append(f"{move_num}. {white_move}")
            # Add opening info as PGN headers
            pgn = f'[ECO "{eco}"]\n[Opening "{opening_name}"]\n\n' + " ".join(pgn_moves)

        # Map speed to time_class
        speed = game.get("speed", "")
        time_class = speed if speed in ("rapid", "blitz", "bullet") else "rapid"
        if speed == "classical":
            time_class = "rapid"
        elif speed in ("correspondence", "ultraBullet"):
            time_class = "daily" if speed == "correspondence" else "bullet"

        # Timestamps: Lichess uses milliseconds
        end_time = game.get("lastMoveAt", game.get("createdAt", 0))
        if end_time > 1e12:  # milliseconds -> seconds
            end_time = int(end_time / 1000)

        game_id = game.get("id", "")

        return {
            "white": {
                "username": white_user.get("name", white_user.get("id", "Anonymous")),
                "result": white_result,
                "rating": white_player.get("rating", 0),
            },
            "black": {
                "username": black_user.get("name", black_user.get("id", "Anonymous")),
                "result": black_result,
                "rating": black_player.get("rating", 0),
            },
            "pgn": pgn,
            "eco": eco,
            "url": f"https://lichess.org/{game_id}",
            "time_class": time_class,
            "end_time": end_time,
            "platform": "lichess",
        }

    except Exception as e:
        logger.warning(f"Failed to normalize Lichess game: {e}")
        return None


def _lichess_result(winner, status: str, color: str) -> str:
    """Convert Lichess winner/status into Chess.com-style result string."""
    if winner is None:
        # Draw
        if status == "stalemate":
            return "stalemate"
        return "agreed"  # generic draw

    if winner == color:
        return "win"
    else:
        # This color lost
        if status == "mate":
            return "checkmated"
        elif status == "resign":
            return "resigned"
        elif status in ("timeout", "outoftime"):
            return "timeout"
        elif status == "abandon":
            return "abandoned"
        else:
            return "lose"
