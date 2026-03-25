/**
 * Feature Flags for Safe Deployment
 * Allows instant rollback by toggling environment variables
 */

export const FEATURES = {
    // Backend Cache — usado en agent.js y intent-classifier.js ✅
    USE_BACKEND_CACHE: process.env.ENABLE_CACHE !== 'false',
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
