import axios from 'axios';
import { getMetaConfig } from './api/whatsapp/utils.js';

async function run() {
    const config = getMetaConfig();
    const url = `https://graph.facebook.com/v21.0/${config.wabaId}/message_templates`;
    const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${config.accessToken}` } });
    console.log(JSON.stringify(response.data.data.find(t => t.name === 'seguimiento'), null, 2));
}
run();
