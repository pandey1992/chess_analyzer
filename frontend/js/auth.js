// Auth module — login, signup, logout, token management

const Auth = {
    _user: null,
    _googleInitialized: false,
    _googleClientId: null,

    isLoggedIn() {
        return !!ChessAPI.getToken();
    },

    getUser() {
        return this._user;
    },

    async checkAuth() {
        const token = ChessAPI.getToken();
        if (!token) {
            this._user = null;
            return null;
        }
        try {
            const response = await fetch(`${CONFIG.API_BASE}/auth/me`, {
                headers: ChessAPI.getAuthHeaders()
            });
            if (!response.ok) {
                ChessAPI.clearToken();
                this._user = null;
                return null;
            }
            this._user = await response.json();
            return this._user;
        } catch (e) {
            this._user = null;
            return null;
        }
    },

    async handleLoginSubmit(event) {
        event.preventDefault();
        const errorEl = document.getElementById('loginError');
        const btn = document.getElementById('loginBtn');
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        errorEl.style.display = 'none';
        errorEl.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Logging in...';

        try {
            await ChessAPI.login(email, password);
            await this.checkAuth();
            Router.navigate('app');
        } catch (err) {
            errorEl.textContent = err.message || 'Login failed. Please check your credentials.';
            errorEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Log In';
        }
        return false;
    },

    async handleSignupSubmit(event) {
        event.preventDefault();
        const errorEl = document.getElementById('signupError');
        const btn = document.getElementById('signupBtn');
        const username = document.getElementById('signupUsername').value.trim();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        const confirmPassword = document.getElementById('signupConfirmPassword').value;

        errorEl.style.display = 'none';
        errorEl.textContent = '';

        // Client-side validation
        if (password !== confirmPassword) {
            errorEl.textContent = 'Passwords do not match.';
            errorEl.style.display = 'block';
            return false;
        }

        if (password.length < 8) {
            errorEl.textContent = 'Password must be at least 8 characters.';
            errorEl.style.display = 'block';
            return false;
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            errorEl.textContent = 'Username can only contain letters, numbers, hyphens, and underscores.';
            errorEl.style.display = 'block';
            return false;
        }

        btn.disabled = true;
        btn.textContent = 'Creating account...';

        try {
            await ChessAPI.register(username, email, password);
            await this.checkAuth();
            Router.navigate('app');
        } catch (err) {
            errorEl.textContent = err.message || 'Registration failed. Please try again.';
            errorEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Create Account';
        }
        return false;
    },

    handleLogout() {
        ChessAPI.clearToken();
        this._user = null;
        Router.navigate('landing');
    },

    async initGoogleForPage(page) {
        if (page !== 'login' && page !== 'signup') return;

        const containerId = page === 'login' ? 'googleLoginButton' : 'googleSignupButton';
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            if (!this._googleClientId) {
                this._googleClientId = await this.fetchGoogleClientId();
            }

            if (!this._googleClientId) {
                const action = page === 'login' ? 'Log in' : 'Sign up';
                this.showGoogleFallback(container, `${action} with Google is unavailable. Configure GOOGLE_CLIENT_ID to enable it.`);
                return;
            }

            if (!window.google || !window.google.accounts || !window.google.accounts.id) {
                const action = page === 'login' ? 'Log in' : 'Sign up';
                this.showGoogleFallback(container, `${action} with Google is temporarily unavailable. Please refresh and try again.`);
                return;
            }

            if (!this._googleInitialized) {
                window.google.accounts.id.initialize({
                    client_id: this._googleClientId,
                    callback: (response) => this.handleGoogleCredential(response),
                    auto_select: false,
                    cancel_on_tap_outside: true
                });
                this._googleInitialized = true;
            }

            container.style.display = 'block';
            container.innerHTML = '';
            window.google.accounts.id.renderButton(container, {
                theme: 'outline',
                size: 'large',
                shape: 'pill',
                width: 360,
                text: page === 'login' ? 'signin_with' : 'signup_with'
            });
        } catch (error) {
            const action = page === 'login' ? 'Log in' : 'Sign up';
            this.showGoogleFallback(container, `${action} with Google is temporarily unavailable. Please use email/password.`);
            console.error('Google auth initialization failed:', error);
        }
    },

    showGoogleFallback(container, message) {
        container.style.display = 'block';
        container.innerHTML = `<div class="google-auth-fallback">${message}</div>`;
    },

    async fetchGoogleClientId() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/auth/google-config`);
            if (!response.ok) return CONFIG.GOOGLE_CLIENT_ID || '';
            const data = await response.json();
            return data.client_id || CONFIG.GOOGLE_CLIENT_ID || '';
        } catch (error) {
            return CONFIG.GOOGLE_CLIENT_ID || '';
        }
    },

    async handleGoogleCredential(response) {
        const idToken = response && response.credential;
        const loginError = document.getElementById('loginError');
        const signupError = document.getElementById('signupError');

        if (loginError) {
            loginError.style.display = 'none';
            loginError.textContent = '';
        }
        if (signupError) {
            signupError.style.display = 'none';
            signupError.textContent = '';
        }

        if (!idToken) {
            const msg = 'Google login failed. Missing credential.';
            if (loginError && Router.currentPage === 'login') {
                loginError.textContent = msg;
                loginError.style.display = 'block';
            }
            if (signupError && Router.currentPage === 'signup') {
                signupError.textContent = msg;
                signupError.style.display = 'block';
            }
            return;
        }

        try {
            await ChessAPI.googleAuth(idToken);
            await this.checkAuth();
            Router.navigate('app');
        } catch (error) {
            const msg = error.message || 'Google authentication failed.';
            if (loginError && Router.currentPage === 'login') {
                loginError.textContent = msg;
                loginError.style.display = 'block';
            }
            if (signupError && Router.currentPage === 'signup') {
                signupError.textContent = msg;
                signupError.style.display = 'block';
            }
        }
    }
};

// ==================== Landing Page Helpers ====================

function toggleFaq(button) {
    const item = button.closest('.faq-item');
    const isOpen = item.classList.contains('open');

    // Close all FAQ items
    document.querySelectorAll('.faq-item.open').forEach(el => {
        el.classList.remove('open');
    });

    // Toggle the clicked one
    if (!isOpen) {
        item.classList.add('open');
    }
}

function toggleMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    const btn = document.getElementById('hamburgerBtn');
    menu.classList.toggle('open');
    btn.classList.toggle('open');
}

function closeMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    const btn = document.getElementById('hamburgerBtn');
    menu.classList.remove('open');
    btn.classList.remove('open');
}

// Navbar scroll effect on landing page
window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;
    if (Router.currentPage === 'landing') {
        if (window.scrollY > 60) {
            navbar.classList.add('navbar-scrolled');
        } else {
            navbar.classList.remove('navbar-scrolled');
        }
    }
});

function initGoogleForCurrentHash() {
    const page = (window.location.hash || '#landing').slice(1).split('?')[0];
    Auth.initGoogleForPage(page || 'landing');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGoogleForCurrentHash, { once: true });
} else {
    initGoogleForCurrentHash();
}

window.addEventListener('hashchange', initGoogleForCurrentHash);
