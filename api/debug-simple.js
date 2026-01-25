
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

        // Fetch last 20 events from the webhook log
        const listKey = 'webhook:events';
        const len = await client.llen(listKey);
        const raw = await client.lrange(listKey, 0, 19); // Last 20 (lpush puts new at 0)

        const events = raw.map(s => {
            try { return JSON.parse(s); } catch (e) { return { error: 'parse_error', raw: s }; }
        });

        await client.quit();

        return res.json({
            count: len,
            events: events
        });

    } catch (error) {
        if (client) client.quit();
        return res.status(500).json({ error: error.message, stack: error.stack });
    }
}
