
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
        for (const key of keys) {
            const data = await client.get(key);
            if (data) {
                let c;
                let isCorrupt = false;
                try {
                    c = JSON.parse(data);
                } catch (e) {
                    c = { id: data, nombre: 'CORRUPT_DATA', whatsapp: 'Unknown', raw: data };
                    isCorrupt = true;
                }

                // Count messages for this ID (if we have an ID)
                const candidateId = c.id || key.split(':')[1];
                const msgCount = await client.llen(`messages:${candidateId}`);

                candidates.push({
                    id: candidateId,
                    name: c.nombre,
                    phone: c.whatsapp,
                    msgs: msgCount,
                    RAW_KEY: key,
                    isCorrupt: isCorrupt
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
