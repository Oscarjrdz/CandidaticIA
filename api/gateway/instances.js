/**
 * GET  /api/gateway/instances  — List all instances
 * POST /api/gateway/instances  — Create new instance
 * DELETE /api/gateway/instances?instanceId=xxx — Delete instance
 */

import {
    createInstance, getAllInstances, deleteInstance, getInstance, updateInstance
} from './session-engine.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // ── LIST ──────────────────────────────────────────────────────────────
        if (req.method === 'GET') {
            const instances = await getAllInstances();
            // Mask full token for security (show only first 8 chars)
            const safe = instances.map(i => ({
                ...i,
                token: i.token ? `${i.token.substring(0, 8)}••••••••` : null,
                _tokenFull: undefined
            }));
            return res.status(200).json({ success: true, instances: safe });
        }

        // ── CREATE ────────────────────────────────────────────────────────────
        if (req.method === 'POST') {
            const { name, webhookUrl, createdBy } = req.body || {};
            if (!name?.trim()) {
                return res.status(400).json({ success: false, error: 'El nombre de la instancia es requerido.' });
            }

            const instance = await createInstance({ name, webhookUrl, createdBy });

            return res.status(201).json({
                success: true,
                instance: {
                    ...instance,
                    // Return full token ONLY on creation — never again after this
                    token: instance.token
                }
            });
        }

        // ── DELETE ────────────────────────────────────────────────────────────
        if (req.method === 'DELETE') {
            const { instanceId } = req.query;
            if (!instanceId) {
                return res.status(400).json({ success: false, error: 'instanceId requerido.' });
            }
            const existing = await getInstance(instanceId);
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Instancia no encontrada.' });
            }
            await deleteInstance(instanceId);
            return res.status(200).json({ success: true, message: 'Instancia eliminada.' });
        }

        // ── PATCH — Update webhook URL / name ─────────────────────────────────
        if (req.method === 'PATCH') {
            const { instanceId } = req.query;
            if (!instanceId) return res.status(400).json({ success: false, error: 'instanceId requerido.' });
            const existing = await getInstance(instanceId);
            if (!existing) return res.status(404).json({ success: false, error: 'Instancia no encontrada.' });
            const { webhookUrl, name } = req.body || {};
            const updates = {};
            if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl.trim();
            if (name?.trim()) updates.name = name.trim();
            const updated = await updateInstance(instanceId, updates);
            return res.status(200).json({ success: true, instance: { ...updated, token: updated.token ? `${updated.token.substring(0, 8)}••••••••` : null } });
        }

        return res.status(405).json({ success: false, error: 'Method Not Allowed' });


    } catch (err) {
        console.error('[GATEWAY /instances]', err.message);
        return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
}
