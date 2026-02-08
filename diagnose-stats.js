import { getRedisClient, isProfileComplete } from './api/utils/storage.js';

async function diagnose() {
    const redis = getRedisClient();
    console.log('--- Redis Diagnostic ---');

    const allIds = await redis.zrevrange('candidates:list', 0, -1);
    console.log(`Total IDs in candidates:list: ${allIds.length}`);

    if (allIds.length > 0) {
        const sampleId = allIds[0];
        const raw = await redis.get(`candidate:${sampleId}`);
        const c = JSON.parse(raw);
        console.log('Sample Candidate:', JSON.stringify(c, null, 2));

        const lastInteraction = new Date(c.ultimoMensaje || c.primerContacto || c.createdAt || 0);
        console.log('Last Interaction Date:', lastInteraction.toISOString());

        const now = new Date();
        const todayStart = new Date(now.getTime());
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now.getTime());
        todayEnd.setHours(23, 59, 59, 999);

        console.log('Today Range:', todayStart.toISOString(), 'to', todayEnd.toISOString());

        const hours = [24, 48, 72, 168];
        hours.forEach(h => {
            const dueTime = new Date(lastInteraction.getTime() + (h * 60 * 60 * 1000));
            console.log(`Level ${h}h Due Time:`, dueTime.toISOString(), `In range? ${dueTime >= todayStart && dueTime <= todayEnd}`);
        });
    }

    const inactiveStagesJson = await redis.get('bot_inactive_stages');
    console.log('Inactive Stages Config:', inactiveStagesJson);
}

diagnose();
