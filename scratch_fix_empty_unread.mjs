import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

async function run() {
    console.log('Buscando candidatos no leídos sin mensajes...\n');

    // Get all unread candidate IDs from the Set
    const unreadIds = await redis.smembers('candidates:unread');
    console.log(`candidates:unread tiene ${unreadIds.length} IDs\n`);

    let fixed = 0;
    let skipped = 0;

    for (const id of unreadIds) {
        // Check if messages key exists
        const msgCount = await redis.llen(`messages:${id}`);
        if (msgCount > 0) {
            skipped++;
            continue;
        }

        // No messages — fetch candidate and clear unread
        const raw = await redis.get(`candidate:${id}`);
        if (!raw) {
            // Candidate doesn't even exist, remove from set
            await redis.srem('candidates:unread', id);
            await redis.decr('stats:bot:unread_v2');
            console.log(`  [REMOVED] ${id} — candidato no existe`);
            fixed++;
            continue;
        }

        const c = JSON.parse(raw);
        const ut = c.lastUserMessageAt ? new Date(c.lastUserMessageAt).getTime() : 0;
        const ht = c.lastHumanMessageAt ? new Date(c.lastHumanMessageAt).getTime() : 0;

        if (ut > ht && c.lastUserMessageAt) {
            // Clear unread: set lastHumanMessageAt = lastUserMessageAt
            c.lastHumanMessageAt = c.lastUserMessageAt;
            await redis.set(`candidate:${id}`, JSON.stringify(c));
            await redis.srem('candidates:unread', id);
            await redis.decr('stats:bot:unread_v2');
            console.log(`  [FIXED] ${id} (${c.nombre || c.whatsapp}) — sin mensajes, burbuja quitada`);
            fixed++;
        } else {
            skipped++;
        }
    }

    // Ensure counter doesn't go negative
    const counter = parseInt(await redis.get('stats:bot:unread_v2')) || 0;
    if (counter < 0) {
        await redis.set('stats:bot:unread_v2', 0);
        console.log('\n[FIX] Contador era negativo, reseteado a 0');
    }

    console.log(`\nListo: ${fixed} burbujas quitadas, ${skipped} candidatos con mensajes reales (sin cambios)`);
    redis.disconnect();
}
run().catch(console.error);
