import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';

const envPath = '/tmp/.env.production';
const envStr = fs.readFileSync(envPath, 'utf8');
const envMap = {};
envStr.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length > 1) {
        envMap[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/"/g, '');
    }
});

async function check() {
    console.log("Connecting to ioredis...");
    const redis = new Redis(envMap['REDIS_URL']);

    // Find keys matching Oscar's testing phone number (last 10 digits 5570072124)
    const keys = await redis.keys('candidate:status');
    // Candidate status is a hash, so keys just returns candidate:status
    const allStatuses = await redis.hgetall('candidate:status');
    let phoneFound = null;
    let projId = null;

    for (const [phone, statusStr] of Object.entries(allStatuses)) {
        if (phone.includes('5570072124')) {
            console.log(`\nFound target candidate! Phone: ${phone}`);
            phoneFound = phone;
            const cand = JSON.parse(statusStr);
            console.log("Candidate Status Project ID:", cand?.projectId);
            projId = cand?.projectId;
            break;
        }
    }

    if (projId && phoneFound) {
        const metaStr = await redis.hget(`project:cand_meta:${projId}`, phoneFound);
        console.log("Candidate Meta:", metaStr);

        if (metaStr) {
            const meta = JSON.parse(metaStr);
            console.log("\nEXTRACTED CITA DATE:", meta.citaFecha);
            console.log("EXTRACTED CITA TIME:", meta.citaHora);
        }
    } else {
        console.log("Failed to find Oscar's test candidate.");
    }

    // NOW READ THE PROJECT ITSELF TO SEE THE REAL CALENDAR OPTIONS
    if (projId) {
        // Attempt to see if we cache projects
        const pKeys = await redis.keys(`*project*${projId}*`);
        console.log("\nAssociated Redis Project Keys:", pKeys);
    }

    await redis.quit();
}
check().catch(console.error);
