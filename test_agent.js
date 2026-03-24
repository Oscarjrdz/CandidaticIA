import { processMessage } from './api/ai/agent.js';
import { getRedisClient } from './api/utils/storage.js';

async function test() {
   const candidateId = 'cand_1774388746435_364vrlvbr';
   const aggregatedText = '🎙️ [AUDIO TRANSCRITO]: "Me llamo Oscar Rodríguez."';
   const res = await processMessage(candidateId, aggregatedText);
   console.log(res);
   
   const redis = getRedisClient();
   if (redis) {
      console.log('EXTRACTED:', await redis.get(`DEBUG_AI_EXTRACTED:${candidateId}`));
      console.log('AGGREGATED:', await redis.get(`DEBUG_AI_AGGREGATED:${candidateId}`));
      redis.quit();
   }
}
test().catch(console.error);
