/**
 * Redis Bandwidth Audit
 * GET /api/scripts/redis-bandwidth-audit
 */
import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis offline' });

    try {
        // 1. Estadísticas generales de red
        const infoStats = await redis.info('stats');
        const parseInfo = (info, key) => {
            const line = info.split('\n').find(l => l.startsWith(key + ':'));
            return line ? parseInt(line.split(':')[1].trim(), 10) : 0;
        };
        const inputBytes  = parseInfo(infoStats, 'total_net_input_bytes');
        const outputBytes = parseInfo(infoStats, 'total_net_output_bytes');
        const totalCmds   = parseInfo(infoStats, 'total_commands_processed');

        // 2. Comandos más usados
        const infoCmd = await redis.info('commandstats');
        const cmdLines = infoCmd.split('\n').filter(l => l.startsWith('cmdstat_'));
        const commands = cmdLines.map(line => {
            const name  = line.split(':')[0].replace('cmdstat_', '');
            const calls = parseInt((line.match(/calls=(\d+)/) || [])[1] || 0);
            const usec  = parseInt((line.match(/usec=(\d+)/)  || [])[1] || 0);
            return { name, calls, usec_total: usec };
        }).sort((a, b) => b.calls - a.calls).slice(0, 20);

        // 3. Conteo de candidatos y keys base
        const [complete, pending] = await Promise.all([
            redis.scard('stats:list:complete'),
            redis.scard('stats:list:pending'),
        ]);

        // 4. Cuántas image: keys hay (escaneo ligero)
        let imageCount = 0;
        let imageSampleKeys = [];
        try {
            let cursor = '0';
            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'image:*', 'COUNT', 200);
                cursor = nextCursor;
                imageCount += keys.length;
                if (imageSampleKeys.length < 5) imageSampleKeys.push(...keys.slice(0, 5 - imageSampleKeys.length));
            } while (cursor !== '0' && imageCount < 1000);
        } catch (e) { /* skip */ }

        // 5. Tamaño aproximado de mensajes (sample de 10 candidatos)
        let avgMessageBytes = 0;
        try {
            const sampleIds = await redis.zrevrange('candidates:list', 0, 9);
            if (sampleIds.length > 0) {
                const sizes = await Promise.all(
                    sampleIds.map(id => redis.llen(`messages:${id}`))
                );
                const totalMsgs = sizes.reduce((a, b) => a + b, 0);
                avgMessageBytes = Math.round((totalMsgs / sampleIds.length) * 500); // ~500 bytes por mensaje
            }
        } catch (e) { /* skip */ }

        const toGB = (b) => b ? (b / 1024 / 1024 / 1024).toFixed(3) + ' GB' : 'N/A';

        return res.status(200).json({
            summary: {
                total_input:     toGB(inputBytes),
                total_output:    toGB(outputBytes),
                total_bandwidth: toGB(inputBytes + outputBytes),
                total_commands:  totalCmds,
            },
            candidates: {
                complete,
                pending,
                total: complete + pending,
            },
            top_commands_by_calls: commands,
            image_keys_in_redis: {
                count: imageCount,
                sample_keys: imageSampleKeys,
                warning: imageCount > 10
                    ? `⚠️ ${imageCount} imágenes en base64 en Redis. Cada lectura transfiere datos masivos.`
                    : 'OK — pocas imágenes en Redis',
            },
            messages_estimate: {
                avg_messages_per_candidate: Math.round(avgMessageBytes / 500),
                avg_bytes_per_candidate: avgMessageBytes,
                estimated_full_read_mb: ((complete + pending) * avgMessageBytes / 1024 / 1024).toFixed(1) + ' MB',
            },
        });

    } catch (e) {
        return res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0, 5) });
    }
}
