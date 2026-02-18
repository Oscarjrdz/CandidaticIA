
import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = fs.readFileSync(envPath, 'utf8');
const env = {};
envConfig.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
});

const redis = new Redis(env.REDIS_URL);

async function run() {
    console.log('--- BYPASS DIAGNOSTIC ---');

    // 1. Get Bypass Rules
    const bypassIds = await redis.zrange('bypass:list', 0, -1);
    console.log(`Found ${bypassIds.length} rules.`);
    if (bypassIds.length > 0) {
        const rulesRaw = await redis.mget(bypassIds.map(id => 'bypass:' + id));
        rulesRaw.forEach((raw, i) => {
            if (raw) {
                const r = JSON.parse(raw);
                console.log(`Rule: ${r.name} (Active: ${r.active}) -> Project: ${r.projectId}`);
                console.log(`  Criteria: ${JSON.stringify({
                    mun: r.municipios,
                    esc: r.escolaridades,
                    cat: r.categories,
                    age: [r.minAge, r.maxAge]
                })}`);
            }
        });
    }

    // 2. Get Last Candidates
    const keys = await redis.keys('candidate:*');
    const lastKeys = keys.sort().slice(-3); // Get last 3
    for (const key of lastKeys) {
        const data = await redis.get(key);
        if (data) {
            const c = JSON.parse(data);
            console.log(`\nCandidate: ${c.id} (${c.nombreReal || c.nombre})`);
            console.log(`  Project: ${c.projectId || 'NONE'}`);
            console.log(`  Complete: ${c.isComplete}`);
            console.log(`  Data: ${JSON.stringify({
                edad: c.edad,
                mun: c.municipio,
                esc: c.escolaridad,
                cat: c.categoria
            })}`);
        }
    }

    // 3. Check Batch Config
    const batchConfig = await redis.get('batch_config');
    console.log('\nBatch Config:', batchConfig);

    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
