import { getRedisClient, auditProfile } from './api/utils/storage.js';

async function diagnose() {
    const redis = getRedisClient();
    if (!redis) {
        process.exit(1);
    }

    const ids = ['cand_1769717762491_ar2jvneez', 'cand_1769531474922_n54mt0t91'];

    for (const id of ids) {
        console.log(`\n--- ID: ${id} ---`);
        const data = await redis.get(`candidate:${id}`);
        if (!data) {
            console.log('NOT FOUND');
            continue;
        }

        const c = JSON.parse(data);
        try {
            const audit = auditProfile(c, []);
            console.log('Audit Result:', audit.isComplete ? 'COMPLETE' : 'INCOMPLETE');
            console.log('Missing:', audit.missingLabels);
        } catch (e) {
            console.log('AUDIT FAILED:', e.message);
        }
    }

    process.exit(0);
}

diagnose();
