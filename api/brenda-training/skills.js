import { getRedisClient } from '../utils/storage.js';
import {
    requireSuperAdmin,
    listSkills,
    saveSkill,
    removeSkill
} from '../utils/brenda-training.js';

// ════════════════════════════════════════════════════════════════════════════
// SKILLS (clientes / vacantes) — CRUD.  Una Skill = los HECHOS CERRADOS de una
// vacante de un cliente (Katcon, Metalsa, Yageo...): sueldo, turno, ubicación,
// beneficios, reglas duras. Datos rígidos, no negociables — el agente persuade
// SOBRE estos hechos, no los cambia. Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

const MAX_NAME = 80;
const MAX_FIELD = 400;
const MAX_NOTES = 2000;
const MAX_LIST_ITEMS = 20;

// Normaliza una lista (beneficios/reglas): acepta array o texto con saltos de línea,
// recorta cada ítem y limita cuántos entran, para no meter basura al prompt.
function normalizeList(value) {
    let arr = [];
    if (Array.isArray(value)) arr = value;
    else if (typeof value === 'string') arr = value.split('\n');
    return arr
        .map(v => String(v || '').trim().slice(0, MAX_FIELD))
        .filter(Boolean)
        .slice(0, MAX_LIST_ITEMS);
}

export default async function handler(req, res) {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ success: false, error: 'Redis unavailable' });

    if (req.method === 'GET') {
        try {
            const skills = await listSkills(redis);
            return res.status(200).json({ success: true, skills });
        } catch (error) {
            console.error('❌ [BrendaTraining] skills GET error:', error);
            return res.status(500).json({ success: false, error: 'No se pudieron cargar las skills', detail: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const body = req.body || {};
            const name = String(body.name || '').trim().slice(0, MAX_NAME);
            if (!name) return res.status(400).json({ success: false, error: 'La skill necesita un nombre (ej. "Skill Katcon")' });

            const skill = await saveSkill(redis, {
                id: body.id || undefined,
                name,
                clientName: String(body.clientName || '').trim().slice(0, MAX_NAME),
                salary: String(body.salary || '').trim().slice(0, MAX_FIELD),
                schedule: String(body.schedule || '').trim().slice(0, MAX_FIELD),
                restDays: String(body.restDays || '').trim().slice(0, MAX_FIELD),
                location: String(body.location || '').trim().slice(0, MAX_FIELD),
                benefits: normalizeList(body.benefits),
                rules: normalizeList(body.rules),
                notes: String(body.notes || '').slice(0, MAX_NOTES),
                color: String(body.color || '#d97706').slice(0, 12)
            }, user.name || user.id);

            return res.status(200).json({ success: true, skill });
        } catch (error) {
            console.error('❌ [BrendaTraining] skills POST error:', error);
            return res.status(500).json({ success: false, error: 'No se pudo guardar la skill', detail: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const id = req.body?.id || req.query?.id;
            if (!id) return res.status(400).json({ success: false, error: 'Falta el id de la skill' });

            const removed = await removeSkill(redis, id);
            if (!removed) return res.status(404).json({ success: false, error: 'No se encontro esa skill' });

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error('❌ [BrendaTraining] skills DELETE error:', error);
            return res.status(500).json({ success: false, error: 'No se pudo quitar la skill', detail: error.message });
        }
    }

    return res.status(405).json({ success: false, error: 'Metodo no permitido' });
}
