
import fs from 'fs';
import path from 'path';

// Manual env loading BEFORE any other imports
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value.length > 0) {
            process.env[key.trim()] = value.join('=').trim().replace(/^"(.*)"$/, '$1');
        }
    });
    console.log('✅ Environment variables loaded from .env.local');
}

const { getRedisClient, getCandidateIdByPhone, getCandidateById, isCandidateLocked, getWaitlist } = await import('./api/utils/storage.js');

async function diagnose() {
    const phone = '5218146042532';
    console.log(`\n--- 🕵️‍♂️ DIAGNOSING CANDIDATE: ${phone} ---`);

    const redis = getRedisClient();
    if (!redis) {
        console.error('❌ Redis client not available');
        return;
    }

    try {
        // 1. Get Candidate ID
        const candidateId = await getCandidateIdByPhone(phone);
        if (!candidateId) {
            console.warn('❌ Candidate ID not found for this phone.');
            return;
        }
        console.log(`✅ Candidate ID: ${candidateId}`);

        // 2. Load Candidate Data
        const candidate = await getCandidateById(candidateId);
        if (!candidate) {
            console.warn('❌ Candidate data is null or ghost.');
        } else {
            console.log(`✅ Name: ${candidate.nombreReal || candidate.nombre}`);
            console.log(`✅ Blocked: ${candidate.blocked === true ? '🔴 YES' : '🟢 NO'}`);
            console.log(`✅ Last Active: ${candidate.lastUserMessageAt}`);
            console.log(`✅ Webhook Safety (Unread): ${candidate.unread}`);
        }

        // 3. Check Lock Status
        const locked = await isCandidateLocked(candidateId);
        console.log(`✅ Locked: ${locked ? '🔴 LOCKED' : '🟢 FREE'}`);

        // 4. Check Waitlist
        const waitlist = await getWaitlist(candidateId);
        console.log(`✅ Waitlist Packets: ${waitlist.length}`);
        if (waitlist.length > 0) {
            console.log('📦 Pending messages:', waitlist);
        }

        // 5. Check if Bot is active globally
        const botActive = await redis.get('bot_ia_active');
        console.log(`✅ Global Bot Active: ${botActive !== 'false' ? '🟢 YES' : '🔴 NO'}`);

        // 6. Check for collisions/duplicates
        const lastMsgId = await redis.get(`last_msg:${candidateId}`);
        console.log(`✅ Last Processed Msg ID: ${lastMsgId}`);

    } catch (e) {
        console.error('❌ Error during diagnosis:', e);
    } finally {
        process.exit(0);
    }
}

diagnose();
