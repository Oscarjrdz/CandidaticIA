/**
 * /api/reminder-templates
 * CRUD para plantillas reutilizables de recordatorio (creadas desde CandidateReminderModal).
 *
 * Sigue el mismo patrón que /api/quick_replies: una sola llave de Redis con el
 * arreglo JSON completo de plantillas — el frontend manda el arreglo ya modificado
 * (agregado o filtrado) y aquí se sobrescribe entero.
 *
 * Cada plantilla: { id, name, message, scheduleType, dayOffset, timeOfDay, cutoffTime,
 * fallbackTemplateName, fallbackTemplateLanguage, createdAt }. dayOffset/timeOfDay son
 * relativos al momento en que se aplica la plantilla (no una fecha absoluta), para que sea
 * reutilizable con cualquier candidato en cualquier día. scheduleType: 'nextBusinessDay'
 * recalcula el próximo día hábil al usarla (viernes→lunes, hora de Monterrey); 'fixedOffset'
 * (o ausente, plantillas viejas) usa dayOffset/timeOfDay tal cual. cutoffTime ("HH:MM",
 * opcional, solo para 'nextBusinessDay'): si la plantilla se aplica a esa hora o después,
 * brinca un día hábil más (demasiado tarde para agendar cita para el día siguiente).
 * El cálculo compartido vive en api/utils/reminder-schedule.js.
 *
 * GET  → { success, templates }
 * POST { templates } → sobrescribe el arreglo completo
 */
export default async function handler(req, res) {
    try {
        const { getRedisClient, validateAdminSession } = await import('./utils/storage.js');
        const { invalidateCache } = await import('./utils/cache.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });
        const redis = getRedisClient();
        const KEY = 'candidatic:reminder_templates';

        if (req.method === 'GET') {
            const raw = await redis.get(KEY);
            const templates = raw ? JSON.parse(raw) : [];
            return res.status(200).json({ success: true, templates });
        }

        if (req.method === 'POST') {
            const { templates } = req.body || {};
            if (!Array.isArray(templates)) {
                return res.status(400).json({ error: 'templates debe ser un arreglo' });
            }
            await redis.set(KEY, JSON.stringify(templates));
            invalidateCache(KEY);
            return res.status(200).json({ success: true, templates });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
