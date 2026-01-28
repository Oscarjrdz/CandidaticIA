
import { getRedisClient } from './api/utils/storage.js';

async function diagnose() {
    const client = getRedisClient();
    if (!client) {
        console.log('No Redis client available');
        return;
    }

    const rules = await client.get('automation_rules');
    console.log('--- AUTOMATION RULES ---');
    console.log(rules);

    const cat = await client.get('candidatic_categories');
    console.log('--- CATEGORIES ---');
    console.log(cat);

    const logs = await client.lrange('debug:extraction_log', 0, 1);
    console.log('--- LAST EXTRACTION LOG ---');
    console.log(JSON.stringify(logs, null, 2));

    process.exit(0);
}

diagnose();
