import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        const client = getRedisClient();
        if (!client) return res.status(500).json({ error: 'No Redis client available' });

        // 1. UltraMSG API Logs
        const keys = await client.keys('debug:ultramsg:*');
        const logs = [];
        for (const key of keys) {
            const data = await client.get(key);
            if (data) {
                try { logs.push({ key, data: JSON.parse(data) }); }
                catch (e) { logs.push({ key, error: 'JSON Parse Error', raw: data }); }
            }
        }
        logs.sort((a, b) => {
            const timeA = a.data?.timestamp || a.data?.data?.timestamp || '';
            const timeB = b.data?.timestamp || b.data?.data?.timestamp || '';
            return timeB.localeCompare(timeA);
        });

        // 2. Media Access Logs
        const mediaLogsRaw = await client.lrange('debug:media_access', 0, 24);
        const mediaLogs = mediaLogsRaw.map(log => {
            try { return JSON.parse(log); }
            catch (e) { return { error: 'JSON Parse Error', raw: log }; }
        });

        // 3. AI Agent Logs
        const aiKeys = await client.keys('debug:ai:*');
        const aiLogs = [];
        for (const key of aiKeys) {
            const data = await client.get(key);
            if (data) {
                try { aiLogs.push({ key, data: JSON.parse(data) }); }
                catch (e) { aiLogs.push({ key, error: 'JSON Parse Error', raw: data }); }
            }
        }

        // 4. Webhook Trace Logs
        const webhookKeys = await client.keys('debug:webhook:*');
        const webhookLogs = [];
        for (const key of webhookKeys) {
            const data = await client.get(key);
            if (data) {
                try { webhookLogs.push({ key, data: JSON.parse(data) }); }
                catch (e) { webhookLogs.push({ key, error: 'JSON Parse Error', raw: data }); }
            }
        }

        return res.status(200).json({
            success: true,
            timestamp: new Date().toISOString(),
            counts: {
                apiLogs: logs.length,
                mediaAccess: mediaLogs.length,
                aiSessions: aiLogs.length,
                webhookTraces: webhookLogs.length
            },
            apiLogs: logs.slice(0, 15),
            mediaAccess: mediaLogs,
            aiLogs: aiLogs.slice(-10),
            webhookTraces: webhookLogs.slice(-10)
        });

    } catch (error) {
        console.error('❌ Debug Handler Fatal Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
}
