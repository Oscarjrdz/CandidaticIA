import dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });
import { getCandidateKnowledgeSnapshot } from './api/utils/copilot-candidate-knowledge.js';

async function test() {
    try {
        console.log("Conectando a Redis en PRODUCCIÓN...");
        const snapshot = await getCandidateKnowledgeSnapshot();
        console.log("\n=== TOTALES REALES EN LA BASE ===");
        console.log(`Total Candidatos: ${snapshot.totals.candidates}`);
        
        console.log("\n=== DESGLOSE DE ESCOLARIDAD (100% REAL) ===");
        if(snapshot.distributions.byEducation && snapshot.distributions.byEducation.length > 0) {
            snapshot.distributions.byEducation.forEach(item => {
                console.log(`- ${item.label}: ${item.count}`);
            });
        } else {
            console.log("No se encontraron registros de escolaridad.");
        }
        
        console.log("\n(Esta es exactamente la información matemática precisa que Brenda usa para contestar sin gastar tokens extra)");
    } catch(e) {
        console.error("Error:", e);
    }
    process.exit(0);
}
test();
