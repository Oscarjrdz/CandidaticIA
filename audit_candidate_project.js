import { getRedisClient, getCandidateIdByPhone, getProjectById } from './api/utils/storage.js';

async function audit() {
    const phone = '5218116038195';
    console.log(`Auditing candidate: ${phone}`);

    const redis = getRedisClient();
    if (!redis) {
        console.error('No Redis client available');
        return;
    }

    try {
        const candidateId = await getCandidateIdByPhone(phone);
        if (!candidateId) {
            console.error('Candidate ID not found for phone');
            return;
        }

        const candidateRaw = await redis.get(`candidate:${candidateId}`);
        const candidate = JSON.parse(candidateRaw);
        console.log('Candidate Data:', JSON.stringify(candidate, null, 2));

        const projectId = candidate.projectId || candidate.projectMetadata?.projectId;
        if (!projectId) {
            console.log('Candidate is not in a project.');
            return;
        }

        const project = await getProjectById(projectId);
        console.log('Project Steps:', JSON.stringify(project.steps.map(s => ({ id: s.id, name: s.name, aiEnabled: !!s.aiConfig?.enabled, hasPrompt: !!s.aiConfig?.prompt })), null, 2));

        const bridgeSticker = await redis.get('bot_step_move_sticker');
        console.log('Bridge Sticker Key (bot_step_move_sticker):', bridgeSticker ? 'FOUND' : 'MISSING');

    } catch (e) {
        console.error('Audit Error:', e.message);
    } finally {
        process.exit();
    }
}

audit();
