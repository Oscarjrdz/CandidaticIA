import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Replace with your phone number to test (use international format without +)
const testPhoneNumber = '5218128599426';

import { getUltraMsgConfig } from './api/whatsapp/utils.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runPresenceTest() {
    const config = await getUltraMsgConfig();
    const instanceId = config?.instanceId;
    const token = config?.token;

    if (!instanceId || !token) {
        console.error('❌ Faltan las variables ULTRAMSG_INSTANCE_ID o ULTRAMSG_TOKEN en Redis/.env');
        process.exit(1);
    }
    const formattedChatId = `${testPhoneNumber}@c.us`;

    console.log(`\n🚀 Iniciando prueba de Presencia para el número: ${testPhoneNumber}`);

    // --- 1. PRUEBA DE "ESCRIBIENDO..." ---
    console.log('\n[1] Intentando mostrar "Escribiendo..." (composing) en tu WhatsApp...');
    try {
        const urlPresence = `https://api.ultramsg.com/${instanceId}/chats/presence`;
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('chatId', formattedChatId);
        params.append('presence', 'composing');

        const res = await axios.post(urlPresence, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        console.log(`✅ Respuesta de UltraMsg (Escribiendo): ${JSON.stringify(res.data)}`);
        console.log('👀 Abre tu WhatsApp YA MISMO y revisa si dice "Escribiendo..." debajo del nombre de Brenda.');
    } catch (e) {
        console.error(`❌ Error en Presencia: ${e.message}`);
    }

    console.log('\n⏳ Esperando 10 segundos para que puedas observar tu teléfono...');
    await sleep(10000);

    // --- 2. PRUEBA DE "LEÍDO" (PALOMITAS AZULES) ---
    console.log('\n[2] Intentando marcar los mensajes como "Leídos" (Palomitas Azules)...');
    console.log('👉 Por favor, envíale OTRA VEZ un mensaje nuevo a Brenda (ej. "hola de prueba") y no abras su chat.');

    console.log('⏳ Esperando 15 segundos para que envíes el mensaje...');
    await sleep(15000);

    try {
        const urlRead = `https://api.ultramsg.com/${instanceId}/chats/read`;
        const paramsRead = new URLSearchParams();
        paramsRead.append('token', token);
        paramsRead.append('chatId', formattedChatId);

        const resRead = await axios.post(urlRead, paramsRead, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        console.log(`✅ Respuesta de UltraMsg (Leído): ${JSON.stringify(resRead.data)}`);
        console.log('👀 Revisa el mensaje que le acabas de mandar. ¿Sus palomitas se pintaron de azul?');
    } catch (e) {
        console.error(`❌ Error en Leído: ${e.message}`);
    }
}

runPresenceTest();
