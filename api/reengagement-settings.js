/**
 * GET  /api/reengagement-settings  — Lee config
 * POST /api/reengagement-settings  — Guarda config
 */
import { getRedisClient } from './utils/storage.js';

const REDIS_KEY = 'reengagement:settings';

export const DEFAULT_SETTINGS = {
    enabled: false,
    silenceHours: 2,
    maxAttempts: 2,
    intervalHours: 24,
    businessHoursStart: 8,
    businessHoursEnd: 20,
    maxSilenceDays: 7,
    activeFrom: null   // ISO — se fija al primer enable
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    if (req.method === 'GET') {
        try {
            const raw = await redis.get(REDIS_KEY);
            const settings = raw
                ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
                : { ...DEFAULT_SETTINGS };
            return res.status(200).json({ success: true, settings });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const raw = await redis.get(REDIS_KEY);
            const current = raw ? JSON.parse(raw) : { ...DEFAULT_SETTINGS };
            const body = req.body || {};

            // Fijar activeFrom la primera vez que se activa
            if (body.enabled && !current.activeFrom) {
                body.activeFrom = new Date().toISOString();
            }

            const updated = { ...current, ...body };
            await redis.set(REDIS_KEY, JSON.stringify(updated));
            return res.status(200).json({ success: true, settings: updated });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
