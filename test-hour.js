import dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });
import { getCandidateKnowledgeSnapshot } from './api/utils/copilot-candidate-knowledge.js';

async function test() {
    try {
        console.log("Calculando horarios pico...");
        const snapshot = await getCandidateKnowledgeSnapshot();
        
        console.log("\n=== HORARIOS DE LLEGADA DE CANDIDATOS ===");
        if(snapshot.distributions.byHour && snapshot.distributions.byHour.length > 0) {
            snapshot.distributions.byHour.slice(0, 5).forEach(item => {
                console.log(`- ${item.label}: ${item.count} candidatos`);
            });
        } else {
            console.log("No se encontraron registros de horarios.");
        }
    } catch(e) {
        console.error("Error:", e);
    }
    process.exit(0);
}
test();
