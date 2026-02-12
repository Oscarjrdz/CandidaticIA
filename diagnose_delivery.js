import { getRedisClient } from './api/utils/storage.js';
import dotenv from 'dotenv';
dotenv.config();

async function diagnose(phone) {
    const redis = getRedisClient();
    if (!redis) {
        console.error('❌ No Redis client available.');
        return;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const debugKey = `debug:ultramsg:${cleanPhone}`;

    console.log(`🔍 Inspecting delivery logs for: ${cleanPhone}`);

    const logs = await redis.get(debugKey);
    if (!logs) {
        console.warn(`⚠️ No delivery logs found for ${cleanPhone}. Key: ${debugKey}`);

        // Try with and without 521 prefix
        const alternative = cleanPhone.startsWith('521') ? cleanPhone.replace('521', '52') : `521${cleanPhone.substring(2)}`;
        const altLogs = await redis.get(`debug:ultramsg:${alternative}`);
        if (altLogs) console.log(`💡 Found logs under alternative key: debug:ultramsg:${alternative}`);
    } else {
        console.log('✅ Found delivery logs:');
        console.log(JSON.stringify(JSON.parse(logs), null, 2));
    }

    // Also check AI Telemetry
    console.log('\n📊 Checking AI Telemetry (last 5 entries)...');
    const telemetry = await redis.zrevrange('stats:ai_telemetry', 0, 5);
    console.log(telemetry.length > 0 ? telemetry : 'No telemetry found.');

    process.exit(0);
}

const phone = process.argv[2] || '5218116038195';
diagnose(phone);
