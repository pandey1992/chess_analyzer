// Shared state store — replaces global variables from app.js
// Loaded before app.js so all modules can reference AppStore.*

const AppStore = {
    // Game data
    allGames: [],
    username: '',
    openingsVisible: 10,
    stats: {},
    currentPlatform: 'chesscom',

    // Dashboard
    latestDashboardData: null,

    // Pro puzzles
    proPuzzles: [],
    proPuzzleBoards: {},
    proPuzzleCurrentIndex: 0,
    proPuzzleProgress: {},
    proPuzzleDragSource: null,
    proPuzzleStreak: 0,
    proPuzzleBestStreak: 0,
    proPuzzleHintUsage: {},

    hasAnalysis() {
        return !!(this.stats && this.stats.totalGames);
    },

    saveToSession() {
        try {
            sessionStorage.setItem('chess_store', JSON.stringify({
                allGames: this.allGames,
                username: this.username,
                currentPlatform: this.currentPlatform,
                stats: this.stats,
                latestDashboardData: this.latestDashboardData
            }));
        } catch (e) { /* ignore quota errors */ }
    },

    restoreFromSession() {
        try {
            const saved = sessionStorage.getItem('chess_store');
            if (!saved) return false;
            const data = JSON.parse(saved);
            if (data.allGames) this.allGames = data.allGames;
            if (data.username) this.username = data.username;
            if (data.currentPlatform) this.currentPlatform = data.currentPlatform;
            if (data.stats) this.stats = data.stats;
            if (data.latestDashboardData) this.latestDashboardData = data.latestDashboardData;
            return this.hasAnalysis();
        } catch (e) { return false; }
    },

    clearAnalysis() {
        this.allGames = [];
        this.username = '';
        this.stats = {};
        this.latestDashboardData = null;
        sessionStorage.removeItem('chess_store');
    },

    clearPuzzles() {
        this.proPuzzles = [];
        this.proPuzzleBoards = {};
        this.proPuzzleCurrentIndex = 0;
        this.proPuzzleProgress = {};
        this.proPuzzleDragSource = null;
        this.proPuzzleStreak = 0;
        this.proPuzzleBestStreak = 0;
        this.proPuzzleHintUsage = {};
    }
};
