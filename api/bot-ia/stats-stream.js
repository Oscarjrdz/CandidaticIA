/**
 * Bot IA Stats Stream — Reads cached stats (O(1) per tick)
 * 
 * BEFORE: Called calculateBotStats() every 30s → 10 MB per call → ~860 GB/month
 * AFTER:  Reads cached result from Redis → ~500 bytes per call → ~0.5 GB/month
 * 
 * Full recalculation is handled by calculateBotStats() cache miss (every 10 min max)
 */

import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const redis = getRedisClient();

    // Read cached stats (O(1) — just a single GET)
    const readCachedStats = async () => {
        if (!redis) return null;
        try {
            const cached = await redis.get('stats:bot:cached_result');
            if (cached) return JSON.parse(cached);
            // Cache miss: trigger one full calculation (will self-cache for 10 min)
            const { calculateBotStats } = await import('../utils/bot-stats.js');
            return await calculateBotStats();
        } catch (e) {
            return null;
        }
    };

    // Initial send
    const initialStats = await readCachedStats();
    if (initialStats) sendEvent(initialStats);

    // Poll cached stats every 30 seconds (now costs ~500 bytes instead of ~10 MB)
    const interval = setInterval(async () => {
        const stats = await readCachedStats();
        if (stats) sendEvent(stats);
    }, 30000);

    req.on('close', () => {
        clearInterval(interval);
        res.end();
    });
}
