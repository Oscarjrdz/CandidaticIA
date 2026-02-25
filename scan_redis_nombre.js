import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl);

async function checkProjects() {
    try {
        const keys = await redis.keys('project:*');
        for (const key of keys) {
            const data = await redis.get(key);
            if (data && data.includes('{{nombre}}')) {
                console.log(`MATCH in project key ${key}`);
            }
        }

        const ruleKeys = await redis.keys('ai_automation:*');
        for (const key of ruleKeys) {
            const data = await redis.get(key);
            if (data && data.includes('{{nombre}}')) {
                console.log(`MATCH in rule key ${key}`);
            }
        }

        const botConfig = await redis.get('bot_ia_prompt');
        if (botConfig && botConfig.includes('{{nombre}}')) {
            console.log("MATCH in bot_ia_prompt");
        }

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkProjects();
