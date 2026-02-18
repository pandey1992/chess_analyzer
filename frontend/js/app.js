// Main app orchestrator - Chess Analyzer
// Global state
let allGames = [];
let username = '';
let openingsVisible = 10;
let stats = {};
let currentPlatform = 'chesscom';
let proPuzzles = [];
let proPuzzleBoards = {};
let proPuzzleCurrentIndex = 0;
let proPuzzleProgress = {};
let proPuzzleDragSource = null;

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
        proPuzzleCurrentIndex = 0;
        proPuzzleProgress = {};
        proPuzzleBoards = {};
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
        proPuzzleCurrentIndex = 0;
        proPuzzleProgress = {};
        proPuzzleBoards = {};
        renderProPuzzles();
    } catch (error) {
        resultsEl.innerHTML = `<div class="pro-puzzle-empty" style="color:#c53030;">${error.message}</div>`;
    }
}

// ==================== Pro Puzzle Player (single-window flow) ====================
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

    if (proPuzzleCurrentIndex < 0 || proPuzzleCurrentIndex >= proPuzzles.length) {
        proPuzzleCurrentIndex = 0;
    }

    proPuzzles.forEach((p) => {
        if (!proPuzzleProgress[p.id]) {
            proPuzzleProgress[p.id] = { status: 'unsolved', attempts: 0 };
        }
    });

    resultsEl.innerHTML = `
        <div class="pro-player">
            <div class="pro-player-header">
                <div>
                    <div id="proPuzzleTitle" class="pro-player-title"></div>
                    <div id="proPuzzleSub" class="pro-player-sub"></div>
                </div>
                <div class="pro-player-stats">
                    <span id="proRemainingPill" class="pro-pill"></span>
                    <span id="proSolvedPill" class="pro-pill"></span>
                    <span id="proSkippedPill" class="pro-pill"></span>
                </div>
            </div>
            <div id="proToMove" class="pro-to-move"></div>
            <div id="proPuzzleBoard" class="pro-puzzle-board"></div>
            <div id="proPuzzleFeedback" class="pro-puzzle-feedback"></div>
            <div class="pro-player-nav">
                <button class="pro-puzzle-btn secondary" onclick="resetCurrentProPuzzle()">Reset</button>
                <button class="pro-puzzle-btn secondary" onclick="goPrevProPuzzle()">Previous</button>
                <button class="pro-puzzle-btn secondary" onclick="skipCurrentProPuzzle()">Skip</button>
                <button class="pro-puzzle-btn secondary" onclick="goNextProPuzzle()">Next</button>
            </div>
        </div>
    `;

    renderCurrentProPuzzle();
}

function renderCurrentProPuzzle() {
    const puzzle = proPuzzles[proPuzzleCurrentIndex];
    if (!puzzle) return;

    const status = proPuzzleProgress[puzzle.id]?.status || 'unsolved';
    const solved = Object.values(proPuzzleProgress).filter(p => p.status === 'solved').length;
    const skipped = Object.values(proPuzzleProgress).filter(p => p.status === 'skipped').length;
    const remaining = proPuzzles.length - solved - skipped;

    const title = document.getElementById('proPuzzleTitle');
    const sub = document.getElementById('proPuzzleSub');
    const toMoveEl = document.getElementById('proToMove');
    const feedback = document.getElementById('proPuzzleFeedback');

    if (title) title.textContent = `Puzzle ${proPuzzleCurrentIndex + 1} / ${proPuzzles.length}`;
    if (sub) sub.textContent = `Move ${puzzle.move_number} | Eval Drop ${puzzle.cp_loss} | ${status.toUpperCase()}`;
    if (feedback) {
        feedback.textContent = '';
        feedback.className = 'pro-puzzle-feedback';
    }

    const remainingPill = document.getElementById('proRemainingPill');
    const solvedPill = document.getElementById('proSolvedPill');
    const skippedPill = document.getElementById('proSkippedPill');
    if (remainingPill) remainingPill.textContent = `Remaining ${remaining}`;
    if (solvedPill) solvedPill.textContent = `Solved ${solved}`;
    if (skippedPill) skippedPill.textContent = `Skipped ${skipped}`;

    if (!proPuzzleBoards[puzzle.id]) {
        proPuzzleBoards[puzzle.id] = buildBoardStateFromFen(puzzle.fen, puzzle.id);
    }
    const state = proPuzzleBoards[puzzle.id];
    if (toMoveEl) toMoveEl.textContent = state.sideToMove === 'w' ? 'White to move' : 'Black to move';

    renderProPuzzleBoard(puzzle.id);
}

function initProPuzzleBoards() {
    // Kept for compatibility with previous calls.
    renderCurrentProPuzzle();
}

function buildBoardStateFromFen(fen, puzzleId = null) {
    const [boardPart, sideToMove] = fen.split(' ');
    const rows = boardPart.split('/');
    const pieces = {};

    for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
        let fileIdx = 0;
        for (const ch of rows[rankIdx]) {
            if (/\d/.test(ch)) {
                fileIdx += parseInt(ch, 10);
            } else {
                const sq = `${'abcdefgh'[fileIdx]}${8 - rankIdx}`;
                pieces[sq] = ch;
                fileIdx += 1;
            }
        }
    }

    return {
        puzzleId,
        fen,
        sideToMove: sideToMove || 'w',
        selectedSquare: null,
        pieces
    };
}

function renderProPuzzleBoard(puzzleId) {
    const container = document.getElementById('proPuzzleBoard');
    const state = proPuzzleBoards[puzzleId];
    if (!container || !state) return;

    const orientationWhite = state.sideToMove === 'w';
    const ranks = orientationWhite ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    const files = orientationWhite ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];

    let html = '<div class="pro-board-grid">';
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const square = `${files[f]}${ranks[r]}`;
            const piece = state.pieces[square] || '';
            const isLight = (r + f) % 2 === 0;
            const selected = state.selectedSquare === square ? ' selected' : '';
            const showFile = r === 7;
            const showRank = f === 0;
            const fileLabel = files[f];
            const rankLabel = ranks[r];

            html += `
                <div class="pro-board-square ${isLight ? 'light' : 'dark'}${selected}"
                     onclick="onProPuzzleSquareClick(${puzzleId}, '${square}')"
                     ondragover="event.preventDefault()"
                     ondrop="onProPuzzleDrop(event, ${puzzleId}, '${square}')">
                    ${showFile ? `<span class="pro-board-file">${fileLabel}</span>` : ''}
                    ${showRank ? `<span class="pro-board-rank">${rankLabel}</span>` : ''}
                    ${piece ? `
                        <img class="pro-piece"
                              alt="${pieceToCode(piece)}"
                              src="${pieceToImageUrl(piece)}"
                              draggable="${isDraggablePiece(piece, state.sideToMove)}"
                              ondragstart="onProPuzzleDragStart(event, ${puzzleId}, '${square}')">
                        ` : ''}
                </div>
            `;
        }
    }
    html += '</div>';
    container.innerHTML = html;
}

function isDraggablePiece(piece, sideToMove) {
    const isWhite = piece === piece.toUpperCase();
    return (sideToMove === 'w' && isWhite) || (sideToMove === 'b' && !isWhite);
}

function onProPuzzleDragStart(event, puzzleId, square) {
    proPuzzleDragSource = square;
    if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', square);
        event.dataTransfer.effectAllowed = 'move';
    }
}

function onProPuzzleDrop(event, puzzleId, targetSquare) {
    event.preventDefault();
    const fromSquare = (event.dataTransfer && event.dataTransfer.getData('text/plain')) || proPuzzleDragSource;
    proPuzzleDragSource = null;
    if (!fromSquare) return;
    handleProPuzzleMove(puzzleId, fromSquare, targetSquare);
}

function onProPuzzleSquareClick(puzzleId, square) {
    const state = proPuzzleBoards[puzzleId];
    if (!state) return;
    const clickedPiece = state.pieces[square];

    if (!state.selectedSquare) {
        if (!clickedPiece) return;
        const isWhitePiece = clickedPiece === clickedPiece.toUpperCase();
        if ((state.sideToMove === 'w' && !isWhitePiece) || (state.sideToMove === 'b' && isWhitePiece)) return;
        state.selectedSquare = square;
        renderProPuzzleBoard(puzzleId);
        return;
    }

    const from = state.selectedSquare;
    state.selectedSquare = null;
    if (from === square) {
        renderProPuzzleBoard(puzzleId);
        return;
    }
    handleProPuzzleMove(puzzleId, from, square);
}

function handleProPuzzleMove(puzzleId, from, to) {
    const state = proPuzzleBoards[puzzleId];
    if (!state) return;
    const movingPiece = state.pieces[from];
    if (!movingPiece) return;

    const isWhitePiece = movingPiece === movingPiece.toUpperCase();
    if ((state.sideToMove === 'w' && !isWhitePiece) || (state.sideToMove === 'b' && isWhitePiece)) return;

    let pieceToPlace = movingPiece;
    let uci = `${from}${to}`;
    if ((movingPiece === 'P' && to.endsWith('8')) || (movingPiece === 'p' && to.endsWith('1'))) {
        uci += 'q';
        pieceToPlace = movingPiece === 'P' ? 'Q' : 'q';
    }

    delete state.pieces[from];
    state.pieces[to] = pieceToPlace;
    state.selectedSquare = null;

    renderProPuzzleBoard(puzzleId);
    submitCurrentProPuzzle(uci);
}

function pieceToCode(piece) {
    const map = {
        K: 'wK', Q: 'wQ', R: 'wR', B: 'wB', N: 'wN', P: 'wP',
        k: 'bK', q: 'bQ', r: 'bR', b: 'bB', n: 'bN', p: 'bP'
    };
    return map[piece] || '';
}

function pieceToImageUrl(piece) {
    const code = pieceToCode(piece);
    if (!code) return '';
    return `https://cdn.jsdelivr.net/gh/oakmac/chessboardjs/website/img/chesspieces/wikipedia/${code}.png`;
}

function resetCurrentProPuzzle() {
    const puzzle = proPuzzles[proPuzzleCurrentIndex];
    if (!puzzle) return;
    proPuzzleBoards[puzzle.id] = buildBoardStateFromFen(puzzle.fen, puzzle.id);
    renderCurrentProPuzzle();
}

function resetProPuzzleBoard() {
    // Backward compatibility if old inline handlers exist.
    resetCurrentProPuzzle();
}

async function submitCurrentProPuzzle(moveOverride = null) {
    const puzzle = proPuzzles[proPuzzleCurrentIndex];
    if (!puzzle) return;
    const feedback = document.getElementById('proPuzzleFeedback');
    if (!feedback) return;

    const move = moveOverride || '';
    if (!move) {
        feedback.textContent = 'Make a move on the board first.';
        feedback.className = 'pro-puzzle-feedback error';
        return;
    }

    feedback.textContent = 'Checking...';
    feedback.className = 'pro-puzzle-feedback';

    try {
        const result = await ChessAPI.attemptProPuzzle(puzzle.id, move);
        proPuzzleProgress[puzzle.id].attempts += 1;
        if (result.correct) {
            feedback.textContent = result.message || 'Correct.';
            feedback.className = 'pro-puzzle-feedback success';
            proPuzzleProgress[puzzle.id].status = 'solved';
            setTimeout(() => moveToNextUnsolvedOrStay(), 650);
        } else {
            const incorrectText = 'Incorrect, try again';
            feedback.textContent = incorrectText;
            feedback.className = 'pro-puzzle-feedback error';
            setTimeout(() => {
                const latestPuzzle = proPuzzles[proPuzzleCurrentIndex];
                if (!latestPuzzle || latestPuzzle.id !== puzzle.id) return;
                proPuzzleBoards[puzzle.id] = buildBoardStateFromFen(puzzle.fen, puzzle.id);
                renderProPuzzleBoard(puzzle.id);
            }, 900);
            setTimeout(() => {
                const latestPuzzle = proPuzzles[proPuzzleCurrentIndex];
                if (!latestPuzzle || latestPuzzle.id !== puzzle.id) return;
                const latestFeedback = document.getElementById('proPuzzleFeedback');
                if (latestFeedback) {
                    latestFeedback.textContent = '';
                    latestFeedback.className = 'pro-puzzle-feedback';
                }
            }, 2000);
        }
    } catch (error) {
        feedback.textContent = error.message || 'Could not submit answer.';
        feedback.className = 'pro-puzzle-feedback error';
    }
}

async function submitProPuzzleAttempt(puzzleId, moveOverride = null) {
    // Backward compatibility for older button handlers.
    if (typeof puzzleId === 'number') {
        const idx = proPuzzles.findIndex(p => p.id === puzzleId);
        if (idx >= 0) proPuzzleCurrentIndex = idx;
    }
    await submitCurrentProPuzzle(moveOverride);
}

function moveToNextUnsolvedOrStay() {
    for (let i = proPuzzleCurrentIndex + 1; i < proPuzzles.length; i++) {
        const p = proPuzzles[i];
        if ((proPuzzleProgress[p.id]?.status || 'unsolved') === 'unsolved') {
            proPuzzleCurrentIndex = i;
            renderCurrentProPuzzle();
            return;
        }
    }
    for (let i = 0; i < proPuzzles.length; i++) {
        const p = proPuzzles[i];
        if ((proPuzzleProgress[p.id]?.status || 'unsolved') === 'unsolved') {
            proPuzzleCurrentIndex = i;
            renderCurrentProPuzzle();
            return;
        }
    }
    renderCurrentProPuzzle();
    const feedback = document.getElementById('proPuzzleFeedback');
    if (feedback) {
        feedback.textContent = 'All puzzles are solved/skipped. Use Previous to review.';
        feedback.className = 'pro-puzzle-feedback success';
    }
}

function goPrevProPuzzle() {
    if (proPuzzleCurrentIndex <= 0) return;
    proPuzzleCurrentIndex -= 1;
    renderCurrentProPuzzle();
}

function goNextProPuzzle() {
    if (proPuzzleCurrentIndex >= proPuzzles.length - 1) return;
    proPuzzleCurrentIndex += 1;
    renderCurrentProPuzzle();
}

function skipCurrentProPuzzle() {
    const puzzle = proPuzzles[proPuzzleCurrentIndex];
    if (!puzzle) return;
    proPuzzleProgress[puzzle.id].status = 'skipped';
    moveToNextUnsolvedOrStay();
}

function clearProPuzzleSession(reason = 'logged_out') {
    proPuzzles = [];
    proPuzzleBoards = {};
    proPuzzleCurrentIndex = 0;
    proPuzzleProgress = {};
    proPuzzleDragSource = null;

    const resultsEl = document.getElementById('proPuzzleResults');
    if (resultsEl) {
        let msg = 'Log in to generate and load Pro puzzles.';
        if (reason === 'guest') {
            msg = 'Continue as guest is enabled. Log in to use Pro puzzle training.';
        } else if (reason === 'signed_in') {
            msg = 'No puzzles loaded yet. Click "Generate Puzzles From My Mistakes" or "Load Saved Puzzles".';
        }
        resultsEl.innerHTML = `<div class="pro-puzzle-empty">${msg}</div>`;
    }
}

window.clearProPuzzleSession = clearProPuzzleSession;

async function fetchWeeklyDashboard(username, gameTypes) {
    const dashboardSection = document.getElementById('dashboardSection');

    // Show loading state
    dashboardSection.style.display = 'block';
    dashboardSection.innerHTML = `
        <div class="dashboard-loading">
            <div class="spinner"></div>
            <p>Loading weekly accuracy dashboard${currentPlatform === 'chesscom' ? ' (deep-analyzing up to 20 games with Stockfish at depth 15 - this may take a few minutes...)' : ''}...</p>
        </div>
    `;

    try {
        const dashboardData = await ChessAPI.fetchDashboard(username, gameTypes, currentPlatform);

        if (dashboardData.total_analyzed_games === 0) {
            dashboardSection.innerHTML = `
                <div class="chart-container" style="text-align: center; padding: 30px;">
                    <h2>Weekly Accuracy Dashboard</h2>
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
                <h2>Weekly Accuracy Dashboard</h2>
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
                <h3>No Analysis Data Found</h3>
                <p>Please analyze your games first before generating a study plan.</p>
                <p style="margin-top: 12px;">Click "Analyze Games" at the top to get started!</p>
            </div>
        `;
        studyPlanSection.style.display = 'block';
        return;
    }

    studyPlanBtn.disabled = true;
    studyPlanBtn.textContent = 'Generating Your Personalized Study Plan...';
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
                <h3>Error Generating Study Plan</h3>
                <p>${errorMessage}</p>
                ${helpText}
            </div>
        `;
    } finally {
        studyPlanBtn.disabled = false;
        studyPlanBtn.textContent = 'Generate My Study Plan';
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
        btn.textContent = 'Copied!';
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

