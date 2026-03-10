import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getRedisClient, getCandidateById } from './api/utils/storage.js';
import { Orchestrator } from './api/utils/orchestrator.js';

(async () => {
    try {
        console.log("=== STARTING DIRECT HANDOVER SIMULATION ===");

        const candidateId = 'cand_1773173224818_wp429qa09';
        const candidateData = await getCandidateById(candidateId);

        // Simulating the exact payload agent.js passes to Orchestrator when "Secu" is parsed
        const simulatedUpdates = {
            escolaridad: 'Secundaria',
            isNowComplete: true,
            congratulated: false
        };

        // Dummy config logic
        const config = {
            instanceId: process.env.ULTRAMSG_INSTANCE_ID || '12345',
            token: process.env.ULTRAMSG_TOKEN || '12345'
        };

        const mergedData = { ...candidateData, ...simulatedUpdates };
        console.log("Input Data for Handover:", {
            name: mergedData.nombreReal,
            escolaridad: mergedData.escolaridad
        });

        const handoverResult = await Orchestrator.executeHandover(mergedData, config, 'test_msg_id');

        console.log("=== HANDOVER COMPLETE ===");
        console.log("Result:", handoverResult);

    } catch (e) {
        console.error("FATAL CRASH IN ORCHESTRATOR:", e);
    }
    process.exit(0);
})();
