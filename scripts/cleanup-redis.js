/**
 * Redis Cleanup Script — One-Time OOM Remediation
 * 
 * What it does:
 * 1. Sets TTL (30 days) on all messages:* keys that don't have one
 * 2. Deletes all debug:* keys (ephemeral logs, ~683 keys)
 * 3. Deletes all image:* keys (stale base64 blobs, ~32 keys)
 * 4. Reports memory freed
 * 
 * Usage: REDIS_URL=<url> node scripts/cleanup-redis.js
 */
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function scanKeys(pattern) {
    let cursor = '0';
    const keys = [];
    do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        cursor = next;
        keys.push(...batch);
    } while (cursor !== '0');
    return keys;
}

async function run() {
    console.log('🧹 Redis Cleanup Script — OOM Remediation');
    console.log('==========================================\n');

    // Memory before
    const infoBefore = await redis.info('memory');
    const usedBefore = infoBefore.match(/used_memory:(\d+)/)?.[1];
    console.log(`📊 Memory BEFORE: ${(usedBefore / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📊 Total keys: ${await redis.dbsize()}\n`);

    let totalDeleted = 0;

    // === 1. Set TTL on messages:* keys without one ===
    console.log('--- Phase 1: Setting TTL on messages:* ---');
    const msgKeys = await scanKeys('messages:*');
    let ttlSet = 0;
    for (const key of msgKeys) {
        const ttl = await redis.ttl(key);
        if (ttl === -1) { // -1 means no TTL
            await redis.expire(key, 2592000); // 30 days
            ttlSet++;
        }
    }
    console.log(`  ✅ ${ttlSet}/${msgKeys.length} message lists now have 30-day TTL\n`);

    // === 2. Delete debug:* keys ===
    console.log('--- Phase 2: Cleaning debug:* keys ---');
    const debugKeys = await scanKeys('debug:*');
    if (debugKeys.length > 0) {
        // Delete in batches of 100
        for (let i = 0; i < debugKeys.length; i += 100) {
            const batch = debugKeys.slice(i, i + 100);
            await redis.del(...batch);
        }
        totalDeleted += debugKeys.length;
    }
    console.log(`  ✅ Deleted ${debugKeys.length} debug keys\n`);

    // === 3. Delete image:* blobs (stale inbound base64) ===
    console.log('--- Phase 3: Cleaning image:* blobs ---');
    const imageKeys = await scanKeys('image:*');
    if (imageKeys.length > 0) {
        await redis.del(...imageKeys);
        totalDeleted += imageKeys.length;
    }
    console.log(`  ✅ Deleted ${imageKeys.length} image blob keys\n`);

    // === 4. Trim vacancy_history:* to max 100 ===
    console.log('--- Phase 4: Capping vacancy_history:* ---');
    const vhKeys = await scanKeys('vacancy_history:*');
    let vhTrimmed = 0;
    for (const key of vhKeys) {
        const count = await redis.zcard(key);
        if (count > 100) {
            await redis.zremrangebyrank(key, 0, count - 101);
            vhTrimmed++;
        }
    }
    console.log(`  ✅ ${vhTrimmed}/${vhKeys.length} vacancy histories capped to 100\n`);

    // Memory after
    const infoAfter = await redis.info('memory');
    const usedAfter = infoAfter.match(/used_memory:(\d+)/)?.[1];
    const freed = usedBefore - usedAfter;

    console.log('==========================================');
    console.log(`📊 Memory AFTER: ${(usedAfter / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📊 Total keys: ${await redis.dbsize()}`);
    console.log(`🎉 Freed: ${(freed / 1024 / 1024).toFixed(2)} MB (${totalDeleted} keys deleted)`);

    process.exit(0);
}

run().catch(e => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
});
