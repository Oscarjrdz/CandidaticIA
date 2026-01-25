
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
                let c;
                try {
                    c = JSON.parse(data);
                } catch (e) {
                    c = { id: 'corrupt', nombre: 'CORRUPT', whatsapp: 'Unknown' };
                }

                // Count messages for this ID
                const candidateId = c.id || key.split(':')[1];
                const msgCount = await client.llen(`messages:${candidateId}`);

                // Get last message info if possible
                let lastMsg = null;
                if (msgCount > 0) {
                    const params = await client.lrange(`messages:${candidateId}`, -1, -1);
                    if (params && params.length > 0) {
                        try { lastMsg = JSON.parse(params[0]); } catch { lastMsg = params[0]; }
                    }
                }

                candidates.push({
                    id: candidateId,
                    name: c.nombre,
                    phone: c.whatsapp,
                    msgs: msgCount,
                    lastMsg: lastMsg,
                    RAW_KEY: key
                });
            }
        }

        await client.quit();

        // Sort by message count desc
        candidates.sort((a, b) => b.msgs - a.msgs);

        return res.json({
            count: candidates.length,
            candidates: candidates
        });

    } catch (error) {
        if (client) client.quit();
        return res.status(500).json({ error: error.message, stack: error.stack });
    }
}
