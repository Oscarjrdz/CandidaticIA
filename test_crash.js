import { processMessage } from './api/ai/agent.js';
import { getRedisClient, saveCandidate } from './api/utils/storage.js';

async function diag() {
    try {
        const cand = await saveCandidate({
            whatsapp: "5218116038195",
            nombre: "Oscar",
            esNuevo: "SI",
            projectMetadata: {
                currentVacancyIndex: 0
            }
        });
        const r = getRedisClient();
        await r.set(`phone:5218116038195`, cand.id);
        
        const test1 = await processMessage(cand.id, "hola");
        console.log("HOLA DONE:", test1);
        
    } catch(e) {
        console.error("FATAL CRASH:", e);
    }
    process.exit(0);
}
diag();
