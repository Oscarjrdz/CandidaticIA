import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const data = await redis.get('candidatic_vacancies');
        const vacancies = data ? JSON.parse(data) : [];

        return res.status(200).json({
            success: true,
            count: vacancies.length,
            vacancies: vacancies.map(v => ({
                id: v.id,
                name: v.name,
                company: v.empresa
            }))
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
