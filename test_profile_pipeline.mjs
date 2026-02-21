import { getRedisClient, getMessages } from './api/utils/storage.js';

async function diagnose() {
    const redis = getRedisClient();
    try {
        const cands = await redis.keys('candidate:*');
        let latest = null;
        let cId = null;
        for (const k of cands) {
            const dataRaw = await redis.get(k);
            if (dataRaw) {
                const data = JSON.parse(dataRaw);
                // Simple max finding based on time
                if (!latest || new Date(data.primerContacto) > new Date(latest.primerContacto)) {
                    latest = data;
                    cId = k.split(':')[1];
                }
            }
        }
        console.log('--- ULTIMO CANDIDATO REGISTRADO ---');
        console.log(latest.whatsapp, '|', latest.nombreReal);
        console.log('Project ID Assigned:', latest.projectId || 'NONE');
        console.log('Step Reached:', latest.currentStep || 'NONE');
        console.log('ADN Extracted:', JSON.stringify(latest, null, 2));

        const logs = await getMessages(cId);
        console.log('\n--- ULTIMAS 10 CONVERSACIONES ---');
        logs.slice(-10).forEach(j => {
            console.log(`[${j.from}] ${j.content.substring(0, 80)}`);
        });

    } catch (e) { console.error(e); }
    process.exit(0);
}
diagnose();
