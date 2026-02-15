import { getRedisClient } from './storage.js';

/**
 * 🛰️ GLOBAL TELEMETRY UTILITY
 * Logs system events to Redis for the X-Ray dashboard.
 */
export const logTelemetry = async (type, data = {}) => {
    try {
        const redis = getRedisClient();
        if (!redis) return;

        const event = {
            timestamp: new Date().toLocaleTimeString('en-US', {
                hour12: true,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }),
            type: type.toUpperCase(),
            data
        };

        const eventStr = JSON.stringify(event);

        // 1. Persist to Log (for dashboard loading)
        await redis.lpush('telemetry_logs_v4', eventStr);
        await redis.ltrim('telemetry_logs_v4', 0, 99); // Keep last 100

        // 2. Broadcast to SSE (Real-time update)
        await redis.publish('telemetry_stream', eventStr);

    } catch (e) {
        console.error('Telemetry Log Fail:', e.message);
    }
};
