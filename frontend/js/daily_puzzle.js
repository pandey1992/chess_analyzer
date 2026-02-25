// Lichess Daily Puzzle — interactive multi-move puzzle trainer

const DailyPuzzle = {
    puzzle: null,       // API response: {puzzle_id, fen, solution_uci, themes, rating, date, side_to_move, ...}
    boardState: null,   // {pieces, sideToMove, selectedSquare, fen}
    playerSide: 'w',    // orientation lock: 'w' or 'b'
    solutionIndex: 0,   // next move in solution_uci the player must find
    solved: false,
    usedHint: false,
    dragSource: null,

    // ------------------------------------------------------------------ init
    async init() {
        await this.load();
    },

    // ------------------------------------------------------------------ load
    async load() {
        const container = document.getElementById('dailyPuzzleContainer');
        if (!container) return;
        container.innerHTML = '<div class="dp-loading">Loading today\'s puzzle from Lichess\u2026</div>';

        try {
            const data = await ChessAPI.fetchDailyPuzzle();
            this.puzzle = data;
            this.playerSide = data.side_to_move === 'black' ? 'b' : 'w';
            this.solutionIndex = 0;
            this.solved = false;
            this.usedHint = false;
            this.boardState = this._buildState(data.fen);
            this._checkAlreadySolvedToday();
            this._render();
        } catch (err) {
            container.innerHTML = `
                <div class="dp-error">
                    <p>Could not load today's puzzle. Please try again later.</p>
                    <button class="dp-btn" onclick="DailyPuzzle.load()">Retry</button>
                </div>`;
        }
    },

    _checkAlreadySolvedToday() {
        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem('dp_solved_date') === today) {
            this.solved = true;
            // Replay full solution so board shows final position
            this.solutionIndex = (this.puzzle.solution_uci || []).length;
            this._replayToIndex();
        }
    },

    // ------------------------------------------------------------------ render
    _render() {
        const container = document.getElementById('dailyPuzzleContainer');
        if (!container || !this.puzzle) return;
        const p = this.puzzle;
        const streak = parseInt(localStorage.getItem('dp_streak') || '0', 10);
        const themes = (p.themes || []).filter(t => !['middlegame', 'endgame', 'opening', 'short', 'long', 'veryLong'].includes(t));
        const themeHTML = themes.slice(0, 4).map(t => `<span class="dp-theme-tag">${this._formatTheme(t)}</span>`).join('');
        const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        const sideLabel = this.playerSide === 'w' ? 'White' : 'Black';
        const streakBadge = streak > 1 ? `<span class="dp-streak-badge">\uD83D\uDD25 ${streak}-day streak</span>` : '';

        container.innerHTML = `
            <div class="dp-header">
                <div class="dp-header-left">
                    <div class="dp-date">${dateStr}</div>
                    <div class="dp-themes">${themeHTML}</div>
                </div>
                <div class="dp-header-right">
                    ${streakBadge}
                    <span class="dp-rating-badge">\u2605 ${p.rating}</span>
                </div>
            </div>
            <div class="dp-to-move" id="dpToMove">${sideLabel} to move</div>
            <div id="dpBoard" class="dp-board-wrap"></div>
            <div id="dpFeedback" class="dp-feedback"></div>
            ${this.solved ? this._solvedBannerHTML() : ''}
            <div class="dp-actions">
                <button class="dp-btn secondary" onclick="DailyPuzzle.reset()">Reset</button>
                <button class="dp-btn secondary" onclick="DailyPuzzle.showHint()">Hint</button>
                ${p.puzzle_url ? `<a class="dp-btn secondary" href="${p.puzzle_url}" target="_blank" rel="noopener noreferrer">View on Lichess \u2197</a>` : ''}
            </div>
        `;

        this._renderBoard();
    },

    _solvedBannerHTML() {
        const streak = parseInt(localStorage.getItem('dp_streak') || '0', 10);
        const streakMsg = streak > 1 ? ` \uD83D\uDD25 ${streak}-day streak!` : '';
        return `<div class="dp-solved-banner">\u2713 Today's puzzle solved!${streakMsg} Come back tomorrow.</div>`;
    },

    _formatTheme(t) {
        return t.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
    },

    // ------------------------------------------------------------------ board
    _renderBoard() {
        const container = document.getElementById('dpBoard');
        const state = this.boardState;
        if (!container || !state) return;

        const flipBoard = this.playerSide === 'b';
        const ranks = flipBoard ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
        const files = flipBoard ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];

        let html = '<div class="pro-board-grid">';
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const square = `${files[f]}${ranks[r]}`;
                const piece = state.pieces[square] || '';
                const isLight = (r + f) % 2 === 0;
                const selected = state.selectedSquare === square ? ' selected' : '';
                const draggable = !this.solved && piece && this._isDraggable(piece);

                html += `
                    <div class="pro-board-square ${isLight ? 'light' : 'dark'}${selected}"
                         onclick="DailyPuzzle._onSquareClick('${square}')"
                         ondragover="event.preventDefault()"
                         ondrop="DailyPuzzle._onDrop(event, '${square}')">
                        ${r === 7 ? `<span class="pro-board-file">${files[f]}</span>` : ''}
                        ${f === 0 ? `<span class="pro-board-rank">${ranks[r]}</span>` : ''}
                        ${piece ? `<img class="pro-piece" alt="${this._pieceCode(piece)}"
                            src="${this._pieceUrl(piece)}"
                            draggable="${draggable}"
                            ondragstart="DailyPuzzle._onDragStart(event, '${square}')">` : ''}
                    </div>`;
            }
        }
        html += '</div>';
        container.innerHTML = html;
    },

    _isDraggable(piece) {
        const isWhite = piece === piece.toUpperCase();
        const s = this.boardState;
        if (s.sideToMove !== this.playerSide) return false;
        return this.playerSide === 'w' ? isWhite : !isWhite;
    },

    // ------------------------------------------------------------------ drag & click
    _onDragStart(event, square) {
        this.dragSource = square;
        if (event.dataTransfer) {
            event.dataTransfer.setData('text/plain', square);
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

    _onSquareClick(square) {
        if (this.solved) return;
        const state = this.boardState;
        const piece = state.pieces[square];

        if (!state.selectedSquare) {
            if (!piece) return;
            if (!this._isDraggable(piece)) return;
            state.selectedSquare = square;
            this._renderBoard();
            return;
        }

        const from = state.selectedSquare;
        state.selectedSquare = null;
        if (from === square) { this._renderBoard(); return; }
        this._handleMove(from, square);
    },

    // ------------------------------------------------------------------ move logic
    _handleMove(from, to) {
        if (this.solved) return;
        const state = this.boardState;
        const movingPiece = state.pieces[from];
        if (!movingPiece || !this._isDraggable(movingPiece)) return;

        let uci = `${from}${to}`;
        // Auto-promote to queen
        if ((movingPiece === 'P' && to[1] === '8') || (movingPiece === 'p' && to[1] === '1')) {
            uci += 'q';
        }

        // Optimistic visual: apply move immediately
        const savedPieces = { ...state.pieces };
        const savedSideToMove = state.sideToMove;
        this._applyUciToState(state, uci);
        state.selectedSquare = null;
        this._renderBoard();

        const expectedUci = (this.puzzle.solution_uci || [])[this.solutionIndex];

        if (uci !== expectedUci) {
            // Wrong move — revert after brief delay
            setTimeout(() => {
                this.boardState.pieces = savedPieces;
                this.boardState.sideToMove = savedSideToMove;
                this.boardState.selectedSquare = null;
                this._renderBoard();
                this._setFeedback('Not the best move. Try again!', 'error');
                this.usedHint = true;
            }, 400);
            return;
        }

        // Correct player move
        this.solutionIndex += 1;
        this._setFeedback('Good move!', 'success');

        if (this.solutionIndex >= (this.puzzle.solution_uci || []).length) {
            // Puzzle complete (no opponent reply needed)
            setTimeout(() => this._onComplete(), 300);
            return;
        }

        // Auto-play opponent's response
        const opponentUci = this.puzzle.solution_uci[this.solutionIndex];
        this.solutionIndex += 1;
        setTimeout(() => {
            this._applyUciToState(this.boardState, opponentUci);
            this._renderBoard();
            if (this.solutionIndex >= (this.puzzle.solution_uci || []).length) {
                setTimeout(() => this._onComplete(), 300);
            } else {
                this._setFeedback('Keep going\u2026', 'success');
            }
        }, 550);
    },

    _applyUciToState(state, uci) {
        if (!uci || uci.length < 4) return;
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        const promoChar = uci[4] || null;
        const piece = state.pieces[from];
        if (!piece) return;

        let pieceToPlace = piece;
        if (promoChar) {
            pieceToPlace = piece === piece.toUpperCase()
                ? promoChar.toUpperCase()
                : promoChar.toLowerCase();
        }

        // Castling rook movement
        if (piece === 'K' && from === 'e1') {
            if (to === 'g1') { state.pieces['f1'] = 'R'; delete state.pieces['h1']; }
            if (to === 'c1') { state.pieces['d1'] = 'R'; delete state.pieces['a1']; }
        }
        if (piece === 'k' && from === 'e8') {
            if (to === 'g8') { state.pieces['f8'] = 'r'; delete state.pieces['h8']; }
            if (to === 'c8') { state.pieces['d8'] = 'r'; delete state.pieces['a8']; }
        }

        // En passant: pawn moves diagonally to empty square
        if ((piece === 'P' || piece === 'p') && from[0] !== to[0] && !state.pieces[to]) {
            delete state.pieces[`${to[0]}${from[1]}`];
        }

        delete state.pieces[from];
        state.pieces[to] = pieceToPlace;
        state.sideToMove = state.sideToMove === 'w' ? 'b' : 'w';
    },

    _replayToIndex() {
        this.boardState = this._buildState(this.puzzle.fen);
        const sol = this.puzzle.solution_uci || [];
        for (let i = 0; i < this.solutionIndex; i++) {
            this._applyUciToState(this.boardState, sol[i]);
        }
    },

    // ------------------------------------------------------------------ completion
    _onComplete() {
        this.solved = true;
        const today = new Date().toISOString().slice(0, 10);
        const lastDate = localStorage.getItem('dp_last_completed');
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        let streak = parseInt(localStorage.getItem('dp_streak') || '0', 10);

        if (lastDate === yesterday) {
            streak += 1;
        } else if (lastDate !== today) {
            streak = 1;
        }

        localStorage.setItem('dp_solved_date', today);
        localStorage.setItem('dp_last_completed', today);
        localStorage.setItem('dp_streak', String(streak));

        const msg = this.usedHint ? 'Puzzle solved! (with hints)' : 'Excellent! Puzzle solved!';
        this._setFeedback(msg, 'success');

        // Append solved banner after a short delay
        setTimeout(() => {
            const existing = document.querySelector('.dp-solved-banner');
            if (existing) return;
            const actions = document.querySelector('.dp-actions');
            if (actions) {
                const banner = document.createElement('div');
                banner.className = 'dp-solved-banner';
                const streakMsg = streak > 1 ? ` \uD83D\uDD25 ${streak}-day streak!` : '';
                banner.innerHTML = `\u2713 Puzzle solved!${streakMsg} Come back tomorrow for a new puzzle.`;
                actions.insertAdjacentElement('afterend', banner);
            }
        }, 600);
    },

    // ------------------------------------------------------------------ controls
    reset() {
        if (!this.puzzle) return;
        this.solutionIndex = 0;
        this.solved = false;
        this.usedHint = false;
        this.boardState = this._buildState(this.puzzle.fen);
        this._setFeedback('', '');
        this._renderBoard();
        // Remove solved banner if present (only for session reset, not persistent)
        const banner = document.querySelector('.dp-solved-banner');
        if (banner) banner.remove();
    },

    showHint() {
        if (!this.puzzle) return;
        const uci = (this.puzzle.solution_uci || [])[this.solutionIndex];
        if (!uci) return;
        this.usedHint = true;
        const fromSq = uci.slice(0, 2).toUpperCase();
        this._setFeedback(`Hint: Move the piece on ${fromSq}`, '');
    },

    // ------------------------------------------------------------------ helpers
    _buildState(fen) {
        const [boardPart, side] = fen.split(' ');
        const rows = boardPart.split('/');
        const pieces = {};
        for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
            let fileIdx = 0;
            for (const ch of rows[rankIdx]) {
                if (/\d/.test(ch)) {
                    fileIdx += parseInt(ch, 10);
                } else {
                    pieces[`${'abcdefgh'[fileIdx]}${8 - rankIdx}`] = ch;
                    fileIdx += 1;
                }
            }
        }
        return { fen, sideToMove: side || 'w', selectedSquare: null, pieces };
    },

    _pieceCode(piece) {
        const map = {
            K:'wK',Q:'wQ',R:'wR',B:'wB',N:'wN',P:'wP',
            k:'bK',q:'bQ',r:'bR',b:'bB',n:'bN',p:'bP'
        };
        return map[piece] || '';
    },

    _pieceUrl(piece) {
        const code = this._pieceCode(piece);
        if (!code) return '';
        return `https://cdn.jsdelivr.net/gh/oakmac/chessboardjs/website/img/chesspieces/wikipedia/${code}.png`;
    },

    _setFeedback(text, type) {
        const el = document.getElementById('dpFeedback');
        if (!el) return;
        el.textContent = text;
        el.className = 'dp-feedback' + (type ? ` ${type}` : '');
    },
};
