import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    try {
        const redis = getRedisClient();
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth() + 1;
        const mm = String(month).padStart(2, '0');
        const today = now.getUTCDate();

        // All day keys this month + monthly total + last absolute snapshot
        const keys = [`stats:bandwidth:${year}-${mm}:total`, 'stats:bandwidth:last_absolute_bytes'];
        for (let d = 1; d <= today; d++) {
            keys.push(`stats:bandwidth:${year}-${mm}-${String(d).padStart(2,'0')}:total`);
        }

        const pipeline = redis.pipeline();
        keys.forEach(k => pipeline.get(k));
        const results = await pipeline.exec();

        // Also get current Redis INFO bytes
        const info = await redis.info('stats');
        let inputBytes = 0, outputBytes = 0;
        info.split('\n').forEach(line => {
            if (line.startsWith('total_net_input_bytes:')) inputBytes = parseInt(line.split(':')[1]);
            if (line.startsWith('total_net_output_bytes:')) outputBytes = parseInt(line.split(':')[1]);
        });

        const data = {};
        keys.forEach((k, i) => { data[k] = results[i][1]; });

        return res.status(200).json({
            keys: data,
            currentRedisBytes: inputBytes + outputBytes,
            inputBytes,
            outputBytes,
            today: now.toISOString()
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
