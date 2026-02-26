import axios from 'axios';
import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";

async function run() {
    const redis = new Redis(redisUrl);
    const aiConfigRaw = await redis.get('ai_config');
    const ultramsgConfigRaw = await redis.get('ultramsg_config') || await redis.get('ultramsg_credentials');

    let instanceId, token;

    if (ultramsgConfigRaw) {
        const config = JSON.parse(ultramsgConfigRaw);
        instanceId = config.instanceId;
        token = config.token;
    }

    if (!instanceId || !token) {
        console.error('UltraMsg config not found in Redis');
        process.exit(1);
    }

    console.log(`--- CHECKING ULTRAMSG INSTANCE (${instanceId}) ---`);
    try {
        const statusRes = await axios.get(`https://api.ultramsg.com/${instanceId}/instance/status`, { params: { token } });
        console.log('Status:', JSON.stringify(statusRes.data, null, 2));

        const settingsRes = await axios.get(`https://api.ultramsg.com/${instanceId}/instance/settings`, { params: { token } });
        console.log('Settings (Webhook URL):', settingsRes.data.webhook_url);
    } catch (e) {
        console.error('Failed to check UltraMsg status:', e.message);
    }

    process.exit(0);
}

run().catch(console.error);
