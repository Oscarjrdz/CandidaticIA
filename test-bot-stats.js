import { calculateBotStats } from './api/utils/bot-stats.js';

async function test() {
    console.log('--- Testing Bot Stats Calculation ---');
    const stats = await calculateBotStats();
    if (stats) {
        console.log('✅ Stats calculated successfully:');
        console.log(JSON.stringify(stats, null, 2));
    } else {
        console.log('❌ Stats calculation failed.');
    }
}

test();
