import { getRedisClient, getCandidates } from './api/utils/storage.js';

async function diagnose() {
    console.log('--- 🕵️‍♀️ BRENDA DIAGNOSTIC V2 ---');
    const redis = getRedisClient();
    if (!redis) {
        console.error('❌ Redis client not available.');
        process.exit(1);
    }

    // 1. Check Bot Status
    const isActive = await redis.get('bot_ia_active');
    console.log(`Bot IA Active: ${isActive}`);

    // 2. Check Daily Limit
    const today = new Date().toISOString().split('T')[0];
    const todayKey = `ai:proactive:sent:${today}`;
    const sentToday = await redis.get(todayKey) || 0;
    console.log(`Sent today (${today}): ${sentToday} / 200`);

    // 3. Inspect Candidate Pool
    const { candidates } = await getCandidates(1000);
    const incomplete = candidates.filter(c => !c.perfil_completo && !c.perfil_validado);
    console.log(`Total Incomplete Candidates: ${incomplete.length}`);

    const now = Date.now();
    const ready = [];

    for (const cand of incomplete) {
        if (cand.proactive_opt_out) continue;

        const tUser = new Date(cand.lastUserMessageAt || 0).getTime();
        const tBot = new Date(cand.lastBotMessageAt || 0).getTime();
        const lastMsgAt = new Date(Math.max(tUser, tBot));
        const hoursInactive = (now - lastMsgAt) / (1000 * 60 * 60);

        let targetLevel = 0;
        if (hoursInactive >= 168) targetLevel = 168;
        else if (hoursInactive >= 72) targetLevel = 72;
        else if (hoursInactive >= 48) targetLevel = 48;
        else if (hoursInactive >= 24) targetLevel = 24;

        if (targetLevel > 0) {
            const sessionKey = `proactive:sent:${cand.id}:${targetLevel}:${today}`;
            const sent = await redis.get(sessionKey);
            if (!sent) {
                ready.push({ name: cand.nombre, hoursInactive: hoursInactive.toFixed(1), targetLevel });
            }
        }
    }

    console.log(`Candidates Ready for Follow-up (Wait Time Reached): ${ready.length}`);
    if (ready.length > 0) {
        console.log('First 10 candidates pending:');
        console.table(ready.slice(0, 10));
    } else {
        console.log('No candidates meet the 24h+ inactivity criteria for today yet.');
    }

    process.exit(0);
}

diagnose().catch(err => {
    console.error(err);
    process.exit(1);
});
