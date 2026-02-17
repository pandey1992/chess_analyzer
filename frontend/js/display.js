// Display functions - extracted from chess_analyzer_v2_with_study_plan.html

function displayAll(stats) {
    displayHeroSection(stats);
    displayLeaksGrid(stats);
    displayInsights(stats);
    displayStudyRecommendations(stats);
    displayTimeManagement(stats);
    displayGamesToReview(stats);
    displayStats(stats);
    displayColorChart(stats);
    displayOpeningChart(stats);
    displayOpeningTable(stats);

    if (stats.endgameLosses > 0) {
        displayEndgameAnalysis(stats);
    }
}

function displayHeroSection(stats) {
    const winRate = ((stats.wins / stats.totalGames) * 100).toFixed(1);
    const recentWinRate = stats.recentGames.length > 0
        ? ((stats.recentGames.slice(0, 10).filter(g => g.result === 'win').length / 10) * 100).toFixed(0)
        : 0;

    const lossStreaks = stats.streaks.filter(s => s.type === 'loss' && s.count >= 3);
    const worstPhase = [
        { name: 'opening', count: stats.openingPhaseLosses },
        { name: 'middlegame', count: stats.middlegameLosses },
        { name: 'endgame', count: stats.endgameLosses }
    ].sort((a, b) => b.count - a.count)[0];

    let heroClass = 'hero-section';
    let heroTitle = '🎯 Priority Focus Area';
    let heroSubtitle = '';
    let heroStat = '';
    let heroAction = '';

    if (lossStreaks.length > 0 && lossStreaks[0].count >= 5) {
        heroClass += ' critical';
        heroTitle = '🚨 Alert: Losing Streak!';
        heroSubtitle = `You're on a ${lossStreaks[0].count}-game losing streak`;
        heroStat = `-${lossStreaks[0].count}`;
        heroAction = 'Take a break! Analyze your recent games, identify the pattern, and come back refreshed.';
    } else if (stats.openingPhaseLosses > stats.totalGames * 0.3) {
        heroClass += ' critical';
        heroTitle = '💥 Opening Problems Detected';
        heroSubtitle = `${stats.openingPhaseLosses} losses in the opening phase`;
        heroStat = `${((stats.openingPhaseLosses / stats.losses) * 100).toFixed(0)}%`;
        heroAction = 'You\'re getting crushed early. Focus on opening principles and study your most-played openings.';
    } else if (recentWinRate < 35) {
        heroClass += ' warning';
        heroTitle = '⚠️ Recent Form Dip';
        heroSubtitle = `Only ${recentWinRate}% wins in last 10 games`;
        heroStat = `${recentWinRate}%`;
        heroAction = 'Your recent performance is below your average. Review your latest losses and take a mental reset.';
    } else {
        heroClass += ' good';
        heroTitle = '🎉 You\'re Doing Well!';
        heroSubtitle = `${winRate}% overall win rate`;
        heroStat = `${winRate}%`;
        heroAction = `Keep it up! Your main area for improvement is the ${worstPhase.name}.`;
    }

    const html = `
        <div class="${heroClass}">
            <div class="hero-title">${heroTitle}</div>
            <div class="hero-subtitle">${heroSubtitle}</div>
            <div class="hero-stat">${heroStat}</div>
            <div class="hero-action">${heroAction}</div>
        </div>
    `;

    document.getElementById('heroSection').innerHTML = html;
}

function displayLeaksGrid(stats) {
    const phases = [
        { name: 'opening', count: stats.openingPhaseLosses, total: stats.losses },
        { name: 'middlegame', count: stats.middlegameLosses, total: stats.losses },
        { name: 'endgame', count: stats.endgameLosses, total: stats.losses }
    ];

    const worstPhase = phases.sort((a, b) => b.count - a.count)[0];
    const phasePct = ((worstPhase.count / worstPhase.total) * 100).toFixed(0);

    const whiteGames = stats.whiteWins + stats.whiteLosses + stats.whiteDraws;
    const blackGames = stats.blackWins + stats.blackLosses + stats.blackDraws;
    const whiteWinRate = whiteGames > 0 ? ((stats.whiteWins / whiteGames) * 100).toFixed(0) : 0;
    const blackWinRate = blackGames > 0 ? ((stats.blackWins / blackGames) * 100).toFixed(0) : 0;
    const colorImbalance = Math.abs(whiteWinRate - blackWinRate);

    const hourlyPerf = Object.entries(stats.gamesByHour)
        .map(([hour, data]) => ({
            hour: parseInt(hour),
            winRate: data.total > 0 ? ((data.wins / data.total) * 100).toFixed(0) : 0,
            total: data.total
        }))
        .filter(h => h.total >= 3)
        .sort((a, b) => a.winRate - b.winRate);

    const worstHour = hourlyPerf.length > 0 ? hourlyPerf[0] : null;

    const recentForm = stats.recentGames.slice(0, 10);
    const recentWins = recentForm.filter(g => g.result === 'win').length;
    const recentWinRate = (recentWins / 10) * 100;
    const overallWinRate = ((stats.wins / stats.totalGames) * 100).toFixed(0);
    const formDiff = recentWinRate - overallWinRate;

    let html = `
        <div class="leak-card ${worstPhase.count >= stats.losses * 0.4 ? 'critical' : worstPhase.count >= stats.losses * 0.3 ? 'warning' : 'good'}">
            <div class="leak-icon">${worstPhase.name === 'opening' ? '📖' : worstPhase.name === 'middlegame' ? '⚔️' : '🏁'}</div>
            <div class="leak-title">${worstPhase.name.charAt(0).toUpperCase() + worstPhase.name.slice(1)} Phase</div>
            <div class="leak-metric">${worstPhase.count}</div>
            <div class="leak-description">
                ${phasePct}% of your losses
                ${worstPhase.count >= stats.losses * 0.4 ? '<br><strong>Critical!</strong> Major weakness here.' :
                  worstPhase.count >= stats.losses * 0.3 ? '<br><strong>Focus area</strong> for improvement.' :
                  '<br>Your strongest phase!'}
            </div>
        </div>

        <div class="leak-card ${colorImbalance >= 15 ? 'critical' : colorImbalance >= 10 ? 'warning' : 'good'}">
            <div class="leak-icon">⚖️</div>
            <div class="leak-title">Color Imbalance</div>
            <div class="leak-metric">${colorImbalance}%</div>
            <div class="leak-description">
                White: ${whiteWinRate}% | Black: ${blackWinRate}%
                ${colorImbalance >= 15 ? '<br><strong>Big gap!</strong> One color much weaker.' :
                  colorImbalance >= 10 ? '<br><strong>Notable difference</strong> between colors.' :
                  '<br>Well balanced!'}
            </div>
        </div>
    `;

    if (worstHour && worstHour.winRate < 40) {
        html += `
            <div class="leak-card warning">
                <div class="leak-icon">🕐</div>
                <div class="leak-title">Time of Day</div>
                <div class="leak-metric">${worstHour.winRate}%</div>
                <div class="leak-description">
                    At ${worstHour.hour}:00 (${worstHour.total} games)
                    <br><strong>Avoid this time!</strong> Your worst performance window.
                </div>
            </div>
        `;
    }

    html += `
        <div class="leak-card ${Math.abs(formDiff) >= 15 ? 'warning' : 'good'}">
            <div class="leak-icon">📊</div>
            <div class="leak-title">Recent Form</div>
            <div class="leak-metric">${recentWins}/10</div>
            <div class="leak-description">
                Last 10 games: ${recentWinRate.toFixed(0)}%
                ${formDiff < -15 ? '<br><strong>Slump detected!</strong> Below your average.' :
                  formDiff > 15 ? '<br><strong>Hot streak!</strong> Above your average.' :
                  '<br>Consistent with your average.'}
            </div>
        </div>
    `;

    const openingVariety = Object.keys(stats.openings).length;
    const gamesPerOpening = stats.totalGames / openingVariety;

    html += `
        <div class="leak-card ${gamesPerOpening > 20 ? 'warning' : 'good'}">
            <div class="leak-icon">🎯</div>
            <div class="leak-title">Repertoire Variety</div>
            <div class="leak-metric">${openingVariety}</div>
            <div class="leak-description">
                Different openings played
                ${gamesPerOpening > 20 ? '<br><strong>Too narrow!</strong> Expand your repertoire.' :
                  '<br>Good variety in your openings.'}
            </div>
        </div>
    `;

    const timeoutRate = stats.losses > 0 ? ((stats.timePressureLosses / stats.losses) * 100).toFixed(0) : 0;
    html += `
        <div class="leak-card ${timeoutRate >= 20 ? 'critical' : timeoutRate >= 10 ? 'warning' : 'good'}">
            <div class="leak-icon">⏰</div>
            <div class="leak-title">Time Pressure</div>
            <div class="leak-metric">${stats.timePressureLosses}</div>
            <div class="leak-description">
                ${timeoutRate}% of losses are timeouts
                ${timeoutRate >= 20 ? '<br><strong>Critical issue!</strong> Flagging too often.' :
                  timeoutRate >= 10 ? '<br><strong>Improve time management.</strong>' :
                  '<br>Good time management!'}
            </div>
        </div>
    `;

    document.getElementById('leaksGrid').innerHTML = html;
}

function displayInsights(stats) {
    const insights = [];

    // Streaks
    const lossStreaks = stats.streaks.filter(s => s.type === 'loss');
    if (lossStreaks.length > 0 && lossStreaks[0].count >= 3) {
        insights.push({
            type: 'critical',
            badge: 'ALERT',
            text: `You're currently on a ${lossStreaks[0].count}-game losing streak. This is the perfect time to take a break, review those games carefully, and identify the common mistakes before playing more.`
        });
    }

    // Color preference
    const whiteGames = stats.whiteWins + stats.whiteLosses + stats.whiteDraws;
    const blackGames = stats.blackWins + stats.blackLosses + stats.blackDraws;
    const whiteWinRate = whiteGames > 0 ? (stats.whiteWins / whiteGames) * 100 : 0;
    const blackWinRate = blackGames > 0 ? (stats.blackWins / blackGames) * 100 : 0;

    if (Math.abs(whiteWinRate - blackWinRate) > 12) {
        const weaker = whiteWinRate < blackWinRate ? 'white' : 'black';
        const stronger = whiteWinRate > blackWinRate ? 'white' : 'black';
        insights.push({
            type: 'warning',
            badge: 'COLOR IMBALANCE',
            text: `You score ${Math.abs(whiteWinRate - blackWinRate).toFixed(0)}% better with ${stronger} pieces. Your ${weaker}-piece openings need work. Consider expanding your ${weaker}-piece repertoire.`
        });
    }

    // Repertoire
    const openingCount = Object.keys(stats.openings).length;
    if (openingCount < 5) {
        insights.push({
            type: 'tip',
            badge: 'TIP',
            text: `You're only playing ${openingCount} different openings. While focus is good, having 2-3 solid options per color makes you less predictable and gives you flexibility against different opponents.`
        });
    }

    // Recent form
    const recentWins = stats.recentGames.slice(0, 10).filter(g => g.result === 'win').length;
    const overallWinRate = (stats.wins / stats.totalGames) * 100;
    const recentWinRate = (recentWins / 10) * 100;

    if (recentWinRate > overallWinRate + 15) {
        insights.push({
            type: 'tip',
            badge: 'MOMENTUM',
            text: `You're playing ${(recentWinRate - overallWinRate).toFixed(0)}% better than your average lately! You're on a hot streak. Keep the momentum going!`
        });
    }

    let html = '';
    insights.forEach(insight => {
        html += `
            <div class="insight-item ${insight.type}">
                <div class="insight-header">
                    <span class="insight-badge ${insight.type}">${insight.badge}</span>
                </div>
                <div class="insight-text">${insight.text}</div>
            </div>
        `;
    });

    if (insights.length === 0) {
        html = `
            <div class="insight-item tip">
                <div class="insight-header">
                    <span class="insight-badge tip">LOOKING GOOD</span>
                </div>
                <div class="insight-text">No critical patterns detected in your recent games. Keep up the consistent play!</div>
            </div>
        `;
    }

    document.getElementById('insightsContainer').innerHTML = html;
}

function displayStudyRecommendations(stats) {
    const recommendations = [];

    // Priority 1: Biggest leak by game phase
    const phases = [
        { name: 'Opening', count: stats.openingPhaseLosses, pct: (stats.openingPhaseLosses / stats.losses) * 100 },
        { name: 'Middlegame', count: stats.middlegameLosses, pct: (stats.middlegameLosses / stats.losses) * 100 },
        { name: 'Endgame', count: stats.endgameLosses, pct: (stats.endgameLosses / stats.losses) * 100 }
    ].sort((a, b) => b.count - a.count);

    if (phases[0].pct > 30) {
        let resources = [];
        if (phases[0].name === 'Opening') {
            resources = [
                { type: 'youtube', url: 'https://www.youtube.com/@GothamChess/search?query=opening+principles', label: '📺 Opening Principles' },
                { type: 'article', url: 'https://www.chess.com/lessons/openings', label: '📖 Opening Lessons' },
                { type: 'lichess', url: 'https://lichess.org/practice', label: '♟️ Lichess Practice' }
            ];
        } else if (phases[0].name === 'Middlegame') {
            resources = [
                { type: 'youtube', url: 'https://www.youtube.com/@HangingPawns/search?query=middlegame+strategy', label: '📺 Middlegame Strategy' },
                { type: 'article', url: 'https://www.chess.com/puzzles', label: '📖 Tactics Puzzles' },
                { type: 'lichess', url: 'https://lichess.org/training', label: '♟️ Lichess Puzzles' }
            ];
        } else {
            resources = [
                { type: 'youtube', url: 'https://www.youtube.com/@DanielNaroditskyGM/search?query=endgame', label: '📺 Endgame Lessons' },
                { type: 'article', url: 'https://www.chess.com/practice/drills/endgame-practice', label: '📖 Endgame Drills' },
                { type: 'lichess', url: 'https://lichess.org/practice', label: '♟️ Lichess Endgames' }
            ];
        }

        recommendations.push({
            priority: 'HIGH',
            title: `${phases[0].name} Training`,
            impact: `Could save you ${phases[0].count} losses (${phases[0].pct.toFixed(0)}% of total)`,
            actions: phases[0].name === 'Opening'
                ? 'Spend 20 minutes daily reviewing your opening lines. Focus on understanding plans and ideas, not just memorizing moves.'
                : phases[0].name === 'Middlegame'
                ? 'Work on tactics puzzles daily (15-20 min). Study strategic concepts like pawn structures and piece placement.'
                : 'Study basic endgame positions: K+P endings, rook endgames, and basic checkmates. Aim for technical precision.',
            resources: resources
        });
    }

    // Priority 2: Worst performing opening
    const worstOpenings = Object.entries(stats.openings)
        .filter(([_, data]) => data.totalGames >= 5)
        .map(([eco, data]) => ({
            name: data.name,
            eco,
            winRate: ((data.whiteWins + data.blackWins) / data.totalGames) * 100,
            total: data.totalGames,
            losses: data.whiteLosses + data.blackLosses
        }))
        .sort((a, b) => a.winRate - b.winRate);

    if (worstOpenings.length > 0 && worstOpenings[0].winRate < 40) {
        const openingSearchName = encodeURIComponent(worstOpenings[0].name);
        recommendations.push({
            priority: 'HIGH',
            title: `Fix Your ${worstOpenings[0].name}`,
            impact: `Currently losing ${worstOpenings[0].losses} games with this opening (${worstOpenings[0].winRate.toFixed(0)}% win rate)`,
            actions: `Study the key ideas and common traps in this opening. Consider whether to deepen your knowledge or switch to a more reliable alternative.`,
            resources: [
                { type: 'youtube', url: `https://www.youtube.com/@GothamChess/search?query=${openingSearchName}`, label: `📺 ${worstOpenings[0].name}` },
                { type: 'article', url: 'https://www.chess.com/openings', label: '📖 Opening Explorer' },
                { type: 'lichess', url: `https://lichess.org/opening/${openingSearchName}`, label: '♟️ Lichess Opening' }
            ]
        });
    }

    let studyHTML = '';
    recommendations.forEach((rec, idx) => {
        const priorityClass = rec.priority === 'HIGH' ? '' : 'medium';
        studyHTML += `
            <div class="study-card">
                <span class="study-priority ${priorityClass}">#${idx + 1} Priority: ${rec.priority}</span>
                <div class="study-title">${rec.title}</div>
                <div class="study-impact">💰 Potential Impact: ${rec.impact}</div>
                <div style="margin-top: 12px; color: #4a5568; line-height: 1.6;">
                    <strong>Action Steps:</strong> ${rec.actions}
                </div>
                <div class="study-resources">
                    ${rec.resources.map(r => `
                        <a href="${r.url}" target="_blank" rel="noopener noreferrer" class="resource-link ${r.type}">
                            ${r.label}
                        </a>
                    `).join('')}
                </div>
            </div>
        `;
    });

    if (recommendations.length === 0) {
        studyHTML = `
            <div class="study-card">
                <div class="study-title">You're doing great! 🎉</div>
                <div style="margin-top: 12px; color: #4a5568; line-height: 1.6;">
                    No critical issues detected. Keep reviewing your games, solving tactics puzzles daily,
                    and gradually expanding your opening repertoire. Consistency is key!
                </div>
                <div class="study-resources">
                    <a href="https://www.youtube.com/@DanielNaroditskyGM/playlists" target="_blank" rel="noopener noreferrer" class="resource-link youtube">
                        📺 GM Naroditsky
                    </a>
                    <a href="https://www.chess.com/lessons" target="_blank" rel="noopener noreferrer" class="resource-link article">
                        📖 Chess Lessons
                    </a>
                    <a href="https://lichess.org/training" target="_blank" rel="noopener noreferrer" class="resource-link lichess">
                        ♟️ Daily Puzzles
                    </a>
                </div>
            </div>
        `;
    }

    document.getElementById('studyContainer').innerHTML = studyHTML;
}

function displayTimeManagement(stats) {
    const timeoutLossRate = stats.losses > 0 ? ((stats.timePressureLosses / stats.losses) * 100).toFixed(0) : 0;
    const timeControlData = Object.entries(stats.timeManagement.byTimeControl)
        .map(([control, data]) => ({
            control,
            ...data,
            total: data.wins + data.losses + data.draws,
            winRate: (data.wins + data.losses) > 0 ? ((data.wins / (data.wins + data.losses)) * 100).toFixed(1) : 0,
            timeoutRate: data.losses > 0 ? ((data.timeoutLosses / data.losses) * 100).toFixed(0) : 0
        }))
        .sort((a, b) => b.total - a.total);

    let html = `
        <div class="chart-container" style="margin-top: 30px;">
            <div class="section-header">
                <h2 class="section-title">⏱️ Time Management Analysis</h2>
            </div>
            <p style="color: #718096; margin-bottom: 20px;">
                Understanding how you manage your time is crucial for tournament success.
            </p>

            <div class="leaks-grid" style="margin-bottom: 30px;">
                <div class="leak-card ${timeoutLossRate >= 20 ? 'critical' : timeoutLossRate >= 10 ? 'warning' : 'good'}">
                    <div class="leak-icon">⏰</div>
                    <div class="leak-title">Time Trouble Losses</div>
                    <div class="leak-metric">${stats.timePressureLosses}</div>
                    <div class="leak-description">
                        ${timeoutLossRate}% of all losses
                        ${timeoutLossRate >= 20 ? '<br><strong>Major issue!</strong> Flagging too often.' :
                          timeoutLossRate >= 10 ? '<br><strong>Warning:</strong> Improve time management.' :
                          '<br>Good time management!'}
                    </div>
                </div>

                <div class="leak-card ${stats.timeManagement.wonInTimeTrouble >= 5 ? 'good' : ''}">
                    <div class="leak-icon">🏃</div>
                    <div class="leak-title">Time Pressure Wins</div>
                    <div class="leak-metric">${stats.timeManagement.timeoutWins}</div>
                    <div class="leak-description">
                        Won when opponent ran out of time
                        ${stats.timeManagement.timeoutWins >= 10 ? '<br>Great! You play fast when needed.' : '<br>Stay solid in time scrambles.'}
                    </div>
                </div>

                <div class="leak-card ${stats.timeManagement.lostWithGoodTime >= 10 ? 'warning' : 'good'}">
                    <div class="leak-icon">🤔</div>
                    <div class="leak-title">Positional Losses</div>
                    <div class="leak-metric">${stats.timeManagement.lostWithGoodTime}</div>
                    <div class="leak-description">
                        Lost with time remaining
                        ${stats.timeManagement.lostWithGoodTime >= 10 ? '<br>Focus: Not about time, about decisions.' : '<br>These are about moves, not time.'}
                    </div>
                </div>
            </div>

            <h3 style="font-size: 1.4em; color: #2d3748; margin: 30px 0 20px; font-weight: 600;">
                Performance by Time Control
            </h3>
            <table style="width: 100%;">
                <thead>
                    <tr>
                        <th>Time Control</th>
                        <th>Games</th>
                        <th>Win Rate</th>
                        <th>W/L/D</th>
                        <th>Timeout Losses</th>
                    </tr>
                </thead>
                <tbody>
    `;

    timeControlData.forEach(tc => {
        const winRateClass = tc.winRate >= 55 ? 'win-rate-high' :
                            tc.winRate >= 45 ? 'win-rate-medium' :
                            'win-rate-low';

        html += `
            <tr>
                <td><strong>${tc.control.charAt(0).toUpperCase() + tc.control.slice(1)}</strong></td>
                <td><span class="stat-number">${tc.total}</span></td>
                <td><span class="${winRateClass}">${tc.winRate}%</span></td>
                <td><span class="stat-number">${tc.wins}/${tc.losses}/${tc.draws}</span></td>
                <td>
                    <span class="${tc.timeoutLosses >= 5 ? 'win-rate-low' : tc.timeoutLosses >= 2 ? 'win-rate-medium' : ''}">
                        ${tc.timeoutLosses} (${tc.timeoutRate}%)
                    </span>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';

    if (timeoutLossRate >= 15) {
        html += `
            <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 24px; border-radius: 12px; margin-top: 20px;">
                <h4 style="font-size: 1.3em; margin-bottom: 15px;">⚠️ Critical: Time Management Issue</h4>
                <p style="opacity: 0.95; margin-bottom: 15px;">
                    You're losing ${timeoutLossRate}% of games (${stats.timePressureLosses} games) to timeout!
                </p>
                <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <strong>Quick Fixes:</strong>
                    <ul style="margin: 10px 0 0 20px; line-height: 1.8;">
                        <li>Pre-move in obvious positions</li>
                        <li>Set time checkpoints: 50% time by move 20</li>
                        <li>Play increment time controls</li>
                        <li>Avoid deep calculation in time pressure</li>
                    </ul>
                </div>
                <div class="study-resources">
                    <a href="https://www.youtube.com/@JohnBartholomewChess/search?query=time+management" target="_blank" rel="noopener noreferrer" class="resource-link youtube">
                        📺 Time Management Tips
                    </a>
                    <a href="https://www.chess.com/article/view/the-art-of-time-management" target="_blank" rel="noopener noreferrer" class="resource-link article">
                        📖 Time Strategy Guide
                    </a>
                </div>
            </div>
        `;
    }

    html += '</div>';
    document.getElementById('timeManagementSection').innerHTML = html;
}

function displayGamesToReview(stats) {
    const totalSuspicious = stats.gamesToReview.quickCollapses.length +
                           stats.gamesToReview.middlegameBlunders.length +
                           stats.gamesToReview.openingDisasters.length;

    if (totalSuspicious === 0) return;

    let html = `
        <div class="chart-container" style="margin-top: 30px;">
            <div class="section-header">
                <h2 class="section-title">🔍 Games to Review - Likely Blunders</h2>
            </div>
            <p style="color: #718096; margin-bottom: 20px;">
                These games likely contain tactical mistakes or blunders. Review them with the analysis board.
            </p>

            <div class="leaks-grid" style="margin-bottom: 30px;">
    `;

    if (stats.gamesToReview.openingDisasters.length > 0) {
        html += `
            <div class="leak-card critical" onclick="showReviewGames('openingDisasters')">
                <div class="leak-icon">💥</div>
                <div class="leak-title">Opening Disasters</div>
                <div class="leak-metric">${stats.gamesToReview.openingDisasters.length}</div>
                <div class="leak-description">
                    Lost in ≤15 moves
                    <br><strong>Critical!</strong> Getting crushed early.
                </div>
            </div>
        `;
    }

    if (stats.gamesToReview.quickCollapses.length > 0) {
        html += `
            <div class="leak-card ${stats.gamesToReview.quickCollapses.length >= 10 ? 'critical' : 'warning'}" onclick="showReviewGames('quickCollapses')">
                <div class="leak-icon">⚡</div>
                <div class="leak-title">Quick Collapses</div>
                <div class="leak-metric">${stats.gamesToReview.quickCollapses.length}</div>
                <div class="leak-description">
                    Lost in <25 moves
                    <br><strong>Review these!</strong> Likely major blunders.
                </div>
            </div>
        `;
    }

    if (stats.gamesToReview.middlegameBlunders.length > 0) {
        html += `
            <div class="leak-card ${stats.gamesToReview.middlegameBlunders.length >= 10 ? 'critical' : 'warning'}" onclick="showReviewGames('middlegameBlunders')">
                <div class="leak-icon">🎯</div>
                <div class="leak-title">Middlegame Blunders</div>
                <div class="leak-metric">${stats.gamesToReview.middlegameBlunders.length}</div>
                <div class="leak-description">
                    Resigned in middlegame
                    <br><strong>Tactical errors</strong> - missing tactics?
                </div>
            </div>
        `;
    }

    html += '</div></div>';
    document.getElementById('gamesToReviewSection').innerHTML = html;
}

function displayGameList(title, games, description, showAll) {
    const gamesToShow = showAll ? games : games.slice(0, 5);

    let html = `
        <div style="background: #f7fafc; padding: 25px; border-radius: 12px;">
            <h3 style="color: #2d3748; font-size: 1.3em; margin-bottom: 10px;">${title}</h3>
            <p style="color: #718096; margin-bottom: 20px; font-size: 0.95em;">${description}</p>
            <div style="display: grid; gap: 12px;">
    `;

    gamesToShow.forEach(game => {
        const date = new Date(game.date * 1000);
        const formattedDate = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

        html += `
            <div style="background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #ef4444; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 600; color: #2d3748; margin-bottom: 4px;">
                        vs ${game.opponent} • ${game.opening}
                    </div>
                    <div style="font-size: 0.85em; color: #718096;">
                        ${formattedDate} • ${game.moves} moves • ${game.timeControl}
                    </div>
                </div>
                <a href="${game.url}" target="_blank" style="background: #667eea; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 0.9em; white-space: nowrap;">
                    Review Game →
                </a>
            </div>
        `;
    });

    if (!showAll && games.length > 5) {
        html += `
            <div style="text-align: center; padding: 12px; color: #718096; font-size: 0.9em;">
                ...and ${games.length - 5} more similar games
            </div>
        `;
    }

    html += '</div></div>';
    return html;
}

function displayStats(stats) {
    const winRate = ((stats.wins / stats.totalGames) * 100).toFixed(1);
    const html = `
        <div class="stat-card">
            <div class="stat-value">${stats.totalGames}</div>
            <div class="stat-label">Total Games</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${winRate}%</div>
            <div class="stat-label">Win Rate</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.wins}</div>
            <div class="stat-label">Wins</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.losses}</div>
            <div class="stat-label">Losses</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.draws}</div>
            <div class="stat-label">Draws</div>
        </div>
    `;
    document.getElementById('statsGrid').innerHTML = html;
}

function displayOpeningTable(stats) {
    const openingData = Object.entries(stats.openings)
        .map(([eco, data]) => ({
            eco,
            name: data.name,
            total: data.totalGames,
            whiteWins: data.whiteWins,
            whiteLosses: data.whiteLosses,
            whiteDraws: data.whiteDraws,
            blackWins: data.blackWins,
            blackLosses: data.blackLosses,
            blackDraws: data.blackDraws,
            totalWins: data.whiteWins + data.blackWins,
            totalLosses: data.whiteLosses + data.blackLosses,
            winRate: (((data.whiteWins + data.blackWins) / data.totalGames) * 100).toFixed(0)
        }))
        .sort((a, b) => b.total - a.total);

    let tableHTML = `
        <thead>
            <tr>
                <th>Opening</th>
                <th>Games</th>
                <th>Win Rate</th>
                <th>White (W/L/D)</th>
                <th>Black (W/L/D)</th>
            </tr>
        </thead>
        <tbody>
    `;

    openingData.forEach((opening, idx) => {
        const winRateClass = opening.winRate >= 55 ? 'win-rate-high' :
                            opening.winRate >= 45 ? 'win-rate-medium' :
                            'win-rate-low';

        const rowClass = idx >= 10 ? 'opening-row-hidden' : '';

        tableHTML += `
            <tr class="clickable-row ${rowClass}" onclick="showOpeningGames('${opening.eco}', '${opening.name.replace(/'/g, "\\'")}')">
                <td>
                    <div class="opening-name">${opening.name}</div>
                    <div class="opening-eco">${opening.eco}</div>
                </td>
                <td><span class="stat-number">${opening.total}</span></td>
                <td><span class="${winRateClass}">${opening.winRate}%</span></td>
                <td><span class="stat-number">${opening.whiteWins}/${opening.whiteLosses}/${opening.whiteDraws}</span></td>
                <td><span class="stat-number">${opening.blackWins}/${opening.blackLosses}/${opening.blackDraws}</span></td>
            </tr>
        `;
    });

    tableHTML += '</tbody>';
    document.getElementById('openingTable').innerHTML = tableHTML;

    if (openingData.length > 10) {
        const showMoreBtn = document.createElement('button');
        showMoreBtn.className = 'show-more-btn';
        showMoreBtn.textContent = `Show More (${openingData.length - 10} more openings)`;
        showMoreBtn.onclick = showMoreOpenings;
        document.getElementById('openingTable').parentElement.appendChild(showMoreBtn);
    }
}

function showMoreOpenings() {
    const hiddenRows = document.querySelectorAll('.opening-row-hidden');
    const rowsToShow = Math.min(10, hiddenRows.length);

    for (let i = 0; i < rowsToShow; i++) {
        hiddenRows[i].classList.remove('opening-row-hidden');
    }

    openingsVisible += rowsToShow;
    const remaining = hiddenRows.length - rowsToShow;
    const btn = event.target;

    if (remaining > 0) {
        btn.textContent = `Show More (${remaining} more openings)`;
    } else {
        btn.remove();
    }
}

function displayEndgameAnalysis(stats) {
    if (Object.keys(stats.endgameTypes).length === 0) return;

    const endgameData = Object.entries(stats.endgameTypes)
        .map(([type, data]) => ({
            type,
            losses: data.losses,
            percentage: ((data.losses / stats.endgameLosses) * 100).toFixed(0),
            games: data.games
        }))
        .sort((a, b) => b.losses - a.losses);

    const endgameIcons = {
        'Rook Endgame': '♜',
        'Queen Endgame': '♛',
        'Queen vs Rook': '♛♜',
        'Bishop Endgame': '♝♟',
        'Knight Endgame': '♞♟',
        'Bishop vs Knight': '♝♞',
        'Pawn Endgame': '♔♟',
        'Queen + Minor Piece': '♛♝',
        'Rook + Minor Piece': '♜♝',
        'Complex Position': '♔',
        'Unknown': '?'
    };

    const endgameDescriptions = {
        'Pawn Endgame': 'Only Kings + Pawns',
        'Rook Endgame': 'Rook + Pawns vs Rook + Pawns',
        'Queen Endgame': 'Queen + Pawns',
        'Bishop Endgame': 'Bishop + Pawns',
        'Knight Endgame': 'Knight + Pawns',
        'Bishop vs Knight': 'Bishop vs Knight + Pawns',
        'Queen vs Rook': 'Queen vs Rook (imbalanced)',
        'Rook + Minor Piece': 'Rook + Bishop/Knight',
        'Queen + Minor Piece': 'Queen + Bishop/Knight',
        'Complex Position': 'Multiple pieces active',
        'Unknown': 'Unknown position'
    };

    let html = `
        <div class="chart-container" style="margin-top: 30px;">
            <div class="section-header">
                <h2 class="section-title">🏁 Endgame Breakdown - Technical Losses</h2>
            </div>
            <p style="color: #718096; margin-bottom: 20px;">
                You lost ${stats.endgameLosses} games in true endgame positions (balanced material, move 40+).
            </p>

            <div class="leaks-grid" style="margin-bottom: 20px;">
    `;

    endgameData.slice(0, 8).forEach(endgame => {
        const severity = endgame.losses >= 5 ? 'critical' : endgame.losses >= 3 ? 'warning' : 'good';
        const description = endgameDescriptions[endgame.type] || endgame.type;

        html += `
            <div class="leak-card ${severity}" onclick="showEndgameGames('${endgame.type.replace(/'/g, "\\'")}')">
                <div class="leak-icon">${endgameIcons[endgame.type] || '♔'}</div>
                <div class="leak-title">${endgame.type}</div>
                <div style="color: #718096; font-size: 0.85em; margin-bottom: 8px;">${description}</div>
                <div class="leak-metric">${endgame.losses}</div>
                <div class="leak-description">
                    ${endgame.percentage}% of endgame losses
                    ${endgame.losses >= 5 ? '<br><strong>Critical!</strong> Master this endgame.' :
                      endgame.losses >= 3 ? '<br><strong>Study needed</strong>' :
                      '<br>Minor issue.'}
                </div>
            </div>
        `;
    });

    html += '</div>';

    if (endgameData.length > 0 && endgameData[0].losses >= 3) {
        const worstEndgame = endgameData[0];
        const searchTerm = worstEndgame.type.toLowerCase().replace(/ /g, '+');
        const description = endgameDescriptions[worstEndgame.type] || worstEndgame.type;

        html += `
            <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 24px; border-radius: 12px; margin-top: 20px;">
                <h4 style="font-size: 1.3em; margin-bottom: 8px;">🎯 Priority: Master ${worstEndgame.type}</h4>
                <p style="opacity: 0.9; margin-bottom: 12px; font-size: 0.95em; font-weight: 500;">${description}</p>
                <p style="opacity: 0.95; margin-bottom: 15px;">
                    You've lost ${worstEndgame.losses} games in ${worstEndgame.type} positions with equal material.
                </p>
                <div class="study-resources">
                    <a href="https://www.youtube.com/@DanielNaroditskyGM/search?query=${searchTerm}+endgame" target="_blank" rel="noopener noreferrer" class="resource-link youtube">
                        📺 ${worstEndgame.type} Tutorial
                    </a>
                    <a href="https://www.chess.com/practice/drills/endgame-practice" target="_blank" rel="noopener noreferrer" class="resource-link article">
                        📖 Endgame Drills
                    </a>
                    <a href="https://lichess.org/practice" target="_blank" rel="noopener noreferrer" class="resource-link lichess">
                        ♟️ Lichess Endgames
                    </a>
                </div>
            </div>
        `;
    }

    html += '</div>';
    document.getElementById('endgameAnalysisSection').innerHTML = html;
    window.endgameTypesData = stats.endgameTypes;
}

function showOpeningGames(eco, openingName) {
    const games = allGames.filter(g => (g.eco || 'Unknown') === eco);
    document.getElementById('modalTitle').textContent = openingName;

    let gamesHTML = '';
    games.forEach(game => {
        const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
        const result = isWhite ? game.white.result : game.black.result;

        let gameResult = 'Draw';
        let resultClass = 'draw';

        if (result === 'win' || result.includes('won')) {
            gameResult = 'Win';
            resultClass = 'win';
        } else if (result === 'lose' || result.includes('resigned') || result.includes('checkmated')) {
            gameResult = 'Loss';
            resultClass = 'loss';
        }

        const date = new Date(game.end_time * 1000);
        const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        gamesHTML += `
            <div class="game-card ${resultClass}">
                <div class="game-header">
                    <div class="game-players">
                        ${game.white.username} vs ${game.black.username}
                    </div>
                    <div class="game-result ${resultClass}">${gameResult}</div>
                </div>
                <div class="game-details">
                    <span><strong>Playing as:</strong> ${isWhite ? 'White' : 'Black'}</span>
                    <span><strong>Date:</strong> ${formattedDate}</span>
                    <span><strong>Time Control:</strong> ${game.time_class}</span>
                </div>
                <div class="game-link">
                    <a href="${game.url}" target="_blank">View game on ${currentPlatform === 'lichess' ? 'Lichess' : 'Chess.com'} →</a>
                </div>
            </div>
        `;
    });

    document.getElementById('gamesList').innerHTML = gamesHTML;
    document.getElementById('gameModal').style.display = 'block';
}

function showEndgameGames(endgameType) {
    if (!window.endgameTypesData || !window.endgameTypesData[endgameType]) return;

    const data = window.endgameTypesData[endgameType];
    document.getElementById('modalTitle').textContent = `${endgameType} - ${data.losses} losses`;

    let gamesHTML = '';
    data.games.forEach(game => {
        const date = new Date(game.date * 1000);
        const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        gamesHTML += `
            <div class="game-card loss">
                <div class="game-header">
                    <div class="game-players">
                        vs ${game.opponent}
                    </div>
                    <div class="game-result loss">Loss</div>
                </div>
                <div class="game-details">
                    <span><strong>Endgame Type:</strong> ${endgameType}</span>
                    <span><strong>Date:</strong> ${formattedDate}</span>
                    <span><strong>Moves:</strong> ${game.moveCount || 'N/A'}</span>
                </div>
                <div class="game-link">
                    <a href="${game.url}" target="_blank">View game on ${currentPlatform === 'lichess' ? 'Lichess' : 'Chess.com'} →</a>
                </div>
            </div>
        `;
    });

    document.getElementById('gamesList').innerHTML = gamesHTML;
    document.getElementById('gameModal').style.display = 'block';
}

function showReviewGames(category) {
    const categoryLabels = {
        openingDisasters: '💥 Opening Disasters',
        quickCollapses: '⚡ Quick Collapses',
        middlegameBlunders: '🎯 Middlegame Blunders'
    };

    const games = stats.gamesToReview[category];
    if (!games || games.length === 0) return;

    document.getElementById('modalTitle').textContent =
        `${categoryLabels[category] || category} - ${games.length} games`;

    let gamesHTML = '';
    games.forEach(game => {
        const date = new Date(game.date * 1000);
        const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric'
        });

        gamesHTML += `
            <div class="game-card loss">
                <div class="game-header">
                    <div class="game-players">vs ${game.opponent} • ${game.opening}</div>
                    <div class="game-result loss">Loss</div>
                </div>
                <div class="game-details">
                    <span><strong>Moves:</strong> ${game.moves}</span>
                    <span><strong>Date:</strong> ${formattedDate}</span>
                    <span><strong>Time Control:</strong> ${game.timeControl}</span>
                </div>
                <div class="game-link">
                    <a href="${game.url}" target="_blank">View game on ${currentPlatform === 'lichess' ? 'Lichess' : 'Chess.com'} →</a>
                </div>
            </div>
        `;
    });

    document.getElementById('gamesList').innerHTML = gamesHTML;
    document.getElementById('gameModal').style.display = 'block';
}

function closeModal() {
    document.getElementById('gameModal').style.display = 'none';
}

function displayStudyPlan(plan, weaknesses, strengths) {
    const studyPlanSection = document.getElementById('studyPlanResults');

    const html = `
        <div class="study-plan-container">
            <div class="study-plan-header">
                <h2 style="color: #2d3748; margin-bottom: 12px;">📚 Your Personalized Chess Study Plan</h2>
                <p style="color: #718096; font-size: 1.05em;">Based on analysis of ${stats.totalGames} games</p>
            </div>

            <div class="analysis-summary">
                <div class="summary-column critical">
                    <h3>🎯 Priority Areas</h3>
                    <ul>
                        ${weaknesses.slice(0, 5).map(w => `<li>${w}</li>`).join('')}
                    </ul>
                </div>
                <div class="summary-column strength">
                    <h3>💪 Your Strengths</h3>
                    <ul>
                        ${strengths.length > 0
                            ? strengths.map(s => `<li>${s}</li>`).join('')
                            : '<li>Building on your current level</li>'}
                    </ul>
                </div>
            </div>

            <div class="ai-study-plan">
                <div class="ai-badge">🤖 AI-Generated Custom Plan</div>
                ${formatStudyPlan(plan)}
            </div>

            <div class="study-plan-actions">
                <button onclick="downloadStudyPlan()" class="action-btn primary">
                    📥 Download Study Plan
                </button>
                <button onclick="copyStudyPlan()" class="action-btn secondary">
                    📋 Copy to Clipboard
                </button>
                <button onclick="emailStudyPlan()" class="action-btn secondary">
                    ✉️ Email to Myself
                </button>
            </div>
        </div>
    `;

    studyPlanSection.innerHTML = html;
    window.currentStudyPlan = plan;
}

// ============================================================
// WEEKLY ACCURACY DASHBOARD
// ============================================================

function displayDashboard(data) {
    const section = document.getElementById('dashboardSection');
    const accColor = (acc) => acc >= 80 ? '#38a169' : acc >= 60 ? '#d69e2e' : '#e53e3e';
    const accLabel = (acc) => acc !== null ? `${acc}%` : 'N/A';

    const bestGame = data.game_accuracies.length > 0
        ? data.game_accuracies.reduce((best, g) => g.accuracy > best.accuracy ? g : best)
        : null;

    const overall = data.overall;
    const byColor = data.by_color;
    const byPhase = data.by_phase;
    const mq = data.move_quality;

    let html = `
        <div class="dashboard-section">
            <div class="dashboard-header">
                <h2>📊 Weekly Accuracy Dashboard</h2>
                <p class="dashboard-period">${data.period} &bull; ${data.total_analyzed_games} analyzed games</p>
            </div>

            <!-- Overview Cards -->
            <div class="dashboard-grid">
                <div class="dash-card">
                    <div class="dash-card-label">Games Analyzed</div>
                    <div class="dash-card-value">${data.total_analyzed_games}</div>
                    <div class="dash-card-sub">⬜ ${data.games_as_white} White &bull; ⬛ ${data.games_as_black} Black</div>
                </div>
                <div class="dash-card">
                    <div class="dash-card-label">Overall Accuracy</div>
                    <div class="dash-card-value" style="color: ${accColor(overall.accuracy)}">${accLabel(overall.accuracy)}</div>
                    <div class="accuracy-bar">
                        <div class="accuracy-bar-fill" style="width: ${overall.accuracy || 0}%; background: ${accColor(overall.accuracy)}"></div>
                    </div>
                </div>
                <div class="dash-card">
                    <div class="dash-card-label">Win Rate</div>
                    <div class="dash-card-value">${data.total_analyzed_games > 0 ? Math.round((overall.wins / data.total_analyzed_games) * 100) : 0}%</div>
                    <div class="dash-card-sub">${overall.wins}W / ${overall.losses}L / ${overall.draws}D</div>
                </div>
                <div class="dash-card">
                    <div class="dash-card-label">Best Game</div>
                    ${bestGame ? `
                        <div class="dash-card-value" style="color: ${accColor(bestGame.accuracy)}">${bestGame.accuracy}%</div>
                        <div class="dash-card-sub"><a href="${bestGame.url}" target="_blank" style="color: #667eea;">vs ${bestGame.opponent}</a></div>
                    ` : `<div class="dash-card-value">-</div>`}
                </div>
            </div>

            <!-- Phase Accuracy -->
            <div class="dashboard-phase-section">
                <h3>🎯 Accuracy by Game Phase</h3>
                <div class="phase-grid">
                    ${_phaseCard('Opening', 'moves 1-15', '📖', byPhase.opening)}
                    ${_phaseCard('Middlegame', 'moves 16-30', '⚔️', byPhase.middlegame)}
                    ${_phaseCard('Endgame', 'moves 31+', '🏁', byPhase.endgame)}
                </div>
            </div>

            <!-- Accuracy by Color -->
            <div class="dashboard-color-section">
                <h3>⚖️ Accuracy by Color</h3>
                <div class="color-accuracy-grid">
                    <div class="color-acc-card white-card">
                        <div class="color-acc-label">⬜ White</div>
                        <div class="color-acc-value" style="color: ${accColor(byColor.white.accuracy)}">${accLabel(byColor.white.accuracy)}</div>
                        <div class="color-acc-games">${byColor.white.games} games</div>
                        <div class="accuracy-bar"><div class="accuracy-bar-fill" style="width: ${byColor.white.accuracy || 0}%; background: ${accColor(byColor.white.accuracy)}"></div></div>
                    </div>
                    <div class="color-acc-card black-card">
                        <div class="color-acc-label">⬛ Black</div>
                        <div class="color-acc-value" style="color: ${accColor(byColor.black.accuracy)}">${accLabel(byColor.black.accuracy)}</div>
                        <div class="color-acc-games">${byColor.black.games} games</div>
                        <div class="accuracy-bar"><div class="accuracy-bar-fill" style="width: ${byColor.black.accuracy || 0}%; background: ${accColor(byColor.black.accuracy)}"></div></div>
                    </div>
                </div>
            </div>

            <!-- Move Quality -->
            <div class="dashboard-quality-section">
                <h3>🔍 Move Quality</h3>
                <div class="quality-grid">
                    <div class="quality-card inaccuracy">
                        <div class="quality-count">${mq.inaccuracy}</div>
                        <div class="quality-label">Inaccuracies</div>
                    </div>
                    <div class="quality-card mistake">
                        <div class="quality-count">${mq.mistake}</div>
                        <div class="quality-label">Mistakes</div>
                    </div>
                    <div class="quality-card blunder">
                        <div class="quality-count">${mq.blunder}</div>
                        <div class="quality-label">Blunders</div>
                    </div>
                </div>
            </div>

            <!-- Accuracy Trend -->
            ${data.game_accuracies.length > 1 ? `
                <div class="dashboard-trend-section">
                    <h3>📈 Accuracy Trend</h3>
                    <canvas id="accuracyTrendChart"></canvas>
                </div>
            ` : ''}
        </div>
    `;

    section.innerHTML = html;
    section.style.display = 'block';

    // Render trend chart
    if (data.game_accuracies.length > 1) {
        renderAccuracyTrendChart(data.game_accuracies);
    }
}

function _phaseCard(name, movesDesc, icon, phaseData) {
    const acc = phaseData ? phaseData.accuracy : null;
    const moves = phaseData ? phaseData.moves_analyzed : 0;
    const accColor = acc !== null ? (acc >= 80 ? '#38a169' : acc >= 60 ? '#d69e2e' : '#e53e3e') : '#a0aec0';
    const accText = acc !== null ? `${acc}%` : 'Not enough analyzed data yet';

    return `
        <div class="phase-card">
            <div class="phase-icon">${icon}</div>
            <div class="phase-name">${name}</div>
            <div class="phase-moves">${movesDesc}</div>
            <div class="phase-accuracy" style="color: ${accColor}">${accText}</div>
            <div class="accuracy-bar">
                <div class="accuracy-bar-fill" style="width: ${acc || 0}%; background: ${accColor}"></div>
            </div>
            ${moves > 0 ? `<div class="phase-detail">${moves} games analyzed</div>` : ''}
        </div>
    `;
}

function renderAccuracyTrendChart(gameAccuracies) {
    const ctx = document.getElementById('accuracyTrendChart');
    if (!ctx) return;

    // Destroy existing chart if any
    const existing = Chart.getChart(ctx);
    if (existing) existing.destroy();

    const labels = gameAccuracies.map(g => {
        const d = new Date(g.date * 1000);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const accuracies = gameAccuracies.map(g => g.accuracy);
    const colors = gameAccuracies.map(g =>
        g.result === 'win' ? '#38a169' : g.result === 'loss' ? '#e53e3e' : '#d69e2e'
    );

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Accuracy %',
                data: accuracies,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                fill: true,
                tension: 0.3,
                pointBackgroundColor: colors,
                pointBorderColor: colors,
                pointRadius: 6,
                pointHoverRadius: 8,
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    min: 0,
                    max: 100,
                    title: { display: true, text: 'Accuracy %' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        afterLabel: function(context) {
                            const g = gameAccuracies[context.dataIndex];
                            return `${g.result.toUpperCase()} as ${g.color} vs ${g.opponent}\n${g.opening}`;
                        }
                    }
                }
            }
        }
    });
}

function formatStudyPlan(plan) {
    // Approved domains — only make links clickable if they match trusted sources
    const approvedDomains = [
        'lichess.org',
        'chess.com',
        'www.chess.com',
        'youtube.com',
        'www.youtube.com'
    ];

    // Convert markdown-style formatting to HTML
    let formatted = plan
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/^### (.*$)/gm, '<h4>$1</h4>')
        .replace(/^## (.*$)/gm, '<h3>$1</h3>')
        .replace(/^# (.*$)/gm, '<h2>$1</h2>');

    // Convert markdown links [text](url) to clickable HTML links (only approved domains)
    formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (match, text, url) => {
        try {
            const hostname = new URL(url).hostname;
            if (approvedDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="study-plan-link">${text}</a>`;
            }
        } catch (e) {}
        return text;
    });

    // Convert raw URLs to clickable links (only approved domains)
    formatted = formatted.replace(/(https?:\/\/[^\s<)"]+)/g, (match, url) => {
        // Skip if already inside an <a> tag
        if (formatted.indexOf(`href="${url}"`) !== -1) return match;
        try {
            const hostname = new URL(url).hostname;
            if (approvedDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
                const label = hostname.includes('youtube') ? '📺 Watch' :
                              hostname.includes('lichess') ? '♟️ Lichess' :
                              hostname.includes('chess.com') ? '📖 Chess.com' : '🔗 Link';
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="study-plan-link">${label}</a>`;
            }
        } catch (e) {}
        return url;
    });

    formatted = formatted.replace(/\n/g, '<br>');

    return `<div class="plan-content">${formatted}</div>`;
}
