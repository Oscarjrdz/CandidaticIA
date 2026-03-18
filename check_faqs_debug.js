import { getRedisClient } from './api/utils/storage.js';
import dotenv from 'dotenv';
import path from 'path';

// Load local environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.prod.local') });

async function run() {
    console.log("Using REDIS_URL:", process.env.REDIS_URL ? "SET" : "NOT SET");
    const client = getRedisClient();
    if (!client) {
        console.error("No redis client");
        process.exit(1);
    }
    const keys = await client.keys('vacancy_faq:*');
    console.log(`Found ${keys.length} FAQ keys`);
    for (const key of keys) {
        const data = await client.get(key);
        const faqs = JSON.parse(data);
        console.log(`\n======================================`);
        console.log(`Key: ${key}`);
        faqs.forEach(f => {
            console.log(`- Topic: ${f.topic}`);
            console.log(`  Frequency: ${f.frequency}`);
            console.log(`  Original Qs: ${f.originalQuestions?.join(' | ')}`);
            console.log(`  Official Answer: ${f.officialAnswer}`);
            console.log(`  Media: ${f.mediaUrl}`);
            console.log(`--------------------------------------`);
        });
    }
    process.exit(0);
}
run();
