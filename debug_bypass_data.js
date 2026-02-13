
import { getRedisClient } from './api/utils/storage.js';
import fs from 'fs';
import path from 'path';

// Load .env.local manually
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const [key, value] = line.split('=');
            if (key && value) {
                process.env[key.trim()] = value.trim();
            }
        });
        console.log('✅ .env.local loaded');
    } else {
        console.warn('⚠️ .env.local not found');
    }
} catch (e) {
    console.warn('⚠️ Error loading .env.local', e);
}


async function debugBypass() {
    const client = getRedisClient();
    if (!client) {
        console.error('Redis client not initialized (Check REDIS_URL)');
        return;
    }

    console.log('--- PROJECTS ---');
    const projectKeys = await client.keys('candidatic:project:*');
    for (const key of projectKeys) {
        const data = await client.get(key);
        try {
            const p = JSON.parse(data);
            if (p.name && (p.name.includes('Venta') || p.name.includes('Vacantes'))) {
                console.log(`FOUND PROJECT: ${p.name} (ID: ${p.id})`);
                if (p.steps && p.steps.length > 0) {
                    console.log('STEPS:', p.steps.map(s => `"${s.name}" (ID: "${s.id}")`));
                } else {
                    console.log('NO STEPS DEFINED');
                }
            }
        } catch (e) { }
    }

    console.log('\n--- CANDIDATE ---');
    // Search for Oscar García
    const candidateKeys = await client.keys('candidatic:candidate:*');
    for (const key of candidateKeys) {
        const data = await client.get(key);
        try {
            const c = JSON.parse(data);
            if (c.nombreReal && c.nombreReal.toLowerCase().includes('oscar garcía'.toLowerCase())) {
                console.log(`FOUND CANDIDATE: ${c.nombreReal} (ID: ${c.id})`);
                console.log(`projectId: "${c.projectId}"`);
                console.log(`stepId: "${c.projectMetadata?.stepId || c.stepId}"`);
                console.log(`projectMetadata:`, JSON.stringify(c.projectMetadata));
                console.log(`Active properties: bypassed=${c.bypass_rule}, active=${!c.blocked}`);
            }
        } catch (e) { }
    }

    process.exit(0);
}

debugBypass();
