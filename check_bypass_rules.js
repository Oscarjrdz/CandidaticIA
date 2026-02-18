import { getRedisClient } from './api/utils/storage.js';

async function checkBypassRules() {
    const redis = getRedisClient();

    console.log('🔍 Fetching bypass rules...\n');

    // Get all bypass rule IDs
    const bypassIds = await redis.zrange('bypass:list', 0, -1);
    console.log(`Found ${bypassIds.length} bypass rule(s)\n`);

    if (bypassIds.length === 0) {
        console.log('❌ No bypass rules found in Redis');
        process.exit(0);
    }

    // Get all rules
    const rulesRaw = await redis.mget(bypassIds.map(id => `bypass:${id}`));
    const rules = rulesRaw.filter(r => r).map(r => JSON.parse(r));

    // Display each rule
    rules.forEach((rule, idx) => {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📋 Rule ${idx + 1}: ${rule.name}`);
        console.log(`${'='.repeat(60)}`);
        console.log(`ID: ${rule.id}`);
        console.log(`Active: ${rule.active ? '✅ YES' : '❌ NO'}`);
        console.log(`Project ID: ${rule.projectId}`);
        console.log(`\nCriteria:`);
        console.log(`  Age: ${rule.minAge || 'any'} - ${rule.maxAge || 'any'}`);
        console.log(`  Gender: ${rule.gender || 'any'}`);
        console.log(`  Municipalities: ${rule.municipios?.length > 0 ? rule.municipios.join(', ') : 'any'}`);
        console.log(`  Categories: ${rule.categories?.length > 0 ? rule.categories.join(', ') : 'any'}`);
        console.log(`  Education: ${rule.escolaridades?.length > 0 ? rule.escolaridades.join(', ') : 'any'}`);
        console.log(`\nCreated: ${rule.createdAt}`);
        if (rule.updatedAt) console.log(`Updated: ${rule.updatedAt}`);
    });

    console.log(`\n${'='.repeat(60)}\n`);

    // Check bypass_enabled setting
    const bypassEnabled = await redis.get('bypass_enabled');
    console.log(`⚙️  bypass_enabled setting: ${bypassEnabled || 'NOT SET'}`);

    if (bypassEnabled !== 'true') {
        console.log(`\n⚠️  WARNING: Bypass is DISABLED. Set bypass_enabled='true' to activate.\n`);
    } else {
        console.log(`\n✅ Bypass system is ENABLED and ready.\n`);
    }

    process.exit(0);
}

checkBypassRules().catch(console.error);
