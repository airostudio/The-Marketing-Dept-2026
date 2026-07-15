/**
 * Authentication Module
 * Handles user login, registration, and session management
 *
 * Uses Supabase for persistent authentication when configured,
 * falls back to localStorage for demo/offline mode.
 */

const Auth = {
    // Storage keys
    STORAGE_KEY: 'seo_agent_user',
    SESSION_KEY: 'seo_agent_session',

    /**
     * Check if Supabase is available and configured
     */
    useSupabase() {
        return typeof window.Supabase !== 'undefined' && window.Supabase.isConfigured();
    },

    /**
     * Check if user is authenticated
     */
    async isAuthenticated() {
        // Try Supabase first
        if (this.useSupabase()) {
            try {
                const session = await window.Supabase.Auth.getSession();
                if (session) {
                    return true;
                }
            } catch (e) {
                console.warn('Supabase auth check failed, falling back to local:', e);
            }
        }

        // Fallback to local session
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
     * Synchronous check for immediate UI decisions
     * For async operations, use isAuthenticated() instead
     */
    isAuthenticatedSync() {
        // Check local session first (fast)
        const session = localStorage.getItem(this.SESSION_KEY);
        if (!session) return false;

        try {
            const sessionData = JSON.parse(session);
            if (Date.now() > sessionData.expires) {
                return false;
            }
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Build the public user object for a Supabase auth user, merging in the
     * authoritative role/plan/name from the `profiles` table. user_metadata
     * is only a snapshot taken at signup/login time — it never reflects an
     * admin promotion (`UPDATE profiles SET role = ...`) or a plan change
     * made afterward, so profiles is the source of truth whenever it's
     * reachable. Falls back to user_metadata if the profile fetch fails
     * (offline, transient error, or the on-signup trigger hasn't run yet)
     * so login/session checks never hard-fail on a profiles read.
     */
    async _mergeProfile(user) {
        const base = {
            id: user.id,
            email: user.email,
            firstname: user.user_metadata?.firstname || user.user_metadata?.first_name || '',
            lastname: user.user_metadata?.lastname || user.user_metadata?.last_name || '',
            role: 'user',
            plan: user.user_metadata?.plan || 'free',
            createdAt: user.created_at
        };

        if (!window.Supabase?.DB?.getProfile) return base;
        try {
            const profile = await window.Supabase.DB.getProfile(user.id);
            if (!profile) return base;
            return {
                ...base,
                firstname: profile.firstname || base.firstname,
                lastname: profile.lastname || base.lastname,
                role: profile.role || 'user',
                plan: profile.plan || base.plan,
                company: profile.company || '',
            };
        } catch (e) {
            console.warn('[Auth] Could not load profile, using session metadata only:', e.message);
            return base;
        }
    },

    /**
     * Get current user data
     */
    async getUser() {
        // Try Supabase first
        if (this.useSupabase()) {
            try {
                const user = await window.Supabase.Auth.getUser();
                if (user) {
                    return await this._mergeProfile(user);
                }
            } catch (e) {
                console.warn('Supabase getUser failed, falling back to local:', e);
            }
        }

        // Fallback to local storage
        const userData = localStorage.getItem(this.STORAGE_KEY);
        if (!userData) return null;

        try {
            return JSON.parse(userData);
        } catch {
            return null;
        }
    },

    /**
     * Synchronous get user for immediate UI
     */
    getUserSync() {
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
    async login(email, password, remember = false) {
        // Try Supabase first
        if (this.useSupabase()) {
            try {
                const { user, session } = await window.Supabase.Auth.signIn(email, password);

                if (user) {
                    // Create local session for fast checks
                    const sessionDuration = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
                    const localSession = {
                        userId: user.id,
                        email: user.email,
                        created: Date.now(),
                        expires: Date.now() + sessionDuration,
                        source: 'supabase'
                    };

                    const userPublic = await this._mergeProfile(user);

                    localStorage.setItem(this.SESSION_KEY, JSON.stringify(localSession));
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(userPublic));

                    return userPublic;
                }
            } catch (error) {
                // If Supabase error is about invalid credentials, throw it
                if (error.message?.includes('Invalid') || error.message?.includes('credentials')) {
                    throw error;
                }
                console.warn('Supabase login failed, trying local auth:', error);
            }
        }

        // Fallback to local authentication
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                const users = this.getStoredUsers();
                const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

                if (!user) {
                    reject(new Error('No account found with this email address. Please create an account first.'));
                    return;
                }

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
                    expires: Date.now() + sessionDuration,
                    source: 'local'
                };

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
    async register(userData) {
        const { firstname, lastname, email, password } = userData;

        // Validation
        if (!firstname || !lastname || !email || !password) {
            throw new Error('All fields are required');
        }

        if (password.length < 8) {
            throw new Error('Password must be at least 8 characters');
        }

        // Try Supabase first
        if (this.useSupabase()) {
            try {
                const { user } = await window.Supabase.Auth.signUp(email, password, {
                    firstname,
                    lastname,
                    first_name: firstname,
                    last_name: lastname,
                    plan: 'free'
                });

                if (user) {
                    // Create local session
                    const session = {
                        userId: user.id,
                        email: user.email,
                        created: Date.now(),
                        expires: Date.now() + 24 * 60 * 60 * 1000,
                        source: 'supabase'
                    };

                    // A brand-new account genuinely is role='user'/plan='free' — matches
                    // the on_auth_user_created trigger's default profiles row, so there's
                    // no profiles read needed here (unlike login/getUser, which must
                    // reflect whatever an admin may have changed since signup).
                    const userPublic = {
                        id: user.id,
                        email: user.email,
                        firstname,
                        lastname,
                        role: 'user',
                        plan: 'free',
                        createdAt: user.created_at || new Date().toISOString()
                    };

                    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(userPublic));

                    return userPublic;
                }
            } catch (error) {
                // If it's a duplicate email error, throw it
                if (error.message?.includes('already') || error.message?.includes('exists')) {
                    throw new Error('An account with this email already exists');
                }
                console.warn('Supabase registration failed, using local storage:', error);
            }
        }

        // Fallback to local storage
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                // Check if email already exists locally
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
                    expires: Date.now() + 24 * 60 * 60 * 1000,
                    source: 'local'
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
    async logout() {
        // Try Supabase logout
        if (this.useSupabase()) {
            try {
                await window.Supabase.Auth.signOut();
            } catch (e) {
                console.warn('Supabase logout failed:', e);
            }
        }

        // Always clear local session
        localStorage.removeItem(this.SESSION_KEY);
        localStorage.removeItem(this.STORAGE_KEY);
    },

    /**
     * Get stored users (for local/demo mode)
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
    },

    /**
     * Get authentication mode info
     */
    getAuthMode() {
        if (this.useSupabase()) {
            return {
                mode: 'supabase',
                persistent: true,
                crossDevice: true,
                description: 'Using Supabase authentication (persistent across devices)'
            };
        }
        return {
            mode: 'local',
            persistent: false,
            crossDevice: false,
            description: 'Using local demo mode (data stored in browser only)'
        };
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
        this.showAuthModeIndicator();
    },

    showAuthModeIndicator() {
        const authMode = Auth.getAuthMode();
        if (authMode.mode === 'local') {
            console.info('Auth Mode: Local demo mode. For persistent login across devices, configure Supabase in Settings.');
        }
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
                if (!Auth.isAuthenticatedSync()) {
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
