import { Redis } from '@upstash/redis';
import { getCandidates } from './api/utils/storage.js';
import dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function diagnose() {
    console.log('--- 🕵️‍♀️ BRENDA DIAGNOSTIC ---');

    // 1. Check Bot Status
    const isActive = await redis.get('bot_ia_active');
    console.log(`Bot IA Active: ${isActive}`);

    // 2. Check Daily Limit
    const today = new Date().toISOString().split('T')[0];
    const todayKey = `ai:proactive:sent:${today}`;
    const sentToday = await redis.get(todayKey) || 0;
    console.log(`Sent today (${today}): ${sentToday} / 200`);

    // 3. Inspect Candidate Pool
    const candidates = await getCandidates();
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
                ready.push({ name: cand.nombre, hoursInactive, targetLevel });
            }
        }
    }

    console.log(`Candidates Ready for Follow-up: ${ready.length}`);
    if (ready.length > 0) {
        console.log('First 5 ready:');
        console.table(ready.slice(0, 5));
    }

    // 4. Check Current Hour (CDMX is roughly UTC-6)
    const hour = new Date().getUTCHours() - 6;
    console.log(`Current CDMX Hour (approx): ${hour}:00`);
    if (hour < 7 || hour >= 23) {
        console.log('⚠️ OUTSIDE OPERATIONAL WINDOW (07:00 - 23:00)');
    }

    process.exit(0);
}

diagnose().catch(err => {
    console.error(err);
    process.exit(1);
});
