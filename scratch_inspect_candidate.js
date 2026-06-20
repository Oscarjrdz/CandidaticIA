import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function run() {
    try {
        console.log('Scanning for a candidate key...');
        const result = await redis.scan('0', 'MATCH', 'candidate:*', 'COUNT', 10);
        const keys = result[1];
        if (keys.length === 0) {
            console.log('No candidate keys found!');
        } else {
            const sampleKey = keys[0];
            const raw = await redis.get(sampleKey);
            const cand = JSON.parse(raw);
            console.log(`Sample key: ${sampleKey}`);
            console.log(`Raw size: ${raw.length} characters`);
            console.log('Keys in candidate object:', Object.keys(cand));
            
            // Print fields and check if any fields have huge content
            for (const [k, v] of Object.entries(cand)) {
                const type = typeof v;
                const length = type === 'string' ? v.length : (type === 'object' && v ? JSON.stringify(v).length : 0);
                if (length > 100) {
                    console.log(`  - ${k} (${type}): length ${length} (starts with: ${JSON.stringify(v).slice(0, 100)}...)`);
                } else {
                    console.log(`  - ${k} (${type}): ${JSON.stringify(v)}`);
                }
            }
        }
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
run();
