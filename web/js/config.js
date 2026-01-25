/**
 * Application Configuration
 * The Marketing Department 2026
 *
 * This file contains environment-specific configuration.
 * For deployment, update these values or replace this file via CI/CD.
 */

window.APP_CONFIG = {
    // Supabase Configuration
    // Get these from your Supabase project settings: https://app.supabase.com
    SUPABASE_URL: '',      // e.g., 'https://xxxxxxxxxxxx.supabase.co'
    SUPABASE_ANON_KEY: '', // Your project's anon/public key

    // App Settings
    APP_NAME: 'The Marketing Department',
    APP_VERSION: '2026.1.0',

    // Feature Flags
    FEATURES: {
        ENABLE_ANALYTICS: true,
        ENABLE_REALTIME: true,
        ENABLE_STORAGE: true
    }
};
