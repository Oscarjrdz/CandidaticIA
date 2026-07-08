import { getRedisClient } from '../utils/storage.js';
import {
    requireSuperAdmin,
    getPersona,
    savePersona,
    getPersonaHistory,
    getTrainingTokensToday
} from '../utils/brenda-training.js';

const MAX_STYLE_GUIDE_CHARS = 20000;

export default async function handler(req, res) {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ success: false, error: 'Redis unavailable' });

    if (req.method === 'GET') {
        try {
            const [persona, history, tagsRaw, tokensToday] = await Promise.all([
                getPersona(redis),
                getPersonaHistory(redis),
                redis.get('candidatic:chat_tags'),
                getTrainingTokensToday(redis)
            ]);
            const availableTags = tagsRaw ? JSON.parse(tagsRaw) : [];

            return res.status(200).json({
                success: true,
                persona,
                history,
                availableTags,
                tokensToday
            });
        } catch (error) {
            console.error('❌ [BrendaTraining] persona GET error:', error);
            return res.status(500).json({ success: false, error: 'No se pudo cargar la personalidad', detail: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const { restoreVersion } = req.body || {};

            let styleGuide = req.body?.styleGuide;
            let source = 'manual-edit';

            if (restoreVersion !== undefined && restoreVersion !== null) {
                const history = await getPersonaHistory(redis);
                const target = history.find(h => h.version === Number(restoreVersion));
                if (!target) {
                    return res.status(404).json({ success: false, error: 'No se encontro esa version en el historial' });
                }
                styleGuide = target.styleGuide;
                source = `restore-v${target.version}`;
            }

            styleGuide = String(styleGuide || '').slice(0, MAX_STYLE_GUIDE_CHARS);
            if (!styleGuide.trim()) {
                return res.status(400).json({ success: false, error: 'La personalidad no puede quedar vacia' });
            }

            const persona = await savePersona(redis, { styleGuide, updatedBy: user.name || user.id, source });
            return res.status(200).json({ success: true, persona });
        } catch (error) {
            console.error('❌ [BrendaTraining] persona POST error:', error);
            return res.status(500).json({ success: false, error: 'No se pudo guardar la personalidad', detail: error.message });
        }
    }

    return res.status(405).json({ success: false, error: 'Metodo no permitido' });
}
