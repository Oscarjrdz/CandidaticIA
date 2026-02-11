
import axios from 'axios';
import { getRedisClient, getUltraMsgConfig } from './api/whatsapp/utils.js';
import dotenv from 'dotenv';
dotenv.config();

async function checkContacts() {
    try {
        const { instanceId, token } = await getUltraMsgConfig();
        console.log(`📡 Checking Instance: ${instanceId}`);

        const url = `https://api.ultramsg.com/${instanceId}/contacts`;
        const response = await axios.get(url, {
            params: {
                token: token,
                limit: 10
            }
        });

        console.log('✅ Contacts response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkContacts();
