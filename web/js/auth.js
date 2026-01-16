/**
 * Authentication Module
 * Handles user login, registration, and session management
 */

const Auth = {
    // Storage keys
    STORAGE_KEY: 'seo_agent_user',
    SESSION_KEY: 'seo_agent_session',

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        const session = localStorage.getItem(this.SESSION_KEY);
        if (!session) return false;

        try {
            const sessionData = JSON.parse(session);
            // Check if session is expired (24 hours)
            if (Date.now() > sessionData.expires) {
                this.logout();
                return false;
            }
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Get current user data
     */
    getUser() {
        const userData = localStorage.getItem(this.STORAGE_KEY);
        if (!userData) return null;

        try {
            return JSON.parse(userData);
        } catch {
            return null;
        }
    },

    /**
     * Login user
     */
    login(email, password, remember = false) {
        return new Promise((resolve, reject) => {
            // Simulate API call delay
            setTimeout(() => {
                // Get stored users
                const users = this.getStoredUsers();
                const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

                if (!user) {
                    reject(new Error('No account found with this email address'));
                    return;
                }

                // Simple password check (in real app, use proper hashing)
                if (user.password !== this.hashPassword(password)) {
                    reject(new Error('Incorrect password'));
                    return;
                }

                // Create session
                const sessionDuration = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
                const session = {
                    userId: user.id,
                    email: user.email,
                    created: Date.now(),
                    expires: Date.now() + sessionDuration
                };

                // Store session and user data (without password)
                const userPublic = { ...user };
                delete userPublic.password;

                localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(userPublic));

                resolve(userPublic);
            }, 800);
        });
    },

    /**
     * Register new user
     */
    register(userData) {
        return new Promise((resolve, reject) => {
            // Simulate API call delay
            setTimeout(() => {
                const { firstname, lastname, email, password } = userData;

                // Validation
                if (!firstname || !lastname || !email || !password) {
                    reject(new Error('All fields are required'));
                    return;
                }

                if (password.length < 8) {
                    reject(new Error('Password must be at least 8 characters'));
                    return;
                }

                // Check if email already exists
                const users = this.getStoredUsers();
                if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
                    reject(new Error('An account with this email already exists'));
                    return;
                }

                // Create user
                const newUser = {
                    id: 'user_' + Date.now(),
                    firstname,
                    lastname,
                    email,
                    password: this.hashPassword(password),
                    plan: 'free',
                    createdAt: new Date().toISOString()
                };

                // Store user
                users.push(newUser);
                localStorage.setItem('seo_agent_users', JSON.stringify(users));

                // Auto login after registration
                const session = {
                    userId: newUser.id,
                    email: newUser.email,
                    created: Date.now(),
                    expires: Date.now() + 24 * 60 * 60 * 1000
                };

                const userPublic = { ...newUser };
                delete userPublic.password;

                localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(userPublic));

                resolve(userPublic);
            }, 1000);
        });
    },

    /**
     * Logout user
     */
    logout() {
        localStorage.removeItem(this.SESSION_KEY);
        localStorage.removeItem(this.STORAGE_KEY);
    },

    /**
     * Get stored users (for demo purposes - in real app, this would be server-side)
     */
    getStoredUsers() {
        const users = localStorage.getItem('seo_agent_users');
        if (!users) return [];

        try {
            return JSON.parse(users);
        } catch {
            return [];
        }
    },

    /**
     * Simple hash function (for demo - use proper hashing in production)
     */
    hashPassword(password) {
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'hash_' + Math.abs(hash).toString(16);
    }
};

/**
 * Auth Modal Controller
 */
const AuthModal = {
    modal: null,
    currentTab: 'login',

    init() {
        this.modal = document.getElementById('authModal');
        if (!this.modal) return;

        this.bindEvents();
        this.interceptDashboardLinks();
    },

    bindEvents() {
        // Close button
        const closeBtn = document.getElementById('closeAuthModal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // Click outside to close
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.classList.contains('active')) {
                this.close();
            }
        });

        // Tab switching
        const tabs = this.modal.querySelectorAll('.auth-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchTab(tab.dataset.tab);
            });
        });

        // Form submissions
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');

        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        if (registerForm) {
            registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        }

        // Password visibility toggles
        const toggleBtns = this.modal.querySelectorAll('.toggle-password');
        toggleBtns.forEach(btn => {
            btn.addEventListener('click', () => this.togglePasswordVisibility(btn));
        });
    },

    interceptDashboardLinks() {
        // Find all dashboard links
        const dashboardLinks = document.querySelectorAll('a[href="dashboard.html"], a[href="/dashboard.html"]');

        dashboardLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                if (!Auth.isAuthenticated()) {
                    e.preventDefault();
                    this.open('login');
                }
                // If authenticated, allow normal navigation
            });
        });
    },

    open(tab = 'login') {
        if (!this.modal) return;

        this.switchTab(tab);
        this.modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Focus first input
        setTimeout(() => {
            const firstInput = this.modal.querySelector(`.auth-form.active input:not([type="checkbox"])`);
            if (firstInput) firstInput.focus();
        }, 100);
    },

    close() {
        if (!this.modal) return;

        this.modal.classList.remove('active');
        document.body.style.overflow = '';
        this.clearErrors();
        this.resetForms();
    },

    switchTab(tab) {
        this.currentTab = tab;

        // Update tabs
        const tabs = this.modal.querySelectorAll('.auth-tab');
        tabs.forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });

        // Update forms
        const forms = this.modal.querySelectorAll('.auth-form');
        forms.forEach(form => {
            form.classList.toggle('active', form.dataset.form === tab);
        });

        this.clearErrors();
    },

    togglePasswordVisibility(btn) {
        const wrapper = btn.closest('.password-input-wrapper');
        const input = wrapper.querySelector('input');
        const eyeOpen = btn.querySelector('.eye-open');
        const eyeClosed = btn.querySelector('.eye-closed');

        if (input.type === 'password') {
            input.type = 'text';
            eyeOpen.style.display = 'none';
            eyeClosed.style.display = 'block';
        } else {
            input.type = 'password';
            eyeOpen.style.display = 'block';
            eyeClosed.style.display = 'none';
        }
    },

    async handleLogin(e) {
        e.preventDefault();

        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        const errorDiv = document.getElementById('loginError');

        const email = form.querySelector('#login-email').value;
        const password = form.querySelector('#login-password').value;
        const remember = form.querySelector('#remember-me').checked;

        // Show loading state
        btn.classList.add('loading');
        btn.disabled = true;
        this.clearErrors();

        try {
            const user = await Auth.login(email, password, remember);

            // Success - redirect to dashboard
            this.close();
            window.location.href = 'dashboard.html';

        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.add('visible');
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    },

    async handleRegister(e) {
        e.preventDefault();

        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        const errorDiv = document.getElementById('registerError');

        const userData = {
            firstname: form.querySelector('#register-firstname').value,
            lastname: form.querySelector('#register-lastname').value,
            email: form.querySelector('#register-email').value,
            password: form.querySelector('#register-password').value
        };

        const termsAccepted = form.querySelector('#accept-terms').checked;

        if (!termsAccepted) {
            errorDiv.textContent = 'Please accept the Terms of Service and Privacy Policy';
            errorDiv.classList.add('visible');
            return;
        }

        // Show loading state
        btn.classList.add('loading');
        btn.disabled = true;
        this.clearErrors();

        try {
            const user = await Auth.register(userData);

            // Success - redirect to dashboard
            this.close();
            window.location.href = 'dashboard.html';

        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.add('visible');
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    },

    clearErrors() {
        const errors = this.modal.querySelectorAll('.auth-error');
        errors.forEach(err => {
            err.textContent = '';
            err.classList.remove('visible');
        });
    },

    resetForms() {
        const forms = this.modal.querySelectorAll('form');
        forms.forEach(form => form.reset());
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    AuthModal.init();

    // Check if user was redirected from dashboard (needs to login)
    if (sessionStorage.getItem('auth_redirect') === 'true') {
        sessionStorage.removeItem('auth_redirect');
        // Auto-open the login modal
        setTimeout(() => {
            if (AuthModal.modal) {
                AuthModal.open('login');
            }
        }, 300);
    }
});

// Export for use in other modules
window.Auth = Auth;
window.AuthModal = AuthModal;
