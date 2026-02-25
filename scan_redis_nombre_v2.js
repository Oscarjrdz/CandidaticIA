import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl);

async function checkProjects() {
    try {
        const keys = await redis.keys('*');
        console.log(`Scanning ${keys.length} keys...`);
        for (const key of keys) {
            const type = await redis.type(key);
            let data = "";
            if (type === 'string') {
                data = await redis.get(key);
            } else if (type === 'hash') {
                const h = await redis.hgetall(key);
                data = JSON.stringify(h);
            }

            if (data && data.includes('{{nombre}}')) {
                console.log(`MATCH in key [${key}] (Type: ${type})`);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkProjects();
