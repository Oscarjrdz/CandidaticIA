
import Redis from 'ioredis';

export default async function handler(req, res) {
    let client;
    try {
        if (!process.env.REDIS_URL) {
            return res.json({ error: 'No REDIS_URL' });
        }

        client = new Redis(process.env.REDIS_URL, {
            tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
        });

        // 1. Scan for candidate keys
        const keys = await client.keys('candidate:*');

        // 2. Get details for each
        const candidates = [];
        for (const key of keys) {
            const data = await client.get(key);
            if (data) {
                const c = JSON.parse(data);
                // Count messages for this ID
                const msgCount = await client.llen(`messages:${c.id}`);
                candidates.push({
                    id: c.id,
                    name: c.nombre,
                    phone: c.whatsapp,
                    msgs: msgCount,
                    RAW_KEY: key
                });
            }
        }

        await client.quit();

        return res.json({
            count: candidates.length,
            candidates: candidates
        });

    } catch (error) {
        if (client) client.quit();
        return res.status(500).json({ error: error.message, stack: error.stack });
    }
}
