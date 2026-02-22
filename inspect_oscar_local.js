
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

// Extract REDIS_URL from somewhere if possible, or use common local connection
const redis = new Redis('rediss://default:Ab3PAAIjcDE2Njg0NDA1NDI5Zjc0MWIxODAzNTA2MGMzYzNlODAxYXAxMA@clean-shrew-15823.upstash.io:6379');

async function run() {
    try {
        const candidateId = 'cand_1771740607320_w8sn1y0j9';
        const projectId = 'proj_1771225156891_10ez5k';

        const candData = await redis.get(`candidatic:candidate:${candidateId}`);
        const meta = await redis.hget(`project:cand_meta:${projectId}`, candidateId);

        console.log('CANDIDATE_DATA:', candData);
        console.log('CANDIDATE_META:', meta);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
run();
