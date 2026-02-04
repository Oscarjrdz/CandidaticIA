import axios from 'axios';
import { getUltraMsgConfig } from './api/whatsapp/utils.js';

async function diagnose() {
    const config = await getUltraMsgConfig();
    if (!config) {
        console.error('❌ Config not found');
        process.exit(1);
    }

    const { instanceId, token } = config;
    const to = '5218116038195@c.us'; // Target phone from history

    console.log(`--- SURGICAL DIAGNOSIS: PRESENCE ---`);
    console.log(`Target: ${to}`);
    console.log(`Instance: ${instanceId}`);

    const endpoints = ['chats/presence', 'chats/typing'];
    const keywords = ['composing', 'typing'];

    for (const endpoint of endpoints) {
        for (const kw of keywords) {
            const url = `https://api.ultramsg.com/${instanceId}/${endpoint}`;

            // 1. TEST FORM-DATA
            console.log(`\n[TEST] Endpoint: ${endpoint} | KW: ${kw} | Format: FORM`);
            const params = new URLSearchParams({ token, chatId: to, presence: kw, type: kw });
            try {
                const res = await axios.post(url, params, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 5000
                });
                console.log(`✅ Success:`, res.status, JSON.stringify(res.data));
            } catch (e) {
                console.log(`❌ Fail:`, e.response?.status || e.message, JSON.stringify(e.response?.data) || '');
            }

            // 2. TEST JSON
            console.log(`[TEST] Endpoint: ${endpoint} | KW: ${kw} | Format: JSON`);
            try {
                const res = await axios.post(url, { token, chatId: to, presence: kw, type: kw }, { timeout: 5000 });
                console.log(`✅ Success:`, res.status, JSON.stringify(res.data));
            } catch (e) {
                console.log(`❌ Fail:`, e.response?.status || e.message, JSON.stringify(e.response?.data) || '');
            }
        }
    }
}

diagnose();
