import { getRedisClient } from './api/utils/storage.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const redis = getRedisClient();
  const keys = await redis.keys('project:*');
  for (const k of keys) {
    const pStr = await redis.get(k);
    if (!pStr) continue;
    try {
      const p = JSON.parse(pStr);
      if (p.name && p.name.includes('AISIN')) {
        console.log("PROJECT:", p.name);
         for (const step of p.steps || []) {
           if (step.name.toLowerCase().includes('cita')) {
             console.log("STEP:", step.name);
             console.log("PROMPT:\n", step.aiConfig?.prompt);
             break;
           }
         }
      }
    } catch(e) {}
  }
  process.exit(0);
}
run();
