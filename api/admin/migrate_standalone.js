
import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';

// 1. Manually Load Env
const loadEnv = () => {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
            console.log('📄 Found .env.local');
            const envConfig = fs.readFileSync(envPath, 'utf8');
            envConfig.split('\n').forEach(line => {
                const [key, val] = line.split('=');
                if (key && val) {
                    process.env[key.trim()] = val.trim();
                }
            });
            // Polyfill
            if (!process.env.REDIS_URL) {
                if (process.env.UPSTASH_REDIS_REST_URL) {
                    process.env.REDIS_URL = process.env.UPSTASH_REDIS_REST_URL.replace('https://', 'rediss://');
                }
                if (process.env.KV_REST_API_URL) {
                    // Start with basic URL
                    // Vercel KV usually needs special handling or @vercel/kv, but ioredis might work if we format it right
                    // or maybe we just try to find the key that HAS the redis:// string.
                    // Let's print keys to debug if we fail again.
                }
            }
        }
    } catch (e) {
        console.error('Error loading env:', e);
    }
};

loadEnv();

console.log('🔑 REDIS_URL present:', !!process.env.REDIS_URL);
if (!process.env.REDIS_URL) {
    console.error('❌ NO REDIS_URL FOUND. Cannot proceed.');
    process.exit(1);
}

// 2. Init Client
const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
});

redis.on('error', (err) => console.error('❌ Redis Connection Error:', err));

async function migrate() {
    console.log('🚀 CONNECTING TO REDIS...');

    // Test connection
    try {
        await redis.ping();
        console.log('✅ Connected to Redis.');
    } catch (e) {
        console.error('❌ Connection failed:', e);
        process.exit(1);
    }

    try {
        // Fetch Projects manually
        const projectKeys = await redis.keys('candidatic:project:*');
        console.log(`📋 Found ${projectKeys.length} projects.`);

        for (const pKey of projectKeys) {
            const pData = await redis.get(pKey);
            if (!pData) continue;
            const p = JSON.parse(pData);
            console.log(`\n🔹 Processing: "${p.name}" (${p.id})`);

            if (!p.steps || p.steps.length === 0) {
                console.log('   ⚠️ No steps. Creating default...');
                p.steps = [{ id: 'step_default', name: 'Inicio', locked: true }];
                await redis.set(pKey, JSON.stringify(p));
                continue;
            }

            // Check if already migrated
            const hasDefault = p.steps.some(s => s.id === 'step_default');
            if (hasDefault) {
                console.log('   ✅ Already migrated.');
                const defStep = p.steps.find(s => s.id === 'step_default');
                if (!defStep.locked) {
                    defStep.locked = true;
                    await redis.set(pKey, JSON.stringify(p));
                    console.log('   🔒 Locked step_default.');
                }
                continue;
            }

            // DO MIGRATION
            const firstStep = p.steps[0];
            const oldId = firstStep.id;
            console.log(`   🔄 Renaming first step "${firstStep.name}" (${oldId}) -> "step_default"`);

            firstStep.id = 'step_default';
            firstStep.locked = true;

            // Save Project
            await redis.set(pKey, JSON.stringify(p));

            // MIGRATE CANDIDATES (Manual Scan)
            // Ideally use index if available, but scan is safer here
            let moved = 0;
            const candKeys = await redis.keys('candidatic:candidate:*');
            for (const cKey of candKeys) {
                const cData = await redis.get(cKey);
                if (!cData) continue;
                try {
                    const c = JSON.parse(cData);
                    let changed = false;

                    if (c.projectId === p.id && c.stepId === oldId) {
                        c.stepId = 'step_default';
                        changed = true;
                    }
                    if (c.projectId === p.id && c.projectMetadata?.stepId === oldId) {
                        c.projectMetadata.stepId = 'step_default';
                        changed = true;
                    }

                    if (changed) {
                        await redis.set(cKey, JSON.stringify(c));
                        moved++;
                    }
                } catch (e) { }
            }
            console.log(`   📦 Moved ${moved} candidates.`);
        }

    } catch (e) {
        console.error('Fatal Error:', e);
    } finally {
        redis.disconnect();
    }
}

migrate();
