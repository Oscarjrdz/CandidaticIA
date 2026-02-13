
import { getRedisClient, getProjects, updateProjectSteps } from '../utils/storage.js';
import fs from 'fs';
import path from 'path';

// Force load envs
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const [key, val] = line.split('=');
            if (key && val) {
                process.env[key.trim()] = val.trim();
            }
        });

        // Polyfill REDIS_URL if missing but others present
        if (!process.env.REDIS_URL) {
            if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
                console.log('Using Vercel KV credentials...');
                // The storage.js utility handles this internally usually, but let's confirm envs are set
            } else if (process.env.UPSTASH_REDIS_REST_URL) {
                process.env.REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
            }
        }

        console.log('✅ Loaded .env.local');
    } else {
        console.log('⚠️ .env.local not found');
    }
} catch (e) {
    console.error('Error loading env:', e);
}

async function migrateDefaultSteps() {
    console.log('--- 🛡️ STARTING MIGRATION: IMMUTABLE DEFAULT STEPS ---');
    const client = getRedisClient();
    if (!client) {
        console.error('❌ Redis client not initialized.');
        process.exit(1);
    }

    try {
        const projects = await getProjects();
        console.log(`📋 Found ${projects.length} projects.`);

        for (const p of projects) {
            console.log(`\n🔹 Processing Project: "${p.name}" (${p.id})`);

            if (!p.steps || p.steps.length === 0) {
                console.log('   ⚠️ No steps found. Creating default step...');
                const newSteps = [{ id: 'step_default', name: 'Inicio', locked: true }];
                await updateProjectSteps(p.id, newSteps);
                console.log('   ✅ Created default step.');
                continue;
            }

            // Check if already migrated
            if (p.steps.some(s => s.id === 'step_default')) {
                console.log('   ✅ Already has "step_default". skipping structure update.');

                // Ensure it is locked though
                const defaultStep = p.steps.find(s => s.id === 'step_default');
                if (defaultStep && !defaultStep.locked) {
                    defaultStep.locked = true;
                    await updateProjectSteps(p.id, p.steps);
                    console.log('   🔒 Locked existing "step_default".');
                }
                continue;
            }

            // MIGRATION LOGIC
            // 1. Identify first step
            const firstStep = p.steps[0];
            const oldId = firstStep.id;
            console.log(`   🔄 Migrating first step "${firstStep.name}" (ID: ${oldId}) -> "step_default"`);

            // 2. Update Step Structure
            firstStep.id = 'step_default';
            firstStep.locked = true;
            await updateProjectSteps(p.id, p.steps);
            console.log('   ✅ Project steps updated.');

            // 3. Migrate Candidates in that Step
            // We need to find all candidates in this project that are in 'oldId' and move them to 'step_default'
            // scan/search is expensive, so we iterate known project candidates if possible, 
            // but `projects.js` doesn't expose a cheap list of IDs.
            // We'll rely on a global search for this migration script or iterate all candidates.
            // For safety and speed in this specific environment, let's iterate ALL candidates.

            let movedCount = 0;
            const candidateKeys = await client.keys('candidatic:candidate:*');

            for (const key of candidateKeys) {
                try {
                    const cData = await client.get(key);
                    const c = JSON.parse(cData);

                    if (c.projectId === p.id && (c.stepId === oldId || c.projectMetadata?.stepId === oldId)) {
                        c.stepId = 'step_default';
                        if (c.projectMetadata) c.projectMetadata.stepId = 'step_default';

                        // Save back
                        await client.set(key, JSON.stringify(c));
                        movedCount++;
                    }
                } catch (e) { }
            }
            console.log(`   📦 Moved ${movedCount} candidates from "${oldId}" to "step_default".`);
        }

        console.log('\n--- 🎉 MIGRATION COMPLETE ---');
        process.exit(0);

    } catch (error) {
        console.error('❌ Migration Fatal Error:', error);
        process.exit(1);
    }
}

migrateDefaultSteps();
