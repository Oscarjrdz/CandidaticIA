import Redis from 'ioredis';
import fs from 'fs';

const envStr = fs.readFileSync('/tmp/.env.production', 'utf8');
const envMap = {};
envStr.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length > 1) {
        envMap[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/"/g, '');
    }
});

async function run() {
    const redis = new Redis(envMap['REDIS_URL']);

    // get all project keys
    const keys = await redis.keys('project:*');
    console.log(`Found ${keys.length} project keys.`);

    let optionsFound = false;
    for (const key of keys) {
        // Skip metadata keys
        if (key.includes('cand_meta') || key.includes('candidates')) continue;

        try {
            const raw = await redis.get(key);
            if (!raw) continue;
            const proj = JSON.parse(raw);

            if (proj.steps && Array.isArray(proj.steps)) {
                for (const step of proj.steps) {
                    if (step.calendarOptions && step.calendarOptions.length > 0) {
                        console.log(`\n✅ Project [${proj.id}] "${proj.name}", Step "${step.name}" HAS calendarOptions (${step.calendarOptions.length} items)`);
                        console.log(JSON.stringify(step.calendarOptions, null, 2));
                        optionsFound = true;
                    }
                }
            }
        } catch (e) { }
    }

    if (!optionsFound) {
        console.log("\n❌ NO CALENDAR OPTIONS FOUND IN ANY PROJECT STEP!");
    }

    await redis.quit();
}

run().catch(console.error);
