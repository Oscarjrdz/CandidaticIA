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

    // Modo audit sin auth — solo stats agregadas, sin datos sensibles
    if (req.query.audit === 'true') {
        try {
            const redis = getRedisClient();
            if (!redis) return res.status(500).json({ error: 'Redis offline' });
            const [cmdInfo, complete, pending] = await Promise.all([
                redis.info('commandstats'),
                redis.scard('stats:list:complete'),
                redis.scard('stats:list:pending'),
            ]);
            const infoStats = await redis.info('stats');
            const parseInfo = (info, key) => {
                const line = info.split('\n').find(l => l.startsWith(key + ':'));
                return line ? parseInt(line.split(':')[1].trim(), 10) : 0;
            };
            const inputBytes  = parseInfo(infoStats, 'total_net_input_bytes');
            const outputBytes = parseInfo(infoStats, 'total_net_output_bytes');
            const cmdLines = cmdInfo.split('\n').filter(l => l.startsWith('cmdstat_'));
            const commands = cmdLines.map(line => {
                const name  = line.split(':')[0].replace('cmdstat_', '');
                const calls = parseInt((line.match(/calls=(\d+)/) || [])[1] || 0);
                return { name, calls };
            }).sort((a, b) => b.calls - a.calls).slice(0, 20);
            let imageCount = 0;
            let cur = '0';
            do {
                const [next, keys] = await redis.scan(cur, 'MATCH', 'image:*', 'COUNT', 200);
                cur = next; imageCount += keys.length;
            } while (cur !== '0' && imageCount < 2000);
            const toGB = b => (b / 1024 / 1024 / 1024).toFixed(3) + ' GB';
            return res.status(200).json({
                bandwidth: { input: toGB(inputBytes), output: toGB(outputBytes), total: toGB(inputBytes + outputBytes) },
                candidates: { complete, pending, total: complete + pending },
                image_keys_in_redis: imageCount,
                top_commands_by_calls: commands,
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
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
        // Use Monterrey time (America/Monterrey = UTC-6, no DST since 2023)
        const now = new Date();
        const mtyDate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Monterrey',
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(now); // YYYY-MM-DD
        const yearMonthDay = mtyDate;
        const yearMonth = mtyDate.substring(0, 7); // YYYY-MM

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

        // 5. Modo diagnóstico: ?audit=true devuelve commandstats + conteos (sin auth adicional — temporal)
        if (req.query.audit === 'true') {
            const [cmdInfo, complete, pending, imageCount] = await Promise.all([
                redis.info('commandstats'),
                redis.scard('stats:list:complete'),
                redis.scard('stats:list:pending'),
                (async () => {
                    let count = 0;
                    let cursor = '0';
                    do {
                        const [next, keys] = await redis.scan(cursor, 'MATCH', 'image:*', 'COUNT', 200);
                        cursor = next;
                        count += keys.length;
                    } while (cursor !== '0' && count < 2000);
                    return count;
                })(),
            ]);

            const cmdLines = cmdInfo.split('\n').filter(l => l.startsWith('cmdstat_'));
            const commands = cmdLines.map(line => {
                const name  = line.split(':')[0].replace('cmdstat_', '');
                const calls = parseInt((line.match(/calls=(\d+)/) || [])[1] || 0);
                return { name, calls };
            }).sort((a, b) => b.calls - a.calls).slice(0, 20);

            const toGB = b => (b / 1024 / 1024 / 1024).toFixed(3) + ' GB';
            return res.status(200).json({
                bandwidth: { input: toGB(inputBytes), output: toGB(outputBytes), total: toGB(currentAbsoluteBytes) },
                candidates: { complete, pending, total: complete + pending },
                image_keys_in_redis: imageCount,
                top_commands_by_calls: commands,
            });
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
