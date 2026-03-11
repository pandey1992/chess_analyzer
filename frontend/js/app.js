// Main app orchestrator - Chess Analyzer
// Global state now lives in AppStore (store.js)

function renderInlineErrorCard(container, title, message, retryLabel = '', onRetry = null) {
    if (!container) return;
    const retryBtnId = `retryBtn_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    container.innerHTML = `
        <div class="inline-error-card">
            <div class="inline-error-title">${title}</div>
            <div class="inline-error-message">${message}</div>
            ${retryLabel ? `<div class="inline-error-actions"><button id="${retryBtnId}" class="inline-error-retry">${retryLabel}</button></div>` : ''}
        </div>
    `;
    if (retryLabel && typeof onRetry === 'function') {
        const btn = document.getElementById(retryBtnId);
        if (btn) btn.addEventListener('click', onRetry);
    }
}

function selectPlatform(platform) {
    AppStore.currentPlatform = platform;
}

async function startAnalysis() {
    console.log('Analysis button clicked');
    AppStore.username = document.getElementById('username').value.trim();

    if (!AppStore.username) {
        showError('Please enter a username');
        return;
    }

    const gameTypes = getSelectedGameTypes();
    if (gameTypes.length === 0) {
        showError('Please select at least one game type');
        return;
    }

    hideError();
    showLoading();
    AppStore.openingsVisible = 10;
    AppStore.latestDashboardData = null;

    const platformName = AppStore.currentPlatform === 'lichess' ? 'Lichess' : 'Chess.com';

    try {
        setLoadingStatus('Fetching games...', `Reading your recent ${platformName} games`, 20);

        AppStore.allGames = await ChessAPI.fetchGames(AppStore.username, gameTypes, AppStore.currentPlatform);

        if (AppStore.allGames.length === 0) {
            showError(`No games found for this user on ${platformName}`);
            hideLoading();
            return;
        }

        setLoadingStatus('Analyzing patterns...', `Processing ${AppStore.allGames.length} games`, 62);

        analyzeAndDisplay(AppStore.allGames);
        renderProgressTrackingPanel();

        setLoadingStatus('Building dashboard...', 'Rendering insights and charts', 90);
        hideLoading();
        showResults();

        // Save analysis to session so other pages can access it
        AppStore.saveToSession();

        // Fetch weekly accuracy dashboard in background
        fetchWeeklyDashboard(AppStore.username, gameTypes);
        loadProPuzzles();
    } catch (error) {
        console.error('Error:', error);
        const errMsg = error.message || `Failed to fetch games from ${platformName}. Please check the username.`;
        showError(errMsg, {
            title: `Could not analyze ${platformName} games`,
            retryLabel: 'Retry Analysis',
            onRetry: () => startAnalysis()
        });
        setLoadingStatus('Analysis failed', 'Please check username and try again', 100);
        hideLoading();
    }
}

function getSelectedGameTypes() {
    const gameTypes = [];
    if (document.getElementById('rapid')?.checked) gameTypes.push('rapid');
    if (document.getElementById('blitz')?.checked) gameTypes.push('blitz');
    if (document.getElementById('bullet')?.checked) gameTypes.push('bullet');
    return gameTypes;
}

async function refreshWeeklyDashboardIfReady() {
    const dashboardSection = document.getElementById('dashboardSection');
    if (!dashboardSection) return false;
    if (!AppStore.username || !AppStore.allGames || AppStore.allGames.length === 0) return false;

    const gameTypes = getSelectedGameTypes();
    if (!gameTypes.length) return false;

    await fetchWeeklyDashboard(AppStore.username, gameTypes);
    return true;
}

window.refreshWeeklyDashboardIfReady = refreshWeeklyDashboardIfReady;

async function generateProPuzzles() {
    const section = document.getElementById('proPuzzleSection');
    const resultsEl = document.getElementById('proPuzzleResults');
    const btn = document.getElementById('generateProPuzzlesBtn');

    if (section) section.style.display = 'block';

    if (!Auth.isLoggedIn()) {
        if (resultsEl) resultsEl.innerHTML = `
            <div class="pro-puzzle-empty">
                Pro puzzle training requires login. Please log in to generate and save puzzles.
            </div>
        `;
        return;
    }
    if (typeof Payments !== 'undefined') {
        const pro = await Payments.refreshProStatus();
        if (!pro.active) {
            if (resultsEl) resultsEl.innerHTML = `
                <div class="pro-puzzle-empty">
                    Pro subscription required. Click <strong>Unlock Pro</strong> to continue.
                </div>
            `;
            return;
        }
    }

    if (!AppStore.allGames || AppStore.allGames.length === 0 || !AppStore.username) {
        if (resultsEl) resultsEl.innerHTML = `
            <div class="pro-puzzle-empty">
                Analyze games first, then generate puzzles from your mistakes.
            </div>
        `;
        return;
    }

    if (btn) btn.disabled = true;
    if (btn) btn.textContent = 'Generating puzzles...';
    if (resultsEl) resultsEl.innerHTML = '<div class="pro-puzzle-empty">Analyzing your bad moves and building puzzles...</div>';

    try {
        const selectedGames = [...AppStore.allGames]
            .sort((a, b) => (b.end_time || 0) - (a.end_time || 0))
            .slice(0, 15)
            .filter(g => g.pgn)
            .map(g => ({ pgn: g.pgn, url: g.url || '' }));

        const data = await ChessAPI.generateProPuzzles(AppStore.username, selectedGames, 15, 20, 120);
        AppStore.proPuzzles = data.puzzles || [];
        AppStore.proPuzzleCurrentIndex = 0;
        AppStore.proPuzzleProgress = {};
        AppStore.proPuzzleBoards = {};
        AppStore.proPuzzleStreak = 0;
        AppStore.proPuzzleBestStreak = 0;
        AppStore.proPuzzleHintUsage = {};
        if (AppStore.proPuzzles.length === 0) {
            const limits = data.limits || {};
            if (resultsEl) resultsEl.innerHTML = `
                <div class="pro-puzzle-empty">
                    No puzzle candidates found from recent games yet.
                    ${limits.max_games_used ? `<br>Analyzed up to ${limits.max_games_used} games on current server limits.` : ''}
                    <br>Try again later, or analyze more recent games first.
                </div>
            `;
            return;
        }
        renderProPuzzles();
    } catch (error) {
        renderInlineErrorCard(
            resultsEl,
            'Puzzle generation failed',
            error.message || 'Could not generate puzzles right now.',
            'Try Again',
            () => generateProPuzzles()
        );
    } finally {
        if (btn) btn.disabled = false;
        if (btn) btn.textContent = 'Generate Puzzles From My Mistakes';
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
    if (typeof Payments !== 'undefined') {
        const pro = await Payments.refreshProStatus();
        if (!pro.active) {
            resultsEl.innerHTML = `
                <div class="pro-puzzle-empty">
                    Pro subscription required. Unlock Pro to load your saved Pro puzzles.
                </div>
            `;
            return;
        }
    }

    try {
        const data = await ChessAPI.getProPuzzles(20);
        AppStore.proPuzzles = data.puzzles || [];
        AppStore.proPuzzleCurrentIndex = 0;
        AppStore.proPuzzleProgress = {};
        AppStore.proPuzzleBoards = {};
        AppStore.proPuzzleStreak = 0;
        AppStore.proPuzzleBestStreak = 0;
        AppStore.proPuzzleHintUsage = {};
        renderProPuzzles();
    } catch (error) {
        renderInlineErrorCard(
            resultsEl,
            'Could not load saved puzzles',
            error.message || 'Failed to fetch puzzle history.',
            'Retry',
            () => loadProPuzzles()
        );
    }
}

// ==================== Pro Puzzle Player (single-window flow) ====================
function renderProPuzzles() {
    const resultsEl = document.getElementById('proPuzzleResults');
    if (!resultsEl) return;

    if (!AppStore.proPuzzles || AppStore.proPuzzles.length === 0) {
        resultsEl.innerHTML = `
            <div class="pro-puzzle-empty">
                No puzzles yet. Click "Generate Puzzles From My Mistakes" after analysis.
            </div>
        `;
        return;
    }

    if (AppStore.proPuzzleCurrentIndex < 0 || AppStore.proPuzzleCurrentIndex >= AppStore.proPuzzles.length) {
        AppStore.proPuzzleCurrentIndex = 0;
    }

    AppStore.proPuzzles.forEach((p) => {
        if (!AppStore.proPuzzleProgress[p.id]) {
            AppStore.proPuzzleProgress[p.id] = { status: 'unsolved', attempts: 0 };
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
                    <span id="proStreakPill" class="pro-pill"></span>
                    <span id="proBestStreakPill" class="pro-pill"></span>
                </div>
            </div>
            <div class="pro-progress-wrap">
                <div class="pro-progress-bar">
                    <div id="proProgressFill" class="pro-progress-fill"></div>
                </div>
            </div>
            <div id="proToMove" class="pro-to-move"></div>
            <div id="proPuzzleBoard" class="pro-puzzle-board"></div>
            <div id="proPuzzleFeedback" class="pro-puzzle-feedback"></div>
            <div class="pro-player-nav">
                <button class="pro-puzzle-btn secondary" onclick="resetCurrentProPuzzle()">Reset</button>
                <button class="pro-puzzle-btn secondary" onclick="showProPuzzleHint()">Hint</button>
                <button class="pro-puzzle-btn secondary" onclick="goPrevProPuzzle()">Previous</button>
                <button class="pro-puzzle-btn secondary" onclick="skipCurrentProPuzzle()">Skip</button>
                <button class="pro-puzzle-btn secondary" onclick="goNextProPuzzle()">Next</button>
            </div>
        </div>
    `;

    renderCurrentProPuzzle();
}

function renderCurrentProPuzzle() {
    const puzzle = AppStore.proPuzzles[AppStore.proPuzzleCurrentIndex];
    if (!puzzle) return;

    const status = AppStore.proPuzzleProgress[puzzle.id]?.status || 'unsolved';
    const solved = Object.values(AppStore.proPuzzleProgress).filter(p => p.status === 'solved').length;
    const skipped = Object.values(AppStore.proPuzzleProgress).filter(p => p.status === 'skipped').length;
    const remaining = AppStore.proPuzzles.length - solved - skipped;

    const title = document.getElementById('proPuzzleTitle');
    const sub = document.getElementById('proPuzzleSub');
    const toMoveEl = document.getElementById('proToMove');
    const feedback = document.getElementById('proPuzzleFeedback');

    if (title) title.textContent = `Puzzle ${AppStore.proPuzzleCurrentIndex + 1} / ${AppStore.proPuzzles.length}`;
    if (sub) sub.textContent = `Move ${puzzle.move_number} | Eval Drop ${puzzle.cp_loss} | ${status.toUpperCase()}`;
    if (feedback) {
        if (status === 'solved') {
            feedback.innerHTML = '<span style="font-size:1.3em">&#10004;</span> Already solved!';
            feedback.className = 'pro-puzzle-feedback success';
        } else if (status === 'skipped') {
            feedback.innerHTML = 'Skipped - make a move to try again.';
            feedback.className = 'pro-puzzle-feedback checking';
        } else {
            feedback.innerHTML = '';
            feedback.className = 'pro-puzzle-feedback';
        }
    }

    const remainingPill = document.getElementById('proRemainingPill');
    const solvedPill = document.getElementById('proSolvedPill');
    const skippedPill = document.getElementById('proSkippedPill');
    const streakPill = document.getElementById('proStreakPill');
    const bestStreakPill = document.getElementById('proBestStreakPill');
    const progressFill = document.getElementById('proProgressFill');
    if (remainingPill) remainingPill.textContent = `Remaining ${remaining}`;
    if (solvedPill) solvedPill.textContent = `Solved ${solved}`;
    if (skippedPill) skippedPill.textContent = `Skipped ${skipped}`;
    if (streakPill) streakPill.textContent = `Streak ${AppStore.proPuzzleStreak}`;
    if (bestStreakPill) bestStreakPill.textContent = `Best ${AppStore.proPuzzleBestStreak}`;
    if (progressFill) {
        const pct = Math.round((solved / Math.max(1, AppStore.proPuzzles.length)) * 100);
        progressFill.style.width = `${pct}%`;
    }

    if (!AppStore.proPuzzleBoards[puzzle.id]) {
        AppStore.proPuzzleBoards[puzzle.id] = buildBoardStateFromFen(puzzle.fen, puzzle.id);
    }
    const state = AppStore.proPuzzleBoards[puzzle.id];
    if (toMoveEl) toMoveEl.textContent = state.sideToMove === 'w' ? 'White to move' : 'Black to move';

    renderProPuzzleBoard(puzzle.id);
}

function initProPuzzleBoards() {
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
    const state = AppStore.proPuzzleBoards[puzzleId];
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
    AppStore.proPuzzleDragSource = square;
    if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', square);
        event.dataTransfer.effectAllowed = 'move';
    }
}

function onProPuzzleDrop(event, puzzleId, targetSquare) {
    event.preventDefault();
    const fromSquare = (event.dataTransfer && event.dataTransfer.getData('text/plain')) || AppStore.proPuzzleDragSource;
    AppStore.proPuzzleDragSource = null;
    if (!fromSquare) return;
    handleProPuzzleMove(puzzleId, fromSquare, targetSquare);
}

function onProPuzzleSquareClick(puzzleId, square) {
    const state = AppStore.proPuzzleBoards[puzzleId];
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
    const state = AppStore.proPuzzleBoards[puzzleId];
    if (!state) return;
    const movingPiece = state.pieces[from];
    if (!movingPiece) return;

    const isWhitePiece = movingPiece === movingPiece.toUpperCase();
    if ((state.sideToMove === 'w' && !isWhitePiece) || (state.sideToMove === 'b' && isWhitePiece)) return;

    // Skip if puzzle already solved
    const puzzle = AppStore.proPuzzles[AppStore.proPuzzleCurrentIndex];
    if (puzzle && AppStore.proPuzzleProgress[puzzle.id]?.status === 'solved') return;

    let pieceToPlace = movingPiece;
    let uci = `${from}${to}`;
    if ((movingPiece === 'P' && to.endsWith('8')) || (movingPiece === 'p' && to.endsWith('1'))) {
        uci += 'q';
        pieceToPlace = movingPiece === 'P' ? 'Q' : 'q';
    }

    // Clear previous feedback when making a new move
    const feedback = document.getElementById('proPuzzleFeedback');
    if (feedback) {
        feedback.innerHTML = '';
        feedback.className = 'pro-puzzle-feedback';
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
    const puzzle = AppStore.proPuzzles[AppStore.proPuzzleCurrentIndex];
    if (!puzzle) return;
    AppStore.proPuzzleBoards[puzzle.id] = buildBoardStateFromFen(puzzle.fen, puzzle.id);
    renderCurrentProPuzzle();
}

function resetProPuzzleBoard() {
    resetCurrentProPuzzle();
}

async function submitCurrentProPuzzle(moveOverride = null) {
    const puzzle = AppStore.proPuzzles[AppStore.proPuzzleCurrentIndex];
    if (!puzzle) return;
    const feedback = document.getElementById('proPuzzleFeedback');
    if (!feedback) return;

    const move = moveOverride || '';
    if (!move) {
        feedback.innerHTML = 'Make a move on the board first.';
        feedback.className = 'pro-puzzle-feedback error';
        return;
    }

    // Extract from/to squares from the UCI move for highlighting
    const moveFrom = move.substring(0, 2);
    const moveTo = move.substring(2, 4);

    feedback.innerHTML = 'Checking...';
    feedback.className = 'pro-puzzle-feedback checking';

    try {
        const result = await ChessAPI.attemptProPuzzle(puzzle.id, move);
        AppStore.proPuzzleProgress[puzzle.id].attempts += 1;

        if (result.correct) {
            // Highlight the correct move squares on the board
            highlightBoardSquares(puzzle.id, moveFrom, moveTo, 'correct');

            feedback.innerHTML = '<span style="font-size:1.3em">&#10004;</span> Correct! Well done.';
            feedback.className = 'pro-puzzle-feedback success';
            AppStore.proPuzzleStreak += 1;
            AppStore.proPuzzleBestStreak = Math.max(AppStore.proPuzzleBestStreak, AppStore.proPuzzleStreak);
            AppStore.proPuzzleProgress[puzzle.id].status = 'solved';

            // Update streak pills immediately
            const streakPill = document.getElementById('proStreakPill');
            const bestStreakPill = document.getElementById('proBestStreakPill');
            if (streakPill) streakPill.textContent = `Streak ${AppStore.proPuzzleStreak}`;
            if (bestStreakPill) bestStreakPill.textContent = `Best ${AppStore.proPuzzleBestStreak}`;

            // Move to next puzzle after a pause to let user see feedback
            setTimeout(() => moveToNextUnsolvedOrStay(), 1500);
        } else {
            // Highlight incorrect move squares
            highlightBoardSquares(puzzle.id, moveFrom, moveTo, 'incorrect');

            // Shake the board
            const boardGrid = document.querySelector('.pro-board-grid');
            if (boardGrid) {
                boardGrid.classList.add('shake');
                setTimeout(() => boardGrid.classList.remove('shake'), 500);
            }

            const attempts = AppStore.proPuzzleProgress[puzzle.id].attempts;
            const attemptText = attempts === 1 ? '1st attempt' : attempts === 2 ? '2nd attempt' : `${attempts} attempts`;
            feedback.innerHTML = `<span style="font-size:1.3em">&#10008;</span> Incorrect - Try again! <span style="font-size:0.85em;opacity:0.7">(${attemptText})</span>`;
            feedback.className = 'pro-puzzle-feedback error';
            AppStore.proPuzzleStreak = 0;
            const streakPill = document.getElementById('proStreakPill');
            if (streakPill) streakPill.textContent = `Streak ${AppStore.proPuzzleStreak}`;

            // Reset board after showing the wrong move briefly
            setTimeout(() => {
                const latestPuzzle = AppStore.proPuzzles[AppStore.proPuzzleCurrentIndex];
                if (!latestPuzzle || latestPuzzle.id !== puzzle.id) return;
                AppStore.proPuzzleBoards[puzzle.id] = buildBoardStateFromFen(puzzle.fen, puzzle.id);
                renderProPuzzleBoard(puzzle.id);
            }, 1200);

            // Keep the feedback visible until user makes next move (don't auto-clear)
        }
    } catch (error) {
        feedback.innerHTML = '<span style="font-size:1.3em">&#9888;</span> ' + (error.message || 'Could not submit answer. Please try again.');
        feedback.className = 'pro-puzzle-feedback error';
    }
}

// Highlight squares on the board after a move
function highlightBoardSquares(puzzleId, fromSquare, toSquare, type) {
    const container = document.getElementById('proPuzzleBoard');
    if (!container) return;

    const squares = container.querySelectorAll('.pro-board-square');
    squares.forEach(sq => {
        // Remove any existing highlights
        sq.classList.remove('highlight-correct', 'highlight-incorrect', 'highlight-from');

        // Get the square's coordinates from its onclick attribute
        const onclickAttr = sq.getAttribute('onclick') || '';
        const sqMatch = onclickAttr.match(/'([a-h][1-8])'/);
        if (!sqMatch) return;
        const sqName = sqMatch[1];

        if (sqName === fromSquare) {
            sq.classList.add(type === 'correct' ? 'highlight-correct' : 'highlight-from');
        }
        if (sqName === toSquare) {
            sq.classList.add(type === 'correct' ? 'highlight-correct' : 'highlight-incorrect');
        }
    });
}

async function submitProPuzzleAttempt(puzzleId, moveOverride = null) {
    if (typeof puzzleId === 'number') {
        const idx = AppStore.proPuzzles.findIndex(p => p.id === puzzleId);
        if (idx >= 0) AppStore.proPuzzleCurrentIndex = idx;
    }
    await submitCurrentProPuzzle(moveOverride);
}

function moveToNextUnsolvedOrStay() {
    for (let i = AppStore.proPuzzleCurrentIndex + 1; i < AppStore.proPuzzles.length; i++) {
        const p = AppStore.proPuzzles[i];
        if ((AppStore.proPuzzleProgress[p.id]?.status || 'unsolved') === 'unsolved') {
            AppStore.proPuzzleCurrentIndex = i;
            renderCurrentProPuzzle();
            return;
        }
    }
    for (let i = 0; i < AppStore.proPuzzles.length; i++) {
        const p = AppStore.proPuzzles[i];
        if ((AppStore.proPuzzleProgress[p.id]?.status || 'unsolved') === 'unsolved') {
            AppStore.proPuzzleCurrentIndex = i;
            renderCurrentProPuzzle();
            return;
        }
    }
    renderCurrentProPuzzle();
    const feedback = document.getElementById('proPuzzleFeedback');
    if (feedback) {
        feedback.innerHTML = '<span style="font-size:1.3em">&#127942;</span> All puzzles completed! Use Previous to review.';
        feedback.className = 'pro-puzzle-feedback success';
    }
}

function goPrevProPuzzle() {
    if (AppStore.proPuzzleCurrentIndex <= 0) return;
    AppStore.proPuzzleCurrentIndex -= 1;
    renderCurrentProPuzzle();
}

function goNextProPuzzle() {
    if (AppStore.proPuzzleCurrentIndex >= AppStore.proPuzzles.length - 1) return;
    AppStore.proPuzzleCurrentIndex += 1;
    renderCurrentProPuzzle();
}

function skipCurrentProPuzzle() {
    const puzzle = AppStore.proPuzzles[AppStore.proPuzzleCurrentIndex];
    if (!puzzle) return;
    AppStore.proPuzzleStreak = 0;
    AppStore.proPuzzleProgress[puzzle.id].status = 'skipped';
    moveToNextUnsolvedOrStay();
}

function clearProPuzzleSession(reason = 'logged_out') {
    AppStore.clearPuzzles();

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

function showProPuzzleHint() {
    const puzzle = AppStore.proPuzzles[AppStore.proPuzzleCurrentIndex];
    const feedback = document.getElementById('proPuzzleFeedback');
    if (!puzzle || !feedback) return;

    const used = AppStore.proPuzzleHintUsage[puzzle.id] || 0;
    const hintPiece = puzzle.hint_piece || 'piece';
    const hintFile = puzzle.hint_from_file || null;

    if (used === 0) {
        feedback.innerHTML = `<span style="font-size:1.2em">&#128161;</span> Hint 1/2: Consider moving your <strong>${hintPiece}</strong>.`;
        feedback.className = 'pro-puzzle-feedback checking';
        AppStore.proPuzzleHintUsage[puzzle.id] = 1;
        return;
    }

    if (used === 1 && hintFile) {
        feedback.innerHTML = `<span style="font-size:1.2em">&#128161;</span> Hint 2/2: The move starts from the <strong>${hintFile}-file</strong>.`;
        feedback.className = 'pro-puzzle-feedback checking';
        AppStore.proPuzzleHintUsage[puzzle.id] = 2;
        return;
    }

    feedback.innerHTML = 'No more hints for this puzzle.';
    feedback.className = 'pro-puzzle-feedback checking';
}

function _getWeakPhaseSummary() {
    const s = AppStore.stats;
    const totalLosses = Math.max(1, s.losses || 0);
    const phases = [
        { name: 'Opening', losses: s.openingPhaseLosses || 0 },
        { name: 'Middlegame', losses: s.middlegameLosses || 0 },
        { name: 'Endgame', losses: s.endgameLosses || 0 }
    ];
    const worst = phases.sort((a, b) => b.losses - a.losses)[0] || { name: 'Opening', losses: 0 };
    return {
        name: worst.name,
        losses: worst.losses,
        pct: Math.round((worst.losses / totalLosses) * 100)
    };
}

function _avg(nums) {
    if (!nums || !nums.length) return null;
    return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function _formatDelta(delta, positiveGood = true, suffix = '%') {
    if (delta === null || Number.isNaN(delta)) return { text: 'No trend yet', cls: 'neutral' };
    const rounded = Math.round(delta * 10) / 10;
    const sign = rounded > 0 ? '+' : '';
    const good = positiveGood ? rounded >= 0 : rounded <= 0;
    if (Math.abs(rounded) < 0.1) return { text: 'Flat vs baseline', cls: 'neutral' };
    return {
        text: `${sign}${rounded}${suffix} vs baseline`,
        cls: good ? 'good' : 'bad'
    };
}

function renderProgressTrackingPanel(targetId) {
    const section = document.getElementById(targetId || 'progressTrackingSection');
    if (!section) return;
    const stats = AppStore.stats;
    if (!stats || !stats.totalGames) {
        section.style.display = 'none';
        return;
    }

    const totalGames = stats.totalGames || 0;
    const overallWinRate = totalGames > 0 ? (stats.wins / totalGames) * 100 : 0;
    const recentGames = (stats.recentGames || []).slice(0, 10);
    const recentWinRate = recentGames.length
        ? (recentGames.filter(g => g.result === 'win').length / recentGames.length) * 100
        : null;
    const weakPhase = _getWeakPhaseSummary();

    let accuracyValue = 'Pending';
    let accuracyHint = 'Loads after weekly dashboard analysis';
    let accuracyTrend = { text: 'No trend yet', cls: 'neutral' };

    let blunderValue = 'Pending';
    let blunderHint = 'Waiting for move-quality data';
    let blunderTrend = { text: 'No trend yet', cls: 'neutral' };

    if (AppStore.latestDashboardData && !AppStore.latestDashboardData.pro_locked) {
        const overallAcc = AppStore.latestDashboardData?.overall?.accuracy;
        const gameAccs = (AppStore.latestDashboardData?.game_accuracies || [])
            .map(g => Number(g.accuracy))
            .filter(n => Number.isFinite(n));

        if (Number.isFinite(overallAcc)) {
            accuracyValue = `${Math.round(overallAcc * 10) / 10}%`;
            accuracyHint = `${AppStore.latestDashboardData.total_analyzed_games || 0} games this week`;
        }

        if (gameAccs.length >= 6) {
            const recentAvg = _avg(gameAccs.slice(0, 3));
            const prevAvg = _avg(gameAccs.slice(3, 6));
            accuracyTrend = _formatDelta(recentAvg - prevAvg, true, '%');
        }

        const blunders = Number(AppStore.latestDashboardData?.move_quality?.blunder || 0);
        const analyzed = Math.max(1, Number(AppStore.latestDashboardData?.total_analyzed_games || 0));
        const blundersPerGame = blunders / analyzed;
        blunderValue = `${blunders}`;
        blunderHint = `${blundersPerGame.toFixed(2)} blunders/game`;
        blunderTrend = blundersPerGame <= 0.7
            ? { text: 'Controlled blunder rate', cls: 'good' }
            : blundersPerGame <= 1.2
            ? { text: 'Moderate blunder rate', cls: 'neutral' }
            : { text: 'High blunder rate', cls: 'bad' };
    } else {
        const likelyBlunders = (stats.gamesToReview?.quickCollapses?.length || 0) +
            (stats.gamesToReview?.middlegameBlunders?.length || 0);
        blunderValue = `${likelyBlunders}`;
        blunderHint = 'Likely blunder games (local estimate)';
        blunderTrend = likelyBlunders <= Math.max(3, Math.round(totalGames * 0.15))
            ? { text: 'Within expected range', cls: 'good' }
            : { text: 'Needs cleanup', cls: 'bad' };
    }

    const winRateDelta = recentWinRate === null ? null : (recentWinRate - overallWinRate);
    const winRateTrend = _formatDelta(winRateDelta, true, '%');

    section.style.display = 'block';
    section.innerHTML = `
        <div class="section-header">
            <h2 class="section-title">Progress Tracking</h2>
        </div>
        <div class="progress-grid">
            <div class="progress-card">
                <div class="progress-label">Accuracy</div>
                <div class="progress-value">${accuracyValue}</div>
                <div class="progress-hint">${accuracyHint}</div>
                <div class="progress-trend ${accuracyTrend.cls}">${accuracyTrend.text}</div>
            </div>
            <div class="progress-card">
                <div class="progress-label">Blunders</div>
                <div class="progress-value">${blunderValue}</div>
                <div class="progress-hint">${blunderHint}</div>
                <div class="progress-trend ${blunderTrend.cls}">${blunderTrend.text}</div>
            </div>
            <div class="progress-card">
                <div class="progress-label">Win Rate</div>
                <div class="progress-value">${overallWinRate.toFixed(1)}%</div>
                <div class="progress-hint">Overall (${stats.wins}W / ${stats.losses}L / ${stats.draws}D)</div>
                <div class="progress-trend ${winRateTrend.cls}">${winRateTrend.text}</div>
            </div>
            <div class="progress-card">
                <div class="progress-label">Weak Phase</div>
                <div class="progress-value">${weakPhase.name}</div>
                <div class="progress-hint">${weakPhase.losses} losses in this phase</div>
                <div class="progress-trend ${weakPhase.pct >= 40 ? 'bad' : weakPhase.pct >= 25 ? 'neutral' : 'good'}">${weakPhase.pct}% of all losses</div>
            </div>
        </div>
    `;
}

async function fetchWeeklyDashboard(username, gameTypes, targetId) {
    const dashboardSection = document.getElementById(targetId || 'dashboardSection');
    if (!dashboardSection) return;

    dashboardSection.style.display = 'block';
    dashboardSection.innerHTML = `
        <div class="dashboard-loading">
            <div class="spinner"></div>
            <p>Loading weekly accuracy dashboard${AppStore.currentPlatform === 'chesscom' ? ' (deep-analyzing up to 20 games with Stockfish at depth 15 - this may take a few minutes...)' : ''}...</p>
        </div>
    `;

    try {
        const dashboardData = await ChessAPI.fetchDashboard(username, gameTypes, AppStore.currentPlatform);
        AppStore.latestDashboardData = dashboardData;
        AppStore.saveToSession();
        renderProgressTrackingPanel();

        if (dashboardData && dashboardData.pro_locked) {
            displayDashboard(dashboardData, targetId);
            return;
        }

        if (dashboardData.total_analyzed_games === 0) {
            dashboardSection.innerHTML = `
                <div class="chart-container" style="text-align: center; padding: 30px;">
                    <h2>Weekly Accuracy Dashboard</h2>
                    <p style="color: #718096; margin-top: 12px;">No analyzed games found for the past week.
                    ${AppStore.currentPlatform === 'lichess' ? 'Request computer analysis on your Lichess games to see accuracy data.' : ''}</p>
                </div>
            `;
            return;
        }

        displayDashboard(dashboardData, targetId);
    } catch (error) {
        console.error('Dashboard error:', error);
        renderProgressTrackingPanel();
        dashboardSection.innerHTML = `
            <div id="dashboardErrorWrap" class="chart-container" style="text-align: center; padding: 30px;"></div>
        `;
        const wrap = document.getElementById('dashboardErrorWrap');
        renderInlineErrorCard(
            wrap,
            'Could not load weekly dashboard',
            error.message || 'Dashboard data is temporarily unavailable.',
            'Retry Dashboard',
            () => fetchWeeklyDashboard(username, gameTypes, targetId)
        );
    }
}

async function generateStudyPlan() {
    const studyPlanBtn = document.getElementById('generateStudyPlanBtnPage') || document.getElementById('generateStudyPlanBtn');
    const studyPlanSection = document.getElementById('studyPlanResults');

    const stats = AppStore.stats;
    if (!stats || !stats.totalGames) {
        if (studyPlanSection) {
            studyPlanSection.innerHTML = `
                <div style="background: #fed7d7; color: #c53030; padding: 24px; border-radius: 12px; margin-top: 20px;">
                    <h3>No Analysis Data Found</h3>
                    <p>Please analyze your games first before generating a study plan.</p>
                    <p style="margin-top: 12px;"><a href="#analyze">Click here to Analyze Games</a></p>
                </div>
            `;
            studyPlanSection.style.display = 'block';
        }
        return;
    }

    if (studyPlanBtn) {
        studyPlanBtn.disabled = true;
        studyPlanBtn.textContent = 'Generating Your Personalized Study Plan...';
    }
    if (studyPlanSection) {
        studyPlanSection.innerHTML = '<div class="spinner" style="margin: 40px auto;"></div><p style="text-align: center;">Analyzing your games and creating custom recommendations...</p>';
        studyPlanSection.style.display = 'block';
    }

    try {
        const { weaknesses, strengths, specificIssues } = computeWeaknessesAndStrengths(stats);
        const statsPayload = buildStatsPayload(stats, weaknesses, strengths, specificIssues);
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

        if (studyPlanSection) {
            studyPlanSection.innerHTML = `
                <div style="background: #fed7d7; color: #c53030; padding: 24px; border-radius: 12px; margin-top: 20px;">
                    <h3>Error Generating Study Plan</h3>
                    <p>${errorMessage}</p>
                    ${helpText}
                </div>
            `;
        }
    } finally {
        if (studyPlanBtn) {
            studyPlanBtn.disabled = false;
            studyPlanBtn.textContent = 'Generate My Study Plan';
        }
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

    const timeoutRate = ((stats.timePressureLosses / totalLosses) * 100).toFixed(1);
    if (stats.timePressureLosses >= totalLosses * 0.15) {
        weaknesses.push(`CRITICAL: Time management problems (${stats.timePressureLosses} timeout losses, ${timeoutRate}% of losses)`);
        specificIssues.timePressure = true;
    }

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
        username: AppStore.username,
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
Based on analysis of ${AppStore.stats.totalGames} games

${window.currentStudyPlan}

---
Generated by Chess AI Coach
    `], { type: 'text/plain' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chess-study-plan-${AppStore.username}-${new Date().toISOString().split('T')[0]}.txt`;
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

    const subject = encodeURIComponent(`Chess Study Plan - ${AppStore.username}`);
    const body = encodeURIComponent(`
My Personalized Chess Study Plan
Generated: ${new Date().toLocaleDateString()}

${window.currentStudyPlan}
    `);

    window.open(`mailto:?subject=${subject}&body=${body}`);
}

// Modal close on background click
window.addEventListener('click', (event) => {
    try {
        const modal = document.getElementById('gameModal');
        if (event.target === modal && typeof closeModal === 'function') {
            closeModal();
        }
    } catch (error) {
        console.error('Modal click handler failed:', error);
    }
});

let globalErrorGuardsInstalled = false;
function installGlobalErrorGuards() {
    if (globalErrorGuardsInstalled) return;
    globalErrorGuardsInstalled = true;

    window.addEventListener('error', (event) => {
        const message = event?.error?.message || event?.message || 'Unexpected script error';
        console.error('Global error:', message);
    });

    window.addEventListener('unhandledrejection', (event) => {
        const message = event?.reason?.message || String(event?.reason || 'Unhandled promise rejection');
        console.error('Unhandled rejection:', message);
    });
}

// ==================== App Initialization ====================
let appInitialized = false;

async function initApp() {
    if (appInitialized) return;
    appInitialized = true;
    installGlobalErrorGuards();

    // Restore analysis data from session
    AppStore.restoreFromSession();

    // Check if user is already logged in, but do not block router boot.
    try {
        await Promise.race([
            Auth.checkAuth(),
            new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
    } catch (error) {
        console.warn('Auth check failed during startup:', error);
    }

    // Initialize the router (shows correct page based on hash + auth state).
    // If router already booted (from router.js auto-init), re-evaluate the
    // route now that Auth.checkAuth() has validated the token.
    if (Router.initialized) {
        Router.handleRoute();
    } else {
        Router.init();
    }

    console.log('Chess AI Coach loaded successfully');
}

// Initialize safely whether script runs before or after DOMContentLoaded.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
    initApp();
}
