import { calculateBotStats } from '../utils/bot-stats.js';

calculateBotStats().then(res => {
    console.log("Stats Result:", JSON.stringify(res, null, 2));
    process.exit(0);
}).catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
