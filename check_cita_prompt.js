import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);
async function run() {
    const keys = await redis.keys('project:*');
    for (const k of keys) {
        try {
            if (!k.includes('project:steps') && !k.includes('project:searches')) {
                const type = await redis.type(k);
                if (type === 'string') {
                    const pStr = await redis.get(k);
                    if (pStr && pStr.startsWith('{')) {
                        const p = JSON.parse(pStr);
                        if (p.name && p.name.includes('AISIN')) {
                            const steps = await redis.get('project:steps:' + p.id);
                            if (steps) {
                                const sArr = JSON.parse(steps);
                                for (const s of sArr) {
                                    if (s.name === 'Cita') {
                                        console.log('[PROMPT CITA]:', s.aiConfig.prompt);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // ignore
        }
    }
    process.exit(0);
}
run();
