import { getRedisClient, getCandidateByPhone } from './utils/storage.js';

async function main() {
    const redis = getRedisClient();
    if (!redis) { console.log("No redis"); return; }

    const phone = '8116038195';
    console.log(`Searching for candidate with phone: ${phone}...`);
    const cand = await getCandidateByPhone(phone);

    if (cand) {
        console.log(`Found Candidate ID: ${cand.id}`);
        // Delete candidate from candidates hash/list
        await redis.del(`candidate:${cand.id}`);
        await redis.zrem('candidates:list', cand.id);

        // Delete indices
        await redis.hdel('candidatic:phone_index', phone.replace(/\D/g, ''));
        const cleanPhone = phone.replace(/\D/g, '');
        const last10 = cleanPhone.slice(-10);
        await redis.hdel('candidatic:phone_index', last10);
        await redis.hdel('candidatic:phone_index', '52' + last10);
        await redis.hdel('candidatic:phone_index', '521' + last10);

        // Stats
        await redis.srem('stats:list:complete', cand.id);
        await redis.srem('stats:list:pending', cand.id);

        // Messages
        await redis.del(`messages:${cand.id}`);

        console.log(`✅ Candidate deleted completely.`);
    } else {
        console.log(`❌ No candidate found for phone ${phone}`);
    }

    process.exit(0);
}
main();
