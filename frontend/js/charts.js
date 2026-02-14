// Chart.js visualization functions - extracted from chess_analyzer_v2_with_study_plan.html

function displayColorChart(stats) {
    const ctx = document.getElementById('colorChart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['White', 'Black'],
            datasets: [
                {
                    label: 'Wins',
                    data: [stats.whiteWins, stats.blackWins],
                    backgroundColor: '#10b981'
                },
                {
                    label: 'Losses',
                    data: [stats.whiteLosses, stats.blackLosses],
                    backgroundColor: '#ef4444'
                },
                {
                    label: 'Draws',
                    data: [stats.whiteDraws, stats.blackDraws],
                    backgroundColor: '#f59e0b'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: { stacked: true },
                y: { stacked: true, beginAtZero: true }
            }
        }
    });
}

function displayOpeningChart(stats) {
    const openingData = Object.entries(stats.openings)
        .map(([eco, data]) => ({
            name: data.name,
            total: data.totalGames,
            wins: data.whiteWins + data.blackWins,
            losses: data.whiteLosses + data.blackLosses,
            draws: data.whiteDraws + data.blackDraws
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8);

    const ctx = document.getElementById('openingChart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: openingData.map(o => o.name),
            datasets: [
                {
                    label: 'Wins',
                    data: openingData.map(o => o.wins),
                    backgroundColor: '#10b981'
                },
                {
                    label: 'Losses',
                    data: openingData.map(o => o.losses),
                    backgroundColor: '#ef4444'
                },
                {
                    label: 'Draws',
                    data: openingData.map(o => o.draws),
                    backgroundColor: '#f59e0b'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: { stacked: true },
                y: { stacked: true, beginAtZero: true }
            }
        }
    });
}
