// Opening Explorer — interactive opening tree powered by Lichess Opening Explorer API
// API: https://explorer.lichess.ovh/lichess?play=e2e4,e7e5&speeds=rapid,classical&ratings=1600,1800,2000,2200,2500

const OpeningExplorer = {
    LICHESS_EXPLORER: 'https://explorer.lichess.ovh/lichess',
    START_FEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',

    // ── state ─────────────────────────────────────────────────────────
    moveHistory: [],    // [{uci, san}]  — moves played so far
    boardState: null,
    dragSource: null,
    loading: false,

    // ─────────────────────────────────────────────────────────────────
    //  PUBLIC API
    // ─────────────────────────────────────────────────────────────────

    /** Called when sidebar item is clicked */
    async init() {
        // Don't re-initialise if already on the starting position with data loaded
        if (this.boardState && this.moveHistory.length === 0 &&
            document.getElementById('oeMovesTable')?.children.length > 0) return;
        this.moveHistory = [];
        this.boardState  = this._buildState(this.START_FEN);
        this._renderBoard();
        this._renderBreadcrumb();
        await this._fetch();
    },

    // ─────────────────────────────────────────────────────────────────
    //  DATA FETCHING
    // ─────────────────────────────────────────────────────────────────

    async _fetch() {
        if (this.loading) return;
        this.loading = true;

        const tableEl = document.getElementById('oeMovesTable');
        const openingEl = document.getElementById('oeOpeningName');
        if (tableEl) tableEl.innerHTML = '<div class="oe-loading">Loading…</div>';

        const play = this.moveHistory.map(m => m.uci).join(',');
        const url  = `${this.LICHESS_EXPLORER}?play=${play}&speeds=rapid,classical,blitz&ratings=1600,1800,2000,2200,2500`;

        try {
            const r = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            this._renderMovesTable(data);
            if (openingEl) openingEl.textContent = data.opening ? `${data.opening.eco} · ${data.opening.name}` : '';
        } catch (e) {
            if (tableEl) tableEl.innerHTML =
                '<div class="oe-error">Could not fetch opening data. Check your connection.</div>';
        } finally {
            this.loading = false;
        }
    },

    // ─────────────────────────────────────────────────────────────────
    //  TABLE RENDERING
    // ─────────────────────────────────────────────────────────────────

    _renderMovesTable(data) {
        const el = document.getElementById('oeMovesTable');
        if (!el) return;

        const moves = (data.moves || [])
            .filter(m => (m.white + m.draws + m.black) > 0)
            .sort((a, b) => (b.white + b.draws + b.black) - (a.white + a.draws + a.black))
            .slice(0, 15);

        if (!moves.length) {
            el.innerHTML = '<div class="oe-no-data">No data for this position. <button class="dp-btn secondary" onclick="OpeningExplorer.back()" style="padding:5px 12px;font-size:0.83em;margin-left:8px;">← Back</button></div>';
            return;
        }

        const rows = moves.map(m => {
            const total = m.white + m.draws + m.black;
            const wPct  = Math.round(m.white / total * 100);
            const dPct  = Math.round(m.draws  / total * 100);
            const bPct  = 100 - wPct - dPct;
            const fmt   = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

            return `
                <tr class="oe-move-row" onclick="OpeningExplorer.playMove('${m.uci}','${m.san || m.uci}')">
                    <td class="oe-td-san">${m.san || m.uci}</td>
                    <td class="oe-td-games">${fmt(total)}</td>
                    <td class="oe-td-bar">
                        <div class="oe-bar">
                            <div class="oe-bar-w" style="width:${wPct}%" title="White ${wPct}%"></div>
                            <div class="oe-bar-d" style="width:${dPct}%" title="Draw ${dPct}%"></div>
                            <div class="oe-bar-b" style="width:${bPct}%" title="Black ${bPct}%"></div>
                        </div>
                        <div class="oe-bar-pct">${wPct}% / ${dPct}% / ${bPct}%</div>
                    </td>
                </tr>`;
        }).join('');

        el.innerHTML = `
            <table class="oe-table">
                <thead>
                    <tr>
                        <th class="oe-th">Move</th>
                        <th class="oe-th">Games</th>
                        <th class="oe-th">White% / Draw% / Black%</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <p class="oe-source">Data: Lichess games (1600–2500 rated, rapid &amp; classical)</p>`;
    },

    // ─────────────────────────────────────────────────────────────────
    //  NAVIGATION
    // ─────────────────────────────────────────────────────────────────

    async playMove(uci, san) {
        this.moveHistory.push({ uci, san });
        this._applyUciToState(this.boardState, uci);
        this._renderBoard();
        this._renderBreadcrumb();
        await this._fetch();
    },

    async back() {
        if (!this.moveHistory.length) return;
        this.moveHistory.pop();
        this._rebuildBoard();
        this._renderBoard();
        this._renderBreadcrumb();
        await this._fetch();
    },

    async reset() {
        this.moveHistory = [];
        this.boardState  = this._buildState(this.START_FEN);
        this._renderBoard();
        this._renderBreadcrumb();
        const el = document.getElementById('oeOpeningName');
        if (el) el.textContent = '';
        await this._fetch();
    },

    async goToMove(index) {
        // index is 1-based; trim history to that point
        this.moveHistory = this.moveHistory.slice(0, index);
        this._rebuildBoard();
        this._renderBoard();
        this._renderBreadcrumb();
        await this._fetch();
    },

    _rebuildBoard() {
        this.boardState = this._buildState(this.START_FEN);
        for (const { uci } of this.moveHistory) this._applyUciToState(this.boardState, uci);
    },

    // ─────────────────────────────────────────────────────────────────
    //  BREADCRUMB
    // ─────────────────────────────────────────────────────────────────

    _renderBreadcrumb() {
        const el = document.getElementById('oeBreadcrumb');
        if (!el) return;
        if (!this.moveHistory.length) { el.textContent = 'Starting position'; return; }

        let html = '';
        this.moveHistory.forEach(({ san }, i) => {
            const isWhiteMove = i % 2 === 0;
            if (isWhiteMove) html += `<span class="oe-bc-num">${Math.floor(i / 2) + 1}.</span>`;
            html += `<span class="oe-bc-move" onclick="OpeningExplorer.goToMove(${i + 1})">${san}</span>`;
        });
        el.innerHTML = html;
    },

    // ─────────────────────────────────────────────────────────────────
    //  BOARD RENDERING
    // ─────────────────────────────────────────────────────────────────

    _renderBoard() {
        const container = document.getElementById('oeBoard');
        const state     = this.boardState;
        if (!container || !state) return;

        // Always show from white's perspective (opening explorer convention)
        const ranks = [8,7,6,5,4,3,2,1];
        const files = ['a','b','c','d','e','f','g','h'];

        // Highlight the last move squares
        const lastUci   = this.moveHistory.length ? this.moveHistory[this.moveHistory.length - 1].uci : '';
        const lastFrom  = lastUci ? lastUci.slice(0, 2) : '';
        const lastTo    = lastUci ? lastUci.slice(2, 4) : '';

        let html = '<div class="pro-board-grid">';
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const sq    = `${files[f]}${ranks[r]}`;
                const piece = state.pieces[sq] || '';
                const light = (r + f) % 2 === 0;
                const isLastMove = sq === lastFrom || sq === lastTo;

                html += `<div class="pro-board-square ${light ? 'light' : 'dark'}${isLastMove ? ' oe-last-move' : ''}">
                    ${r === 7 ? `<span class="pro-board-file">${files[f]}</span>` : ''}
                    ${f === 0 ? `<span class="pro-board-rank">${ranks[r]}</span>` : ''}
                    ${piece ? `<img class="pro-piece" alt="${this._pc(piece)}"
                        src="https://cdn.jsdelivr.net/gh/oakmac/chessboardjs/website/img/chesspieces/wikipedia/${this._pc(piece)}.png"
                        draggable="false">` : ''}
                </div>`;
            }
        }
        html += '</div>';
        container.innerHTML = html;
    },

    // ─────────────────────────────────────────────────────────────────
    //  SHARED CHESS HELPERS
    // ─────────────────────────────────────────────────────────────────

    _buildState(fen) {
        const [boardPart, side] = fen.split(' ');
        const rows   = boardPart.split('/');
        const pieces = {};
        for (let ri = 0; ri < 8; ri++) {
            let fi = 0;
            for (const ch of rows[ri]) {
                if (/\d/.test(ch)) fi += parseInt(ch, 10);
                else { pieces[`${'abcdefgh'[fi]}${8 - ri}`] = ch; fi++; }
            }
        }
        return { fen, sideToMove: side || 'w', pieces };
    },

    _applyUciToState(state, uci) {
        if (!uci || uci.length < 4) return;
        const from  = uci.slice(0, 2);
        const to    = uci.slice(2, 4);
        const promo = uci[4] || null;
        const piece = state.pieces[from];
        if (!piece) return;
        let placed = piece;
        if (promo) placed = piece === piece.toUpperCase() ? promo.toUpperCase() : promo.toLowerCase();
        // Castling
        if (piece === 'K' && from === 'e1') {
            if (to === 'g1') { state.pieces['f1'] = 'R'; delete state.pieces['h1']; }
            if (to === 'c1') { state.pieces['d1'] = 'R'; delete state.pieces['a1']; }
        }
        if (piece === 'k' && from === 'e8') {
            if (to === 'g8') { state.pieces['f8'] = 'r'; delete state.pieces['h8']; }
            if (to === 'c8') { state.pieces['d8'] = 'r'; delete state.pieces['a8']; }
        }
        // En passant
        if ((piece === 'P' || piece === 'p') && from[0] !== to[0] && !state.pieces[to]) {
            delete state.pieces[`${to[0]}${from[1]}`];
        }
        delete state.pieces[from];
        state.pieces[to]  = placed;
        state.sideToMove  = state.sideToMove === 'w' ? 'b' : 'w';
    },

    _pc(p) {
        const m = { K:'wK',Q:'wQ',R:'wR',B:'wB',N:'wN',P:'wP',k:'bK',q:'bQ',r:'bR',b:'bB',n:'bN',p:'bP' };
        return m[p] || '';
    },
};

window.OpeningExplorer = OpeningExplorer;
