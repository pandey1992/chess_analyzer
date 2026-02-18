// Auth module — login, signup, logout, token management

const Auth = {
    _user: null,

    isLoggedIn() {
        return !!ChessAPI.getToken();
    },

    isGuest() {
        return localStorage.getItem('guest_mode') === '1';
    },

    canAccessApp() {
        return this.isLoggedIn() || this.isGuest();
    },

    getUser() {
        return this._user;
    },

    async checkAuth() {
        const token = ChessAPI.getToken();
        if (!token) {
            this._user = this.isGuest() ? { username: 'Guest', email: null } : null;
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
            localStorage.removeItem('guest_mode');
            await this.checkAuth();
            if (typeof window.clearProPuzzleSession === 'function') {
                window.clearProPuzzleSession('signed_in');
            }
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
            localStorage.removeItem('guest_mode');
            await this.checkAuth();
            if (typeof window.clearProPuzzleSession === 'function') {
                window.clearProPuzzleSession('signed_in');
            }
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
        localStorage.removeItem('guest_mode');
        this._user = null;
        if (typeof window.clearProPuzzleSession === 'function') {
            window.clearProPuzzleSession('logged_out');
        }
        Router.navigate('landing');
    },
    
    continueAsGuest() {
        ChessAPI.clearToken();
        localStorage.setItem('guest_mode', '1');
        this._user = { username: 'Guest', email: null };
        if (typeof window.clearProPuzzleSession === 'function') {
            window.clearProPuzzleSession('guest');
        }
        Router.navigate('app');
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
