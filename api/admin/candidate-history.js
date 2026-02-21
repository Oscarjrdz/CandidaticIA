import { getVacancyHistory, getProjectById } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { candidateId } = req.query;

    if (!candidateId) {
        return res.status(400).json({ error: 'candidateId is required' });
    }

    try {
        const history = await getVacancyHistory(candidateId);

        // Enrich history with Project Names if possible, to avoid frontend waterfall requests
        const enrichedHistory = await Promise.all(history.map(async (event) => {
            let projectName = 'Proyecto Desconocido';
            if (event.projectId) {
                const proj = await getProjectById(event.projectId);
                if (proj && proj.name) {
                    projectName = proj.name;
                }
            }
            return {
                ...event,
                projectName
            };
        }));

        res.status(200).json({ success: true, history: enrichedHistory });
    } catch (error) {
        console.error(`[Admin API] Error fetching vacancy history for ${candidateId}:`, error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}
