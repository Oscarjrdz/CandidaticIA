import fs from 'fs';
import { Redis } from 'ioredis';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const kvUrlMatch = envFile.match(/KV_URL="([^"]+)"/);
if (!kvUrlMatch) {
    console.log("No KV_URL in .env.local");
    process.exit(1);
}

const redis = new Redis(kvUrlMatch[1]);

async function run() {
    console.log("--- BYPASS RULES ---");
    const bypassIds = await redis.zrange('bypass:list', 0, -1);
    if(bypassIds.length) {
        const rules = await redis.mget(bypassIds.map(id => `bypass:${id}`));
        console.log(JSON.stringify(rules.map(r => JSON.parse(r)), null, 2));
    } else {
        console.log("No bypass rules");
    }

    console.log("\n--- BYPASS TRACES ---");
    const traces = await redis.lrange('debug:bypass:traces', 0, 5);
    console.log(JSON.stringify(traces.map(t => JSON.parse(t)), null, 2));
    
    process.exit(0);
}
run().catch(console.error);
