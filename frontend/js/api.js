// API client - replaces direct CORS proxy and Groq API calls

const ChessAPI = {
    async fetchGames(username, gameTypes, platform = 'chesscom') {
        const endpoint = platform === 'lichess'
            ? `${CONFIG.API_BASE}/lichess/games/${encodeURIComponent(username)}?game_types=${gameTypes.join(',')}`
            : `${CONFIG.API_BASE}/games/${encodeURIComponent(username)}?game_types=${gameTypes.join(',')}`;

        const response = await fetch(endpoint);

        if (!response.ok) {
            const platformName = platform === 'lichess' ? 'Lichess' : 'Chess.com';
            if (response.status === 404) throw new Error(`User not found on ${platformName}`);
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Failed to fetch games');
        }

        const data = await response.json();
        return data.games;
    },

    async fetchDashboard(username, gameTypes, platform = 'chesscom') {
        const endpoint = platform === 'lichess'
            ? `${CONFIG.API_BASE}/lichess/dashboard/${encodeURIComponent(username)}?game_types=${gameTypes.join(',')}`
            : `${CONFIG.API_BASE}/dashboard/${encodeURIComponent(username)}?game_types=${gameTypes.join(',')}`;

        const response = await fetch(endpoint);

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Failed to fetch dashboard');
        }

        return await response.json();
    },

    async generateStudyPlan(statsPayload) {
        const response = await fetch(`${CONFIG.API_BASE}/study-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(statsPayload)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Failed to generate study plan');
        }

        const data = await response.json();
        return data.plan;
    },

    async register(username, email, password) {
        const response = await fetch(`${CONFIG.API_BASE}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify({ username, email, password })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Registration failed');
        }

        const data = await response.json();
        this.setToken(data.access_token);
        return data;
    },

    async login(email, password) {
        const response = await fetch(`${CONFIG.API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Login failed');
        }

        const data = await response.json();
        this.setToken(data.access_token);
        return data;
    },

    async googleAuth(idToken) {
        const response = await fetch(`${CONFIG.API_BASE}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: idToken })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Google authentication failed');
        }

        const data = await response.json();
        this.setToken(data.access_token);
        return data;
    },

    async generateProPuzzles(username, games, maxGames = 15, maxPuzzles = 20, minCpLoss = 120) {
        const response = await fetch(`${CONFIG.API_BASE}/pro/puzzles/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify({
                username,
                games,
                max_games: maxGames,
                max_puzzles: maxPuzzles,
                min_cp_loss: minCpLoss
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Failed to generate puzzles');
        }

        return await response.json();
    },

    async getProPuzzles(limit = 20) {
        const response = await fetch(`${CONFIG.API_BASE}/pro/puzzles?limit=${limit}`, {
            headers: this.getAuthHeaders()
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Failed to fetch puzzles');
        }
        return await response.json();
    },

    async attemptProPuzzle(puzzleId, move) {
        const response = await fetch(`${CONFIG.API_BASE}/pro/puzzles/${puzzleId}/attempt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify({ move })
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Failed to submit answer');
        }
        return await response.json();
    },

    // Token management
    getToken() {
        return localStorage.getItem('auth_token');
    },

    setToken(token) {
        localStorage.setItem('auth_token', token);
    },

    clearToken() {
        localStorage.removeItem('auth_token');
    },

    getAuthHeaders() {
        const token = this.getToken();
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }
};
