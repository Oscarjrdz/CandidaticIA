import { getRedisClient } from './api/utils/storage.js';

async function diagnose() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('No Redis client');
        process.exit(1);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const todayCount = await redis.get(`ai:proactive:count:${todayStr}`) || '0';
    console.log(`Today's Counter (${todayStr}): ${todayCount}`);

    const keys = await redis.keys('proactive:*');
    console.log(`Found ${keys.length} proactive session keys.`);

    let oldSent = 0;
    let newSent = 0;
    let unknownFormat = 0;

    for (const key of keys.slice(0, 100)) { // Check a sample
        const val = await redis.get(key);
        if (val === 'sent') {
            unknownFormat++;
        } else if (val.startsWith(todayStr)) {
            newSent++;
        } else {
            oldSent++;
        }
    }

    console.log(`Sample Stats (first 100):`);
    console.log(`- Unknown ('sent'): ${unknownFormat}`);
    console.log(`- Sent Today: ${newSent}`);
    console.log(`- Sent Other Days: ${oldSent}`);

    console.log('\n--- MASTER TOGGLES ---');
    console.log('bot_ia_active:', await redis.get('bot_ia_active'));
    console.log('bot_proactive_enabled:', await redis.get('bot_proactive_enabled'));

    process.exit(0);
}

diagnose();
