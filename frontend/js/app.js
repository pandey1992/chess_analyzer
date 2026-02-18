// Main app orchestrator - Chess Analyzer
// Global state
let allGames = [];
let username = '';
let openingsVisible = 10;
let stats = {};
let currentPlatform = 'chesscom';
let proPuzzles = [];
let proPuzzleBoards = {};
let proPuzzleGames = {};

function selectPlatform(platform) {
    currentPlatform = platform;
}

async function startAnalysis() {
    console.log('Analysis button clicked');
    username = document.getElementById('username').value.trim();

    if (!username) {
        showError('Please enter a username');
        return;
    }

    const gameTypes = [];
    if (document.getElementById('rapid').checked) gameTypes.push('rapid');
    if (document.getElementById('blitz').checked) gameTypes.push('blitz');
    if (document.getElementById('bullet').checked) gameTypes.push('bullet');

    if (gameTypes.length === 0) {
        showError('Please select at least one game type');
        return;
    }

    hideError();
    showLoading();
    openingsVisible = 10;

    const platformName = currentPlatform === 'lichess' ? 'Lichess' : 'Chess.com';

    try {
        // Call backend API with platform selection
        allGames = await ChessAPI.fetchGames(username, gameTypes, currentPlatform);

        if (allGames.length === 0) {
            showError(`No games found for this user on ${platformName}`);
            hideLoading();
            return;
        }

        // Analysis stays client-side
        analyzeAndDisplay(allGames);
        hideLoading();
        showResults();

        // Fetch weekly accuracy dashboard in background
        fetchWeeklyDashboard(username, gameTypes);
        loadProPuzzles();
    } catch (error) {
        console.error('Error:', error);
        showError(error.message || `Failed to fetch games from ${platformName}. Please check the username.`);
        hideLoading();
    }
}

async function generateProPuzzles() {
    const section = document.getElementById('proPuzzleSection');
    const resultsEl = document.getElementById('proPuzzleResults');
    const btn = document.getElementById('generateProPuzzlesBtn');

    section.style.display = 'block';

    if (!Auth.isLoggedIn()) {
        resultsEl.innerHTML = `
            <div class="pro-puzzle-empty">
                Pro puzzle training requires login. Please log in to generate and save puzzles.
            </div>
        `;
        return;
    }

    if (!allGames || allGames.length === 0 || !username) {
        resultsEl.innerHTML = `
            <div class="pro-puzzle-empty">
                Analyze games first, then generate puzzles from your mistakes.
            </div>
        `;
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Generating puzzles...';
    resultsEl.innerHTML = '<div class="pro-puzzle-empty">Analyzing your bad moves and building puzzles...</div>';

    try {
        const selectedGames = [...allGames]
            .sort((a, b) => (b.end_time || 0) - (a.end_time || 0))
            .slice(0, 15)
            .filter(g => g.pgn)
            .map(g => ({ pgn: g.pgn, url: g.url || '' }));

        const data = await ChessAPI.generateProPuzzles(username, selectedGames, 15, 20, 120);
        proPuzzles = data.puzzles || [];
        renderProPuzzles();
    } catch (error) {
        resultsEl.innerHTML = `<div class="pro-puzzle-empty" style="color:#c53030;">${error.message}</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Puzzles From My Mistakes';
    }
}

async function loadProPuzzles() {
    const section = document.getElementById('proPuzzleSection');
    const resultsEl = document.getElementById('proPuzzleResults');
    if (!section || !resultsEl) return;

    section.style.display = 'block';
    if (!Auth.isLoggedIn()) {
        resultsEl.innerHTML = `
            <div class="pro-puzzle-empty">
                Continue as guest is enabled. Log in to use Pro puzzle training.
            </div>
        `;
        return;
    }

    try {
        const data = await ChessAPI.getProPuzzles(20);
        proPuzzles = data.puzzles || [];
        renderProPuzzles();
    } catch (error) {
        resultsEl.innerHTML = `<div class="pro-puzzle-empty" style="color:#c53030;">${error.message}</div>`;
    }
}

function renderProPuzzles() {
    const resultsEl = document.getElementById('proPuzzleResults');
    if (!resultsEl) return;

    if (!proPuzzles || proPuzzles.length === 0) {
        resultsEl.innerHTML = `
            <div class="pro-puzzle-empty">
                No puzzles yet. Click "Generate Puzzles From My Mistakes" after analysis.
            </div>
        `;
        return;
    }

    resultsEl.innerHTML = proPuzzles.map((p, index) => `
        <div class="pro-puzzle-card">
            <div class="pro-puzzle-head">
                <strong>Puzzle ${index + 1}</strong>
                <span class="pro-pill">Move ${p.move_number}</span>
                <span class="pro-pill danger">Eval Drop ${p.cp_loss}</span>
            </div>
            <div class="pro-puzzle-meta">Find the best move in this position.</div>
            <div class="pro-puzzle-board-wrap">
                <div id="puzzleBoard${p.id}" class="pro-puzzle-board"></div>
            </div>
            <div class="pro-puzzle-answer-row">
                <input id="puzzleMove${p.id}" class="pro-puzzle-input" type="text" placeholder="Enter your move (e.g. Nf3 or g1f3)">
                <button class="pro-puzzle-btn" onclick="submitProPuzzleAttempt(${p.id})">Check</button>
                <button class="pro-puzzle-btn secondary" onclick="resetProPuzzleBoard(${p.id})">Reset</button>
            </div>
            <div id="puzzleFeedback${p.id}" class="pro-puzzle-feedback"></div>
            <div class="pro-puzzle-fen">${p.fen}</div>
        </div>
    `).join('');

    requestAnimationFrame(initProPuzzleBoards);
}

function initProPuzzleBoards() {
    proPuzzleBoards = {};
    proPuzzleGames = {};

    if (typeof window.Chess === 'undefined' || typeof window.Chessboard === 'undefined') {
        proPuzzles.forEach((p) => {
            const el = document.getElementById(`puzzleBoard${p.id}`);
            if (el) {
                el.innerHTML = '<div class="pro-board-error">Board failed to load (missing chess libraries). Refresh page.</div>';
            }
        });
        return;
    }

    proPuzzles.forEach((p) => {
        const elId = `puzzleBoard${p.id}`;
        const el = document.getElementById(elId);
        if (!el) return;

        try {
            const sideToMove = (p.fen || '').split(' ')[1] || 'w';
            proPuzzleGames[p.id] = new window.Chess(p.fen);

            const board = window.Chessboard(elId, {
                position: p.fen,
                draggable: true,
                orientation: sideToMove === 'b' ? 'black' : 'white',
                pieceTheme: 'https://cdn.jsdelivr.net/npm/chessboardjs@1.0.0/www/img/chesspieces/wikipedia/{piece}.png',
                onDrop: (source, target) => onProPuzzleDrop(p.id, source, target),
                onSnapEnd: () => syncProPuzzleBoard(p.id)
            });
            proPuzzleBoards[p.id] = board;

            // Ensure board computes size correctly after layout settles.
            setTimeout(() => {
                try {
                    board.resize();
                    board.position(p.fen, false);
                } catch (e) {
                    // no-op
                }
            }, 60);
        } catch (error) {
            console.error('Puzzle board init failed:', error);
            el.innerHTML = '<div class="pro-board-error">Board failed to initialize. Try reloading page.</div>';
        }
    });
}

function onProPuzzleDrop(puzzleId, source, target) {
    const game = proPuzzleGames[puzzleId];
    if (!game) return 'snapback';

    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (!move) return 'snapback';

    const input = document.getElementById(`puzzleMove${puzzleId}`);
    if (input) input.value = move.san;

    submitProPuzzleAttempt(puzzleId, move.san);
    return undefined;
}

function syncProPuzzleBoard(puzzleId) {
    const board = proPuzzleBoards[puzzleId];
    const game = proPuzzleGames[puzzleId];
    if (board && game) {
        board.position(game.fen());
    }
}

function resetProPuzzleBoard(puzzleId) {
    const puzzle = proPuzzles.find(p => p.id === puzzleId);
    if (!puzzle) return;

    if (typeof window.Chess !== 'undefined') {
        proPuzzleGames[puzzleId] = new window.Chess(puzzle.fen);
    }
    const board = proPuzzleBoards[puzzleId];
    if (board) board.position(puzzle.fen, false);

    const feedback = document.getElementById(`puzzleFeedback${puzzleId}`);
    if (feedback) {
        feedback.textContent = '';
        feedback.className = 'pro-puzzle-feedback';
    }
}

async function submitProPuzzleAttempt(puzzleId, moveOverride = null) {
    const input = document.getElementById(`puzzleMove${puzzleId}`);
    const feedback = document.getElementById(`puzzleFeedback${puzzleId}`);
    if (!feedback) return;

    const move = moveOverride || (input ? input.value.trim() : '');
    if (!move) {
        feedback.textContent = 'Enter a move first.';
        feedback.className = 'pro-puzzle-feedback error';
        return;
    }

    feedback.textContent = 'Checking...';
    feedback.className = 'pro-puzzle-feedback';

    try {
        const result = await ChessAPI.attemptProPuzzle(puzzleId, move);
        feedback.textContent = result.message;
        feedback.className = result.correct ? 'pro-puzzle-feedback success' : 'pro-puzzle-feedback error';
        if (!result.correct) {
            setTimeout(() => resetProPuzzleBoard(puzzleId), 700);
        }
    } catch (error) {
        feedback.textContent = error.message || 'Could not submit answer.';
        feedback.className = 'pro-puzzle-feedback error';
    }
}

async function fetchWeeklyDashboard(username, gameTypes) {
    const dashboardSection = document.getElementById('dashboardSection');

    // Show loading state
    dashboardSection.style.display = 'block';
    dashboardSection.innerHTML = `
        <div class="dashboard-loading">
            <div class="spinner"></div>
            <p>Loading weekly accuracy dashboard${currentPlatform === 'chesscom' ? ' (deep-analyzing up to 20 games with Stockfish at depth 15 — this may take a few minutes...)' : ''}...</p>
        </div>
    `;

    try {
        const dashboardData = await ChessAPI.fetchDashboard(username, gameTypes, currentPlatform);

        if (dashboardData.total_analyzed_games === 0) {
            dashboardSection.innerHTML = `
                <div class="chart-container" style="text-align: center; padding: 30px;">
                    <h2>📊 Weekly Accuracy Dashboard</h2>
                    <p style="color: #718096; margin-top: 12px;">No analyzed games found for the past week.
                    ${currentPlatform === 'lichess' ? 'Request computer analysis on your Lichess games to see accuracy data.' : ''}</p>
                </div>
            `;
            return;
        }

        displayDashboard(dashboardData);
    } catch (error) {
        console.error('Dashboard error:', error);
        dashboardSection.innerHTML = `
            <div class="chart-container" style="text-align: center; padding: 30px;">
                <h2>📊 Weekly Accuracy Dashboard</h2>
                <p style="color: #e53e3e; margin-top: 12px;">Could not load dashboard: ${error.message}</p>
            </div>
        `;
    }
}

async function generateStudyPlan() {
    const studyPlanBtn = document.getElementById('generateStudyPlanBtn');
    const studyPlanSection = document.getElementById('studyPlanResults');

    // Check if stats is available
    if (!stats || !stats.totalGames) {
        studyPlanSection.innerHTML = `
            <div style="background: #fed7d7; color: #c53030; padding: 24px; border-radius: 12px; margin-top: 20px;">
                <h3>⚠️ No Analysis Data Found</h3>
                <p>Please analyze your games first before generating a study plan.</p>
                <p style="margin-top: 12px;">Click "Analyze Games" at the top to get started!</p>
            </div>
        `;
        studyPlanSection.style.display = 'block';
        return;
    }

    studyPlanBtn.disabled = true;
    studyPlanBtn.textContent = '🤖 Generating Your Personalized Study Plan...';
    studyPlanSection.innerHTML = '<div class="spinner" style="margin: 40px auto;"></div><p style="text-align: center; color: white;">Analyzing your games and creating custom recommendations...</p>';
    studyPlanSection.style.display = 'block';

    try {
        // Build weaknesses and strengths for display
        const { weaknesses, strengths, specificIssues } = computeWeaknessesAndStrengths(stats);

        // Build stats payload for backend
        const statsPayload = buildStatsPayload(stats, weaknesses, strengths, specificIssues);

        // Call backend API (no API key in frontend!)
        const plan = await ChessAPI.generateStudyPlan(statsPayload);
        displayStudyPlan(plan, weaknesses, strengths);

    } catch (error) {
        console.error('Error generating study plan:', error);

        let errorMessage = error.message;
        let helpText = '';

        if (error.message.includes('rate_limit') || error.message.includes('429')) {
            errorMessage = 'Rate limit reached. Please try again in a few minutes.';
            helpText = '<p style="margin-top: 12px;">The AI service is temporarily rate-limited. Please wait a moment and try again.</p>';
        } else if (error.message.includes('api_key') || error.message.includes('401') || error.message.includes('invalid')) {
            errorMessage = 'API authentication failed.';
            helpText = '<p style="margin-top: 12px;">This might be a temporary issue. Try refreshing the page and trying again.</p>';
        } else {
            helpText = '<p style="margin-top: 12px;">If the problem persists, please try again later.</p>';
        }

        studyPlanSection.innerHTML = `
            <div style="background: #fed7d7; color: #c53030; padding: 24px; border-radius: 12px; margin-top: 20px;">
                <h3>⚠️ Error Generating Study Plan</h3>
                <p>${errorMessage}</p>
                ${helpText}
            </div>
        `;
    } finally {
        studyPlanBtn.disabled = false;
        studyPlanBtn.textContent = '🤖 Generate My Study Plan';
    }
}

function computeWeaknessesAndStrengths(stats) {
    const weaknesses = [];
    const strengths = [];
    const specificIssues = {};

    const totalLosses = stats.losses || 1;
    const openingPct = ((stats.openingPhaseLosses / totalLosses) * 100).toFixed(1);
    const middlegamePct = ((stats.middlegameLosses / totalLosses) * 100).toFixed(1);
    const endgamePct = ((stats.endgameLosses / totalLosses) * 100).toFixed(1);

    // Worst phase
    const worstPhase = [
        { name: 'Opening', count: stats.openingPhaseLosses },
        { name: 'Middlegame', count: stats.middlegameLosses },
        { name: 'Endgame', count: stats.endgameLosses }
    ].sort((a, b) => b.count - a.count)[0];
    specificIssues.worstPhase = worstPhase.name;

    if (stats.openingPhaseLosses >= totalLosses * 0.3) {
        weaknesses.push(`CRITICAL: Opening phase weakness (${stats.openingPhaseLosses} losses, ${openingPct}% of all losses)`);
        specificIssues.openingProblems = true;
    }
    if (stats.middlegameLosses >= totalLosses * 0.3) {
        weaknesses.push(`Middlegame tactical issues (${stats.middlegameLosses} losses, ${middlegamePct}% of all losses)`);
    }
    if (stats.endgameLosses >= totalLosses * 0.3) {
        weaknesses.push(`Endgame technique needs work (${stats.endgameLosses} losses, ${endgamePct}% of all losses)`);
    }

    // Time pressure
    const timeoutRate = ((stats.timePressureLosses / totalLosses) * 100).toFixed(1);
    if (stats.timePressureLosses >= totalLosses * 0.15) {
        weaknesses.push(`CRITICAL: Time management problems (${stats.timePressureLosses} timeout losses, ${timeoutRate}% of losses)`);
        specificIssues.timePressure = true;
    }

    // Color performance
    const whiteGames = stats.whiteWins + stats.whiteLosses + stats.whiteDraws;
    const blackGames = stats.blackWins + stats.blackLosses + stats.blackDraws;
    const whiteWinRate = whiteGames > 0 ? ((stats.whiteWins / whiteGames) * 100).toFixed(1) : 0;
    const blackWinRate = blackGames > 0 ? ((stats.blackWins / blackGames) * 100).toFixed(1) : 0;
    const colorImbalance = Math.abs(whiteWinRate - blackWinRate);

    if (colorImbalance >= 12) {
        const weakerColor = whiteWinRate < blackWinRate ? 'White' : 'Black';
        weaknesses.push(`${weakerColor} piece performance is weak (White: ${whiteWinRate}% vs Black: ${blackWinRate}%)`);
        specificIssues.colorWeakness = weakerColor;
    }

    // Opening analysis - FIXED: use correct property names (whiteWins+blackWins instead of data.wins)
    const openingPerformance = Object.entries(stats.openings)
        .map(([eco, data]) => ({
            eco,
            name: data.name,
            wins: data.whiteWins + data.blackWins,
            losses: data.whiteLosses + data.blackLosses,
            draws: data.whiteDraws + data.blackDraws,
            total: data.totalGames,
            winRate: (((data.whiteWins + data.blackWins) / data.totalGames) * 100).toFixed(1)
        }))
        .filter(o => o.total >= 3)
        .sort((a, b) => a.winRate - b.winRate);

    const worstOpenings = openingPerformance.slice(0, 3);
    const bestOpenings = openingPerformance.slice(-2).reverse();

    if (worstOpenings.length > 0) {
        worstOpenings.forEach(opening => {
            if (opening.winRate < 40) {
                weaknesses.push(`Struggling with ${opening.name} (${opening.wins}-${opening.losses}-${opening.draws}, ${opening.winRate}% win rate)`);
            }
        });
    }

    if (bestOpenings.length > 0) {
        bestOpenings.forEach(opening => {
            if (opening.winRate > 55) {
                strengths.push(`Strong in ${opening.name} (${opening.wins}-${opening.losses}-${opening.draws}, ${opening.winRate}% win rate)`);
            }
        });
    }

    // Endgame types
    if (stats.endgameLosses > 0 && stats.endgameTypes) {
        const endgameData = Object.entries(stats.endgameTypes)
            .map(([type, data]) => ({
                type,
                losses: data.losses,
                percentage: ((data.losses / stats.endgameLosses) * 100).toFixed(1)
            }))
            .sort((a, b) => b.losses - a.losses);

        const worstEndgames = endgameData.filter(e => e.losses >= 3).slice(0, 3);
        if (worstEndgames.length > 0) {
            specificIssues.endgameTypes = worstEndgames.map(e => e.type);
            worstEndgames.forEach(endgame => {
                weaknesses.push(`Weak in ${endgame.type} endgames (${endgame.losses} losses, ${endgame.percentage}% of endgame losses)`);
            });
        }
    }

    return { weaknesses, strengths, specificIssues };
}

function buildStatsPayload(stats, weaknesses, strengths, specificIssues) {
    // Opening analysis for payload
    const openingPerformance = Object.entries(stats.openings)
        .map(([eco, data]) => ({
            eco,
            name: data.name,
            wins: data.whiteWins + data.blackWins,
            losses: data.whiteLosses + data.blackLosses,
            draws: data.whiteDraws + data.blackDraws,
            total: data.totalGames,
            winRate: (((data.whiteWins + data.blackWins) / data.totalGames) * 100).toFixed(1)
        }))
        .filter(o => o.total >= 3)
        .sort((a, b) => a.winRate - b.winRate);

    const worstOpenings = openingPerformance.slice(0, 3).map(o => ({
        name: o.name,
        win_rate: parseFloat(o.winRate),
        record: `${o.wins}-${o.losses}-${o.draws}`
    }));

    const bestOpenings = openingPerformance.slice(-2).reverse().map(o => ({
        name: o.name,
        win_rate: parseFloat(o.winRate),
        record: `${o.wins}-${o.losses}-${o.draws}`
    }));

    return {
        username,
        total_games: stats.totalGames,
        wins: stats.wins,
        losses: stats.losses,
        draws: stats.draws,
        opening_phase_losses: stats.openingPhaseLosses,
        middlegame_losses: stats.middlegameLosses,
        endgame_losses: stats.endgameLosses,
        time_pressure_losses: stats.timePressureLosses,
        white_wins: stats.whiteWins,
        white_losses: stats.whiteLosses,
        white_draws: stats.whiteDraws,
        black_wins: stats.blackWins,
        black_losses: stats.blackLosses,
        black_draws: stats.blackDraws,
        worst_openings: worstOpenings,
        best_openings: bestOpenings,
        endgame_types: stats.endgameTypes ? Object.fromEntries(
            Object.entries(stats.endgameTypes).map(([type, data]) => [type, { losses: data.losses }])
        ) : {},
        weaknesses: weaknesses,
        strengths: strengths,
        specific_issues: specificIssues
    };
}

function downloadStudyPlan() {
    if (!window.currentStudyPlan) return;

    const blob = new Blob([`
CHESS STUDY PLAN
Generated: ${new Date().toLocaleDateString()}
Based on analysis of ${stats.totalGames} games

${window.currentStudyPlan}

---
Generated by Chess AI Coach
    `], { type: 'text/plain' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chess-study-plan-${username}-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function copyStudyPlan() {
    if (!window.currentStudyPlan) return;

    navigator.clipboard.writeText(window.currentStudyPlan).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '✅ Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    });
}

function emailStudyPlan() {
    if (!window.currentStudyPlan) return;

    const subject = encodeURIComponent(`Chess Study Plan - ${username}`);
    const body = encodeURIComponent(`
My Personalized Chess Study Plan
Generated: ${new Date().toLocaleDateString()}

${window.currentStudyPlan}
    `);

    window.open(`mailto:?subject=${subject}&body=${body}`);
}

// Modal close on background click
window.onclick = function(event) {
    const modal = document.getElementById('gameModal');
    if (event.target === modal) {
        closeModal();
    }
}

// ==================== App Initialization ====================
let appInitialized = false;

async function initApp() {
    if (appInitialized) return;
    appInitialized = true;

    // Check if user is already logged in, but do not block router boot.
    try {
        await Promise.race([
            Auth.checkAuth(),
            new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
    } catch (error) {
        console.warn('Auth check failed during startup:', error);
    }

    // Initialize the router (shows correct page based on hash + auth state)
    Router.init();

    console.log('Chess AI Coach loaded successfully');
}

// Initialize safely whether script runs before or after DOMContentLoaded.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
    initApp();
}
