// Puzzle Rush — solve as many puzzles as possible before time runs out
// Uses the same puzzle format as DailyPuzzle (fen, solution_uci, side_to_move, rating, themes)

const PuzzleRush = {
    // ── puzzle queue & current puzzle ─────────────────────────────────
    queue: [],
    current: null,
    boardState: null,
    playerSide: 'w',
    solutionIndex: 0,
    dragSource: null,
    locked: false,    // prevent input during opponent-reply animation

    // ── game stats ─────────────────────────────────────────────────────
    score: 0,
    fails: 0,
    MAX_FAILS: 3,
    streak: 0,
    timeLeft: 0,
    duration: 180,
    timerInterval: null,
    gameActive: false,

    // ─────────────────────────────────────────────────────────────────
    //  PUBLIC API
    // ─────────────────────────────────────────────────────────────────

    /** Show the mode-selection lobby */
    renderLobby() {
        const c = document.getElementById('puzzleRushContainer');
        if (!c) return;
        const best = parseInt(localStorage.getItem('pr_best') || '0', 10);
        c.innerHTML = `
            <div class="pr-lobby">
                <p class="pr-lobby-desc">
                    Solve as many puzzles as you can before time runs out.<br>
                    You get <strong>3 lives</strong> — each wrong first move costs one.
                </p>
                ${best > 0 ? `<div class="pr-lobby-best">🏆 Personal best: <strong>${best}</strong> puzzles</div>` : ''}
                <div class="pr-mode-row">
                    <button class="pr-mode-btn" onclick="PuzzleRush.startGame(60)">
                        <span class="pr-mode-icon">💨</span>
                        <span class="pr-mode-label">1 min</span>
                        <span class="pr-mode-sub">Quick fire</span>
                    </button>
                    <button class="pr-mode-btn pr-mode-btn--featured" onclick="PuzzleRush.startGame(180)">
                        <span class="pr-mode-icon">⚡</span>
                        <span class="pr-mode-label">3 min</span>
                        <span class="pr-mode-sub">Classic</span>
                    </button>
                    <button class="pr-mode-btn" onclick="PuzzleRush.startGame(300)">
                        <span class="pr-mode-icon">🕔</span>
                        <span class="pr-mode-label">5 min</span>
                        <span class="pr-mode-sub">Endurance</span>
                    </button>
                </div>
            </div>
        `;
    },

    /** Start a timed game */
    async startGame(duration) {
        this.score = 0;
        this.fails = 0;
        this.streak = 0;
        this.timeLeft = duration;
        this.duration = duration;
        this.gameActive = true;
        this.queue = [];
        this.locked = false;

        this._renderGameShell();
        await this._loadNextPuzzle();
        this._startTimer();
    },

    // ─────────────────────────────────────────────────────────────────
    //  TIMER
    // ─────────────────────────────────────────────────────────────────

    _startTimer() {
        clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            if (!this.gameActive) { clearInterval(this.timerInterval); return; }
            this.timeLeft = Math.max(0, this.timeLeft - 1);
            this._updateHUD();
            if (this.timeLeft === 0) this._endGame('timeout');
        }, 1000);
    },

    _fmt(s) {
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    },

    // ─────────────────────────────────────────────────────────────────
    //  PUZZLE LOADING
    // ─────────────────────────────────────────────────────────────────

    async _loadNextPuzzle() {
        if (!this.gameActive) return;

        // Refill queue when low
        if (this.queue.length < 2) await this._fillQueue();

        if (!this.queue.length) { this._endGame('error'); return; }

        this.current = this.queue.shift();
        this.solutionIndex = 0;
        this.locked = false;
        this.playerSide = this.current.side_to_move === 'black' ? 'b' : 'w';
        this.boardState = this._buildState(this.current.fen);
        this._renderBoard();
        this._updateHUD();

        // Background-prefetch next batch
        if (this.queue.length < 3) setTimeout(() => this._fillQueue(), 100);
    },

    async _fillQueue() {
        try {
            const data = await ChessAPI.fetchFeaturedPuzzles(8);
            if (Array.isArray(data)) this.queue.push(...data);
            else if (data && data.fen) this.queue.push(data);
        } catch (_) { /* silently ignore, we may already have enough */ }
    },

    // ─────────────────────────────────────────────────────────────────
    //  UI SHELL
    // ─────────────────────────────────────────────────────────────────

    _renderGameShell() {
        const c = document.getElementById('puzzleRushContainer');
        if (!c) return;
        c.innerHTML = `
            <div class="pr-hud">
                <div class="pr-hud-cell">
                    <div class="pr-hud-lbl">Score</div>
                    <div class="pr-hud-val" id="prScore">0</div>
                </div>
                <div class="pr-hud-cell">
                    <div class="pr-hud-lbl">Streak</div>
                    <div class="pr-hud-val" id="prStreak">0</div>
                </div>
                <div class="pr-hud-cell pr-hud-timer-cell">
                    <div class="pr-hud-lbl">Time</div>
                    <div class="pr-hud-val pr-hud-timer" id="prTimer">${this._fmt(this.timeLeft)}</div>
                </div>
                <div class="pr-hud-cell">
                    <div class="pr-hud-lbl">Lives</div>
                    <div class="pr-hud-val" id="prLives">❤️❤️❤️</div>
                </div>
            </div>
            <div id="prPuzzleInfo" class="pr-puzzle-info"></div>
            <div id="prFeedback" class="dp-feedback"></div>
            <div id="prBoard" class="dp-board-wrap"></div>
            <button class="dp-btn secondary" style="margin-top:14px;font-size:0.85em;" onclick="PuzzleRush._endGame('quit')">Stop</button>
        `;
    },

    _updateHUD() {
        const full  = '❤️';
        const empty = '🖤';
        const livesStr = full.repeat(Math.max(0, this.MAX_FAILS - this.fails)) +
                         empty.repeat(Math.min(this.fails, this.MAX_FAILS));

        const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        s('prScore',  this.score);
        s('prStreak', this.streak > 1 ? `${this.streak} 🔥` : this.streak);
        s('prLives',  livesStr);

        const timerEl = document.getElementById('prTimer');
        if (timerEl) {
            timerEl.textContent = this._fmt(this.timeLeft);
            timerEl.className = 'pr-hud-val pr-hud-timer' + (this.timeLeft <= 30 ? ' pr-timer-critical' : '');
        }

        const infoEl = document.getElementById('prPuzzleInfo');
        if (infoEl && this.current) {
            const themes = (this.current.themes || [])
                .filter(t => !['middlegame','endgame','opening','short','long','veryLong'].includes(t))
                .slice(0, 2);
            infoEl.innerHTML =
                `<span class="dp-rating-badge">★ ${this.current.rating}</span>` +
                themes.map(t => `<span class="dp-theme-tag">${t.replace(/([A-Z])/g,' $1').trim()}</span>`).join('');
        }
    },

    // ─────────────────────────────────────────────────────────────────
    //  BOARD RENDERING
    // ─────────────────────────────────────────────────────────────────

    _renderBoard() {
        const container = document.getElementById('prBoard');
        const state = this.boardState;
        if (!container || !state) return;

        const flip = this.playerSide === 'b';
        const ranks = flip ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
        const files = flip ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];

        let html = '<div class="pro-board-grid">';
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const sq = `${files[f]}${ranks[r]}`;
                const piece = state.pieces[sq] || '';
                const light = (r + f) % 2 === 0;
                const sel = state.selectedSquare === sq ? ' selected' : '';
                const drag = !this.locked && piece && this._isDraggable(piece);

                html += `<div class="pro-board-square ${light ? 'light' : 'dark'}${sel}"
                     onclick="PuzzleRush._onSquareClick('${sq}')"
                     ondragover="event.preventDefault()"
                     ondrop="PuzzleRush._onDrop(event,'${sq}')">
                    ${r === 7 ? `<span class="pro-board-file">${files[f]}</span>` : ''}
                    ${f === 0 ? `<span class="pro-board-rank">${ranks[r]}</span>` : ''}
                    ${piece ? `<img class="pro-piece" alt="${this._pieceCode(piece)}"
                        src="https://cdn.jsdelivr.net/gh/oakmac/chessboardjs/website/img/chesspieces/wikipedia/${this._pieceCode(piece)}.png"
                        draggable="${drag}"
                        ondragstart="PuzzleRush._onDragStart(event,'${sq}')">` : ''}
                </div>`;
            }
        }
        html += '</div>';
        container.innerHTML = html;
    },

    _isDraggable(piece) {
        if (this.locked || !this.gameActive) return false;
        const s = this.boardState;
        if (s.sideToMove !== this.playerSide) return false;
        const isWhite = piece === piece.toUpperCase();
        return this.playerSide === 'w' ? isWhite : !isWhite;
    },

    // ─────────────────────────────────────────────────────────────────
    //  DRAG & CLICK INPUT
    // ─────────────────────────────────────────────────────────────────

    _onDragStart(event, sq) {
        this.dragSource = sq;
        if (event.dataTransfer) {
            event.dataTransfer.setData('text/plain', sq);
            event.dataTransfer.effectAllowed = 'move';
        }
    },

    _onDrop(event, target) {
        event.preventDefault();
        const from = (event.dataTransfer && event.dataTransfer.getData('text/plain')) || this.dragSource;
        this.dragSource = null;
        if (!from || from === target) return;
        this._handleMove(from, target);
    },

    _onSquareClick(sq) {
        if (this.locked || !this.gameActive) return;
        const state = this.boardState;
        const piece = state.pieces[sq];

        if (!state.selectedSquare) {
            if (!piece || !this._isDraggable(piece)) return;
            state.selectedSquare = sq;
            this._renderBoard();
            return;
        }

        const from = state.selectedSquare;
        state.selectedSquare = null;
        if (from === sq) { this._renderBoard(); return; }
        this._handleMove(from, sq);
    },

    // ─────────────────────────────────────────────────────────────────
    //  MOVE LOGIC
    // ─────────────────────────────────────────────────────────────────

    _handleMove(from, to) {
        if (this.locked || !this.gameActive) return;
        const state = this.boardState;
        const movingPiece = state.pieces[from];
        if (!movingPiece || !this._isDraggable(movingPiece)) return;

        let uci = `${from}${to}`;
        if ((movingPiece === 'P' && to[1] === '8') || (movingPiece === 'p' && to[1] === '1')) uci += 'q';

        const savedPieces = { ...state.pieces };
        const savedSide   = state.sideToMove;
        this._applyUciToState(state, uci);
        state.selectedSquare = null;
        this._renderBoard();

        const expected = (this.current.solution_uci || [])[this.solutionIndex];

        if (uci !== expected) {
            // Wrong move
            this.locked = true;
            setTimeout(() => {
                state.pieces      = savedPieces;
                state.sideToMove  = savedSide;
                state.selectedSquare = null;
                this._renderBoard();
                this.fails++;
                this.streak = 0;
                this._setFeedback('✗ Wrong! Try again.', 'error');
                this._updateHUD();
                this.locked = false;
                if (this.fails >= this.MAX_FAILS) setTimeout(() => this._endGame('lives'), 700);
            }, 400);
            return;
        }

        // Correct move
        this.solutionIndex++;
        this._setFeedback('✓', 'success');

        if (this.solutionIndex >= (this.current.solution_uci || []).length) {
            this.locked = true;
            setTimeout(() => this._onPuzzleSolved(), 300);
            return;
        }

        // Auto-play opponent's reply
        this.locked = true;
        const oppUci = this.current.solution_uci[this.solutionIndex];
        this.solutionIndex++;
        setTimeout(() => {
            this._applyUciToState(state, oppUci);
            this._renderBoard();
            this.locked = false;
            if (this.solutionIndex >= (this.current.solution_uci || []).length) {
                setTimeout(() => this._onPuzzleSolved(), 300);
            }
        }, 500);
    },

    async _onPuzzleSolved() {
        this.score++;
        this.streak++;
        const bonusMsg = this.streak >= 5 ? ` 🔥 ${this.streak} streak!` : '';
        this._setFeedback(`✓ Solved! ${this.score} pts${bonusMsg}`, 'success');
        this._updateHUD();
        if (!this.gameActive) return;
        await new Promise(r => setTimeout(r, 500));
        if (!this.gameActive) return;
        this._setFeedback('', '');
        await this._loadNextPuzzle();
    },

    // ─────────────────────────────────────────────────────────────────
    //  GAME OVER
    // ─────────────────────────────────────────────────────────────────

    _endGame(reason) {
        clearInterval(this.timerInterval);
        this.gameActive = false;

        const prev = parseInt(localStorage.getItem('pr_best') || '0', 10);
        const isNewBest = this.score > prev;
        if (isNewBest) localStorage.setItem('pr_best', String(this.score));

        const reasonLabel = {
            timeout: "⏱ Time's up!",
            lives:   '💔 Out of lives!',
            quit:    '🏁 Game ended',
            error:   '⚠️ Could not load puzzles',
        }[reason] || '🏁 Done';

        const c = document.getElementById('puzzleRushContainer');
        if (!c) return;
        c.innerHTML = `
            <div class="pr-game-over">
                <div class="pr-go-reason">${reasonLabel}</div>
                <div class="pr-go-score">${this.score}</div>
                <div class="pr-go-label">Puzzles Solved</div>
                ${isNewBest && this.score > 0
                    ? '<div class="pr-go-best">🏆 New Personal Best!</div>'
                    : (prev > 0 ? `<div class="pr-go-prev-best">Best: ${prev}</div>` : '')}
                <div class="pr-mode-row" style="margin-top:24px;">
                    <button class="pr-mode-btn" onclick="PuzzleRush.startGame(60)">
                        <span class="pr-mode-icon">💨</span><span class="pr-mode-label">1 min</span>
                    </button>
                    <button class="pr-mode-btn pr-mode-btn--featured" onclick="PuzzleRush.startGame(180)">
                        <span class="pr-mode-icon">⚡</span><span class="pr-mode-label">3 min</span>
                    </button>
                    <button class="pr-mode-btn" onclick="PuzzleRush.startGame(300)">
                        <span class="pr-mode-icon">🕔</span><span class="pr-mode-label">5 min</span>
                    </button>
                </div>
            </div>
        `;
    },

    // ─────────────────────────────────────────────────────────────────
    //  SHARED CHESS HELPERS  (same logic as DailyPuzzle)
    // ─────────────────────────────────────────────────────────────────

    _buildState(fen) {
        const [boardPart, side] = fen.split(' ');
        const rows = boardPart.split('/');
        const pieces = {};
        for (let ri = 0; ri < 8; ri++) {
            let fi = 0;
            for (const ch of rows[ri]) {
                if (/\d/.test(ch)) fi += parseInt(ch, 10);
                else { pieces[`${'abcdefgh'[fi]}${8 - ri}`] = ch; fi++; }
            }
        }
        return { fen, sideToMove: side || 'w', selectedSquare: null, pieces };
    },

    _applyUciToState(state, uci) {
        if (!uci || uci.length < 4) return;
        const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4] || null;
        const piece = state.pieces[from];
        if (!piece) return;
        let placed = piece;
        if (promo) placed = piece === piece.toUpperCase() ? promo.toUpperCase() : promo.toLowerCase();
        if (piece === 'K' && from === 'e1') {
            if (to === 'g1') { state.pieces['f1'] = 'R'; delete state.pieces['h1']; }
            if (to === 'c1') { state.pieces['d1'] = 'R'; delete state.pieces['a1']; }
        }
        if (piece === 'k' && from === 'e8') {
            if (to === 'g8') { state.pieces['f8'] = 'r'; delete state.pieces['h8']; }
            if (to === 'c8') { state.pieces['d8'] = 'r'; delete state.pieces['a8']; }
        }
        if ((piece === 'P' || piece === 'p') && from[0] !== to[0] && !state.pieces[to]) {
            delete state.pieces[`${to[0]}${from[1]}`];
        }
        delete state.pieces[from];
        state.pieces[to] = placed;
        state.sideToMove = state.sideToMove === 'w' ? 'b' : 'w';
    },

    _pieceCode(p) {
        const m = { K:'wK',Q:'wQ',R:'wR',B:'wB',N:'wN',P:'wP',k:'bK',q:'bQ',r:'bR',b:'bB',n:'bN',p:'bP' };
        return m[p] || '';
    },

    _setFeedback(text, type) {
        const el = document.getElementById('prFeedback');
        if (!el) return;
        el.textContent = text;
        el.className = 'dp-feedback' + (type ? ` ${type}` : '');
    },
};

window.PuzzleRush = PuzzleRush;
