import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl);

async function findOscar() {
    try {
        console.log("Searching for Oscar...");
        const ids = await redis.zrevrange('candidates:list', 0, 50);
        console.log(`Found ${ids.length} recent candidates. Checking names...`);

        for (const id of ids) {
            const data = await redis.get(`candidate:${id}`);
            if (data) {
                const candidate = JSON.parse(data);
                const name = (candidate.nombreReal || candidate.nombre || '').toLowerCase();
                if (name.includes('oscar')) {
                    console.log(`MATCH: [${id}] Name: ${candidate.nombreReal || candidate.nombre} Phone: ${candidate.whatsapp}`);
                }
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

findOscar();
