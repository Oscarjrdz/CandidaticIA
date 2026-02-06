/**
 * Helper function to notify SSE clients of new candidate
 * Call this whenever a new candidate is created
 */

import { getRedisClient } from './storage.js';

export async function notifyNewCandidate(candidate) {
    try {
        const redis = getRedisClient();
        if (!redis) return;

        // Store latest candidate with timestamp for SSE endpoint to pick up
        const notification = {
            ...candidate,
            timestamp: new Date().toISOString()
        };

        // Set with 10 second expiry (SSE polls every 2s, so 10s is safe)
        await redis.set('sse_new_candidate', JSON.stringify(notification), 'EX', 10);

        console.log('✅ SSE notification sent for candidate:', candidate.id);
    } catch (error) {
        console.error('❌ SSE notification error:', error);
        // Don't throw - this is non-critical
    }
}
