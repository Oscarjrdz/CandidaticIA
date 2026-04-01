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
        
        // Ensure instance prefix is removed
        const cleanInstanceId = instanceId.replace(/^instance/, '');

        console.log(`Using instanceId: ${cleanInstanceId}, token: ${token?.substring(0, 5)}...`);

        const url = `https://gatewaywapp-production.up.railway.app/${cleanInstanceId}/stories`;
        const payload = {
            token: token,
            type: 'text',
            text: 'Prueba sin prefijo instance 🚀',
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
        process.exit(1);
    }
})();
