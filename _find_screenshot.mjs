import { createClient } from 'redis';

const envUrl = process.env.REDIS_URL || process.env.KV_URL;
if (!envUrl) { console.log('No Redis URL in env'); process.exit(1); }

const client = createClient({ url: envUrl });
await client.connect();

const candidateKeys = await client.keys('messages:*');
console.log('Total candidate keys:', candidateKeys.length);

const cutoff = Date.now() - (8 * 60 * 60 * 1000); // last 8 hours
let found = 0;

for (const key of candidateKeys) {
    const msgs = await client.lRange(key, -50, -1).catch(() => []);
    for (const raw of msgs) {
        try {
            const m = JSON.parse(raw);
            const ts = new Date(m.timestamp).getTime();
            if (ts < cutoff) continue;
            const c = String(m.content || '');
            // Look for incoming images from user
            if (m.from === 'user' && c.includes('http')) {
                console.log('\nKEY:', key);
                console.log('from:', m.from, '| ts:', m.timestamp);
                console.log('content:', c.substring(0, 400));
                found++;
            }
        } catch(e) {}
    }
}

console.log('\nTotal found:', found);
await client.disconnect();
