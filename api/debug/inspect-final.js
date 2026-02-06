import { getRedisClient, getCandidateByPhone, getProjectById } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'No Redis client' });

        const phone = '5218116038195'; // Oscar's phone
        const candidate = await getCandidateByPhone(phone);

        let project = null;
        if (candidate?.projectMetadata?.projectId) {
            project = await getProjectById(candidate.projectMetadata.projectId);
        }

        // Also scan for any other project that might have the string
        const allKeys = await redis.keys('project:*');
        const suspiciousProjects = [];
        for (const key of allKeys) {
            const data = await redis.get(key);
            if (data && (data.includes('Santiago') || data.includes('Ayudante'))) {
                suspiciousProjects.push({ key, data: JSON.parse(data) });
            }
        }

        return res.status(200).json({
            success: true,
            candidate: {
                id: candidate?.id,
                projectMetadata: candidate?.projectMetadata
            },
            projectAttached: project,
            suspiciousProjectsFound: suspiciousProjects
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
