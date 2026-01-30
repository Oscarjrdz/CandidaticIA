import dotenv from 'dotenv';
dotenv.config();
import { getCandidateByPhone, getRedisClient } from './api/utils/storage.js';

async function diagnose() {
    const phone = '5218120761482'; // Standard format
    console.log(`🔍 Buscando candidato: ${phone}`);

    let cand = await getCandidateByPhone(phone);
    if (!cand) {
        console.log('❌ Candidato no encontrado con ese número exacto.');
        // Try with +
        cand = await getCandidateByPhone('+' + phone);
    }

    if (cand) {
        console.log('✅ Candidato Encontrado:');
        console.log(`- Nombre: ${cand.nombre}`);
        console.log(`- Nombre Real: ${cand.nombreReal || 'FALTANTE'}`);
        console.log(`- Municipio: ${cand.municipio || 'FALTANTE'}`);
        console.log(`- Último msg Usuario: ${cand.lastUserMessageAt}`);
        console.log(`- Último msg Bot: ${cand.lastBotMessageAt}`);

        const isComp = cand.nombreReal && cand.municipio;
        console.log(`- Perfil Completo: ${isComp ? 'SÍ' : 'NO'}`);

        const now = new Date();
        const lastMsgAt = new Date(cand.lastUserMessageAt || cand.lastBotMessageAt || 0);
        const hoursInactive = (now - lastMsgAt) / (1000 * 60 * 60);
        console.log(`- Horas inactivo: ${hoursInactive.toFixed(2)}h`);

        const redis = getRedisClient();
        const switchStatus = await redis.get('bot_proactive_enabled');
        console.log(`- Switch Global: ${switchStatus}`);

        // Check levels
        if (hoursInactive >= 24) {
            const level = hoursInactive >= 72 ? 72 : (hoursInactive >= 48 ? 48 : 24);
            const sessionKey = `proactive:${cand.id}:${level}:${cand.lastUserMessageAt}`;
            const alreadySent = await redis.get(sessionKey);
            console.log(`- Nivel Alcanzado: ${level}h`);
            console.log(`- Ya enviado hoy?: ${alreadySent ? 'SÍ' : 'NO'}`);
        }
    } else {
        console.log('❌ No se encontró nada.');
    }
    process.exit(0);
}

diagnose();
