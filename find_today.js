import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl);

async function findTodayCandidates() {
    try {
        console.log("Searching for candidates active today (2026-02-25)...");
        const ids = await redis.zrevrange('candidates:list', 0, 100);

        for (const id of ids) {
            const data = await redis.get(`candidate:${id}`);
            if (data) {
                const candidate = JSON.parse(data);
                if (candidate.ultimoMensaje && candidate.ultimoMensaje.startsWith('2026-02-25')) {
                    console.log(`MATCH: [${id}] Name: ${candidate.nombreReal || candidate.nombre} | Msg: ${candidate.ultimoMensaje} | Phone: ${candidate.whatsapp}`);
                }
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

findTodayCandidates();
