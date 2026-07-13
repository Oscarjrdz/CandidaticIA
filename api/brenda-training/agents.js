import { getRedisClient } from '../utils/storage.js';
import {
    requireSuperAdmin,
    listAgents,
    saveAgent,
    removeAgent
} from '../utils/brenda-training.js';

// ════════════════════════════════════════════════════════════════════════════
// AGENTES (reclutadores) — CRUD.  Un Agente = el ESTILO de un reclutador real
// (Oscar, Paty, Sam...) que conduce a Brenda por detrás. NO lleva nombre de empresa
// a propósito: el mismo agente se compone con cualquier Skill/cliente.
// Mismo patrón, auth y forma de respuesta que examples.js. Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

const MAX_NAME = 80;
const MAX_STYLE = 20000;
const MAX_NOTES = 2000;

export default async function handler(req, res) {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ success: false, error: 'Redis unavailable' });

    if (req.method === 'GET') {
        try {
            const agents = await listAgents(redis);
            return res.status(200).json({ success: true, agents });
        } catch (error) {
            console.error('❌ [BrendaTraining] agents GET error:', error);
            return res.status(500).json({ success: false, error: 'No se pudieron cargar los agentes', detail: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const body = req.body || {};
            const name = String(body.name || '').trim().slice(0, MAX_NAME);
            if (!name) return res.status(400).json({ success: false, error: 'El agente necesita un nombre (ej. "Oscar Agent")' });

            const agent = await saveAgent(redis, {
                id: body.id || undefined,
                name,
                recruiterName: String(body.recruiterName || '').trim().slice(0, MAX_NAME),
                styleGuide: String(body.styleGuide || '').slice(0, MAX_STYLE),
                notes: String(body.notes || '').slice(0, MAX_NOTES),
                color: String(body.color || '#2563eb').slice(0, 12)
            }, user.name || user.id);

            return res.status(200).json({ success: true, agent });
        } catch (error) {
            console.error('❌ [BrendaTraining] agents POST error:', error);
            return res.status(500).json({ success: false, error: 'No se pudo guardar el agente', detail: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const id = req.body?.id || req.query?.id;
            if (!id) return res.status(400).json({ success: false, error: 'Falta el id del agente' });

            const removed = await removeAgent(redis, id);
            if (!removed) return res.status(404).json({ success: false, error: 'No se encontro ese agente' });

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error('❌ [BrendaTraining] agents DELETE error:', error);
            return res.status(500).json({ success: false, error: 'No se pudo quitar el agente', detail: error.message });
        }
    }

    return res.status(405).json({ success: false, error: 'Metodo no permitido' });
}
