import asyncio
import json
import logging
import math
import re
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import settings
from backend.services.stockfish_analyzer import (
    analyze_game_pgn,
    analyze_games_batch,
    compute_lichess_phase_accuracy,
    win_probability,
)

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
        "User-Agent": "ChessAnalyzer/1.0 (Chess analysis tool; contact: chessaicoach.com)",
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


# ============================================================
# WEEKLY ACCURACY DASHBOARD ENDPOINTS
# ============================================================


@router.get("/lichess/dashboard/{username}")
@limiter.limit("10/minute")
async def lichess_dashboard(
    request: Request,
    username: str,
    game_types: str = Query(default="rapid,blitz,bullet", max_length=100),
):
    """
    Weekly accuracy dashboard for Lichess.
    Uses Lichess per-move evaluations (no Stockfish needed).
    Only fetches games with computer analysis (analysed=true).
    """
    if not USERNAME_PATTERN.match(username):
        raise HTTPException(status_code=400, detail="Invalid username format")

    game_type_list = [gt.strip() for gt in game_types.split(",")]
    perf_types = []
    for gt in game_type_list:
        if gt not in GAME_TYPE_TO_LICHESS:
            raise HTTPException(status_code=400, detail=f"Invalid game type: {gt}")
        perf_types.append(GAME_TYPE_TO_LICHESS[gt])

    # Last 7 days
    since_date = datetime.now() - timedelta(days=7)
    since_ms = int(since_date.timestamp() * 1000)

    headers = {
        "User-Agent": "ChessAnalyzer/1.0",
        "Accept": "application/x-ndjson",
    }

    params = {
        "since": since_ms,
        "perfType": ",".join(perf_types),
        "max": 100,
        "opening": "true",
        "pgnInJson": "true",
        "moves": "false",
        "clocks": "false",
        "evals": "true",
        "accuracy": "true",
        "analysed": "true",
        "rated": "true",
        "sort": "dateAsc",
    }

    raw_games = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        url = f"{settings.lichess_api_base}/games/user/{username}"
        try:
            response = await client.get(url, headers=headers, params=params)
            if response.status_code == 404:
                raise HTTPException(status_code=404, detail="User not found on Lichess")
            if response.status_code == 429:
                raise HTTPException(status_code=429, detail="Rate limited by Lichess")
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Lichess API error")

            for line in response.text.strip().split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    raw_games.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

        except httpx.RequestError as e:
            logger.error(f"Lichess dashboard API error: {e}")
            raise HTTPException(status_code=502, detail="Failed to connect to Lichess")

    if not raw_games:
        return _empty_dashboard(username, "lichess")

    # Process each game
    username_lower = username.lower()
    games_as_white = 0
    games_as_black = 0
    white_accuracies = []
    black_accuracies = []
    all_accuracies = []
    total_move_quality = {"inaccuracy": 0, "mistake": 0, "blunder": 0}
    phase_all = {"opening": [], "middlegame": [], "endgame": []}
    wins = 0
    losses = 0
    draws = 0
    game_accuracies = []

    for game in raw_games:
        players = game.get("players", {})
        white_player = players.get("white", {})
        black_player = players.get("black", {})
        white_user = white_player.get("user", {})
        black_user = black_player.get("user", {})

        is_white = white_user.get("id", "").lower() == username_lower or \
                   white_user.get("name", "").lower() == username_lower
        user_player = white_player if is_white else black_player
        opponent_player = black_player if is_white else white_player
        opponent_user = opponent_player.get("user", {})

        # Overall accuracy from Lichess
        user_analysis = user_player.get("analysis", {})
        game_accuracy = user_analysis.get("accuracy")
        if game_accuracy is None:
            continue

        # Count by color
        if is_white:
            games_as_white += 1
            white_accuracies.append(game_accuracy)
        else:
            games_as_black += 1
            black_accuracies.append(game_accuracy)

        all_accuracies.append(game_accuracy)

        # Move quality from Lichess analysis
        total_move_quality["inaccuracy"] += user_analysis.get("inaccuracy", 0)
        total_move_quality["mistake"] += user_analysis.get("mistake", 0)
        total_move_quality["blunder"] += user_analysis.get("blunder", 0)

        # Result
        winner = game.get("winner")
        if winner is None:
            draws += 1
            result = "draw"
        elif (winner == "white" and is_white) or (winner == "black" and not is_white):
            wins += 1
            result = "win"
        else:
            losses += 1
            result = "loss"

        # Phase accuracy from per-move evals
        analysis_evals = game.get("analysis", [])
        if analysis_evals:
            phase_result = compute_lichess_phase_accuracy(analysis_evals, is_white)
            for phase in ("opening", "middlegame", "endgame"):
                pa = phase_result["phase_accuracy"].get(phase, {})
                if pa.get("accuracy") is not None:
                    phase_all[phase].append(pa["accuracy"])

        # Game record for trend
        end_time = game.get("lastMoveAt", game.get("createdAt", 0))
        if end_time > 1e12:
            end_time = int(end_time / 1000)

        opening = game.get("opening", {})
        game_id = game.get("id", "")

        game_accuracies.append({
            "date": end_time,
            "accuracy": game_accuracy,
            "result": result,
            "opponent": opponent_user.get("name", opponent_user.get("id", "?")),
            "url": f"https://lichess.org/{game_id}",
            "color": "white" if is_white else "black",
            "opening": opening.get("name", "Unknown"),
        })

    # Build response
    total_games = len(all_accuracies)
    overall_acc = sum(all_accuracies) / total_games if total_games else 0

    period_start = since_date.strftime("%Y-%m-%d")
    period_end = datetime.now().strftime("%Y-%m-%d")

    return {
        "username": username,
        "platform": "lichess",
        "period": f"{period_start} to {period_end}",
        "total_analyzed_games": total_games,
        "games_as_white": games_as_white,
        "games_as_black": games_as_black,
        "overall": {
            "accuracy": round(overall_acc, 1),
            "wins": wins,
            "losses": losses,
            "draws": draws,
        },
        "by_color": {
            "white": {
                "accuracy": round(sum(white_accuracies) / len(white_accuracies), 1)
                if white_accuracies else None,
                "games": games_as_white,
            },
            "black": {
                "accuracy": round(sum(black_accuracies) / len(black_accuracies), 1)
                if black_accuracies else None,
                "games": games_as_black,
            },
        },
        "by_phase": {
            phase: {
                "accuracy": round(sum(accs) / len(accs), 1) if accs else None,
                "moves_analyzed": len(accs),
            }
            for phase, accs in phase_all.items()
        },
        "move_quality": total_move_quality,
        "game_accuracies": game_accuracies,
    }


@router.get("/dashboard/{username}")
@limiter.limit("5/minute")
async def chesscom_dashboard(
    request: Request,
    username: str,
    game_types: str = Query(default="rapid,blitz,bullet", max_length=100),
):
    """
    Weekly accuracy dashboard for Chess.com.
    Uses Stockfish to compute phase-level accuracy from PGNs.
    Limited to last 7 days of games.
    """
    if not USERNAME_PATTERN.match(username):
        raise HTTPException(status_code=400, detail="Invalid username format")

    game_type_list = [gt.strip() for gt in game_types.split(",")]
    for gt in game_type_list:
        if gt not in ALLOWED_GAME_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid game type: {gt}")

    # Fetch last 7 days from Chess.com (current month, maybe prev month)
    current_date = datetime.now()
    seven_days_ago = current_date - timedelta(days=7)

    headers = {
        "User-Agent": "ChessAnalyzer/1.0 (Chess analysis tool; contact: chessaicoach.com)",
        "Accept": "application/json",
    }

    all_games = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        months_to_check = set()
        months_to_check.add((current_date.year, current_date.month))
        months_to_check.add((seven_days_ago.year, seven_days_ago.month))

        for year, month in months_to_check:
            month_str = str(month).zfill(2)
            url = f"{settings.chess_com_api_base}/player/{username}/games/{year}/{month_str}"
            try:
                response = await client.get(url, headers=headers)
                if response.status_code == 404:
                    continue
                if response.status_code != 200:
                    continue

                data = response.json()
                if "games" in data:
                    for game in data["games"]:
                        if game.get("time_class") not in game_type_list:
                            continue
                        # Filter to last 7 days
                        end_time = game.get("end_time", 0)
                        game_date = datetime.fromtimestamp(end_time)
                        if game_date >= seven_days_ago:
                            all_games.append(game)
            except httpx.RequestError as e:
                logger.error(f"Chess.com dashboard API error: {e}")
                continue

    if not all_games:
        # Check if user exists
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(
                    f"{settings.chess_com_api_base}/player/{username}",
                    headers=headers,
                )
                if resp.status_code == 404:
                    raise HTTPException(status_code=404, detail="User not found on Chess.com")
            except httpx.RequestError:
                pass
        return _empty_dashboard(username, "chesscom")

    # Sort by most recent first and limit to 20 games for Stockfish analysis
    MAX_STOCKFISH_GAMES = 20
    all_games.sort(key=lambda g: g.get("end_time", 0), reverse=True)
    all_games = all_games[:MAX_STOCKFISH_GAMES]

    # Process games with Stockfish
    username_lower = username.lower()
    games_as_white = 0
    games_as_black = 0
    white_accuracies = []
    black_accuracies = []
    all_accuracies = []
    total_move_quality = {"inaccuracy": 0, "mistake": 0, "blunder": 0}
    phase_all = {"opening": [], "middlegame": [], "endgame": []}
    wins = 0
    losses = 0
    draws = 0
    game_accuracies = []

    stockfish_path = settings.stockfish_path

    logger.info(f"Chess.com dashboard: analyzing {len(all_games)} games (max {MAX_STOCKFISH_GAMES}) with Stockfish for {username}")

    for game in all_games:
        white_name = game.get("white", {}).get("username", "").lower()
        black_name = game.get("black", {}).get("username", "").lower()
        is_white = white_name == username_lower

        user_data = game.get("white", {}) if is_white else game.get("black", {})
        opp_data = game.get("black", {}) if is_white else game.get("white", {})

        # Chess.com overall accuracy
        accuracies = game.get("accuracies", {})
        game_accuracy = accuracies.get("white") if is_white else accuracies.get("black")

        if game_accuracy is None:
            continue

        # Count by color
        if is_white:
            games_as_white += 1
            white_accuracies.append(game_accuracy)
        else:
            games_as_black += 1
            black_accuracies.append(game_accuracy)

        all_accuracies.append(game_accuracy)

        # Result
        user_result = user_data.get("result", "")
        if user_result == "win":
            wins += 1
            result = "win"
        elif user_result in ("checkmated", "resigned", "timeout", "abandoned", "lose"):
            losses += 1
            result = "loss"
        else:
            draws += 1
            result = "draw"

        # Collect PGN for batch Stockfish analysis below
        pgn = game.get("pgn", "")

        # Game record for trend
        end_time = game.get("end_time", 0)
        opening_name = "Unknown"
        pgn_text = game.get("pgn", "")
        eco_match = re.search(r'\[ECOUrl ".*?/(.+?)"\]', pgn_text)
        if eco_match:
            opening_name = eco_match.group(1).replace("-", " ").title()

        game_accuracies.append({
            "date": end_time,
            "accuracy": round(game_accuracy, 1),
            "result": result,
            "opponent": opp_data.get("username", "?"),
            "url": game.get("url", ""),
            "color": "white" if is_white else "black",
            "opening": opening_name,
            "_pgn": pgn,  # Temporarily store PGN for Stockfish batch
        })

    # Batch Stockfish analysis - analyze all games with single engine instance
    games_for_stockfish = [
        {"pgn": ga.get("_pgn", ""), "username": username}
        for ga in game_accuracies
        if ga.get("_pgn")
    ]

    if games_for_stockfish:
        try:
            loop = asyncio.get_event_loop()
            logger.info(f"Running Stockfish batch analysis on {len(games_for_stockfish)} games (depth 15)...")
            batch_results = await loop.run_in_executor(
                None,
                analyze_games_batch,
                games_for_stockfish,
                stockfish_path,
                15,
            )
            logger.info(f"Stockfish batch done: {sum(1 for r in batch_results if r)}/{len(batch_results)} games analyzed")

            # Replace Chess.com accuracy with Stockfish accuracy for consistency
            stockfish_accuracies = []
            stockfish_white_accs = []
            stockfish_black_accs = []

            stockfish_idx = 0
            for ga in game_accuracies:
                if ga.get("_pgn"):
                    analysis = batch_results[stockfish_idx] if stockfish_idx < len(batch_results) else None
                    stockfish_idx += 1
                    if analysis:
                        sf_acc = analysis["overall_accuracy"]
                        stockfish_accuracies.append(sf_acc)
                        ga["accuracy"] = round(sf_acc, 1)  # Override with Stockfish accuracy

                        if ga["color"] == "white":
                            stockfish_white_accs.append(sf_acc)
                        else:
                            stockfish_black_accs.append(sf_acc)

                        for phase in ("opening", "middlegame", "endgame"):
                            pa = analysis["phase_accuracy"].get(phase, {})
                            if pa.get("accuracy") is not None:
                                phase_all[phase].append(pa["accuracy"])
                        total_move_quality["inaccuracy"] += analysis["move_quality"]["inaccuracy"]
                        total_move_quality["mistake"] += analysis["move_quality"]["mistake"]
                        total_move_quality["blunder"] += analysis["move_quality"]["blunder"]

            # Use Stockfish-computed accuracies for overall/by-color so they're
            # consistent with phase accuracy (same formula, same engine)
            if stockfish_accuracies:
                all_accuracies = stockfish_accuracies
                white_accuracies = stockfish_white_accs
                black_accuracies = stockfish_black_accs

        except Exception as e:
            logger.error(f"Batch Stockfish analysis failed: {e}", exc_info=True)

    # Clean up temporary PGN data from game_accuracies
    for ga in game_accuracies:
        ga.pop("_pgn", None)

    # Build response
    total_games = len(all_accuracies)
    overall_acc = sum(all_accuracies) / total_games if total_games else 0

    period_start = seven_days_ago.strftime("%Y-%m-%d")
    period_end = current_date.strftime("%Y-%m-%d")

    return {
        "username": username,
        "platform": "chesscom",
        "period": f"{period_start} to {period_end}",
        "total_analyzed_games": total_games,
        "games_as_white": games_as_white,
        "games_as_black": games_as_black,
        "overall": {
            "accuracy": round(overall_acc, 1),
            "wins": wins,
            "losses": losses,
            "draws": draws,
        },
        "by_color": {
            "white": {
                "accuracy": round(sum(white_accuracies) / len(white_accuracies), 1)
                if white_accuracies else None,
                "games": games_as_white,
            },
            "black": {
                "accuracy": round(sum(black_accuracies) / len(black_accuracies), 1)
                if black_accuracies else None,
                "games": games_as_black,
            },
        },
        "by_phase": {
            phase: {
                "accuracy": round(sum(accs) / len(accs), 1) if accs else None,
                "moves_analyzed": len(accs),
            }
            for phase, accs in phase_all.items()
        },
        "move_quality": total_move_quality,
        "game_accuracies": game_accuracies,
    }


def _empty_dashboard(username: str, platform: str) -> dict:
    """Return an empty dashboard response when no analyzed games are found."""
    now = datetime.now()
    week_ago = now - timedelta(days=7)
    return {
        "username": username,
        "platform": platform,
        "period": f"{week_ago.strftime('%Y-%m-%d')} to {now.strftime('%Y-%m-%d')}",
        "total_analyzed_games": 0,
        "games_as_white": 0,
        "games_as_black": 0,
        "overall": {"accuracy": None, "wins": 0, "losses": 0, "draws": 0},
        "by_color": {
            "white": {"accuracy": None, "games": 0},
            "black": {"accuracy": None, "games": 0},
        },
        "by_phase": {
            "opening": {"accuracy": None, "moves_analyzed": 0},
            "middlegame": {"accuracy": None, "moves_analyzed": 0},
            "endgame": {"accuracy": None, "moves_analyzed": 0},
        },
        "move_quality": {"inaccuracy": 0, "mistake": 0, "blunder": 0},
        "game_accuracies": [],
    }
