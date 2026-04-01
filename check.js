const { Redis } = require('ioredis');
require('dotenv').config();

const REDIS_URI = process.env.REDIS_URL || process.env.REDIS_CONNECTION_STRING;
if (!REDIS_URI) {
    console.error("No REDIS connection string found in .env");
    process.exit(1);
}
const redis = new Redis(REDIS_URI);

async function check() {
    try {
        const lastRunStr = await redis.get('debug:global:last_run');
        if (lastRunStr) {
            console.log('--- ULTIMO PROCESAMIENTO GLOBAL ---');
            console.log(JSON.parse(lastRunStr));
        } else {
             console.log('No recent debug:global:last_run flag found.');
        }

        const candidatesStream = await redis.keys('candidate:*');
        let mostRecent = null;
        let highestTime = 0;
        
        for (const key of candidatesStream) {
            if (key === 'candidate:phones' || key.includes(':locks')) continue;
            const dataStr = await redis.get(key);
            if (!dataStr || !dataStr.startsWith('{')) continue;
            const data = JSON.parse(dataStr);
            if (data.ultimoMensaje) {
                const time = new Date(data.ultimoMensaje).getTime();
                if (time > highestTime) {
                    highestTime = time;
                    mostRecent = data;
                }
            } else if (data.creadoEn) {
                const time = new Date(data.creadoEn).getTime();
                if (time > highestTime) {
                    highestTime = time;
                    mostRecent = data;
                }
            }
        }
        
        console.log('\n--- CANDIDATO MAS RECIENTE EN BDD ---');
        console.log(`Nombre: ${mostRecent?.nombre || mostRecent?.nombreReal || 'Desconocido'}`);
        console.log(`Teléfono: ${mostRecent?.whatsapp}`);
        console.log(`Último Mensaje: ${mostRecent?.ultimoMensaje}`);
        console.log(`Paso actual: ${mostRecent?.estado}`);
        
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
check();
