/**
 * GET /api/gateway/history?instanceId=xxx&limit=50
 * Returns recent message history for an instance.
 */
import { getInstance, getHistory, validateToken } from './session-engine.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { instanceId, token, limit = 50 } = req.query;
    if (!instanceId) return res.status(400).json({ success: false, error: 'instanceId requerido.' });
    if (!token) return res.status(401).json({ success: false, error: 'Token requerido.' });

    try {
        const valid = await validateToken(instanceId, token);
        if (!valid) return res.status(403).json({ success: false, error: 'Token inválido.' });

        const instance = await getInstance(instanceId);
        if (!instance) return res.status(404).json({ success: false, error: 'Instancia no encontrada.' });

        const history = await getHistory(instanceId, Math.min(parseInt(limit), 200));
        return res.status(200).json({ success: true, instanceId, history });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
}
