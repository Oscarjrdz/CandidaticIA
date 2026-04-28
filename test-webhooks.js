import { getRedisClient } from './api/utils/storage.js';

async function run() {
    const client = getRedisClient();
    const history = await client.lrange('debug:webhook_history', 0, -1);
    console.log(`Found ${history.length} payloads`);
    for (const h of history) {
        const item = JSON.parse(h);
        if (item.payload.entry && item.payload.entry[0].changes[0].value.messages) {
            const msg = item.payload.entry[0].changes[0].value.messages[0];
            console.log(`Message: from=${msg.from} text=${msg.text?.body} type=${msg.type} referral=${!!msg.referral}`);
        } else if (item.payload.entry && item.payload.entry[0].changes[0].value.statuses) {
            const status = item.payload.entry[0].changes[0].value.statuses[0];
            console.log(`Status: recipient=${status.recipient_id} status=${status.status} pricing=${status.pricing?.category}`);
        }
    }
    process.exit(0);
}
run();
