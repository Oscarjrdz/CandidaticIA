
import axios from 'axios';
import { getUltraMsgConfig } from './api/whatsapp/utils.js';

async function testBlock() {
    try {
        const config = await getUltraMsgConfig();
        if (!config || !config.instanceId || !config.token) {
            console.error('❌ Configuración de UltraMsg incompleta');
            return;
        }

        console.log('📡 Usando Instance ID:', config.instanceId);

        // --- TEST PHONE --- 
        // Reemplaza con un número real para probar si es necesario, 
        // o deja que el script intente con un formato estándar.
        const testPhone = '8116038195@c.us';

        const url = `https://api.ultramsg.com/${config.instanceId}/contacts/block`;
        const params = new URLSearchParams();
        params.append('token', config.token);
        params.append('chatId', testPhone);

        console.log('📤 Enviando petición a:', url);
        console.log('📦 Params:', params.toString().replace(config.token, '***'));

        const response = await axios.post(url, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log('✅ Respuesta UltraMsg:', JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.error('❌ Error en la prueba:', error.response?.data || error.message);
    }
    process.exit(0);
}

testBlock();
