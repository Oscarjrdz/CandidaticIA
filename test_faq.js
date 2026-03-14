import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const client = getRedisClient();
    try {
        const keys = await client.keys('*faq*');
        console.log("Keys found:", keys);
        for (const key of keys) {
            const data = await client.get(key);
            console.log(`\n--- FAQ Data for ${key} ---`);
            try {
                const faqs = JSON.parse(data);
                for (const faq of faqs) {
                    console.log(`Topic: ${faq.topic}`);
                    console.log(`Questions: ${(faq.originalQuestions || []).join(', ')}`);
                    console.log(`Official Answer: ${faq.officialAnswer || 'NONE'}`);
                    console.log(`Media URL: ${faq.mediaUrl || 'NONE'}`);
                    console.log(`-----------------------------`);
                }
            } catch(e) { console.log(data); }
        }
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}

run();
