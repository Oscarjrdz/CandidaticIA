import { getAIAutomations, saveAIAutomation, deleteAIAutomation } from '../utils/storage.js';

export default async function handler(req, res) {
    try {
        if (req.method === 'GET') {
            const list = await getAIAutomations();
            return res.status(200).json({ success: true, automations: list });
        }

        if (req.method === 'POST') {
            // Robust body parsing handling
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) { }
            }

            const { id, name, prompt, schedule, active } = body || {};

            if (!prompt || !name) {
                console.warn('⚠️ Missing fields in AI automation creation:', { name, prompt });
                return res.status(400).json({ error: 'Faltan campos requeridos (nombre, prompt)' });
            }

            const automation = {
                id: id || `ai_rule_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
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
    } catch (error) {
        console.error('❌ Error in AI automations API:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
