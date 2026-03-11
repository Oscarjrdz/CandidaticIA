/**
 * GET /api/gateway/status?instanceId=xxx
 * Returns current state, phone, and counters for an instance.
 */
import { getInstance } from './session-engine.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { instanceId } = req.query;
    if (!instanceId) return res.status(400).json({ success: false, error: 'instanceId requerido.' });

    try {
        const instance = await getInstance(instanceId);
        if (!instance) return res.status(404).json({ success: false, error: 'Instancia no encontrada.' });

        return res.status(200).json({
            success: true,
            instanceId: instance.instanceId,
            name: instance.name,
            state: instance.state,
            phone: instance.phone || null,
            connectedAt: instance.connectedAt || null,
            messagesIn: instance.messagesIn || 0,
            messagesOut: instance.messagesOut || 0
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
}
