/**
 * GET  /api/wa-numbers  → list of configured WhatsApp numbers
 * POST /api/wa-numbers  → save list
 *
 * Stored in Redis: config:wa_numbers (JSON array)
 * Schema: [{ id, label, phone, color? }]
 *
 * KNOWN_NUMBERS are always merged into the stored list on GET —
 * add new numbers here and they will appear automatically.
 */
import { getRedisClient, validateAdminSession } from './utils/storage.js';

const REDIS_KEY = 'config:wa_numbers';

// Add every known phone number ID here. They will auto-appear in the list
// even if Redis already has an older stored version.
const KNOWN_NUMBERS = [
    { id: process.env.META_PHONE_NUMBER_ID || '1061455557054529', label: 'Principal · 8180859480', color: '#25d366' },
    { id: '1249373631587237', label: 'Secundario · 8123732882', color: '#0ea5e9' },
];

function mergeKnown(stored) {
    const result = stored.map(n => {
        const known = KNOWN_NUMBERS.find(k => k.id === n.id);
        // Always sync label and color from KNOWN_NUMBERS so UI stays current
        return known ? { ...n, label: known.label, color: known.color } : n;
    });
    for (const known of KNOWN_NUMBERS) {
        if (!known.id) continue;
        if (result.some(n => n.id === known.id)) continue;
        result.push({ ...known, phone: known.id });
    }
    return result;
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    if (req.method === 'GET') {
        const raw = await redis.get(REDIS_KEY);
        let stored = raw ? JSON.parse(raw) : [];
        const numbers = mergeKnown(stored);
        // Persist if we added any missing known number
        if (numbers.length !== stored.length) {
            await redis.set(REDIS_KEY, JSON.stringify(numbers));
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
