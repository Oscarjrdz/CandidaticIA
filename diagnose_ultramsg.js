
import axios from 'axios';
import { getRedisClient } from './api/utils/storage.js';

async function diagnose() {
    try {
        const redis = getRedisClient();
        const configJson = await redis.get('ultramsg_config');
        if (!configJson) {
            console.error('❌ No ultramsg_config found in Redis');
            return;
        }

        const { instanceId, token } = JSON.parse(configJson);
        console.log(`📡 Instance ID: ${instanceId}`);

        // 1. Check Settings
        const settingsUrl = `https://api.ultramsg.com/${instanceId}/instance/settings`;
        const settingsResp = await axios.get(settingsUrl, { params: { token } });
        console.log('✅ Instance Settings:', JSON.stringify(settingsResp.data, null, 2));

        // 2. Check Contacts (First 5)
        const contactsUrl = `https://api.ultramsg.com/${instanceId}/contacts`;
        const contactsResp = await axios.get(contactsUrl, { params: { token, limit: 5 } });
        console.log('✅ Contacts Sample:', JSON.stringify(contactsResp.data, null, 2));

    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
    } finally {
        process.exit(0);
    }
}

diagnose();
