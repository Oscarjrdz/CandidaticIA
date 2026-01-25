
import Redis from 'ioredis';

export default async function handler(req, res) {
    let client;
    const log = [];
    try {
        if (!process.env.REDIS_URL) {
            return res.json({ error: 'No REDIS_URL' });
        }

        client = new Redis(process.env.REDIS_URL, {
            tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
        });

        // 1. Scan for all candidate keys
        const keys = await client.keys('candidate:*');
        log.push(`Found ${keys.length} candidate keys total.`);

        let restored = 0;
        let deleted = 0;
        let skipped = 0;

        for (const key of keys) {
            // Check for known corrupt pattern
            if (key.includes(':phone:')) {
                await client.del(key);
                log.push(`🗑️ Deleted corrupt key: ${key}`);
                deleted++;
                continue;
            }

            const data = await client.get(key);
            if (!data) continue;

            try {
                const c = JSON.parse(data);
                if (c.id && c.whatsapp) {
                    // It's a valid candidate
                    // Ensure it is in the ZSET
                    const score = new Date(c.ultimoMensaje || Date.now()).getTime();
                    await client.zadd('candidates:list', score, c.id);
                    restored++;
                    // log.push(`✅ Restored index for: ${c.nombre} (${c.id})`);
                } else {
                    log.push(`⚠️ Invalid JSON structure for ${key}, skipping.`);
                    skipped++;
                }
            } catch (e) {
                // If JSON parse fails, it's corrupt
                log.push(`❌ JSON Parse Error for ${key}: ${e.message}. Deleting.`);
                await client.del(key);
                deleted++;
            }
        }

        const stats = await client.zcard('candidates:list');
        log.push(`🏁 Final ZSET count: ${stats}`);

        await client.quit();

        return res.json({
            status: 'success',
            restored,
            deleted,
            skipped,
            log
        });

    } catch (error) {
        if (client) client.quit();
        return res.status(500).json({ error: error.message, stack: error.stack });
    }
}
