/**
 * Application Configuration
 * Audema Marketing 2026
 *
 * This file contains environment-specific configuration.
 * For deployment, update these values or replace this file via CI/CD.
 */

window.APP_CONFIG = {
    // ═══════════════════════════════════════════════════════════════════════════
    // SUPABASE CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════
    SUPABASE_URL: '',      // Set SUPABASE_URL in Vercel environment variables
    SUPABASE_ANON_KEY: '', // Set SUPABASE_ANON_KEY in Vercel environment variables

    // ═══════════════════════════════════════════════════════════════════════════
    // GOOGLE APIs
    // ═══════════════════════════════════════════════════════════════════════════
    GOOGLE: {
        // Google Cloud Console: https://console.cloud.google.com/apis/credentials
        // Enable: PageSpeed Insights API, Search Console API, Analytics API
        API_KEY: '',  // Set GOOGLE_PAGESPEED_API_KEY in Vercel environment variables — never here

        // OAuth 2.0 Client ID for Search Console & Analytics
        // Create at: https://console.cloud.google.com/apis/credentials
        CLIENT_ID: 'airo-studios',

        // Search Console API
        SEARCH_CONSOLE: {
            ENABLED: true,
            SCOPES: ['https://www.googleapis.com/auth/webmasters.readonly']
        },

        // Google Analytics 4 API
        ANALYTICS: {
            ENABLED: true,
            PROPERTY_ID: '',  // GA4 Property ID (e.g., 'properties/123456789')
            SCOPES: ['https://www.googleapis.com/auth/analytics.readonly']
        },

        // Google Ads API
        ADS: {
            ENABLED: false,
            DEVELOPER_TOKEN: '',  // Apply at: https://developers.google.com/google-ads/api/docs/first-call/dev-token
            CLIENT_ID: '',
            CLIENT_SECRET: '',
            REFRESH_TOKEN: '',
            CUSTOMER_ID: ''  // Your Google Ads customer ID (without dashes)
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // META (FACEBOOK/INSTAGRAM) APIs
    // ═══════════════════════════════════════════════════════════════════════════
    META: {
        // Create app at: https://developers.facebook.com/apps/
        APP_ID: '',
        APP_SECRET: '',
        ACCESS_TOKEN: '',  // Long-lived page access token

        // Facebook Marketing API
        MARKETING: {
            ENABLED: false,
            AD_ACCOUNT_ID: '',  // Format: act_123456789
            SCOPES: ['ads_read', 'ads_management', 'business_management']
        },

        // Instagram Graph API
        INSTAGRAM: {
            ENABLED: false,
            BUSINESS_ACCOUNT_ID: '',
            SCOPES: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights']
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SOCIAL MEDIA APIs
    // ═══════════════════════════════════════════════════════════════════════════
    SOCIAL: {
        // Twitter/X API - https://developer.twitter.com/
        TWITTER: {
            ENABLED: false,
            API_KEY: '',
            API_SECRET: '',
            ACCESS_TOKEN: '',
            ACCESS_TOKEN_SECRET: '',
            BEARER_TOKEN: ''
        },

        // LinkedIn API - https://www.linkedin.com/developers/
        LINKEDIN: {
            ENABLED: false,
            CLIENT_ID: '',
            CLIENT_SECRET: '',
            ACCESS_TOKEN: '',
            ORGANIZATION_ID: ''  // For company page analytics
        },

        // TikTok API - https://developers.tiktok.com/
        TIKTOK: {
            ENABLED: false,
            APP_ID: '',
            APP_SECRET: '',
            ACCESS_TOKEN: ''
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SEO TOOL APIs
    // ═══════════════════════════════════════════════════════════════════════════
    SEO_TOOLS: {
        // Ahrefs API - https://ahrefs.com/api
        AHREFS: {
            ENABLED: false,
            API_KEY: ''
        },

        // SEMrush API - https://www.semrush.com/api-analytics/
        SEMRUSH: {
            ENABLED: false,
            API_KEY: ''
        },

        // Moz API - https://moz.com/products/api
        MOZ: {
            ENABLED: false,
            ACCESS_ID: '',
            SECRET_KEY: ''
        },

        // DataForSEO API - https://dataforseo.com/ (affordable alternative)
        DATAFORSEO: {
            ENABLED: false,
            LOGIN: '',
            PASSWORD: ''
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // AI/LLM APIs (for content generation, analysis)
    //
    // No API keys here, ever. This is a static, git-tracked file shipped to
    // every visitor's browser — a real key pasted here would be exposed to
    // anyone who views source. Every AI call in this app goes through a
    // server-side proxy (api/openai.js, api/gemini.js, api/claude.js,
    // api/perplexity.js) that reads its key exclusively from a Vercel
    // environment variable (OPENAI_API_KEY, GEMINI_API_KEY, etc.) and never
    // returns it to the client. web/js/ai-service.js's OpenAI/Gemini
    // clients call those proxies directly — model/token defaults are set
    // there and in the proxies themselves, not read from this file.
    // ═══════════════════════════════════════════════════════════════════════════
    AI: {
        // Default provider: 'openai' or 'gemini' — which proxy
        // ai-service.js's AI.prompt()/AI.chat() call first, with the other
        // as an automatic fallback if the first one's call fails.
        DEFAULT_PROVIDER: 'openai',

        // AI Feature Settings
        SETTINGS: {
            // Max tokens for different task types
            MAX_TOKENS: {
                SHORT: 500,      // Quick suggestions
                MEDIUM: 1500,    // Recommendations
                LONG: 4000       // Full reports
            },
            // Temperature settings (0 = deterministic, 1 = creative)
            TEMPERATURE: {
                ANALYSIS: 0.3,   // Factual analysis
                CREATIVE: 0.7,   // Content generation
                BALANCED: 0.5    // General use
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // APP SETTINGS
    // ═══════════════════════════════════════════════════════════════════════════
    APP_NAME: 'Audema - Audema Marketing',
    APP_VERSION: '2026.1.0',

    // API rate limiting (requests per minute)
    RATE_LIMITS: {
        GOOGLE_PAGESPEED: 60,
        SEARCH_CONSOLE: 1200,
        ANALYTICS: 10000,
        DEFAULT: 60
    },

    // Cache TTL in milliseconds
    CACHE_TTL: {
        PAGESPEED: 3600000,       // 1 hour
        SEARCH_CONSOLE: 1800000,  // 30 minutes
        ANALYTICS: 300000,        // 5 minutes
        KEYWORDS: 86400000,       // 24 hours
        BACKLINKS: 86400000,      // 24 hours
        COMPETITORS: 86400000     // 24 hours
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // FEATURE FLAGS
    // ═══════════════════════════════════════════════════════════════════════════
    FEATURES: {
        ENABLE_ANALYTICS: true,
        ENABLE_REALTIME: true,
        ENABLE_STORAGE: true,
        ENABLE_AI_INSIGHTS: true,          // AI-powered recommendations
        ENABLE_AI_CONTENT: true,           // AI content generation
        ENABLE_AI_REPORTS: true,           // AI report summaries
        ENABLE_COMPETITOR_TRACKING: true,
        ENABLE_SOCIAL_PUBLISHING: false
        // NO MOCK DATA FLAG - Production ready with real data only
    }
};

/**
 * Helper to check if an API is configured and enabled
 */
window.isApiEnabled = function(path) {
    const parts = path.split('.');
    let config = window.APP_CONFIG;

    for (const part of parts) {
        if (!config || typeof config !== 'object') return false;
        config = config[part];
    }

    if (typeof config === 'object' && config !== null) {
        return config.ENABLED === true && (config.API_KEY || config.ACCESS_TOKEN || config.CLIENT_ID);
    }

    return !!config;
};

/**
 * Helper to get API config
 */
window.getApiConfig = function(path) {
    const parts = path.split('.');
    let config = window.APP_CONFIG;

    for (const part of parts) {
        if (!config || typeof config !== 'object') return null;
        config = config[part];
    }

    return config;
};
