import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: "No Redis" });

    const bot_ia_prompt = await redis.get('bot_ia_prompt');
    const assistant_ia_prompt = await redis.get('assistant_ia_prompt');
    const automations = await redis.get('ai:automations:list');

    // Get all projects
    const projectsKey = 'projects:all';
    const projectIds = await redis.zrevrange(projectsKey, 0, -1);
    const projects = [];
    if (projectIds) {
        for (const id of projectIds) {
            const p = await redis.get(`project:${id}`);
            if (p) projects.push(JSON.parse(p));
        }
    }

    res.status(200).json({
        bot_ia_prompt,
        assistant_ia_prompt,
        automations: automations ? JSON.parse(automations) : [],
        projects
    });
}
