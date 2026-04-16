/**
 * One-time migration: Sync 'stats:unread:ids' Redis SET
 * from existing candidate data.
 * Run once after deploying the atomic unread tracking.
 * 
 * Usage: node --experimental-modules api/scripts/sync_unread_set.js
 */

import 'dotenv/config';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL?.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
});

async function main() {
    console.log('🔄 Syncing stats:unread:ids SET from candidate data...');
    
    // Clear existing SET
    await redis.del('stats:unread:ids');
    
    // Get all candidate IDs
    const ids = await redis.zrange('candidates:list', 0, -1);
    console.log(`📊 Found ${ids.length} candidates`);
    
    let unreadCount = 0;
    const batchSize = 200;
    
    for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const pipeline = redis.pipeline();
        batch.forEach(id => pipeline.get(`candidate:${id}`));
        const results = await pipeline.exec();
        
        const addPipeline = redis.pipeline();
        results.forEach(([err, raw], idx) => {
            if (err || !raw) return;
            try {
                const c = JSON.parse(raw);
                if (c.unread === true) {
                    addPipeline.sadd('stats:unread:ids', batch[idx]);
                    unreadCount++;
                }
            } catch {}
        });
        await addPipeline.exec();
        
        process.stdout.write(`\r  Processed ${Math.min(i + batchSize, ids.length)}/${ids.length}...`);
    }
    
    console.log(`\n✅ Done! SET 'stats:unread:ids' now has ${unreadCount} members.`);
    
    // Verify
    const scard = await redis.scard('stats:unread:ids');
    console.log(`🔍 SCARD verification: ${scard}`);
    
    redis.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
