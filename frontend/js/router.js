// Lightweight hash-based SPA router

const Router = {
    currentPage: null,
    initialized: false,
    authRequiredPages: ['home', 'analyze', 'performance', 'puzzles', 'openings', 'study-plan', 'coaching', 'opponent-prep'],
    guestOnlyPages: ['login', 'signup'],

    init() {
        if (this.initialized) return;
        this.initialized = true;
        window.addEventListener('hashchange', () => this.handleRoute());
        // Initial route
        this.handleRoute();
    },

    handleRoute() {
        const hash = window.location.hash.slice(1) || 'landing';
        let page = hash.split('?')[0]; // strip query params

        // Backward compatibility: #app redirects to #home
        if (page === 'app') {
            window.location.hash = '#home';
            return;
        }

        // Auth guard: redirect to login if page requires auth
        if (this.authRequiredPages.includes(page) && !Auth.canAccessApp()) {
            window.location.hash = '#login';
            return;
        }

        // Guest guard: redirect to home if already logged in and visiting login/signup
        if (this.guestOnlyPages.includes(page) && Auth.isLoggedIn()) {
            window.location.hash = '#home';
            return;
        }

        // Logged-in user on landing page: redirect to home (app dashboard)
        if (page === 'landing' && Auth.isLoggedIn()) {
            window.location.hash = '#home';
            return;
        }

        this.showPage(page);
    },

    showPage(page) {
        // Hide all page containers
        document.querySelectorAll('[data-page]').forEach(el => {
            el.style.display = 'none';
        });

        // Show the target page
        const target = document.querySelector(`[data-page="${page}"]`);
        if (target) {
            target.style.display = '';
            this.currentPage = page;
        } else {
            // Fallback to landing
            const landing = document.querySelector('[data-page="landing"]');
            if (landing) landing.style.display = '';
            this.currentPage = 'landing';
        }

        // Show/hide app shell for auth pages
        if (this.authRequiredPages.includes(this.currentPage)) {
            this.showAppChrome();
        } else {
            this.hideAppChrome();
        }

        // Update navbar state
        this.updateNavbar(this.currentPage);

        // Scroll to top on page change
        if (!window.location.hash.includes('/')) {
            window.scrollTo(0, 0);
        }

        // Page-specific init hooks
        if (this.authRequiredPages.includes(this.currentPage) && typeof PageController !== 'undefined') {
            PageController.init(this.currentPage);
        }
        if (page === 'puzzle' && typeof DailyPuzzle !== 'undefined') {
            DailyPuzzle.init();
        }
        if (page === 'landing' && typeof HomePuzzles !== 'undefined') {
            HomePuzzles.init();
        }
    },

    showAppChrome() {
        const shell = document.getElementById('appShell');
        if (shell) shell.style.display = 'block';
    },

    hideAppChrome() {
        const shell = document.getElementById('appShell');
        if (shell) shell.style.display = 'none';
    },

    updateNavbar(page) {
        const navbar = document.querySelector('.navbar');
        const guestNav = document.getElementById('guestNav');
        const userNav = document.getElementById('userNav');
        const landingLinks = document.getElementById('landingLinks');

        if (!navbar) return;

        const loggedIn = Auth.isLoggedIn();

        // Show/hide nav sections
        if (guestNav) guestNav.style.display = loggedIn ? 'none' : 'flex';
        if (userNav) userNav.style.display = loggedIn ? 'flex' : 'none';
        if (landingLinks) landingLinks.style.display = (page === 'landing') ? 'flex' : 'none';

        // Navbar style: transparent on landing, solid elsewhere
        if (page === 'landing') {
            navbar.classList.add('navbar-landing');
            navbar.classList.remove('navbar-solid');
        } else {
            navbar.classList.remove('navbar-landing');
            navbar.classList.add('navbar-solid');
        }

        // Update username display
        if (loggedIn && userNav) {
            const usernameEl = document.getElementById('navUsername');
            const user = Auth.getUser();
            if (usernameEl && user) {
                usernameEl.textContent = user.username || user.email;
            }
        }
    },

    navigate(page) {
        window.location.hash = `#${page}`;
    },

    // Smooth scroll to section on landing page
    scrollToSection(sectionId) {
        if (this.currentPage !== 'landing') {
            window.location.hash = '#landing';
            setTimeout(() => {
                const el = document.getElementById(sectionId);
                if (el) el.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        } else {
            const el = document.getElementById(sectionId);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
    }
};

// Boot router independently so hash navigation always works.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Router.init(), { once: true });
} else {
    Router.init();
}
