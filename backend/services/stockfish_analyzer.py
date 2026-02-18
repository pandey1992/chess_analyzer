"""
Stockfish-based game analysis for Chess.com games.
Computes per-move evaluations and phase-level accuracy.
"""
import io
import logging
import math
import os
from pathlib import Path
from typing import List, Dict, Optional

import chess
import chess.engine
import chess.pgn

logger = logging.getLogger("chess_analyzer.stockfish")

# Phase boundaries (full move numbers)
OPENING_END = 15       # moves 1-15
MIDDLEGAME_END = 30    # moves 16-30
# Endgame: moves 31+

# Move quality thresholds (centipawn loss)
INACCURACY_THRESHOLD = 50
MISTAKE_THRESHOLD = 100
BLUNDER_THRESHOLD = 200


def win_probability(cp: int) -> float:
    """Convert centipawn evaluation to win probability (0-100 scale, from white's perspective).
    Uses the Lichess formula: 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
    """
    return 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-0.00368208 * cp)) - 1.0)


def move_accuracy_from_wp(wp_before: float, wp_after: float) -> float:
    """Compute accuracy for a single move using win probability loss.

    Uses a steeper exponential decay that better matches Chess.com CAPS scores.
    The standard Lichess formula (coefficient -0.04354) is too generous.
    We use a steeper coefficient (-0.065) calibrated against Chess.com data:
    - 0 win% lost → ~100% accuracy (perfect move)
    - 3 win% lost → ~82% accuracy (good but not best)
    - 8 win% lost → ~60% accuracy (inaccuracy)
    - 15 win% lost → ~38% accuracy (mistake)
    - 25 win% lost → ~19% accuracy (blunder)
    """
    win_pct_lost = max(0.0, wp_before - wp_after)
    accuracy = 103.1668 * math.exp(-0.065 * win_pct_lost) - 3.1669
    return max(0.0, min(100.0, accuracy))


def aggregate_accuracy(accuracies: List[float]) -> float:
    """Aggregate per-move accuracies using harmonic-arithmetic mean blend.

    Uses the Lichess approach: average of arithmetic mean and harmonic mean.
    Harmonic mean heavily penalizes bad moves (blunders tank the score),
    while arithmetic mean represents the "typical" move quality.
    The blend gives a balanced result that punishes blunders appropriately.
    """
    if not accuracies:
        return 0.0

    # Arithmetic mean
    arith_mean = sum(accuracies) / len(accuracies)

    # Harmonic mean (use small floor to avoid division by zero)
    harmonic_sum = sum(1.0 / max(acc, 0.01) for acc in accuracies)
    harmonic_mean = len(accuracies) / harmonic_sum if harmonic_sum > 0 else 0.0

    # Blend: average of arithmetic and harmonic means
    return (arith_mean + harmonic_mean) / 2.0


def score_to_cp(score: chess.engine.PovScore, perspective: chess.Color) -> Optional[int]:
    """Convert PovScore to centipawns from given perspective. Returns None for mate."""
    pov = score.pov(perspective)
    if pov.is_mate():
        mate_in = pov.mate()
        if mate_in > 0:
            return 10000 - (mate_in * 10)  # winning mate
        else:
            return -10000 - (mate_in * 10)  # losing mate
    return pov.score()


def analyze_game_pgn(
    pgn_text: str,
    username: str,
    stockfish_path: str,
    depth: int = 15,
) -> Optional[Dict]:
    """
    Analyze a Chess.com game PGN with Stockfish.

    Returns dict with:
    - overall_accuracy: float
    - phase_accuracy: {opening, middlegame, endgame} each with accuracy + moves
    - move_quality: {inaccuracy, mistake, blunder} counts
    - per_move_evals: list of centipawn evals
    """
    # Resolve stockfish path
    if not os.path.isabs(stockfish_path):
        project_root = Path(__file__).parent.parent.parent
        resolved_path = project_root / stockfish_path
        if resolved_path.exists():
            stockfish_path = str(resolved_path)

    try:
        game = chess.pgn.read_game(io.StringIO(pgn_text))
        if game is None:
            logger.warning("Failed to parse PGN")
            return None

        board = game.board()
        moves = list(game.mainline_moves())

        if len(moves) < 4:
            return None  # Too short to analyze

        # Determine user color
        white_name = game.headers.get("White", "").lower()
        black_name = game.headers.get("Black", "").lower()
        username_lower = username.lower()

        if username_lower in white_name or white_name in username_lower:
            user_color = chess.WHITE
        elif username_lower in black_name or black_name in username_lower:
            user_color = chess.BLACK
        else:
            # Fallback: try matching
            user_color = chess.WHITE

        # Run Stockfish analysis
        engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)

        try:
            evals = []  # centipawn evals from white's perspective after each ply

            # Evaluate starting position
            info = engine.analyse(board, chess.engine.Limit(depth=depth))
            start_cp = score_to_cp(info["score"], chess.WHITE)
            if start_cp is None:
                start_cp = 0

            prev_cp = start_cp

            phase_moves = {"opening": [], "middlegame": [], "endgame": []}
            move_quality = {"inaccuracy": 0, "mistake": 0, "blunder": 0}
            all_user_accuracies = []

            for ply_index, move in enumerate(moves):
                is_white_move = (ply_index % 2 == 0)
                full_move_number = (ply_index // 2) + 1

                board.push(move)

                info = engine.analyse(board, chess.engine.Limit(depth=depth))
                current_cp = score_to_cp(info["score"], chess.WHITE)
                if current_cp is None:
                    current_cp = prev_cp  # Fallback

                evals.append(current_cp)

                # Determine if this is the user's move
                is_user_move = (is_white_move and user_color == chess.WHITE) or \
                               (not is_white_move and user_color == chess.BLACK)

                if is_user_move:
                    # Compute accuracy from win probabilities
                    wp_before = win_probability(prev_cp)
                    wp_after = win_probability(current_cp)

                    if user_color == chess.BLACK:
                        wp_before = 100.0 - wp_before
                        wp_after = 100.0 - wp_after

                    acc = move_accuracy_from_wp(wp_before, wp_after)
                    all_user_accuracies.append(acc)

                    # Centipawn loss (from user's perspective)
                    if user_color == chess.WHITE:
                        cp_loss = max(0, prev_cp - current_cp)
                    else:
                        cp_loss = max(0, current_cp - prev_cp)

                    # Classify move quality
                    if cp_loss >= BLUNDER_THRESHOLD:
                        move_quality["blunder"] += 1
                    elif cp_loss >= MISTAKE_THRESHOLD:
                        move_quality["mistake"] += 1
                    elif cp_loss >= INACCURACY_THRESHOLD:
                        move_quality["inaccuracy"] += 1

                    # Assign to phase
                    if full_move_number <= OPENING_END:
                        phase_moves["opening"].append(acc)
                    elif full_move_number <= MIDDLEGAME_END:
                        phase_moves["middlegame"].append(acc)
                    else:
                        phase_moves["endgame"].append(acc)

                prev_cp = current_cp

            # Compute aggregated results
            overall_accuracy = aggregate_accuracy(all_user_accuracies) \
                if all_user_accuracies else 0

            phase_accuracy = {}
            for phase, accs in phase_moves.items():
                if accs:
                    phase_accuracy[phase] = {
                        "accuracy": round(aggregate_accuracy(accs), 1),
                        "moves_analyzed": len(accs),
                    }
                else:
                    phase_accuracy[phase] = {
                        "accuracy": None,
                        "moves_analyzed": 0,
                    }

            return {
                "overall_accuracy": round(overall_accuracy, 1),
                "phase_accuracy": phase_accuracy,
                "move_quality": move_quality,
            }

        finally:
            engine.quit()

    except Exception as e:
        logger.error(f"Stockfish analysis failed: {e}")
        return None


def analyze_games_batch(
    games_pgn_data: List[Dict],
    stockfish_path: str,
    depth: int = 15,
) -> List[Optional[Dict]]:
    """
    Analyze multiple games with a single Stockfish engine instance.
    Much faster than opening/closing engine per game.

    games_pgn_data: list of dicts with 'pgn' and 'username' keys
    Returns: list of analysis results (same order as input, None for failed)
    """
    results = []
    engine = None

    # Resolve stockfish path - if relative, look in project root
    if not os.path.isabs(stockfish_path):
        project_root = Path(__file__).parent.parent.parent
        resolved_path = project_root / stockfish_path
        if resolved_path.exists():
            stockfish_path = str(resolved_path)

    try:
        engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)

        for game_data in games_pgn_data:
            pgn_text = game_data.get("pgn", "")
            username = game_data.get("username", "")

            if not pgn_text:
                results.append(None)
                continue

            try:
                result = _analyze_single_game(pgn_text, username, engine, depth)
                results.append(result)
            except Exception as e:
                logger.warning(f"Stockfish analysis failed for a game: {e}")
                results.append(None)

    except Exception as e:
        logger.error(f"Failed to start Stockfish engine: {e}")
        # Fill remaining with None
        while len(results) < len(games_pgn_data):
            results.append(None)
    finally:
        if engine:
            try:
                engine.quit()
            except Exception:
                pass

    return results


def _analyze_single_game(
    pgn_text: str,
    username: str,
    engine: chess.engine.SimpleEngine,
    depth: int = 15,
) -> Optional[Dict]:
    """Analyze a single PGN with an already-open Stockfish engine."""
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        return None

    board = game.board()
    moves = list(game.mainline_moves())

    if len(moves) < 4:
        return None

    # Determine user color
    white_name = game.headers.get("White", "").lower()
    black_name = game.headers.get("Black", "").lower()
    username_lower = username.lower()

    if username_lower in white_name or white_name in username_lower:
        user_color = chess.WHITE
    elif username_lower in black_name or black_name in username_lower:
        user_color = chess.BLACK
    else:
        user_color = chess.WHITE

    evals = []

    # Use depth limit + generous time cap for accurate analysis
    analysis_limit = chess.engine.Limit(depth=depth, time=2.0)

    # Evaluate starting position
    info = engine.analyse(board, analysis_limit)
    start_cp = score_to_cp(info["score"], chess.WHITE)
    if start_cp is None:
        start_cp = 0

    prev_cp = start_cp

    phase_moves = {"opening": [], "middlegame": [], "endgame": []}
    move_quality = {"inaccuracy": 0, "mistake": 0, "blunder": 0}
    all_user_accuracies = []

    for ply_index, move in enumerate(moves):
        is_white_move = (ply_index % 2 == 0)
        full_move_number = (ply_index // 2) + 1

        board.push(move)

        info = engine.analyse(board, analysis_limit)
        current_cp = score_to_cp(info["score"], chess.WHITE)
        if current_cp is None:
            current_cp = prev_cp

        evals.append(current_cp)

        is_user_move = (is_white_move and user_color == chess.WHITE) or \
                       (not is_white_move and user_color == chess.BLACK)

        if is_user_move:
            wp_before = win_probability(prev_cp)
            wp_after = win_probability(current_cp)

            if user_color == chess.BLACK:
                wp_before = 100.0 - wp_before
                wp_after = 100.0 - wp_after

            acc = move_accuracy_from_wp(wp_before, wp_after)
            all_user_accuracies.append(acc)

            if user_color == chess.WHITE:
                cp_loss = max(0, prev_cp - current_cp)
            else:
                cp_loss = max(0, current_cp - prev_cp)

            if cp_loss >= BLUNDER_THRESHOLD:
                move_quality["blunder"] += 1
            elif cp_loss >= MISTAKE_THRESHOLD:
                move_quality["mistake"] += 1
            elif cp_loss >= INACCURACY_THRESHOLD:
                move_quality["inaccuracy"] += 1

            if full_move_number <= OPENING_END:
                phase_moves["opening"].append(acc)
            elif full_move_number <= MIDDLEGAME_END:
                phase_moves["middlegame"].append(acc)
            else:
                phase_moves["endgame"].append(acc)

        prev_cp = current_cp

    overall_accuracy = aggregate_accuracy(all_user_accuracies) \
        if all_user_accuracies else 0

    phase_accuracy = {}
    for phase, accs in phase_moves.items():
        if accs:
            phase_accuracy[phase] = {
                "accuracy": round(aggregate_accuracy(accs), 1),
                "moves_analyzed": len(accs),
            }
        else:
            phase_accuracy[phase] = {
                "accuracy": None,
                "moves_analyzed": 0,
            }

    return {
        "overall_accuracy": round(overall_accuracy, 1),
        "phase_accuracy": phase_accuracy,
        "move_quality": move_quality,
    }


def extract_mistake_puzzles(
    pgn_text: str,
    username: str,
    stockfish_path: str,
    depth: int = 14,
    min_cp_loss: int = 120,
    max_puzzles: int = 5,
) -> List[Dict]:
    """
    Build puzzle candidates from user's bad moves.
    Each puzzle asks for the best move in the position before the bad move.
    """
    if max_puzzles <= 0:
        return []

    # Resolve stockfish path
    if not os.path.isabs(stockfish_path):
        project_root = Path(__file__).parent.parent.parent
        resolved_path = project_root / stockfish_path
        if resolved_path.exists():
            stockfish_path = str(resolved_path)

    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        return []

    board = game.board()
    moves = list(game.mainline_moves())
    if len(moves) < 4:
        return []

    white_name = game.headers.get("White", "").lower()
    black_name = game.headers.get("Black", "").lower()
    username_lower = username.lower()
    if username_lower in white_name or white_name in username_lower:
        user_color = chess.WHITE
    elif username_lower in black_name or black_name in username_lower:
        user_color = chess.BLACK
    else:
        user_color = chess.WHITE

    puzzles = []
    engine = None

    try:
        engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)
        analysis_limit = chess.engine.Limit(depth=depth, time=1.5)

        # Eval before any moves
        info = engine.analyse(board, analysis_limit)
        prev_cp = score_to_cp(info["score"], chess.WHITE)
        if prev_cp is None:
            prev_cp = 0

        for ply_index, move in enumerate(moves):
            is_white_move = (ply_index % 2 == 0)
            is_user_move = (is_white_move and user_color == chess.WHITE) or \
                           (not is_white_move and user_color == chess.BLACK)
            full_move_number = (ply_index // 2) + 1

            if is_user_move:
                # Position before user's move
                fen_before = board.fen()
                bad_move_san = board.san(move)
                bad_move_uci = move.uci()

                # Best line before user's move
                best_info = engine.analyse(board, analysis_limit, multipv=3)
                if isinstance(best_info, dict):
                    best_info = [best_info]

                best_pv = best_info[0].get("pv", []) if best_info else []
                if not best_pv:
                    board.push(move)
                    after_info = engine.analyse(board, analysis_limit)
                    current_cp = score_to_cp(after_info["score"], chess.WHITE)
                    if current_cp is None:
                        current_cp = prev_cp
                    prev_cp = current_cp
                    continue

                best_move = best_pv[0]
                best_move_uci = best_move.uci()
                best_move_san = board.san(best_move)

                # Eval after actual bad move
                board.push(move)
                after_info = engine.analyse(board, analysis_limit)
                current_cp = score_to_cp(after_info["score"], chess.WHITE)
                if current_cp is None:
                    current_cp = prev_cp

                if user_color == chess.WHITE:
                    cp_loss = max(0, prev_cp - current_cp)
                else:
                    cp_loss = max(0, current_cp - prev_cp)

                if cp_loss >= min_cp_loss:
                    accepted = {best_move_uci.lower(), _normalize_san(best_move_san)}
                    # Add secondary acceptable best lines
                    for line in best_info[1:]:
                        pv = line.get("pv", [])
                        if not pv:
                            continue
                        mv = pv[0]
                        accepted.add(mv.uci().lower())
                        try:
                            san = chess.Board(fen_before).san(mv)
                            accepted.add(_normalize_san(san))
                        except Exception:
                            pass

                    puzzles.append({
                        "fen": fen_before,
                        "move_number": full_move_number,
                        "bad_move_san": bad_move_san,
                        "bad_move_uci": bad_move_uci,
                        "best_move_san": best_move_san,
                        "best_move_uci": best_move_uci,
                        "accepted_moves": sorted([m for m in accepted if m]),
                        "cp_loss": round(float(cp_loss), 1),
                    })
                    if len(puzzles) >= max_puzzles:
                        break
            else:
                board.push(move)
                after_info = engine.analyse(board, analysis_limit)
                current_cp = score_to_cp(after_info["score"], chess.WHITE)
                if current_cp is None:
                    current_cp = prev_cp

            prev_cp = current_cp

    except Exception as e:
        logger.error("Failed to extract mistake puzzles: %s", e)
    finally:
        if engine:
            try:
                engine.quit()
            except Exception:
                pass

    return puzzles


def _normalize_san(move_text: str) -> str:
    if not move_text:
        return ""
    normalized = move_text.strip().lower()
    for ch in ["+", "#", "!", "?", " "]:
        normalized = normalized.replace(ch, "")
    return normalized


def compute_lichess_phase_accuracy(
    analysis_evals: List[Dict],
    is_white: bool,
) -> Dict:
    """
    Compute phase-level accuracy from Lichess per-move evaluations.
    No Stockfish needed - uses existing eval data from Lichess API.

    analysis_evals: list of dicts with 'eval' key (centipawns) per ply
    is_white: whether the user played white
    """
    user_offset = 0 if is_white else 1

    phase_moves = {"opening": [], "middlegame": [], "endgame": []}
    all_user_accuracies = []
    move_quality = {"inaccuracy": 0, "mistake": 0, "blunder": 0}

    for i in range(len(analysis_evals)):
        if i % 2 != user_offset:
            continue  # skip opponent moves
        if i == 0:
            continue  # no previous eval for first move

        curr = analysis_evals[i]
        prev = analysis_evals[i - 1]

        if "eval" not in curr or "eval" not in prev:
            continue

        # Win probability before and after
        wp_before = win_probability(prev["eval"])
        wp_after = win_probability(curr["eval"])

        if not is_white:
            wp_before = 100.0 - wp_before
            wp_after = 100.0 - wp_after

        acc = move_accuracy_from_wp(wp_before, wp_after)
        all_user_accuracies.append(acc)

        # Centipawn loss
        if is_white:
            cp_loss = max(0, prev["eval"] - curr["eval"])
        else:
            cp_loss = max(0, curr["eval"] - prev["eval"])

        if cp_loss >= BLUNDER_THRESHOLD:
            move_quality["blunder"] += 1
        elif cp_loss >= MISTAKE_THRESHOLD:
            move_quality["mistake"] += 1
        elif cp_loss >= INACCURACY_THRESHOLD:
            move_quality["inaccuracy"] += 1

        # Lichess judgments also provide quality info
        if "judgment" in curr:
            judgment_name = curr["judgment"].get("name", "").lower()
            # We already computed from cp_loss, so skip to avoid double counting

        full_move_number = (i // 2) + 1
        if full_move_number <= OPENING_END:
            phase_moves["opening"].append(acc)
        elif full_move_number <= MIDDLEGAME_END:
            phase_moves["middlegame"].append(acc)
        else:
            phase_moves["endgame"].append(acc)

    overall_accuracy = aggregate_accuracy(all_user_accuracies) \
        if all_user_accuracies else 0

    phase_accuracy = {}
    for phase, accs in phase_moves.items():
        if accs:
            phase_accuracy[phase] = {
                "accuracy": round(aggregate_accuracy(accs), 1),
                "moves_analyzed": len(accs),
            }
        else:
            phase_accuracy[phase] = {
                "accuracy": None,
                "moves_analyzed": 0,
            }

    return {
        "overall_accuracy": round(overall_accuracy, 1),
        "phase_accuracy": phase_accuracy,
        "move_quality": move_quality,
    }
