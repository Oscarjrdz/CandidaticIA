import { getRedisClient } from './api/utils/storage.js';

(async () => {
    try {
        const redis = getRedisClient();
        const cfgRaw = await redis.get('ultramsg_credentials') || await redis.get('ultramsg_config');
        const instancesRaw = await redis.get('ultramsg_instances');
        
        let instanceId, token;
        
        if (instancesRaw) {
            const instances = JSON.parse(instancesRaw);
            const active = instances.find(i => i.status === 'active') || instances[0];
            if (active) { instanceId = active.instanceId; token = active.token; }
        }
        
        if (!instanceId && cfgRaw) {
            const parsed = typeof cfgRaw === 'string' ? JSON.parse(cfgRaw) : cfgRaw;
            instanceId = parsed.instanceId;
            token = parsed.token;
        }

        console.log(`Using instanceId: ${instanceId}, token: ${token?.substring(0, 5)}...`);

        const url = `https://gatewaywapp-production.up.railway.app/${instanceId}/stories`;
        const payload = {
            token: token,
            type: 'text',
            text: 'Prueba de estado API 🚀',
            color: '#128C7E',
            font: 0
        };

        console.log(`POST ${url}`);
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        console.log(`Status code: ${res.status}`);
        console.log(`Response:`, JSON.stringify(data, null, 2));

        process.exit(0);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
})();
