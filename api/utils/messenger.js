import axios from 'axios';

const BASE_URL = 'https://app.builderbot.cloud/api/v2';

/**
 * Helper to get credentials from Env or Redis
 */
async function getCredentials() {
    // 1. Try Environment Variables
    let botId = process.env.BOT_ID;
    let apiKey = process.env.BOT_TOKEN || process.env.API_KEY;

    if (botId && apiKey) {
        return { botId, apiKey, source: 'env' };
    }

    // 2. Try Redis (Fallback)
    try {
        // Dynamic import to avoid cycles or load issues
        const { getRedisClient } = await import('./storage.js');
        const redis = getRedisClient();

        if (redis) {
            const raw = await redis.get('builderbot_credentials');
            if (raw) {
                const creds = JSON.parse(raw);
                if (creds.botId && (creds.apiKey || creds.token)) {
                    return {
                        botId: creds.botId,
                        apiKey: creds.apiKey || creds.token,
                        source: 'redis'
                    };
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Failed to fetch credentials from Redis:', e.message);
    }

    return { botId: null, apiKey: null, source: 'none' };
}

export const sendMessage = async (number, message) => {
    try {
        const { botId: BOT_ID, apiKey: API_KEY, source } = await getCredentials();

        if (!BOT_ID) {
            console.error('❌ Missing BOT_ID (Checked Env & Redis)');
            return { success: false, error: 'Configuration missing: BOT_ID' };
        }

        if (!API_KEY) {
            console.error('❌ Missing API_KEY (Checked Env & Redis)');
            return { success: false, error: 'Configuration missing: BOT_TOKEN' };
        }

        console.log(`📤 Sending WhatsApp via ${source}...`);

        const url = `${BASE_URL}/${BOT_ID}/messages`;
        const payload = {
            messages: {
                type: "text",
                content: message
            },
            number: number,
            checkIfExists: false
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': API_KEY,
            }
        });

        return {
            success: true,
            data: response.data,
        };
    } catch (error) {
        console.error('❌ Network/System error sending message:', error.response?.data || error.message);
        return {
            success: false,
            status: error.response?.status,
            error: error.response?.data || error.message,
        };
    }
};
