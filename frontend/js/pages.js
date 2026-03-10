// Page controller — initializes each page when the router navigates to it

const PageController = {
    currentPage: null,

    init(page) {
        this.currentPage = page;
        this.updateSidebarActive(page);

        switch (page) {
            case 'home': this.initHome(); break;
            case 'analyze': this.initAnalyze(); break;
            case 'performance': this.initPerformance(); break;
            case 'puzzles': this.initPuzzles(); break;
            case 'openings': this.initOpenings(); break;
            case 'study-plan': this.initStudyPlan(); break;
            case 'coaching': this.initCoaching(); break;
            case 'opponent-prep': this.initOpponentPrep(); break;
        }
    },

    updateSidebarActive(page) {
        document.querySelectorAll('.app-sidebar-link').forEach(link => {
            link.classList.toggle('active', link.dataset.sidebar === page);
        });
        document.querySelectorAll('.bottom-nav-item').forEach(link => {
            link.classList.toggle('active', link.dataset.bnav === page);
        });
    },

    // ==================== HOME ====================
    initHome() {
        AppStore.restoreFromSession();
        this._renderHomeStats();
        this._renderHomePuzzle();
        this._renderHomeRecent();
    },

    _renderHomeStats() {
        const container = document.getElementById('homeQuickStats');
        if (!container) return;

        if (!AppStore.hasAnalysis()) {
            container.innerHTML = `
                <div class="home-stat-card">
                    <div class="home-stat-value">--</div>
                    <div class="home-stat-label">Games Analyzed</div>
                </div>
                <div class="home-stat-card">
                    <div class="home-stat-value">--</div>
                    <div class="home-stat-label">Win Rate</div>
                </div>
                <div class="home-stat-card">
                    <div class="home-stat-value">--</div>
                    <div class="home-stat-label">Accuracy</div>
                </div>
            `;
            return;
        }

        const s = AppStore.stats;
        const winRate = ((s.wins / s.totalGames) * 100).toFixed(1);
        let accuracy = '--';
        if (AppStore.latestDashboardData && AppStore.latestDashboardData.overall) {
            const acc = AppStore.latestDashboardData.overall.accuracy;
            if (Number.isFinite(acc)) accuracy = `${Math.round(acc * 10) / 10}%`;
        }

        container.innerHTML = `
            <div class="home-stat-card">
                <div class="home-stat-value">${s.totalGames}</div>
                <div class="home-stat-label">Games Analyzed</div>
            </div>
            <div class="home-stat-card">
                <div class="home-stat-value">${winRate}%</div>
                <div class="home-stat-label">Win Rate</div>
            </div>
            <div class="home-stat-card">
                <div class="home-stat-value">${accuracy}</div>
                <div class="home-stat-label">Accuracy</div>
            </div>
        `;
    },

    _renderHomePuzzle() {
        const container = document.getElementById('homeDailyPuzzle');
        if (!container) return;
        container.innerHTML = '<div class="dp-loading">Loading daily puzzle...</div>';

        ChessAPI.fetchDailyPuzzle().then(data => {
            if (!data || !data.puzzle) {
                container.innerHTML = '<p style="color:#718096;">Could not load daily puzzle.</p>';
                return;
            }
            const p = data.puzzle;
            const themes = (p.themes || []).slice(0, 3).join(', ') || 'Tactics';
            container.innerHTML = `
                <div class="home-puzzle-card">
                    <div class="home-puzzle-header">
                        <span class="home-puzzle-icon">&#9822;</span>
                        <span class="home-puzzle-title">Daily Puzzle</span>
                        <span class="home-puzzle-rating">Rating: ${p.rating || '?'}</span>
                    </div>
                    <div class="home-puzzle-themes">${themes}</div>
                    <a href="#puzzles" class="home-puzzle-play-btn">Solve Puzzle &rarr;</a>
                </div>
            `;
        }).catch(() => {
            container.innerHTML = '<p style="color:#718096;">Could not load daily puzzle.</p>';
        });
    },

    _renderHomeRecent() {
        const container = document.getElementById('homeRecentSummary');
        if (!container) return;

        if (!AppStore.hasAnalysis()) {
            container.innerHTML = `
                <div class="home-recent-empty">
                    <p>No recent analysis. Analyze your games to see your performance summary here.</p>
                </div>
            `;
            return;
        }

        const s = AppStore.stats;
        const worstPhase = [
            { name: 'Opening', count: s.openingPhaseLosses },
            { name: 'Middlegame', count: s.middlegameLosses },
            { name: 'Endgame', count: s.endgameLosses }
        ].sort((a, b) => b.count - a.count)[0];

        container.innerHTML = `
            <div class="home-recent-card">
                <h3>Last Analysis: ${AppStore.username}</h3>
                <div class="home-recent-stats">
                    <span>${s.wins}W / ${s.losses}L / ${s.draws}D</span>
                    <span>Weakest: ${worstPhase.name} (${worstPhase.count} losses)</span>
                </div>
                <a href="#performance" class="home-recent-link">View Full Performance &rarr;</a>
            </div>
        `;
    },

    // ==================== ANALYZE ====================
    initAnalyze() {
        AppStore.restoreFromSession();
        // Restore platform selection
        const platformSelect = document.getElementById('platform');
        if (platformSelect && AppStore.currentPlatform) {
            platformSelect.value = AppStore.currentPlatform;
        }
        // Restore username
        const usernameInput = document.getElementById('username');
        if (usernameInput && AppStore.username && !usernameInput.value) {
            usernameInput.value = AppStore.username;
        }
    },

    // ==================== PERFORMANCE ====================
    initPerformance() {
        AppStore.restoreFromSession();
        this._initPerfTabs();

        if (!AppStore.hasAnalysis()) {
            document.getElementById('perfNeedsAnalysis').style.display = 'block';
            document.getElementById('perfTabContent').style.display = 'none';
            return;
        }

        document.getElementById('perfNeedsAnalysis').style.display = 'none';
        document.getElementById('perfTabContent').style.display = 'block';
        this._showPerfTab('overview');
    },

    _perfTabsBound: false,
    _initPerfTabs() {
        if (this._perfTabsBound) return;
        this._perfTabsBound = true;
        document.querySelectorAll('.perf-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.perf-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this._showPerfTab(tab.dataset.tab);
            });
        });
    },

    _showPerfTab(tabName) {
        const content = document.getElementById('perfTabContent');
        if (!content || !AppStore.hasAnalysis()) return;
        const s = AppStore.stats;

        switch (tabName) {
            case 'overview':
                content.innerHTML = `
                    <div id="perfDashboardSection"></div>
                    <div id="perfProgressSection" class="chart-container progress-tracking-section"></div>
                    <div class="section-header"><h2 class="section-title">Overall Statistics</h2></div>
                    <div class="stats-grid" id="perfStatsGrid"></div>
                    <div class="chart-container">
                        <h3 class="chart-title">Win/Loss/Draw by Color</h3>
                        <canvas id="perfColorChart"></canvas>
                    </div>
                `;
                displayStats(s, 'perfStatsGrid');
                displayColorChart(s, 'perfColorChart');
                renderProgressTrackingPanel('perfProgressSection');
                // Load dashboard if we have username
                if (AppStore.username) {
                    const gameTypes = getSelectedGameTypes();
                    if (gameTypes.length > 0 && !AppStore.latestDashboardData) {
                        fetchWeeklyDashboard(AppStore.username, gameTypes, 'perfDashboardSection');
                    } else if (AppStore.latestDashboardData) {
                        displayDashboard(AppStore.latestDashboardData, 'perfDashboardSection');
                    }
                }
                break;

            case 'leaks':
                content.innerHTML = `
                    <div id="perfHeroSection"></div>
                    <div class="section-header"><h2 class="section-title">Your Biggest Leaks</h2></div>
                    <div class="leaks-grid" id="perfLeaksGrid"></div>
                    <div class="insights-section">
                        <h2 class="section-title" style="margin-bottom: 20px;">Personal Insights</h2>
                        <div id="perfInsightsContainer"></div>
                    </div>
                    <div class="study-recommendations">
                        <h2 style="font-size: 1.8em; margin-bottom: 20px;">What to Study Next</h2>
                        <div id="perfStudyContainer"></div>
                    </div>
                `;
                displayHeroSection(s, 'perfHeroSection');
                displayLeaksGrid(s, 'perfLeaksGrid');
                displayInsights(s, 'perfInsightsContainer');
                displayStudyRecommendations(s, 'perfStudyContainer');
                break;

            case 'time':
                content.innerHTML = `
                    <div id="perfTimeSection"></div>
                    <div id="perfGamesToReview"></div>
                `;
                displayTimeManagement(s, 'perfTimeSection');
                displayGamesToReview(s, 'perfGamesToReview');
                break;

            case 'progress':
                content.innerHTML = `
                    <div id="perfProgressDetail" class="chart-container progress-tracking-section"></div>
                `;
                renderProgressTrackingPanel('perfProgressDetail');
                break;
        }
    },

    // ==================== PUZZLES ====================
    initPuzzles() {
        this._initPuzzleTabs();
        this._showPuzzleTab('daily');
    },

    _puzzleTabsBound: false,
    _initPuzzleTabs() {
        if (this._puzzleTabsBound) return;
        this._puzzleTabsBound = true;
        document.querySelectorAll('.puzzle-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.puzzle-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this._showPuzzleTab(tab.dataset.tab);
            });
        });
    },

    _showPuzzleTab(tabName) {
        const dailyContent = document.getElementById('puzzleDailyContent');
        const proContent = document.getElementById('puzzleProContent');
        if (!dailyContent || !proContent) return;

        if (tabName === 'daily') {
            dailyContent.style.display = 'block';
            proContent.style.display = 'none';
            if (typeof DailyPuzzle !== 'undefined') {
                DailyPuzzle.init('puzzleDailyContainer');
            }
        } else {
            dailyContent.style.display = 'none';
            proContent.style.display = 'block';
            // Pro puzzles section is already rendered in the HTML
            if (typeof Payments !== 'undefined') {
                Payments._renderProAccess();
            }
        }
    },

    // ==================== OPENINGS ====================
    initOpenings() {
        AppStore.restoreFromSession();
        const content = document.getElementById('openingsContent');
        const needsAnalysis = document.getElementById('openingsNeedsAnalysis');
        if (!content || !needsAnalysis) return;

        if (!AppStore.hasAnalysis()) {
            content.style.display = 'none';
            needsAnalysis.style.display = 'block';
            return;
        }

        content.style.display = 'block';
        needsAnalysis.style.display = 'none';
        const s = AppStore.stats;

        content.innerHTML = `
            <div class="chart-container">
                <h3 class="chart-title">Performance by Opening</h3>
                <canvas id="openingsPageChart"></canvas>
            </div>
            <div class="chart-container">
                <h3 class="chart-title">Opening Statistics</h3>
                <table id="openingsPageTable"></table>
            </div>
            <div id="openingsEndgameSection"></div>
        `;
        displayOpeningChart(s, 'openingsPageChart');
        displayOpeningTable(s, 'openingsPageTable');
        if (s.endgameLosses > 0) {
            displayEndgameAnalysis(s, 'openingsEndgameSection');
        }
    },

    // ==================== STUDY PLAN ====================
    initStudyPlan() {
        AppStore.restoreFromSession();
        const btn = document.getElementById('generateStudyPlanBtnPage');
        const needsAnalysis = document.getElementById('studyPlanNeedsAnalysis');
        const intro = document.getElementById('studyPlanIntroPage');

        if (!AppStore.hasAnalysis()) {
            if (needsAnalysis) needsAnalysis.style.display = 'block';
            if (intro) intro.style.display = 'none';
        } else {
            if (needsAnalysis) needsAnalysis.style.display = 'none';
            if (intro) intro.style.display = 'block';
        }
    },

    // ==================== COACHING ====================
    initCoaching() {
        // Prefill coaching page form (uses Page-suffixed IDs to avoid landing page duplicates)
        const user = (typeof Auth !== 'undefined' && Auth.getUser()) || {};
        const nameEl = document.getElementById('coachingNamePage');
        const emailEl = document.getElementById('coachingEmailPage');
        if (nameEl && !nameEl.value && user.username) nameEl.value = user.username;
        if (emailEl && !emailEl.value && user.email) emailEl.value = user.email;

        // Apply dynamic pricing labels
        if (typeof Payments !== 'undefined' && Payments.config) {
            const hourlyBtn = document.getElementById('bookCoachingHourlyBtnPage');
            const monthlyBtn = document.getElementById('bookCoachingMonthlyBtnPage');
            if (hourlyBtn && Payments.config.coaching_hourly_amount_inr) {
                hourlyBtn.textContent = `Pay \u20B9${Payments.config.coaching_hourly_amount_inr} (1 Hour)`;
            }
            if (monthlyBtn && Payments.config.coaching_monthly_amount_inr) {
                monthlyBtn.textContent = `Pay \u20B9${Payments.config.coaching_monthly_amount_inr} (10 Sessions)`;
            }
        }
    },

    // ==================== OPPONENT PREP ====================
    initOpponentPrep() {
        // Restore platform preference from current session
        const platform = document.getElementById('opponentPlatform');
        if (platform && AppStore.currentPlatform) {
            platform.value = AppStore.currentPlatform;
        }

        // Allow Enter key to trigger scout
        const input = document.getElementById('opponentUsername');
        if (input && !input._oppPrepBound) {
            input._oppPrepBound = true;
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') scoutOpponent();
            });
        }

        // If we have cached opponent results from this session, re-render
        if (typeof OpponentPrep !== 'undefined' && OpponentPrep._lastResult) {
            OpponentPrep.renderResults(OpponentPrep._lastResult);
        }
    }
};
