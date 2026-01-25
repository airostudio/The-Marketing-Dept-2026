/**
 * Application Configuration
 * The Marketing Department 2026
 *
 * This file contains environment-specific configuration.
 * For deployment, update these values or replace this file via CI/CD.
 */

window.APP_CONFIG = {
    // ═══════════════════════════════════════════════════════════════════════════
    // SUPABASE CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════
    SUPABASE_URL: 'https://gbitapjzewhkzljqfvyc.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_-dlc_CGlPW_gpLe6rsIluw_C77wSDuV',

    // ═══════════════════════════════════════════════════════════════════════════
    // GOOGLE APIs
    // ═══════════════════════════════════════════════════════════════════════════
    GOOGLE: {
        // Google Cloud Console: https://console.cloud.google.com/apis/credentials
        // Enable: PageSpeed Insights API, Search Console API, Analytics API
        API_KEY: 'AIzaSyDvXzQ1p9Upy4kZmgFrQMhtkNUQ0poke1M',  // For PageSpeed Insights (optional - works without key but with rate limits)

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
    // ═══════════════════════════════════════════════════════════════════════════
    AI: {
        // OpenAI - https://platform.openai.com/api-keys
        OPENAI: {
            ENABLED: false,
            API_KEY: '',
            MODEL: 'gpt-4-turbo-preview'
        },

        // Anthropic Claude - https://console.anthropic.com/
        ANTHROPIC: {
            ENABLED: false,
            API_KEY: '',
            MODEL: 'claude-3-sonnet-20240229'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // APP SETTINGS
    // ═══════════════════════════════════════════════════════════════════════════
    APP_NAME: 'The Marketing Department',
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
        ENABLE_AI_INSIGHTS: false,
        ENABLE_COMPETITOR_TRACKING: true,
        ENABLE_SOCIAL_PUBLISHING: false,
        USE_MOCK_DATA: false  // Set to true for demo mode
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
