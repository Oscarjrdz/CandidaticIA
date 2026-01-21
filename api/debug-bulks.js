import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        const campaignIds = await redis.zrevrange('bulks:list', 0, -1);

        const now = Date.now();
        const serverTime = new Date().toISOString();
        const report = [];

        for (const id of campaignIds) {
            const bulkJson = await redis.get(`bulk:${id}`);
            if (!bulkJson) continue;
            const bulk = JSON.parse(bulkJson);

            const scheduledTime = new Date(bulk.scheduledAt).getTime();
            const diff = now - scheduledTime;

            report.push({
                name: bulk.name,
                status: bulk.status,
                scheduledAt: bulk.scheduledAt,
                scheduledAtParsed: new Date(bulk.scheduledAt).toISOString(),
                diffSeconds: Math.floor(diff / 1000),
                shouldRun: bulk.status === 'pending' || bulk.status === 'sending',
                isTimePass: now >= scheduledTime,
                recipients: bulk.recipients.length,
                sentCount: bulk.sentCount
            });
        }

        return res.status(200).json({
            success: true,
            serverTime,
            now,
            report
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
