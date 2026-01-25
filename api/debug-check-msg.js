
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

        const TRAGET_ID = 'cand_1769119953007_iagvbusk4'; // Valid ID from previous log
        const key = `messages:${TRAGET_ID}`;

        const len = await client.llen(key);
        const raw = await client.lrange(key, -10, -1); // Last 10

        const messages = raw.map(s => {
            try { return JSON.parse(s); } catch (e) { return s; }
        });

        // Also check candidate object
        const candRaw = await client.get(`candidate:${TRAGET_ID}`);
        let candObj = null;
        try { candObj = JSON.parse(candRaw); } catch (e) { }

        await client.quit();

        return res.json({
            id: TRAGET_ID,
            totalMessages: len,
            candidate: candObj,
            lastMessages: messages
        });

    } catch (error) {
        if (client) client.quit();
        return res.status(500).json({ error: error.message, stack: error.stack });
    }
}
