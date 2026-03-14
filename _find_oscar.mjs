import { createClient } from 'redis';

const envUrl = process.env.REDIS_URL || process.env.KV_URL;
const client = createClient({ url: envUrl });
await client.connect();

const phone = '8116038195';
const variants = [
    `messages:521${phone}`,
    `messages:52${phone}`,
    `messages:${phone}`,
    `messages:521${phone}@c.us`,
    `messages:52${phone}@c.us`,
];

for (const key of variants) {
    const count = await client.lLen(key).catch(() => 0);
    if (count > 0) {
        console.log(`\n✅ Found key: ${key} (${count} messages)`);
        const msgs = await client.lRange(key, -30, -1);
        for (const raw of msgs) {
            try {
                const m = JSON.parse(raw);
                const c = String(m.content || '');
                if (m.from === 'user') {
                    console.log(`  [${m.timestamp}] from:${m.from} | ${c.substring(0, 200)}`);
                }
            } catch(e) {}
        }
    } else {
        console.log(`No data: ${key}`);
    }
}

await client.disconnect();
