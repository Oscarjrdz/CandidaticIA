
import fs from 'fs';
import path from 'path';

// Load .env.local
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value.length > 0) {
            process.env[key.trim()] = value.join('=').trim().replace(/^"(.*)"$/, '$1');
        }
    });
    console.log('✅ Environment variables loaded.');
}

import { getRedisClient } from './api/utils/storage.js';

async function checkStickers() {
    console.log('\n--- 🕵️‍♂️ STICKER KEY CHECK ---');
    const redis = getRedisClient();
    try {
        const celeb = await redis.get('bot_celebration_sticker');
        const move = await redis.get('bot_step_move_sticker');

        console.log(`[bot_celebration_sticker]: ${celeb ? celeb.substring(0, 50) + '...' : '❌ NOT SET'}`);
        console.log(`[bot_step_move_sticker]: ${move ? move.substring(0, 50) + '...' : '❌ NOT SET'}`);

        if (move && !move.startsWith('http')) {
            console.warn('⚠️ WARNING: bot_step_move_sticker is not a valid URL.');
        }
    } catch (e) {
        console.error('❌ Redis Error:', e.message);
    } finally {
        process.exit(0);
    }
}

checkStickers();
