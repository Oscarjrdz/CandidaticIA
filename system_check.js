import { getCandidates, getRedisClient } from './api/utils/storage.js';

async function debug() {
    const redis = getRedisClient();
    if (!redis) {
        console.log('❌ Redis no disponible');
        return;
    }

    const enabled = await redis.get('bot_proactive_enabled');
    const todayStr = new Date().toISOString().split('T')[0];
    const todayCount = await redis.get('ai:proactive:count:' + todayStr);
    const totalSent = await redis.get('ai:proactive:total_sent');

    console.log('--- ESTADO GLOBAL ---');
    console.log('Proactivo Activado:', enabled);
    console.log('Enviados Hoy (Count Key):', todayCount);
    console.log('Total Histórico:', totalSent);
    console.log('Hora actual (UTC):', new Date().toISOString());

    console.log('\n--- CANDIDATOS PENDIENTES (TOP 10) ---');
    const { candidates } = await getCandidates(500, 0);
    const now = new Date();

    const incomplete = candidates.filter(c => !c.nombreReal || !c.municipio);
    console.log('Total Incompletos Encontrados:', incomplete.length);

    const report = incomplete.map(c => {
        const lastMsgAt = new Date(c.lastUserMessageAt || c.lastBotMessageAt || 0);
        const hoursInactive = (now - lastMsgAt) / (1000 * 60 * 60);
        return {
            nombre: c.nombre,
            whats: c.whatsapp,
            hoursInactive: parseFloat(hoursInactive.toFixed(1)),
            lastMsg: c.lastUserMessageAt || c.lastBotMessageAt
        };
    }).sort((a, b) => b.hoursInactive - a.hoursInactive);

    console.table(report.slice(0, 10));
}

debug().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
