// Utility functions - extracted from chess_analyzer_v2_with_study_plan.html

function showLoading() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('results').style.display = 'none';
    setLoadingStatus('Fetching games...', 'Connecting to platform API', 12);
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

function showResults() {
    document.getElementById('results').style.display = 'block';
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function hideError() {
    document.getElementById('error').style.display = 'none';
}

function setLoadingStatus(stageText, detailText = '', progressPercent = null) {
    const stageEl = document.getElementById('loadingStage');
    const detailEl = document.getElementById('loadingDetail');
    const fillEl = document.getElementById('loadingProgressFill');

    if (stageEl && stageText) stageEl.textContent = stageText;
    if (detailEl) detailEl.textContent = detailText || '';
    if (fillEl && typeof progressPercent === 'number') {
        const clamped = Math.max(0, Math.min(100, progressPercent));
        fillEl.style.width = `${clamped}%`;
    }
}
