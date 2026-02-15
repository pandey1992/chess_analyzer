// Analysis logic - extracted from chess_analyzer_v2_with_study_plan.html
// All game analysis functions (verbatim from original)

function analyzeAndDisplay(games) {
    stats = initializeStats(); // Assign to global stats variable

    games.forEach(game => {
        processGame(game, stats);
    });

    stats.recentGames.sort((a, b) => b.date - a.date);
    stats.streaks = calculateStreaks(stats.recentGames);

    displayAll(stats);
}

function initializeStats() {
    return {
        totalGames: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        whiteWins: 0,
        whiteLosses: 0,
        whiteDraws: 0,
        blackWins: 0,
        blackLosses: 0,
        blackDraws: 0,
        openings: {},
        openingPhaseLosses: 0,
        middlegameLosses: 0,
        endgameLosses: 0,
        endgameTypes: {},
        timePressureLosses: 0,
        gamesByHour: {},
        recentGames: [],
        streaks: [],
        timeManagement: {
            lostInTimeTrouble: 0,
            wonInTimeTrouble: 0,
            lostWithGoodTime: 0,
            wonWithGoodTime: 0,
            byTimeControl: {}
        },
        gamesToReview: {
            quickCollapses: [],
            middlegameBlunders: [],
            openingDisasters: [],
            tacticalGames: []
        }
    };
}

function processGame(game, stats) {
    stats.totalGames++;
    const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
    const result = game.white.result;
    const opening = game.eco || 'Unknown';
    const openingName = extractOpeningName(game.pgn);
    const moveCount = countMoves(game.pgn);
    const gameDate = new Date(game.end_time * 1000);
    const hour = gameDate.getHours();
    const timeControl = game.time_class;

    // Track games by hour
    if (!stats.gamesByHour[hour]) {
        stats.gamesByHour[hour] = { wins: 0, losses: 0, draws: 0, total: 0 };
    }

    // Initialize opening stats
    if (!stats.openings[opening]) {
        stats.openings[opening] = {
            name: openingName,
            whiteWins: 0,
            whiteLosses: 0,
            whiteDraws: 0,
            blackWins: 0,
            blackLosses: 0,
            blackDraws: 0,
            totalGames: 0
        };
    }
    stats.openings[opening].totalGames++;

    // Time management tracking
    const lostOnTime = (isWhite && (result.includes('timeout') || result.includes('abandoned'))) ||
                       (!isWhite && (game.black.result.includes('timeout') || game.black.result.includes('abandoned')));
    const wonOnTime = (isWhite && (game.black.result.includes('timeout') || game.black.result.includes('abandoned'))) ||
                      (!isWhite && (result.includes('timeout') || result.includes('abandoned')));

    if (!stats.timeManagement.byTimeControl[timeControl]) {
        stats.timeManagement.byTimeControl[timeControl] = {
            wins: 0,
            losses: 0,
            draws: 0,
            timeoutLosses: 0,
            timeoutWins: 0
        };
    }

    // Process based on color and result
    let playerWon = false;
    let playerLost = false;
    let playerDrew = false;

    if (isWhite) {
        processWhiteGame(game, stats, result, opening, moveCount, hour, timeControl, lostOnTime, wonOnTime);
    } else {
        processBlackGame(game, stats, result, opening, moveCount, hour, timeControl, lostOnTime, wonOnTime);
    }

    // Determine result for recent games tracking
    if (isWhite) {
        if (result === 'win') playerWon = true;
        else if (result === 'lose' || result.includes('resigned') || result.includes('checkmated')) playerLost = true;
        else playerDrew = true;
    } else {
        if (result === 'win') playerLost = true;
        else if (result === 'lose' || result.includes('resigned') || result.includes('checkmated')) playerWon = true;
        else playerDrew = true;
    }

    stats.recentGames.push({
        result: playerWon ? 'win' : playerLost ? 'loss' : 'draw',
        date: game.end_time,
        opening: openingName,
        eco: opening
    });
}

function processWhiteGame(game, stats, result, opening, moveCount, hour, timeControl, lostOnTime, wonOnTime) {
    if (result === 'win') {
        stats.wins++;
        stats.whiteWins++;
        stats.openings[opening].whiteWins++;
        stats.gamesByHour[hour].wins++;
        stats.timeManagement.byTimeControl[timeControl].wins++;

        if (wonOnTime) {
            stats.timeManagement.timeoutWins++;
            stats.timeManagement.byTimeControl[timeControl].timeoutWins++;
            stats.timeManagement.wonInTimeTrouble++;
        } else {
            stats.timeManagement.wonWithGoodTime++;
        }
    } else if (result === 'lose' || result.includes('resigned') || result.includes('checkmated')) {
        stats.losses++;
        stats.whiteLosses++;
        stats.openings[opening].whiteLosses++;
        stats.gamesByHour[hour].losses++;
        stats.timeManagement.byTimeControl[timeControl].losses++;

        if (lostOnTime) {
            stats.timePressureLosses++;
            stats.timeManagement.lostInTimeTrouble++;
            stats.timeManagement.byTimeControl[timeControl].timeoutLosses++;
        } else {
            stats.timeManagement.lostWithGoodTime++;
        }

        // Games to review
        trackGamesToReview(game, stats, moveCount, timeControl, result, game.black.username, game.white.result);

        // Categorize loss by game phase
        categorizeLoss(game, stats, moveCount, game.black.username);
    } else {
        stats.draws++;
        stats.whiteDraws++;
        stats.openings[opening].whiteDraws++;
        stats.gamesByHour[hour].draws++;
        stats.timeManagement.byTimeControl[timeControl].draws++;
    }
    stats.gamesByHour[hour].total++;
}

function processBlackGame(game, stats, result, opening, moveCount, hour, timeControl, lostOnTime, wonOnTime) {
    if (result === 'win') {
        stats.losses++;
        stats.blackLosses++;
        stats.openings[opening].blackLosses++;
        stats.gamesByHour[hour].losses++;
        stats.timeManagement.byTimeControl[timeControl].losses++;

        if (lostOnTime) {
            stats.timePressureLosses++;
            stats.timeManagement.lostInTimeTrouble++;
            stats.timeManagement.byTimeControl[timeControl].timeoutLosses++;
        } else {
            stats.timeManagement.lostWithGoodTime++;
        }

        // Games to review
        trackGamesToReview(game, stats, moveCount, timeControl, game.black.result, game.white.username, game.black.result);

        // Categorize loss by game phase
        categorizeLoss(game, stats, moveCount, game.white.username);
    } else if (result === 'lose' || result.includes('resigned') || result.includes('checkmated')) {
        stats.wins++;
        stats.blackWins++;
        stats.openings[opening].blackWins++;
        stats.gamesByHour[hour].wins++;
        stats.timeManagement.byTimeControl[timeControl].wins++;

        if (wonOnTime) {
            stats.timeManagement.timeoutWins++;
            stats.timeManagement.byTimeControl[timeControl].timeoutWins++;
            stats.timeManagement.wonInTimeTrouble++;
        } else {
            stats.timeManagement.wonWithGoodTime++;
        }
    } else {
        stats.draws++;
        stats.blackDraws++;
        stats.openings[opening].blackDraws++;
        stats.gamesByHour[hour].draws++;
        stats.timeManagement.byTimeControl[timeControl].draws++;
    }
    stats.gamesByHour[hour].total++;
}

function trackGamesToReview(game, stats, moveCount, timeControl, result, opponent, resultString) {
    const captureCount = (game.pgn.match(/x/g) || []).length;
    const wasResignation = resultString.includes('resigned');
    const openingName = extractOpeningName(game.pgn);

    const gameToReview = {
        url: game.url,
        date: game.end_time,
        opponent: opponent,
        opening: openingName,
        moves: moveCount,
        timeControl: timeControl
    };

    if (moveCount < 25) {
        stats.gamesToReview.quickCollapses.push(gameToReview);
    }

    if (moveCount <= 15) {
        stats.gamesToReview.openingDisasters.push(gameToReview);
    }

    if (wasResignation && moveCount > 15 && moveCount <= 40) {
        stats.gamesToReview.middlegameBlunders.push(gameToReview);
    }

    if (captureCount >= 8) {
        stats.gamesToReview.tacticalGames.push({...gameToReview, captures: captureCount});
    }
}

function categorizeLoss(game, stats, moveCount, opponent) {
    if (moveCount <= 15) {
        stats.openingPhaseLosses++;
    } else if (moveCount <= 40) {
        stats.middlegameLosses++;
    } else {
        const downMaterial = isDownMaterial(game);

        if (downMaterial) {
            stats.middlegameLosses++;
        } else {
            stats.endgameLosses++;
            const endgameType = classifyEndgame(game.pgn);
            if (!stats.endgameTypes[endgameType]) {
                stats.endgameTypes[endgameType] = { losses: 0, games: [] };
            }
            stats.endgameTypes[endgameType].losses++;
            stats.endgameTypes[endgameType].games.push({
                url: game.url,
                date: game.end_time,
                opponent: opponent,
                moveCount: moveCount
            });
        }
    }
}

function isDownMaterial(game) {
    const pgn = game.pgn.toLowerCase();
    const moveCount = countMoves(game.pgn);

    if (moveCount >= 50) {
        return false;
    }

    if (moveCount >= 40 && moveCount < 50) {
        if (pgn.includes('resigns') || pgn.includes('resigned')) {
            const captures = (pgn.match(/x/g) || []).length;
            if (captures >= 8) {
                return true;
            }
        }

        if (pgn.includes('checkmate')) {
            const lastPart = pgn.slice(-500);
            if (lastPart.includes('q#') || lastPart.includes('r#')) {
                const queenCount = (lastPart.match(/q/g) || []).length;
                const rookCount = (lastPart.match(/r/g) || []).length;
                if (queenCount >= 2 || rookCount >= 2) {
                    return true;
                }
            }
        }
    }

    return false;
}

function classifyEndgame(pgn) {
    const moves = pgn.split(/\d+\./).filter(m => m.trim());
    if (moves.length === 0) return 'Unknown';

    const lastMoves = moves.slice(-15).join(' ').toLowerCase();
    const withoutPromotions = lastMoves.replace(/=[qrbn]/gi, '');

    const hasQueenMove = /q[a-h][1-8]/i.test(withoutPromotions);
    const hasRookMove = /r[a-h][1-8]/i.test(withoutPromotions);
    const hasBishopMove = /b[a-h][1-8]/i.test(withoutPromotions);
    const hasKnightMove = /n[a-h][1-8]/i.test(withoutPromotions);

    const pawnMoveCount = (withoutPromotions.match(/\b[a-h]x?[a-h]?[1-8]/g) || []).length;
    const kingMoveCount = (withoutPromotions.match(/k[a-h][1-8]/gi) || []).length;

    if (!hasQueenMove && !hasRookMove && !hasBishopMove && !hasKnightMove) {
        if (pawnMoveCount >= 3 || kingMoveCount >= 3) {
            return 'Pawn Endgame';
        }
    }

    const queenMoves = (withoutPromotions.match(/q[a-h][0-9]/gi) || []).length;
    const rookMoves = (withoutPromotions.match(/r[a-h][0-9]/gi) || []).length;
    const bishopMoves = (withoutPromotions.match(/b[a-h][0-9]/gi) || []).length;
    const knightMoves = (withoutPromotions.match(/n[a-h][0-9]/gi) || []).length;

    if (queenMoves >= 2 && rookMoves === 0 && bishopMoves === 0 && knightMoves === 0) {
        return 'Queen Endgame';
    } else if (queenMoves >= 1 && rookMoves >= 1) {
        return 'Queen vs Rook';
    } else if (queenMoves >= 1 && (bishopMoves > 0 || knightMoves > 0)) {
        return 'Queen + Minor Piece';
    } else if (rookMoves >= 2 && queenMoves === 0) {
        return 'Rook Endgame';
    } else if (rookMoves >= 1 && queenMoves === 0 && bishopMoves === 0 && knightMoves === 0) {
        return 'Rook Endgame';
    } else if (rookMoves === 1 && queenMoves === 0 && (bishopMoves > 0 || knightMoves > 0)) {
        return 'Rook + Minor Piece';
    } else if (bishopMoves > 0 && knightMoves > 0 && rookMoves === 0 && queenMoves === 0) {
        return 'Bishop vs Knight';
    } else if (bishopMoves >= 1 && knightMoves === 0 && rookMoves === 0 && queenMoves === 0) {
        return 'Bishop Endgame';
    } else if (knightMoves >= 1 && bishopMoves === 0 && rookMoves === 0 && queenMoves === 0) {
        return 'Knight Endgame';
    } else {
        return 'Complex Position';
    }
}

function countMoves(pgn) {
    const moves = pgn.match(/\d+\./g);
    return moves ? moves.length : 0;
}

function extractOpeningName(pgn) {
    // Try Chess.com ECOUrl first
    const chessComMatch = pgn.match(/\[ECOUrl ".*\/(.+)"\]/);
    if (chessComMatch && chessComMatch[1]) {
        return chessComMatch[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    // Try Lichess/standard PGN Opening header
    const openingMatch = pgn.match(/\[Opening "(.+?)"\]/);
    if (openingMatch && openingMatch[1]) {
        return openingMatch[1];
    }

    return 'Unknown Opening';
}

function calculateStreaks(recentGames) {
    const streaks = [];
    let currentStreak = { type: null, count: 0, games: [] };

    recentGames.slice(0, 20).forEach(game => {
        if (game.result === currentStreak.type) {
            currentStreak.count++;
            currentStreak.games.push(game);
        } else {
            if (currentStreak.count >= 3) {
                streaks.push({ ...currentStreak });
            }
            currentStreak = { type: game.result, count: 1, games: [game] };
        }
    });

    if (currentStreak.count >= 3) {
        streaks.push(currentStreak);
    }

    return streaks;
}
