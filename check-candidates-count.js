import { getRedisClient, getCandidatesStats } from './api/utils/storage.js';

async function checkCount() {
    const client = getRedisClient();
    try {
        const stats = await getCandidatesStats();
        console.log('Total Candidates in Redis (zcard candidates:list):', stats.total);

        // Also let's peek at the first 5 IDs to see if looks healthy
        const ids = await client.zrevrange('candidates:list', 0, 4);
        console.log('Sample IDs (top 5):', ids);

    } catch (e) {
        console.error('Error checking count:', e);
    } finally {
        process.exit();
    }
}

checkCount();
