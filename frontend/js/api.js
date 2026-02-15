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
