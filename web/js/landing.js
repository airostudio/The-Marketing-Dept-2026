/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LANDING PAGE JAVASCRIPT
 * Audema Marketing 2026 - SEO Agent
 * ═══════════════════════════════════════════════════════════════════════════════
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // DOM READY
    // ═══════════════════════════════════════════════════════════════════════════

    document.addEventListener('DOMContentLoaded', function() {
        initNavigation();
        initMobileMenu();
        initSmoothScroll();
        initAnimations();
        initPricingToggle();
        initCounters();
        initTestimonials();
        initParallax();
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // NAVIGATION
    // ═══════════════════════════════════════════════════════════════════════════

    function initNavigation() {
        const header = document.querySelector('.header');
        const navLinks = document.querySelectorAll('.nav-link');
        let lastScroll = 0;

        // Sticky header with hide on scroll down
        window.addEventListener('scroll', function() {
            const currentScroll = window.pageYOffset;

            if (currentScroll > 100) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }

            // Hide/show header on scroll
            if (currentScroll > lastScroll && currentScroll > 300) {
                header.classList.add('hidden');
            } else {
                header.classList.remove('hidden');
            }

            lastScroll = currentScroll;

            // Update active nav link based on scroll position
            updateActiveNavLink();
        });

        // Nav link click handling
        navLinks.forEach(link => {
            link.addEventListener('click', function(e) {
                const href = this.getAttribute('href');
                if (href.startsWith('#')) {
                    e.preventDefault();
                    const target = document.querySelector(href);
                    if (target) {
                        smoothScrollTo(target);
                    }
                }
            });
        });
    }

    function updateActiveNavLink() {
        const sections = document.querySelectorAll('section[id]');
        const navLinks = document.querySelectorAll('.nav-link');

        let current = '';

        sections.forEach(section => {
            const sectionTop = section.offsetTop - 100;
            const sectionHeight = section.offsetHeight;

            if (window.pageYOffset >= sectionTop && window.pageYOffset < sectionTop + sectionHeight) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) {
                link.classList.add('active');
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MOBILE MENU
    // ═══════════════════════════════════════════════════════════════════════════

    function initMobileMenu() {
        const menuToggle = document.querySelector('.mobile-menu-toggle');
        const mobileMenu = document.querySelector('.mobile-menu');
        const mobileLinks = document.querySelectorAll('.mobile-nav-link');

        if (!menuToggle || !mobileMenu) return;

        menuToggle.addEventListener('click', function() {
            const isOpen = mobileMenu.classList.contains('open');

            if (isOpen) {
                closeMobileMenu();
            } else {
                openMobileMenu();
            }
        });

        mobileLinks.forEach(link => {
            link.addEventListener('click', function() {
                closeMobileMenu();
            });
        });

        // Close on escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
                closeMobileMenu();
            }
        });

        // Close on click outside
        document.addEventListener('click', function(e) {
            if (!mobileMenu.contains(e.target) && !menuToggle.contains(e.target)) {
                if (mobileMenu.classList.contains('open')) {
                    closeMobileMenu();
                }
            }
        });

        function openMobileMenu() {
            mobileMenu.classList.add('open');
            menuToggle.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeMobileMenu() {
            mobileMenu.classList.remove('open');
            menuToggle.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SMOOTH SCROLL
    // ═══════════════════════════════════════════════════════════════════════════

    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                const href = this.getAttribute('href');
                if (href === '#') return;

                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    smoothScrollTo(target);
                }
            });
        });
    }

    function smoothScrollTo(target) {
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SCROLL ANIMATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function initAnimations() {
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');

                    // Stagger animations for children
                    const children = entry.target.querySelectorAll('.stagger-item');
                    children.forEach((child, index) => {
                        child.style.transitionDelay = `${index * 100}ms`;
                        child.classList.add('animate-in');
                    });

                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        // Observe elements with animation classes
        document.querySelectorAll('.fade-up, .fade-in, .scale-in, .slide-left, .slide-right').forEach(el => {
            observer.observe(el);
        });

        // Add animation classes to sections
        document.querySelectorAll('section').forEach(section => {
            if (!section.classList.contains('hero')) {
                section.classList.add('fade-up');
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRICING TOGGLE
    // ═══════════════════════════════════════════════════════════════════════════

    function initPricingToggle() {
        const toggle = document.querySelector('.pricing-toggle');
        const monthlyPrices = document.querySelectorAll('.price-monthly');
        const yearlyPrices = document.querySelectorAll('.price-yearly');

        if (!toggle) return;

        toggle.addEventListener('click', function() {
            this.classList.toggle('yearly');

            monthlyPrices.forEach(el => el.classList.toggle('hidden'));
            yearlyPrices.forEach(el => el.classList.toggle('hidden'));

            // Animate price change
            document.querySelectorAll('.pricing-card .price-value').forEach(price => {
                price.classList.add('price-changing');
                setTimeout(() => {
                    price.classList.remove('price-changing');
                }, 300);
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANIMATED COUNTERS
    // ═══════════════════════════════════════════════════════════════════════════

    function initCounters() {
        const counters = document.querySelectorAll('.counter');

        const observerOptions = {
            threshold: 0.5
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateCounter(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        counters.forEach(counter => observer.observe(counter));
    }

    function animateCounter(element) {
        const target = parseInt(element.getAttribute('data-target'));
        const suffix = element.getAttribute('data-suffix') || '';
        const prefix = element.getAttribute('data-prefix') || '';
        const duration = 2000;
        const step = target / (duration / 16);
        let current = 0;

        const updateCounter = () => {
            current += step;
            if (current < target) {
                element.textContent = prefix + Math.floor(current).toLocaleString() + suffix;
                requestAnimationFrame(updateCounter);
            } else {
                element.textContent = prefix + target.toLocaleString() + suffix;
            }
        };

        updateCounter();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TESTIMONIALS CAROUSEL
    // ═══════════════════════════════════════════════════════════════════════════

    function initTestimonials() {
        const track = document.querySelector('.testimonials-track');
        const slides = document.querySelectorAll('.testimonial-card');
        const prevBtn = document.querySelector('.testimonial-prev');
        const nextBtn = document.querySelector('.testimonial-next');
        const dots = document.querySelectorAll('.testimonial-dot');

        if (!track || slides.length === 0) return;

        let currentIndex = 0;
        let autoplayInterval;

        function goToSlide(index) {
            if (index < 0) index = slides.length - 1;
            if (index >= slides.length) index = 0;

            currentIndex = index;
            const offset = -index * 100;
            track.style.transform = `translateX(${offset}%)`;

            // Update dots
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === currentIndex);
            });
        }

        function nextSlide() {
            goToSlide(currentIndex + 1);
        }

        function prevSlide() {
            goToSlide(currentIndex - 1);
        }

        function startAutoplay() {
            autoplayInterval = setInterval(nextSlide, 5000);
        }

        function stopAutoplay() {
            clearInterval(autoplayInterval);
        }

        // Event listeners
        if (prevBtn) prevBtn.addEventListener('click', () => { stopAutoplay(); prevSlide(); startAutoplay(); });
        if (nextBtn) nextBtn.addEventListener('click', () => { stopAutoplay(); nextSlide(); startAutoplay(); });

        dots.forEach((dot, index) => {
            dot.addEventListener('click', () => {
                stopAutoplay();
                goToSlide(index);
                startAutoplay();
            });
        });

        // Touch support
        let touchStartX = 0;
        let touchEndX = 0;

        track.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            stopAutoplay();
        }, { passive: true });

        track.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
            startAutoplay();
        }, { passive: true });

        function handleSwipe() {
            const diff = touchStartX - touchEndX;
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    nextSlide();
                } else {
                    prevSlide();
                }
            }
        }

        // Start autoplay
        startAutoplay();

        // Pause on hover
        track.addEventListener('mouseenter', stopAutoplay);
        track.addEventListener('mouseleave', startAutoplay);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PARALLAX EFFECTS
    // ═══════════════════════════════════════════════════════════════════════════

    function initParallax() {
        const parallaxElements = document.querySelectorAll('.parallax');

        if (parallaxElements.length === 0) return;

        let ticking = false;

        window.addEventListener('scroll', () => {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    updateParallax();
                    ticking = false;
                });
                ticking = true;
            }
        });

        function updateParallax() {
            const scrollY = window.pageYOffset;

            parallaxElements.forEach(element => {
                const speed = element.getAttribute('data-speed') || 0.5;
                const offset = scrollY * speed;
                element.style.transform = `translateY(${offset}px)`;
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    // Debounce function
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Throttle function
    function throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTH MODAL & TAB SWITCHING
    // ═══════════════════════════════════════════════════════════════════════════

    // Auth tab switching
    const authTabs = document.querySelectorAll('.auth-tab');
    const authForms = document.querySelectorAll('.auth-form');

    authTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const targetTab = this.dataset.tab;

            // Update tab states
            authTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            // Update form visibility
            authForms.forEach(form => {
                if (form.dataset.form === targetTab) {
                    form.classList.add('active');
                } else {
                    form.classList.remove('active');
                }
            });
        });
    });

    // Auth modal open/close
    const authModal = document.querySelector('.auth-modal');
    const authModalOverlay = document.querySelector('.auth-modal-overlay');
    const authModalClose = document.querySelector('.auth-modal-close');
    const loginButtons = document.querySelectorAll('[href="#login"], [data-action="login"], .btn-login');
    const signupButtons = document.querySelectorAll('[href="#signup"], [href="#register"], [data-action="signup"], .btn-signup');

    function openAuthModal(tab = 'login') {
        if (authModal) {
            authModal.classList.add('active');
            document.body.style.overflow = 'hidden';

            // Switch to specified tab
            authTabs.forEach(t => {
                t.classList.toggle('active', t.dataset.tab === tab);
            });
            authForms.forEach(form => {
                form.classList.toggle('active', form.dataset.form === tab);
            });
        }
    }

    function closeAuthModal() {
        if (authModal) {
            authModal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    loginButtons.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            openAuthModal('login');
        });
    });

    signupButtons.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            openAuthModal('register');
        });
    });

    if (authModalClose) {
        authModalClose.addEventListener('click', closeAuthModal);
    }

    if (authModalOverlay) {
        authModalOverlay.addEventListener('click', closeAuthModal);
    }

    // Close on escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && authModal && authModal.classList.contains('active')) {
            closeAuthModal();
        }
    });

    // Password visibility toggle
    const togglePasswordBtns = document.querySelectorAll('.toggle-password');
    togglePasswordBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const input = this.parentElement.querySelector('input');
            const eyeOpen = this.querySelector('.eye-open');
            const eyeClosed = this.querySelector('.eye-closed');

            if (input.type === 'password') {
                input.type = 'text';
                if (eyeOpen) eyeOpen.style.display = 'none';
                if (eyeClosed) eyeClosed.style.display = 'block';
            } else {
                input.type = 'password';
                if (eyeOpen) eyeOpen.style.display = 'block';
                if (eyeClosed) eyeClosed.style.display = 'none';
            }
        });
    });

    // Check if already authenticated, redirect to dashboard
    if (typeof Auth !== 'undefined' && Auth.isAuthenticatedSync && Auth.isAuthenticatedSync()) {
        // User is already logged in, show dashboard link or auto-redirect
        const heroButtons = document.querySelector('.hero-buttons');
        if (heroButtons) {
            const dashboardLink = document.createElement('a');
            dashboardLink.href = '/dashboard.html';
            dashboardLink.className = 'btn btn-primary';
            dashboardLink.textContent = 'Go to Dashboard';
            heroButtons.innerHTML = '';
            heroButtons.appendChild(dashboardLink);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTHENTICATION FORM HANDLING
    // ═══════════════════════════════════════════════════════════════════════════

    // Login Form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const submitBtn = this.querySelector('button[type="submit"]');
            const errorDiv = document.getElementById('loginError');
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            // Clear previous errors
            if (errorDiv) errorDiv.textContent = '';

            // Show loading state
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner"></span> Signing in...';

            try {
                // Auth.login returns user object directly, throws on error
                const user = await Auth.login(email, password);

                if (user) {
                    submitBtn.innerHTML = '&#10003; Success!';
                    submitBtn.classList.add('success');

                    // Redirect to dashboard
                    setTimeout(() => {
                        window.location.href = '/dashboard.html';
                    }, 500);
                } else {
                    throw new Error('Login failed');
                }
            } catch (error) {
                console.error('Login error:', error);
                if (errorDiv) {
                    errorDiv.textContent = error.message || 'Invalid email or password. Please try again.';
                }
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign In';
            }
        });
    }

    // Register Form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const submitBtn = this.querySelector('button[type="submit"]');
            const errorDiv = document.getElementById('registerError');
            const firstname = document.getElementById('register-firstname').value;
            const lastname = document.getElementById('register-lastname').value;
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;

            // Clear previous errors
            if (errorDiv) errorDiv.textContent = '';

            // Validate password
            if (password.length < 8) {
                if (errorDiv) errorDiv.textContent = 'Password must be at least 8 characters';
                return;
            }

            // Show loading state
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner"></span> Creating account...';

            try {
                // Auth.register expects { firstname, lastname, email, password }
                const user = await Auth.register({ firstname, lastname, email, password });

                if (user) {
                    submitBtn.innerHTML = '&#10003; Account created!';
                    submitBtn.classList.add('success');

                    // Redirect to dashboard
                    setTimeout(() => {
                        window.location.href = '/dashboard.html';
                    }, 500);
                } else {
                    throw new Error('Registration failed');
                }
            } catch (error) {
                console.error('Registration error:', error);
                if (errorDiv) {
                    errorDiv.textContent = error.message || 'Could not create account. Please try again.';
                }
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Account';
            }
        });
    }

    // Generic form handling for other forms (newsletter, contact, etc.)
    const otherForms = document.querySelectorAll('form:not(#loginForm):not(#registerForm)');
    otherForms.forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();

            const submitBtn = this.querySelector('button[type="submit"]');
            if (!submitBtn) return;

            const originalText = submitBtn.textContent;

            // Show loading state
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner"></span> Processing...';

            // Simulate form submission for non-auth forms
            setTimeout(() => {
                submitBtn.innerHTML = '&#10003; Success!';
                submitBtn.classList.add('success');

                setTimeout(() => {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                    submitBtn.classList.remove('success');
                    form.reset();
                }, 2000);
            }, 1500);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // KEYBOARD NAVIGATION
    // ═══════════════════════════════════════════════════════════════════════════

    document.addEventListener('keydown', function(e) {
        // Focus trap for modals
        const modal = document.querySelector('.modal.open');
        if (modal) {
            const focusableElements = modal.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (e.key === 'Tab') {
                if (e.shiftKey) {
                    if (document.activeElement === firstElement) {
                        lastElement.focus();
                        e.preventDefault();
                    }
                } else {
                    if (document.activeElement === lastElement) {
                        firstElement.focus();
                        e.preventDefault();
                    }
                }
            }

            if (e.key === 'Escape') {
                closeModal(modal);
            }
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // LAZY LOADING IMAGES
    // ═══════════════════════════════════════════════════════════════════════════

    if ('IntersectionObserver' in window) {
        const lazyImages = document.querySelectorAll('img[data-src]');

        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                    img.classList.add('loaded');
                    imageObserver.unobserve(img);
                }
            });
        });

        lazyImages.forEach(img => imageObserver.observe(img));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COOKIE BANNER
    // ═══════════════════════════════════════════════════════════════════════════

    function initCookieBanner() {
        const banner = document.querySelector('.cookie-banner');
        const acceptBtn = document.querySelector('.cookie-accept');
        const declineBtn = document.querySelector('.cookie-decline');

        if (!banner || localStorage.getItem('cookiesAccepted')) return;

        setTimeout(() => {
            banner.classList.add('visible');
        }, 2000);

        if (acceptBtn) {
            acceptBtn.addEventListener('click', () => {
                localStorage.setItem('cookiesAccepted', 'true');
                banner.classList.remove('visible');
            });
        }

        if (declineBtn) {
            declineBtn.addEventListener('click', () => {
                localStorage.setItem('cookiesAccepted', 'false');
                banner.classList.remove('visible');
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT FOR GLOBAL ACCESS
    // ═══════════════════════════════════════════════════════════════════════════

    window.MarketingDept = {
        smoothScrollTo,
        debounce,
        throttle
    };

})();
