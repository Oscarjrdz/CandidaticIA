import fs from 'fs';
import { getClient as getRedisClient } from './api/utils/storage.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function verify() {
    const redis = getRedisClient();
    try {
        const pStr = await redis.get('proj_1740693240224_c32zcc');
        if (!pStr) {
            console.log("Project not found in Redis.");
            process.exit(1);
        }
        const p = JSON.parse(pStr);

        console.log(`Checking steps for project: ${p.name}`);

        for (const step of p.steps) {
            if (step.name.toLowerCase().includes('cita')) {
                console.log("=== CITA STEP ===");
                console.log("Step Name:", step.name);
                console.log("Modules configured:", step.appointmentConfirmation?.length);
                console.log("Details:", JSON.stringify(step.appointmentConfirmation, null, 2));
                const originStepNameForConfirm = (step.name || '').toLowerCase();
                const isCitaStepConfirm = originStepNameForConfirm.includes('cita');
                console.log(`isCitaStepConfirm evaluates to: ${isCitaStepConfirm}`);
            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

verify();
