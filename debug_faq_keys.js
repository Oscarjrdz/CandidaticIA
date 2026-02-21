import { getRedisClient } from './api/utils/storage.js';

async function debug() {
    const client = getRedisClient();
    if (!client) {
        console.error("❌ No Redis client");
        process.exit(1);
    }

    console.log("🔍 Scanning for FAQ keys...");
    const keys = await client.keys('vacancy_faq:*');
    console.log(`Found ${keys.length} FAQ keys:`, keys);

    for (const key of keys) {
        const data = await client.get(key);
        console.log(`\n--- Key: ${key} ---`);
        console.log(data);
    }

    console.log("\n🔍 Checking for Gemini API Key in Env...");
    console.log("GEMINI_API_KEY present:", !!process.env.GEMINI_API_KEY);

    process.exit(0);
}

debug();
