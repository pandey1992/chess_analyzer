const HomePuzzles = {
    initialized: false,

    async init() {
        if (this.initialized) return;
        this.initialized = true;
        await this.load();
    },

    async load() {
        const wrap = document.getElementById('homePuzzleHub');
        if (!wrap) return;
        wrap.innerHTML = '<div class="dp-loading">Loading puzzles from Lichess...</div>';

        try {
            const data = await ChessAPI.fetchFeaturedPuzzles(5);
            const daily = data?.daily || null;
            const random = Array.isArray(data?.random) ? data.random : [];

            const dailyCard = daily ? `
                <div class="home-puzzle-card daily">
                    <div class="home-puzzle-title">Daily Puzzle</div>
                    <div class="home-puzzle-main">${daily.themes?.[0] ? this._fmt(daily.themes[0]) : 'Featured Daily Challenge'}</div>
                    <div class="home-puzzle-meta">Rating ${daily.rating || '-'} | ${daily.side_to_move === 'black' ? 'Black' : 'White'} to move</div>
                    <a class="home-puzzle-link" href="${daily.puzzle_url || '#puzzle'}" target="_blank" rel="noopener noreferrer">Solve on Lichess</a>
                    <a class="home-puzzle-link" href="#puzzle" style="margin-left:12px;">Solve inside Chess AI Coach</a>
                </div>
            ` : '';

            const randomCards = random.map((p, idx) => `
                <div class="home-puzzle-card">
                    <div class="home-puzzle-title">Random #${idx + 1}</div>
                    <div class="home-puzzle-main">${p.themes?.[0] ? this._fmt(p.themes[0]) : 'Lichess Puzzle'}</div>
                    <div class="home-puzzle-meta">Rating ${p.rating || '-'} | ${p.side_to_move === 'black' ? 'Black' : 'White'} to move</div>
                    <a class="home-puzzle-link" href="${p.puzzle_url || '#'}" target="_blank" rel="noopener noreferrer">Open on Lichess</a>
                </div>
            `).join('');

            wrap.innerHTML = `
                <div class="home-puzzle-grid">
                    ${dailyCard}
                    ${randomCards || '<div class="home-puzzle-card">Random puzzles are temporarily unavailable. Try again later.</div>'}
                </div>
            `;
        } catch (error) {
            wrap.innerHTML = `
                <div class="home-puzzle-card">
                    <div class="home-puzzle-title">Puzzle Feed</div>
                    <div class="home-puzzle-main">Could not load puzzles right now.</div>
                    <div class="home-puzzle-meta">${error.message || 'Please try again later.'}</div>
                    <a class="home-puzzle-link" href="#puzzle">Open Daily Puzzle</a>
                </div>
            `;
        }
    },

    _fmt(theme) {
        return String(theme || '')
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (s) => s.toUpperCase())
            .trim();
    }
};

window.HomePuzzles = HomePuzzles;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.location.hash || window.location.hash === '#landing') {
            HomePuzzles.init();
        }
    }, { once: true });
} else if (!window.location.hash || window.location.hash === '#landing') {
    HomePuzzles.init();
}
