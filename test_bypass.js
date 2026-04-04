import { getRedisClient, getActiveBypassRules } from './api/utils/storage.js';

async function run() {
    const rules = await getActiveBypassRules();
    console.log(JSON.stringify(rules, null, 2));
    const client = getRedisClient();
    if (client) {
        client.quit();
    }
}
run();
