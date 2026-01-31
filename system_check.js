import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getRedisClient, getCandidates } from './api/utils/storage.js';

async function checkSystem() {
    const redis = getRedisClient();
    if (!redis) {
        console.log('❌ REDIS NOT CONFIGURED');
        process.exit(1);
    }

    const isEnabled = await redis.get('bot_proactive_enabled');
    const today = new Date().toISOString().split('T')[0];
    const todayKey = `ai:proactive:count:${today}`;
    const dailyCount = await redis.get(todayKey);

    console.log('--- SYSTEM STATUS ---');
    console.log(`- Switch Global: ${isEnabled === 'true' ? '✅ ON' : '❌ OFF'}`);
    console.log(`- Daily Count (${today}): ${dailyCount || 0}/100`);

    // Timezone check
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const mxTime = new Date(utc + (3600000 * -6));
    const nowHour = mxTime.getHours();
    console.log(`- Server Time (UTC): ${now.toISOString()}`);
    console.log(`- MX Time (Calc): ${mxTime.toISOString()} (Hour: ${nowHour})`);
    console.log(`- Window (7-23): ${nowHour >= 7 && nowHour < 23 ? '✅ OPEN' : '❌ CLOSED'}`);

    console.log('\n--- CANDIDATE ANALYSIS ---');
    const { candidates } = await getCandidates(500, 0);
    console.log(`- Scanning ${candidates.length} candidates...`);

    const incomplete = candidates.filter(c => !(c.nombreReal && c.municipio));
    console.log(`- Incomplete profiles found: ${incomplete.length}`);

    if (incomplete.length > 0) {
        const top5 = incomplete.slice(0, 5);
        for (const cand of top5) {
            const lastMsgAt = new Date(cand.lastUserMessageAt || cand.lastBotMessageAt || 0);
            const hoursInactive = (now - lastMsgAt) / (1000 * 60 * 60);
            console.log(`  > ${cand.nombre || cand.whatsapp}: Inactivo ${hoursInactive.toFixed(1)}h. Estatus: ${cand.nombreReal ? 'OK' : 'NoName'} ${cand.municipio ? 'OK' : 'NoMun'}`);

            if (hoursInactive >= 24) {
                let level = hoursInactive >= 72 ? 72 : (hoursInactive >= 48 ? 48 : 24);
                const sessionKey = `proactive:${cand.id}:${level}:${cand.lastUserMessageAt}`;
                const alreadySent = await redis.get(sessionKey);
                console.log(`    MATCH ${level}h - Sent previously: ${alreadySent ? 'YES' : 'NO'}`);
            }
        }
    }

    process.exit(0);
}

checkSystem().catch(console.error);
