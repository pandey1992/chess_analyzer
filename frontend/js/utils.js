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

window.__lastErrorRetry = null;

function _retryLastError() {
    if (typeof window.__lastErrorRetry === 'function') {
        window.__lastErrorRetry();
    }
}

function showError(message, options = {}) {
    const errorDiv = document.getElementById('error');
    const title = options.title || 'Something went wrong';
    const retryLabel = options.retryLabel || '';

    if (typeof options.onRetry === 'function') {
        window.__lastErrorRetry = options.onRetry;
    } else {
        window.__lastErrorRetry = null;
    }

    errorDiv.innerHTML = `
        <div class="error-title">${title}</div>
        <div class="error-message">${message}</div>
        ${retryLabel ? `
            <div class="error-actions">
                <button type="button" class="error-retry-btn" onclick="_retryLastError()">${retryLabel}</button>
            </div>
        ` : ''}
    `;
    errorDiv.style.display = 'block';
}

function hideError() {
    const errorDiv = document.getElementById('error');
    errorDiv.style.display = 'none';
    errorDiv.innerHTML = '';
    window.__lastErrorRetry = null;
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
