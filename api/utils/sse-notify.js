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

        // 🚀 Broadcast to ALL connected clients instantly via Pub/Sub
        await redis.publish('channel:sse:updates', JSON.stringify(notification));
        console.log('✅ SSE Pub/Sub published for NEW candidate:', candidate.id);
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

        // 🚀 Broadcast to ALL connected clients instantly via Pub/Sub
        await redis.publish('channel:sse:updates', JSON.stringify(notification));
        console.log('✅ SSE Pub/Sub published for UPDATED candidate:', candidateId);
    } catch (error) {
        console.error('❌ SSE candidate update notification error:', error);
    }
}
