import Redis from 'ioredis';

const redis = new Redis('rediss://default:Ab3KAAIncDFjZTkzZjc5YjFiZGM0ODdhYWFlNmNmYmIwOWFmYTJkZXAxNDYzNzc@clever-shiner-46377.upstash.io:6379');

async function run() {
    console.log('--- STARTING DIAGNOSTIC ---');

    // 1. Check AI Config
    const aiConfigRaw = await redis.get('ai_config');
    console.log('\n--- AI CONFIG ---');
    if (aiConfigRaw) {
        try {
            const aiConfig = JSON.parse(aiConfigRaw);
            console.log(`OpenAI Key present: ${!!aiConfig.openaiApiKey}`);
            console.log(`Key length: ${aiConfig.openaiApiKey?.length}`);
            console.log(`Model: ${aiConfig.openaiModel}`);
        } catch (e) {
            console.log('AI Config invalid JSON');
        }
    } else {
        console.log('ai_config KEY NOT FOUND');
    }

    // 2. Find Oscar (or just candidates)
    const phoneIndex = await redis.hgetall('candidatic:phone_index');
    console.log('\n--- PHONE INDEX (First 5) ---');
    const indexEntries = Object.entries(phoneIndex).slice(0, 5);
    console.log(indexEntries);

    const keys = await redis.keys('candidate:*');
    console.log(`\n--- CANDIDATES FOUND: ${keys.length} ---`);

    for (const key of keys.slice(0, 10)) {
        const data = await redis.get(key);
        if (data && data.toLowerCase().includes('oscar')) {
            console.log(`\n--- FOUND OSCAR (${key}) ---`);
            console.log(JSON.stringify(JSON.parse(data), null, 2));
            break;
        }
    }

    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
