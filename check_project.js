import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl);

async function checkProject() {
    const candidateId = "cand_1772036194177_thr89clam";
    try {
        const data = await redis.get(`candidate:${candidateId}`);
        const c = JSON.parse(data);
        console.log(`Candidate ${candidateId} Project: ${c.projectId || 'None'}`);
        console.log(`Candidate ${candidateId} Step: ${c.stepId || 'None'}`);
        console.log(`Candidate ${candidateId} statusAudit: ${c.statusAudit || 'None'}`);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

checkProject();
