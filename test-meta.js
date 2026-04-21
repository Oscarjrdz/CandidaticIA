import 'dotenv/config';
import { getMetaConfig } from './api/whatsapp/utils.js';
import axios from 'axios';

async function run() {
    const config = getMetaConfig();
    if (!config.accessToken) return console.error("No access token");
    const url = `https://graph.facebook.com/v21.0/${config.wabaId}/message_templates`;
    const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${config.accessToken}` } });
    const seguimiento = response.data.data.find(t => t.name === 'seguimiento');
    console.log(JSON.stringify(seguimiento, null, 2));
}
run();
