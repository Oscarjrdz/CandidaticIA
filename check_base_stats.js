import { getRedisClient, getCandidates, isProfileComplete } from './api/utils/storage.js';

async function diagnose() {
    const redis = getRedisClient();
    const totalInZset = await redis.zcard('candidates:list');
    console.log('Total candidates in ZSET (candidates:list):', totalInZset);

    const customFieldsJson = await redis.get('custom_fields');
    const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];
    console.log('Custom fields count:', customFields.length);

    const { candidates, total } = await getCandidates(1000, 0);
    console.log('getCandidates(1000, 0) returned:', candidates.length, 'candidates');
    console.log('getCandidates total reported:', total);

    if (candidates.length > 0) {
        const sample = candidates[0];
        const isComp = isProfileComplete(sample, customFields);
        console.log('Sample candidate:', sample.nombre, 'Complete:', isComp);

        const pending = candidates.filter(c => !isProfileComplete(c, customFields)).length;
        const complete = candidates.filter(c => isProfileComplete(c, customFields)).length;
        console.log('Calc in script -> Pending:', pending, 'Complete:', complete);
    }

    process.exit(0);
}

diagnose();
