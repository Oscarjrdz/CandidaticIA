/**
 * 📊 Vercel Cron: Redis Bandwidth Tracker
 * Executes hourly to snapshot Redis network usage and calculate robust deltas,
 * handling potential Redis server reboots automatically.
 */
import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Basic security for manual triggers (Vercel Cron automatically passes internal validation)
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis client not initialized' });

        // 1. Fetch raw INFO stats
        const info = await redis.info('stats');
        
        // Parse INFO string for bytes
        let inputBytes = 0;
        let outputBytes = 0;
        
        info.split('\n').forEach(line => {
            if (line.startsWith('total_net_input_bytes:')) {
                inputBytes = parseInt(line.split(':')[1].trim(), 10);
            }
            if (line.startsWith('total_net_output_bytes:')) {
                outputBytes = parseInt(line.split(':')[1].trim(), 10);
            }
        });

        const currentAbsoluteBytes = inputBytes + outputBytes;
        if (currentAbsoluteBytes === 0) {
            return res.status(200).json({ message: 'Zero bytes reported, skipping.' });
        }

        // 2. Fetch previous snapshot to calculate delta
        const prevBytesStr = await redis.get('stats:bandwidth:last_absolute_bytes');
        const prevAbsoluteBytes = prevBytesStr ? parseInt(prevBytesStr, 10) : 0;

        let deltaBytes = 0;
        if (currentAbsoluteBytes < prevAbsoluteBytes) {
            // Redis server was restarted/flushed, the counter reset.
            deltaBytes = currentAbsoluteBytes;
        } else {
            // Normal operation
            deltaBytes = currentAbsoluteBytes - prevAbsoluteBytes;
        }

        // 3. Persist the new absolute value
        await redis.set('stats:bandwidth:last_absolute_bytes', currentAbsoluteBytes);

        // 4. Update Daily and Monthly aggregations using atomic INCRBY
        const now = new Date();
        const yearMonth = now.toISOString().substring(0, 7); // YYYY-MM
        const yearMonthDay = now.toISOString().substring(0, 10); // YYYY-MM-DD

        const monthKey = `stats:bandwidth:${yearMonth}:total`;
        const dayKey = `stats:bandwidth:${yearMonthDay}:total`;

        if (deltaBytes > 0) {
            const pipeline = redis.pipeline();
            pipeline.incrby(monthKey, deltaBytes);
            pipeline.incrby(dayKey, deltaBytes);
            
            // Set TTLs to auto-cleanup old data (keep daily for 60 days, monthly for 365 days)
            pipeline.expire(dayKey, 60 * 24 * 60 * 60);
            pipeline.expire(monthKey, 365 * 24 * 60 * 60);
            
            await pipeline.exec();
        }

        return res.status(200).json({
            success: true,
            snapshot: {
                currentAbsoluteBytes,
                deltaBytes,
                monthKey,
                dayKey
            }
        });

    } catch (error) {
        console.error('❌ Bandwidth Tracker Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
