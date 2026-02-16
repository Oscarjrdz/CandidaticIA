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

        await redis.set('sse_new_candidate', JSON.stringify(notification), 'EX', 10);
        console.log('✅ SSE notification sent for NEW candidate:', candidate.id);
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

        // Use a separate key for updates to avoid collisions with new candidate signals
        await redis.set('sse_candidate_update', JSON.stringify(notification), 'EX', 10);
        console.log('✅ SSE notification sent for UPDATED candidate:', candidateId);
    } catch (error) {
        console.error('❌ SSE candidate update notification error:', error);
    }
}
