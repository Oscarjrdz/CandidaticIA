import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

async function run() {
    console.log('--- STARTING DIAGNOSTIC (STABLE REDIS) ---');
    const redis = new Redis(redisUrl);

    // 1. Check AI Config
    const aiConfigRaw = await redis.get('ai_config');
    console.log('\n--- AI CONFIG ---');
    if (aiConfigRaw) {
        try {
            const aiConfig = JSON.parse(aiConfigRaw);
            console.log(`OpenAI Key present: ${!!aiConfig.openaiApiKey}`);
            if (aiConfig.openaiApiKey) {
                console.log(`Key prefix: ${aiConfig.openaiApiKey.substring(0, 7)}...`);
            }
            console.log(`Model: ${aiConfig.openaiModel}`);
        } catch (e) {
            console.log('AI Config invalid JSON');
        }
    } else {
        console.log('ai_config KEY NOT FOUND');
    }

    // 2. Find Oscar
    const phoneIndex = await redis.hgetall('candidatic:phone_index');
    console.log('\n--- PHONE INDEX (First 10) ---');
    console.log(Object.entries(phoneIndex).slice(0, 10));

    const keys = await redis.keys('candidate:*');
    console.log(`\n--- CANDIDATES FOUND: ${keys.length} ---`);

    let oscar = null;
    for (const key of keys) {
        const data = await redis.get(key);
        if (data && data.toLowerCase().includes('oscar')) {
            oscar = JSON.parse(data);
            console.log(`\n--- FOUND OSCAR (${key}) ---`);
            console.log(JSON.stringify(oscar, null, 2));
            break;
        }
    }

    if (!oscar) {
        console.log('Oscar not found by search, listing first 3 candidates for context:');
        for (const key of keys.slice(0, 3)) {
            const data = await redis.get(key);
            console.log(key, data);
        }
    }

    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
