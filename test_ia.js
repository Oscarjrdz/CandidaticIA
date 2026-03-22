import { getRedisClient } from './api/utils/storage.js';

async function diag() {
    const redis = getRedisClient();
    const isActive = await redis.get('bot_ia_active');
    console.log('AI Active:', isActive);
    
    // Check if his phone is blocked
    const candId = await redis.get('phone:5218116038195');
    if (candId) {
        const cand = await redis.get(`candidate:${candId}`);
        console.log('Candidate Data:', cand);
    }
    process.exit(0);
}
diag();
