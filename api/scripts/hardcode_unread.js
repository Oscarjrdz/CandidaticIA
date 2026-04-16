import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function hardcode() {
    const { getRedisClient } = await import('../utils/storage.js');
    const redis = getRedisClient();
    
    // Get all candidates
    const keys = await redis.keys('candidate:*');
    console.log(`Found ${keys.length} candidates in Redis.`);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const batchSize = 100;
    let candidatesToFix = [];
    
    for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        const pipeline = redis.pipeline();
        batch.forEach(k => pipeline.get(k));
        const res = await pipeline.exec();
        
        res.forEach(([err, raw]) => {
            if (!err && raw) {
                try {
                    const c = JSON.parse(raw);
                    const lastMsgTime = new Date(c.lastUserMessageAt || c.ultimoMensaje || 0);
                    if (lastMsgTime >= today) {
                        candidatesToFix.push(c);
                    }
                } catch(e) {}
            }
        });
    }
    
    console.log(`Found ${candidatesToFix.length} with activity TODAY.`);
    
    const pipeline = redis.pipeline();
    let fixed = 0;
    
    for (const c of candidatesToFix) {
        // Only if it doesn't already have unread true
        if (c.unread !== true) {
            c.unread = true;
            pipeline.set(`candidate:${c.id}`, JSON.stringify(c));
            fixed++;
        }
        pipeline.sadd('stats:unread:ids', c.id);
    }
    
    await pipeline.exec();
    console.log(`Hardcoded JSON for ${fixed} candidates. Added all ${candidatesToFix.length} to SET.`);
    
    const scard = await redis.scard('stats:unread:ids');
    console.log(`Current SCARD: ${scard}`);
    process.exit(0);
}

hardcode().catch(console.error);
