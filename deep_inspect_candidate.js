
import fs from 'fs';
import path from 'path';

// Load .env.local
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value.length > 0) {
            process.env[key.trim()] = value.join('=').trim().replace(/^"(.*)"$/, '$1');
        }
    });
    console.log('✅ Environment variables loaded.');
}

import { getRedisClient, getCandidateIdByPhone, getCandidateById, getProjectById } from './api/utils/storage.js';

async function deepInspect() {
    const phone = '5218116038195';
    console.log(`\n--- 🕵️‍♂️ DEEP INSPECTION: ${phone} ---`);
    const redis = getRedisClient();

    try {
        const candidateId = await getCandidateIdByPhone(phone);
        if (!candidateId) {
            console.error('❌ Candidate not found.');
            return;
        }

        const candidate = await getCandidateById(candidateId);
        console.log('\n--- CANDIDATE DATA ---');
        console.log(JSON.stringify(candidate, null, 2));

        if (candidate.projectId) {
            const project = await getProjectById(candidate.projectId);
            console.log('\n--- PROJECT DATA ---');
            console.log(`Name: ${project.name}`);
            const currentStep = project.steps?.find(s => s.id === candidate.stepId) || project.steps?.[0];
            console.log(`Current Step: ${currentStep?.name} (${currentStep?.id})`);
            console.log(`AI Config Enabled: ${currentStep?.aiConfig?.enabled}`);
            console.log(`AI Prompt: ${currentStep?.aiConfig?.prompt}`);
        }

        // Check last AI response
        const debugKey = `debug:last_response:${candidateId}`;
        const lastResponse = await redis.get(debugKey);
        console.log('\n--- LAST AI RESPONSE (DEBUG) ---');
        console.log(lastResponse ? JSON.parse(lastResponse) : '❌ NO DEBUG DATA FOUND');

        // Check recent bypass traces (might be relevant if it tried to re-bypass)
        const traces = await redis.lrange('debug:bypass:traces', 0, 5);
        console.log('\n--- RECENT BYPASS TRACES ---');
        traces.forEach((t, i) => {
            const parsed = JSON.parse(t);
            if (parsed.candidateId === candidateId) {
                console.log(`[Trace ${i}]: Match ${parsed.finalResult} -> ${parsed.assignedProject}`);
            }
        });

        // Check UltraMSG debug
        const umDebug = await redis.get(`debug:ultramsg:${phone}@c.us`);
        console.log('\n--- LAST ULTRAMSG SEND ---');
        console.log(umDebug ? JSON.parse(umDebug) : '❌ NO ULTRAMSG DEBUG DATA');

    } catch (e) {
        console.error('❌ Error during inspection:', e);
    } finally {
        process.exit(0);
    }
}

deepInspect();
