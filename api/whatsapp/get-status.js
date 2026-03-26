import { getRedisClient } from '../utils/storage.js';

/**
 * GET /api/whatsapp/get-status
 * Retorna el último estado publicado de WA (guardado en Redis)
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Database unavailable' });

        const rawStatus = await redis.get('last_wa_status');
        if (!rawStatus) {
            return res.json({ success: true, status: null });
        }

        const status = JSON.parse(rawStatus);

        // Optional: Check if the status is expired (WA statuses last 24h)
        const publishedAt = new Date(status.timestamp).getTime();
        const now = Date.now();
        const isExpired = (now - publishedAt) > (24 * 60 * 60 * 1000);

        if (isExpired) {
            // Delete expired status
            await redis.del('last_wa_status');
            return res.json({ success: true, status: null });
        }

        return res.json({ success: true, status });
    } catch (e) {
        console.error('[GET WA STATUS] Error:', e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
}
