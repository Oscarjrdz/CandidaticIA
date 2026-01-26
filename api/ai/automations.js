import { getAIAutomations, saveAIAutomation, deleteAIAutomation } from '../utils/storage.js';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        const list = await getAIAutomations();
        return res.status(200).json({ success: true, automations: list });
    }

    if (req.method === 'POST') {
        const { id, name, prompt, schedule, active } = req.body;

        if (!prompt || !name) {
            return res.status(400).json({ error: 'Faltan campos requeridos (nombre, prompt)' });
        }

        const automation = {
            id: id || uuidv4(),
            name,
            prompt,
            schedule: schedule || 'daily',
            active: active !== undefined ? active : true,
            updatedAt: new Date().toISOString()
        };

        const saved = await saveAIAutomation(automation);
        return res.status(200).json({ success: true, automation: saved });
    }

    if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'ID requerido' });

        await deleteAIAutomation(id);
        return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
