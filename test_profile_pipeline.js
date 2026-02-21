import { getClient } from './api/utils/storage.js';

async function diagnose() {
    const redis = getClient();
    try {
        const cands = await redis.keys('candidate:*');
        let latest = null;
        let cId = null;
        for (const k of cands) {
            const dataRaw = await redis.get(k);
            if(dataRaw) {
               const data = JSON.parse(dataRaw);
               if(!latest || new Date(data.primerContacto) > new Date(latest.primerContacto)){
                   latest = data;
                   cId = k.split(':')[1];
               }
            }
        }
        console.log('--- ULTIMO CANDIDATO REGISTRADO ---');
        console.log(latest.whatsapp, '|', latest.nombreReal);
        console.log('Project ID Assigned:', latest.projectId || 'NONE');
        console.log('Step Reached:', latest.currentStep || 'NONE');
        
        const logs = await redis.lrange(`messages:${cId}`, -5, -1);
        console.log('\n--- ULTIMAS CONVERSACIONES ---');
        logs.forEach(l => {
           const j = JSON.parse(l);
           console.log(`[${j.from}] ${j.content.substring(0,80)}`);
        });

    } catch(e) { console.error(e); }
    process.exit(0);
}
diagnose();
