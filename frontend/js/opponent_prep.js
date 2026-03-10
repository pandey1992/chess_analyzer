// Opponent Prep — scout an opponent's games and find their opening weaknesses

const OpponentPrep = {
    _lastResult: null,  // cache so revisiting the page doesn't lose results

    // ==================== UI HELPERS ====================
    showLoading(stage, detail, pct) {
        const el = document.getElementById('opponentLoading');
        const stageEl = document.getElementById('opponentLoadingStage');
        const detailEl = document.getElementById('opponentLoadingDetail');
        const fill = document.getElementById('opponentProgressFill');
        if (el) el.style.display = 'block';
        if (stageEl) stageEl.textContent = stage;
        if (detailEl) detailEl.textContent = detail || '';
        if (fill) fill.style.width = `${pct || 0}%`;
    },

    hideLoading() {
        const el = document.getElementById('opponentLoading');
        if (el) el.style.display = 'none';
    },

    showError(msg) {
        const el = document.getElementById('opponentError');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
    },

    hideError() {
        const el = document.getElementById('opponentError');
        if (el) { el.textContent = ''; el.style.display = 'none'; }
    },

    showResults() {
        const el = document.getElementById('opponentResults');
        if (el) el.style.display = 'block';
    },

    hideResults() {
        const el = document.getElementById('opponentResults');
        if (el) el.style.display = 'none';
    },

    // ==================== CORE ANALYSIS ====================

    /**
     * Analyze games from the opponent's perspective.
     * Separate from AppStore.stats — never mutates user's own analysis data.
     */
    analyzeOpponentGames(games, opponentUsername) {
        const stats = {
            totalGames: 0,
            wins: 0, losses: 0, draws: 0,
            whiteGames: 0, blackGames: 0,
            whiteWins: 0, whiteLosses: 0, whiteDraws: 0,
            blackWins: 0, blackLosses: 0, blackDraws: 0,
            openings: {},
            timeControls: {}
        };

        const normalizedOpp = opponentUsername.toLowerCase();

        games.forEach(game => {
            stats.totalGames++;
            const isWhite = game.white.username.toLowerCase() === normalizedOpp;
            const result = game.white.result;
            const eco = game.eco || 'Unknown';
            const openingName = typeof extractOpeningName === 'function'
                ? extractOpeningName(game.pgn)
                : (eco !== 'Unknown' ? eco : 'Unknown Opening');
            const timeControl = game.time_class || 'unknown';

            // Track time controls
            if (!stats.timeControls[timeControl]) {
                stats.timeControls[timeControl] = { games: 0, wins: 0, losses: 0, draws: 0 };
            }
            stats.timeControls[timeControl].games++;

            // Initialize opening
            if (!stats.openings[eco]) {
                stats.openings[eco] = {
                    name: openingName,
                    whiteGames: 0, whiteWins: 0, whiteLosses: 0, whiteDraws: 0,
                    blackGames: 0, blackWins: 0, blackLosses: 0, blackDraws: 0,
                    totalGames: 0
                };
            }
            stats.openings[eco].totalGames++;

            if (isWhite) {
                // Opponent played White
                stats.whiteGames++;
                stats.openings[eco].whiteGames++;

                if (result === 'win') {
                    // White won → opponent won
                    stats.wins++; stats.whiteWins++;
                    stats.openings[eco].whiteWins++;
                    stats.timeControls[timeControl].wins++;
                } else if (result === 'lose' || (typeof result === 'string' && (result.includes('resigned') || result.includes('checkmated')))) {
                    // This shouldn't normally happen for white.result directly, but handle gracefully
                    stats.losses++; stats.whiteLosses++;
                    stats.openings[eco].whiteLosses++;
                    stats.timeControls[timeControl].losses++;
                } else if (result === 'checkmated' || result === 'timeout' || result === 'resigned' || result === 'abandoned') {
                    // White lost
                    stats.losses++; stats.whiteLosses++;
                    stats.openings[eco].whiteLosses++;
                    stats.timeControls[timeControl].losses++;
                } else {
                    // Draw (stalemate, agreed, repetition, insufficient, etc.)
                    stats.draws++; stats.whiteDraws++;
                    stats.openings[eco].whiteDraws++;
                    stats.timeControls[timeControl].draws++;
                }
            } else {
                // Opponent played Black — white.result tells us what happened to White (not opponent)
                stats.blackGames++;
                stats.openings[eco].blackGames++;

                if (result === 'win') {
                    // White won → opponent (Black) LOST
                    stats.losses++; stats.blackLosses++;
                    stats.openings[eco].blackLosses++;
                    stats.timeControls[timeControl].losses++;
                } else if (result === 'checkmated' || result === 'timeout' || result === 'resigned' || result === 'abandoned') {
                    // White lost → opponent (Black) WON
                    stats.wins++; stats.blackWins++;
                    stats.openings[eco].blackWins++;
                    stats.timeControls[timeControl].wins++;
                } else {
                    // Draw
                    stats.draws++; stats.blackDraws++;
                    stats.openings[eco].blackDraws++;
                    stats.timeControls[timeControl].draws++;
                }
            }
        });

        return stats;
    },

    // ==================== WEAKNESS EXTRACTION ====================

    /**
     * Find openings where opponent has the worst win rate for a given color.
     * @param {Object} openings - stats.openings keyed by ECO
     * @param {string} color - 'white' or 'black'
     * @param {number} minGames - minimum games to consider (default 3)
     * @returns {Array} sorted by opponent's win rate ascending (worst first)
     */
    findWeakOpenings(openings, color, minGames = 3) {
        return Object.entries(openings)
            .map(([eco, data]) => {
                const games = color === 'white' ? data.whiteGames : data.blackGames;
                const wins = color === 'white' ? data.whiteWins : data.blackWins;
                const losses = color === 'white' ? data.whiteLosses : data.blackLosses;
                const draws = color === 'white' ? data.whiteDraws : data.blackDraws;
                const winRate = games > 0 ? (wins / games * 100) : 0;
                const lossRate = games > 0 ? (losses / games * 100) : 0;
                return { eco, name: data.name, games, wins, losses, draws, winRate, lossRate };
            })
            .filter(o => o.games >= minGames)
            .sort((a, b) => a.winRate - b.winRate); // worst win rate first = most exploitable
    },

    // ==================== RECOMMENDATIONS ====================

    /**
     * Generate actionable recommendation cards.
     * weakAsWhite → openings where opponent struggles as White → user plays Black
     * weakAsBlack → openings where opponent struggles as Black → user plays White
     */
    generateRecommendations(weakAsWhite, weakAsBlack) {
        const recs = [];

        // Top 3 where opponent is weakest as White → user plays Black
        weakAsWhite.slice(0, 3).forEach(op => {
            recs.push({
                color: 'black',
                opening: op.name,
                eco: op.eco,
                oppLossRate: op.lossRate.toFixed(0),
                oppWinRate: op.winRate.toFixed(0),
                oppGames: op.games,
                message: `As Black, steer into the ${op.name}. Your opponent wins only ${op.winRate.toFixed(0)}% and loses ${op.lossRate.toFixed(0)}% in this opening as White (${op.games} games).`
            });
        });

        // Top 3 where opponent is weakest as Black → user plays White
        weakAsBlack.slice(0, 3).forEach(op => {
            recs.push({
                color: 'white',
                opening: op.name,
                eco: op.eco,
                oppLossRate: op.lossRate.toFixed(0),
                oppWinRate: op.winRate.toFixed(0),
                oppGames: op.games,
                message: `As White, play the ${op.name}. Your opponent wins only ${op.winRate.toFixed(0)}% and loses ${op.lossRate.toFixed(0)}% defending as Black (${op.games} games).`
            });
        });

        return recs;
    },

    // ==================== PERFECT MATCH ====================

    /**
     * Find openings where user is strong AND opponent is weak.
     * Only runs if user has their own analyzed games.
     */
    findPerfectMatches(opponentOpenings, userStats) {
        if (!userStats || !userStats.openings) return [];

        const matches = [];

        Object.entries(opponentOpenings).forEach(([eco, oppData]) => {
            const userData = userStats.openings[eco];
            if (!userData) return;

            // User strong as White + opponent weak as Black
            const userWhiteGames = userData.whiteWins + userData.whiteLosses + userData.whiteDraws;
            const oppBlackGames = oppData.blackGames;
            if (userWhiteGames >= 3 && oppBlackGames >= 3) {
                const userWhiteWR = (userData.whiteWins / userWhiteGames * 100);
                const oppBlackWR = (oppData.blackWins / oppBlackGames * 100);
                if (userWhiteWR >= 55 && oppBlackWR <= 45) {
                    matches.push({
                        eco,
                        name: oppData.name,
                        userColor: 'white',
                        userWinRate: userWhiteWR.toFixed(0),
                        userGames: userWhiteGames,
                        oppWinRate: oppBlackWR.toFixed(0),
                        oppGames: oppBlackGames,
                        score: userWhiteWR - oppBlackWR
                    });
                }
            }

            // User strong as Black + opponent weak as White
            const userBlackGames = userData.blackWins + userData.blackLosses + userData.blackDraws;
            const oppWhiteGames = oppData.whiteGames;
            if (userBlackGames >= 3 && oppWhiteGames >= 3) {
                const userBlackWR = (userData.blackWins / userBlackGames * 100);
                const oppWhiteWR = (oppData.whiteWins / oppWhiteGames * 100);
                if (userBlackWR >= 55 && oppWhiteWR <= 45) {
                    matches.push({
                        eco,
                        name: oppData.name,
                        userColor: 'black',
                        userWinRate: userBlackWR.toFixed(0),
                        userGames: userBlackGames,
                        oppWinRate: oppWhiteWR.toFixed(0),
                        oppGames: oppWhiteGames,
                        score: userBlackWR - oppWhiteWR
                    });
                }
            }
        });

        return matches.sort((a, b) => b.score - a.score);
    },

    // ==================== RENDERING ====================

    renderResults(result) {
        this.renderOverview(result.stats, result.username);
        this.renderWeaknessTable(result.weakAsWhite, 'opponentWeakWhiteTable', 'white');
        this.renderWeaknessTable(result.weakAsBlack, 'opponentWeakBlackTable', 'black');
        this.renderRecommendations(result.recommendations);

        const perfectMatchEl = document.getElementById('opponentPerfectMatch');
        if (result.perfectMatches.length > 0) {
            this.renderPerfectMatch(result.perfectMatches);
            if (perfectMatchEl) perfectMatchEl.style.display = 'block';
        } else {
            if (perfectMatchEl) perfectMatchEl.style.display = 'none';
        }

        const titleEl = document.getElementById('opponentResultsTitle');
        if (titleEl) titleEl.textContent = `Scouting Report: ${result.username}`;

        this.showResults();
    },

    renderOverview(stats, username) {
        const container = document.getElementById('opponentOverviewStats');
        if (!container) return;

        const winRate = stats.totalGames > 0 ? (stats.wins / stats.totalGames * 100).toFixed(1) : '0.0';
        const lossRate = stats.totalGames > 0 ? (stats.losses / stats.totalGames * 100).toFixed(1) : '0.0';

        // Time control summary
        const tcEntries = Object.entries(stats.timeControls).sort((a, b) => b[1].games - a[1].games);
        const topTC = tcEntries.length > 0 ? tcEntries[0][0] : 'N/A';

        container.innerHTML = `
            <div class="home-stat-card">
                <div class="home-stat-value">${stats.totalGames}</div>
                <div class="home-stat-label">Games Analyzed</div>
            </div>
            <div class="home-stat-card">
                <div class="home-stat-value">${winRate}%</div>
                <div class="home-stat-label">Win Rate</div>
            </div>
            <div class="home-stat-card">
                <div class="home-stat-value">${lossRate}%</div>
                <div class="home-stat-label">Loss Rate</div>
            </div>
            <div class="home-stat-card">
                <div class="home-stat-value">${stats.wins}W / ${stats.losses}L / ${stats.draws}D</div>
                <div class="home-stat-label">Overall Record</div>
            </div>
            <div class="home-stat-card">
                <div class="home-stat-value">${stats.whiteGames} / ${stats.blackGames}</div>
                <div class="home-stat-label">White / Black Games</div>
            </div>
            <div class="home-stat-card">
                <div class="home-stat-value" style="text-transform:capitalize;">${topTC}</div>
                <div class="home-stat-label">Most Played</div>
            </div>
        `;
    },

    renderWeaknessTable(openings, targetId, color) {
        const table = document.getElementById(targetId);
        if (!table) return;

        if (openings.length === 0) {
            table.innerHTML = `<tbody><tr><td colspan="5" style="text-align:center;color:#718096;padding:24px;">
                Not enough data to identify weaknesses (need at least 3 games per opening for this color).
            </td></tr></tbody>`;
            return;
        }

        const colorLabel = color === 'white' ? 'as White' : 'as Black';

        let html = `
            <thead><tr>
                <th>Opening</th>
                <th>Games</th>
                <th>Opp Win Rate</th>
                <th>Opp Loss Rate</th>
                <th>W / L / D</th>
            </tr></thead><tbody>
        `;

        openings.slice(0, 15).forEach(op => {
            // High opponent loss rate = good for user (green)
            const lossRateClass = op.lossRate >= 55 ? 'loss-rate-high' :
                                  op.lossRate >= 40 ? 'loss-rate-medium' : 'loss-rate-low';
            // Low opponent win rate = good for user
            const winRateClass = op.winRate <= 35 ? 'win-rate-low' :
                                 op.winRate <= 50 ? 'win-rate-medium' : 'win-rate-high';

            html += `
                <tr>
                    <td>
                        <div class="opening-name">${op.name}</div>
                        <div class="opening-eco">${op.eco}</div>
                    </td>
                    <td><span class="stat-number">${op.games}</span></td>
                    <td><span class="${winRateClass}">${op.winRate.toFixed(0)}%</span></td>
                    <td><span class="${lossRateClass}">${op.lossRate.toFixed(0)}%</span></td>
                    <td><span class="stat-number">${op.wins} / ${op.losses} / ${op.draws}</span></td>
                </tr>
            `;
        });

        html += '</tbody>';
        table.innerHTML = html;
    },

    renderRecommendations(recs) {
        const container = document.getElementById('opponentRecommendations');
        if (!container) return;

        if (recs.length === 0) {
            container.innerHTML = `<p style="color:#718096;text-align:center;padding:24px;">
                Not enough data to generate specific recommendations. The opponent needs at least 3 games per opening.
            </p>`;
            return;
        }

        container.innerHTML = recs.map(r => `
            <div class="opp-rec-card rec-${r.color}">
                <div class="opp-rec-color-badge badge-${r.color}">Play as ${r.color}</div>
                <div class="opp-rec-opening">${r.opening}</div>
                <div class="opp-rec-eco">${r.eco}</div>
                <div class="opp-rec-message">${r.message}</div>
                <div class="opp-rec-stat">Opponent loses ${r.oppLossRate}% here</div>
            </div>
        `).join('');
    },

    renderPerfectMatch(matches) {
        const container = document.getElementById('opponentMatchCards');
        if (!container) return;

        container.innerHTML = matches.slice(0, 6).map(m => `
            <div class="opp-match-card">
                <div class="opp-match-title">${m.name} (${m.eco})</div>
                <div class="opp-match-detail">
                    You as ${m.userColor}: <strong>${m.userWinRate}% win rate</strong> (${m.userGames} games)<br>
                    Opponent as ${m.userColor === 'white' ? 'black' : 'white'}: <strong>${m.oppWinRate}% win rate</strong> (${m.oppGames} games)
                </div>
                <div class="opp-match-score">+${m.score.toFixed(0)}% advantage</div>
            </div>
        `).join('');
    }
};


// ==================== GLOBAL ENTRY POINT ====================

async function scoutOpponent() {
    const usernameEl = document.getElementById('opponentUsername');
    const platformEl = document.getElementById('opponentPlatform');
    const username = (usernameEl ? usernameEl.value.trim() : '');
    const platform = (platformEl ? platformEl.value : 'chesscom');

    if (!username) {
        OpponentPrep.showError('Please enter an opponent username.');
        return;
    }

    // Gather selected game types
    const gameTypes = [];
    if (document.getElementById('oppRapid')?.checked) gameTypes.push('rapid');
    if (document.getElementById('oppBlitz')?.checked) gameTypes.push('blitz');
    if (document.getElementById('oppBullet')?.checked) gameTypes.push('bullet');
    if (gameTypes.length === 0) {
        OpponentPrep.showError('Please select at least one game type.');
        return;
    }

    OpponentPrep.hideError();
    OpponentPrep.hideResults();

    const platformName = platform === 'lichess' ? 'Lichess' : 'Chess.com';
    OpponentPrep.showLoading('Fetching games...', `Reading ${username}'s recent games from ${platformName}`, 20);

    const btn = document.getElementById('scoutOpponentBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Scouting...'; }

    try {
        const games = await ChessAPI.fetchGames(username, gameTypes, platform);

        if (!games || games.length === 0) {
            OpponentPrep.showError(`No games found for "${username}" on ${platformName}. Check the username and selected game types.`);
            OpponentPrep.hideLoading();
            if (btn) { btn.disabled = false; btn.textContent = 'Scout Opponent'; }
            return;
        }

        OpponentPrep.showLoading('Analyzing patterns...', `Processing ${games.length} games`, 60);

        // Small delay so the UI updates before heavy computation
        await new Promise(r => setTimeout(r, 50));

        const stats = OpponentPrep.analyzeOpponentGames(games, username);
        const weakAsWhite = OpponentPrep.findWeakOpenings(stats.openings, 'white');
        const weakAsBlack = OpponentPrep.findWeakOpenings(stats.openings, 'black');
        const recommendations = OpponentPrep.generateRecommendations(weakAsWhite, weakAsBlack);

        // Perfect match: cross-reference with user's own analysis if available
        let perfectMatches = [];
        AppStore.restoreFromSession();
        if (AppStore.hasAnalysis()) {
            perfectMatches = OpponentPrep.findPerfectMatches(stats.openings, AppStore.stats);
        }

        const result = {
            username,
            platform,
            stats,
            weakAsWhite,
            weakAsBlack,
            recommendations,
            perfectMatches
        };

        OpponentPrep._lastResult = result;
        OpponentPrep.showLoading('Done!', `Found ${Object.keys(stats.openings).length} openings across ${stats.totalGames} games`, 100);

        // Brief pause to show completion
        await new Promise(r => setTimeout(r, 400));

        OpponentPrep.hideLoading();
        OpponentPrep.renderResults(result);

    } catch (error) {
        console.error('Opponent Prep error:', error);
        OpponentPrep.showError(error.message || 'Failed to fetch opponent games. Please check the username and try again.');
        OpponentPrep.hideLoading();
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Scout Opponent'; }
    }
}
