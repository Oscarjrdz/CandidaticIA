/**
 * GET  /api/wa-numbers  → list of configured WhatsApp numbers
 * POST /api/wa-numbers  → save list
 *
 * Stored in Redis: config:wa_numbers (JSON array)
 * Schema: [{ id, label, phone, color? }]
 *
 * If no numbers saved, seeds from META_PHONE_NUMBER_ID env var.
 */
import { getRedisClient, validateAdminSession } from './utils/storage.js';

const REDIS_KEY = 'config:wa_numbers';

const DEFAULT_COLOR = '#25d366';

function seed() {
    const id = process.env.META_PHONE_NUMBER_ID || '';
    if (!id) return [];
    return [{ id, label: 'Principal', phone: id, color: DEFAULT_COLOR }];
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    if (req.method === 'GET') {
        const raw = await redis.get(REDIS_KEY);
        let numbers = raw ? JSON.parse(raw) : null;
        if (!numbers || numbers.length === 0) {
            numbers = seed();
            if (numbers.length > 0) {
                await redis.set(REDIS_KEY, JSON.stringify(numbers));
            }
        }
        return res.json({ success: true, numbers });
    }

    if (req.method === 'POST') {
        const { numbers } = req.body;
        if (!Array.isArray(numbers)) return res.status(400).json({ error: 'numbers must be array' });
        await redis.set(REDIS_KEY, JSON.stringify(numbers));
        return res.json({ success: true, numbers });
    }

    return res.status(405).end();
}
