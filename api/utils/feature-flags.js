/**
 * Feature Flags for Safe Deployment
 * Allows instant rollback by toggling environment variables
 */

export const FEATURES = {
    // Backend Cache (Fase 1) - ENABLED BY DEFAULT ✅
    USE_BACKEND_CACHE: process.env.ENABLE_CACHE !== 'false',

    // Message Queue (Fase 2) - ENABLED BY DEFAULT ✅
    USE_MESSAGE_QUEUE: process.env.ENABLE_QUEUE !== 'false',

    // WebSockets (Fase 3)
    USE_WEBSOCKETS: process.env.ENABLE_WEBSOCKETS === 'true',

    // Advanced optimizations
    USE_REDIS_PIPELINE: process.env.ENABLE_REDIS_PIPELINE === 'true',
    USE_AI_CACHE: process.env.ENABLE_AI_CACHE === 'true'
};

/**
 * Check if a feature is enabled
 * @param {string} featureName - Name of the feature
 * @returns {boolean}
 */
export function isFeatureEnabled(featureName) {
    return FEATURES[featureName] === true;
}

/**
 * Get all feature flags status (for debugging)
 * @returns {Object}
 */
export function getFeatureFlags() {
    return {
        ...FEATURES,
        timestamp: new Date().toISOString()
    };
}
