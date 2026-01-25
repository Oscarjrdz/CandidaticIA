
import { getRedisClient, getCandidateIdByPhone } from './utils/storage.js';

export default async function handler(req, res) {
    const phone = '5218116038195';
    const redis = getRedisClient();

    try {
        const candidateId = await getCandidateIdByPhone(phone);
        if (!candidateId) return res.json({ error: 'Candidate not found' });

        const raw = await redis.get(`candidate:${candidateId}`);
        const data = raw ? JSON.parse(raw) : null;

        return res.json({
            phone,
            candidateId,
            profilePic: data?.profilePic || 'Not Found',
            data: data // Show all just in case
        });
    } catch (e) {
        return res.json({ error: e.message });
    }
}
