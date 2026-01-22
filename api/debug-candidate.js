import { getRedisClient, getCandidates } from './utils/storage.js';

async function debug() {
    console.log('🔍 Connecting to Redis...');
    const redis = getRedisClient();

    console.log('📋 Fetching 5 candidates...');
    const candidates = await getCandidates(5);

    if (candidates.length === 0) {
        console.log('❌ No candidates found.');
        process.exit(0);
    }

    candidates.forEach((c, idx) => {
        console.log(`\n--- Candidate ${idx + 1} ---`);
        console.log(`ID: ${c.id}`);
        console.log(`WhatsApp: ${c.whatsapp}`);
        console.log(`Keys:`, Object.keys(c));
        console.log(`Data:`, JSON.stringify(c, null, 2));
    });

    console.log('\n✅ Debug finished.');
    process.exit(0);
}

debug();
