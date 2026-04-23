/**
 * Helper function to notify SSE clients of new candidate
 * Call this whenever a new candidate is created
 */

import { getRedisClient } from './storage.js';

export async function notifyNewCandidate(candidate) {
    try {
        const redis = getRedisClient();
        if (!redis) return;

        const notification = {
            type: 'candidate:new',
            ...candidate,
            timestamp: new Date().toISOString()
        };

        // 🚀 Use a list to avoid race conditions and clock skew issues
        await redis.rpush('sse:updates', JSON.stringify(notification));
        await redis.expire('sse:updates', 60); // Safety cleanup
        console.log('✅ SSE notification queued for NEW candidate:', candidate.id);
    } catch (error) {
        console.error('❌ SSE notification error:', error);
    }
}

export async function notifyCandidateUpdate(candidateId, updates = {}) {
    try {
        const redis = getRedisClient();
        if (!redis) return;

        const notification = {
            type: 'candidate:update',
            candidateId,
            updates,
            timestamp: new Date().toISOString()
        };

        // 🚀 Use a list to avoid race conditions (multiple updates in a short window)
        await redis.rpush('sse:updates', JSON.stringify(notification));
        await redis.expire('sse:updates', 60); // Safety cleanup
        console.log('✅ SSE notification queued for UPDATED candidate:', candidateId);
    } catch (error) {
        console.error('❌ SSE candidate update notification error:', error);
    }
}
