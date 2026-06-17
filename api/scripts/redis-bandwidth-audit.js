/**
 * Redis Bandwidth Audit
 * GET /api/scripts/redis-bandwidth-audit
 *
 * Muestra exactamente qué comandos y qué keys están consumiendo más ancho de banda.
 */
import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV !== 'development') {
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

        // 2. Comandos más usados (cuáles generan más tráfico)
        const infoCmd = await redis.info('commandstats');
        const cmdLines = infoCmd.split('\n').filter(l => l.startsWith('cmdstat_'));
        const commands = cmdLines.map(line => {
            const name = line.split(':')[0].replace('cmdstat_', '');
            const calls = parseInt((line.match(/calls=(\d+)/) || [])[1] || 0);
            const usec  = parseInt((line.match(/usec=(\d+)/)  || [])[1] || 0);
            return { name, calls, usec_total: usec };
        }).sort((a, b) => b.calls - a.calls).slice(0, 20);

        // 3. Tamaño de keys sospechosas
        const pipeline = redis.pipeline();
        pipeline.memory_usage('presence:hash');
        pipeline.memory_usage('stats:list:complete');
        pipeline.memory_usage('stats:list:pending');
        pipeline.memory_usage('candidates:list');
        pipeline.scard('stats:list:complete');
        pipeline.scard('stats:list:pending');
        const memResults = await pipeline.exec();

        const keySizes = {
            'presence:hash':        memResults[0][1],
            'stats:list:complete':  memResults[1][1],
            'stats:list:pending':   memResults[2][1],
            'candidates:list':      memResults[3][1],
            'total_candidates': (memResults[4][1] || 0) + (memResults[5][1] || 0),
        };

        // 4. Cuántas image: keys hay y cuánto pesan
        let imageScanResult = { count: 0, totalBytes: 0, sampleKeys: [] };
        try {
            let cursor = 0;
            let imageKeys = [];
            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'image:*', 'COUNT', 100);
                cursor = parseInt(nextCursor);
                imageKeys = imageKeys.concat(keys);
                if (imageKeys.length > 500) break; // safety cap
            } while (cursor !== 0);

            imageScanResult.count = imageKeys.length;
            imageScanResult.sampleKeys = imageKeys.slice(0, 5);

            if (imageKeys.length > 0) {
                const memPipe = redis.pipeline();
                imageKeys.slice(0, 50).forEach(k => memPipe.memory_usage(k));
                const memRes = await memPipe.exec();
                imageScanResult.totalBytes = memRes.reduce((sum, [, v]) => sum + (v || 0), 0);
                imageScanResult.estimatedTotalMB = imageKeys.length > 50
                    ? ((imageScanResult.totalBytes / 50) * imageKeys.length / 1024 / 1024).toFixed(1)
                    : (imageScanResult.totalBytes / 1024 / 1024).toFixed(1);
            }
        } catch (e) {
            imageScanResult.error = e.message;
        }

        // 5. Resumen legible
        const toMB = (b) => b ? (b / 1024 / 1024).toFixed(2) + ' MB' : 'N/A';
        const toGB = (b) => b ? (b / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'N/A';

        return res.status(200).json({
            summary: {
                total_input:  toGB(inputBytes),
                total_output: toGB(outputBytes),
                total_bandwidth: toGB(inputBytes + outputBytes),
                total_commands: totalCmds.toLocaleString(),
            },
            top_commands_by_calls: commands,
            key_sizes: {
                'presence:hash':       toMB(keySizes['presence:hash']),
                'stats:list:complete': toMB(keySizes['stats:list:complete']),
                'stats:list:pending':  toMB(keySizes['stats:list:pending']),
                'candidates:list':     toMB(keySizes['candidates:list']),
                total_candidates:      keySizes['total_candidates'],
            },
            image_keys_in_redis: {
                count:             imageScanResult.count,
                estimated_size_mb: imageScanResult.estimatedTotalMB || '0',
                sample_keys:       imageScanResult.sampleKeys,
                warning: imageScanResult.count > 0
                    ? `⚠️ Hay ${imageScanResult.count} imágenes en base64 en Redis (~${imageScanResult.estimatedTotalMB} MB almacenados, multiply por reads diarios para el ancho de banda real)`
                    : 'Sin imágenes almacenadas en Redis'
            },
            recommendations: [
                inputBytes + outputBytes > 5 * 1024 * 1024 * 1024
                    ? '🔴 CRÍTICO: Más de 5 GB consumidos. Revisar imágenes en Redis y lecturas masivas de candidatos.'
                    : '🟢 Consumo dentro de parámetros normales.',
                imageScanResult.count > 10
                    ? `🔴 ${imageScanResult.count} imágenes en base64 en Redis. Migrar a CDN/Vercel Blob urgente.`
                    : null,
            ].filter(Boolean)
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
