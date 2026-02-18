// Lightweight hash-based SPA router

const Router = {
    currentPage: null,
    initialized: false,
    authRequiredPages: ['app'],
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
        const page = hash.split('?')[0]; // strip query params

        // Auth guard: redirect to login if page requires auth
        if (this.authRequiredPages.includes(page) && !Auth.canAccessApp()) {
            window.location.hash = '#login';
            return;
        }

        // Guest guard: redirect to app if already logged in and visiting login/signup
        if (this.guestOnlyPages.includes(page) && Auth.isLoggedIn()) {
            window.location.hash = '#app';
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

        // Update navbar state
        this.updateNavbar(this.currentPage);

        if (this.currentPage === 'app' && typeof loadProPuzzles === 'function') {
            loadProPuzzles();
        }

        // Scroll to top on page change (unless it's an anchor scroll)
        if (!window.location.hash.includes('/')) {
            window.scrollTo(0, 0);
        }
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
