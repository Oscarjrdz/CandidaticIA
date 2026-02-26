import { getRedisClient, getCandidateById, getProjectById } from './api/utils/storage.js';
import { getUltraMsgConfig } from './api/whatsapp/utils.js';
import { getOpenAIResponse } from './api/utils/openai.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('Redis not connected');
        process.exit(1);
    }

    // 1. Find Oscar
    const phoneIndex = await redis.hgetall('candidatic:phone_index');
    console.log('--- PHONE INDEX ---');
    console.log(JSON.stringify(phoneIndex, null, 2));

    const keys = await redis.keys('candidate:*');
    let oscar = null;

    // Check if the user is in the index
    for (const [phone, id] of Object.entries(phoneIndex)) {
        const data = await redis.get(`candidate:${id}`);
        if (data && data.toLowerCase().includes('oscar')) {
            oscar = JSON.parse(data);
            console.log(`--- FOUND OSCAR BY INDEX (${id}) ---`);
            break;
        }
    }

    if (!oscar) {
        for (const key of keys) {
            const data = await redis.get(key);
            if (data && data.toLowerCase().includes('oscar')) {
                oscar = JSON.parse(data);
                console.log(`--- FOUND OSCAR BY KEY (${key}) ---`);
                break;
            }
        }
    }

    if (oscar) {
        const cid = oscar.id;
        console.log(`\n--- CANDIDATE STATE (${cid}) ---`);
        console.log(`Name: ${oscar.nombre}`);
        console.log(`Real Name: ${oscar.nombreReal}`);
        console.log(`Blocked: ${oscar.blocked}`);
        console.log(`ProjectId: ${oscar.projectId || (oscar.projectMetadata?.projectId)}`);
        console.log(`StepId: ${oscar.stepId}`);
        console.log(`Paso1Complete: ${oscar.paso1Status === 'COMPLETO'}`);

        if (oscar.projectId) {
            const project = await getProjectById(oscar.projectId);
            console.log(`\n--- PROJECT INFO (${oscar.projectId}) ---`);
            console.log(`Name: ${project?.name}`);
            const step = project?.steps?.find(s => s.id === oscar.stepId);
            console.log(`Step: ${step?.name}`);
            console.log(`AI Enabled: ${step?.aiConfig?.enabled}`);
        }
    }

    // 2. Check AI Config
    const aiConfigRaw = await redis.get('ai_config');
    console.log('\n--- AI CONFIG ---');
    try {
        const aiConfig = JSON.parse(aiConfigRaw);
        console.log(`OpenAI Key present: ${!!aiConfig.openaiApiKey}`);
        console.log(`Model: ${aiConfig.openaiModel}`);

        if (aiConfig.openaiApiKey) {
            console.log('\n--- TESTING OPENAI KEY ---');
            try {
                const test = await getOpenAIResponse([], 'Responde "OK"', 'gpt-4o-mini', aiConfig.openaiApiKey);
                console.log(`OpenAI Test Result: ${test.content}`);
            } catch (e) {
                console.error(`OpenAI Test FAILED: ${e.message}`);
            }
        }
    } catch (e) {
        console.log('AI Config invalid or missing');
    }

    process.exit(0);
}

run().catch(console.error);
