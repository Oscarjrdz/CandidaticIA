
import fs from 'fs';
import Redis from 'ioredis';

const test = async () => {
    try {
        const envContent = fs.readFileSync('.env.prod.local', 'utf8');
        const redisUrlMatch = envContent.match(/REDIS_URL="?([^"\n]+)/);
        if (!redisUrlMatch) {
            console.error("No REDIS_URL found");
            process.exit(1);
        }
        const redisUrl = redisUrlMatch[1];
        const client = new Redis(redisUrl, { tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined });

        const phone = '5218116038195';
        const targetId = 'cand_1771728336981_ruphv52we';
        const shadowIds = ['cand_1771728055257_7j7hlpmye', 'cand_1771726814989_dab373w5f', 'cand_1771727730973_klp1gadx5'];
        const projectId = 'proj_1771225156891_10ez5k';

        console.log(`Setting phone index for ${phone} to ${targetId}...`);
        await client.hset('candidatic:phone_index', phone, targetId);

        console.log(`Linking ${targetId} to project ${projectId}...`);
        await client.hset('index:cand_project', targetId, projectId);
        await client.sadd(`project:candidates:${projectId}`, targetId);

        // Ensure the candidate record itself has the projectId
        const candData = await client.get(`candidate:${targetId}`);
        if (candData) {
            const parsed = JSON.parse(candData);
            parsed.projectId = projectId;
            parsed.stepId = 'step_new';
            await client.set(`candidate:${targetId}`, JSON.stringify(parsed));
            console.log("Updated candidate record with project info.");
        }

        for (const id of shadowIds) {
            console.log(`Cleaning up shadow ID ${id}...`);
            await client.del(`candidate:${id}`);
            await client.zrem('candidatic:candidates:list', id);
            await client.srem('candidatic:candidates_complete', id); // Just in case
            await client.srem('candidatic:candidates_pending', id);   // Just in case
            await client.hdel('index:cand_project', id);
        }

        console.log("✅ Consolidation complete.");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};
test();
