import axios from 'axios';
import { getUltraMsgConfig } from './api/whatsapp/utils.js';

async function testPresence() {
    const config = await getUltraMsgConfig();
    const instanceId = config?.instanceId;
    const token = config?.token;
    const to = '5218116038195@c.us';

    if (!config) {
        console.error('Failed to load configuration');
        process.exit(1);
    }
    console.log('--- TESTING ULTRAMSG PRESENCE ---');
    console.log('Instance:', instanceId);
    console.log('To:', to);

    const url = `https://api.ultramsg.com/${instanceId}/chats/presence`;

    const payloads = [
        { name: 'Form-UrlEncoded (composing)', data: new URLSearchParams({ token, chatId: to, presence: 'composing' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        { name: 'JSON (composing)', data: { token, chatId: to, presence: 'composing' }, headers: { 'Content-Type': 'application/json' } },
        { name: 'Form-UrlEncoded (typing)', data: new URLSearchParams({ token, chatId: to, presence: 'typing' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        { name: 'JSON (typing)', data: { token, chatId: to, presence: 'typing' }, headers: { 'Content-Type': 'application/json' } },
        { name: 'Form-UrlEncoded (type=typing)', data: new URLSearchParams({ token, chatId: to, type: 'typing' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    ];

    for (const p of payloads) {
        console.log(`\nTesting: ${p.name}...`);
        try {
            const res = await axios.post(url, p.data, { headers: p.headers });
            console.log('Status:', res.status);
            console.log('Data:', JSON.stringify(res.data));
        } catch (e) {
            console.error('Error:', e.response?.status, JSON.stringify(e.response?.data) || e.message);
        }
    }
}

testPresence();
