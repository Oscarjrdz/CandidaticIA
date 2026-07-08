import { getRedisClient } from '../utils/storage.js';
import {
    requireSuperAdmin,
    getTrainingExamples,
    addTrainingExample,
    removeTrainingExample
} from '../utils/brenda-training.js';

const MAX_TEXT_CHARS = 1500;

export default async function handler(req, res) {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ success: false, error: 'Redis unavailable' });

    if (req.method === 'GET') {
        try {
            const examples = await getTrainingExamples(redis);
            return res.status(200).json({ success: true, examples });
        } catch (error) {
            console.error('❌ [BrendaTraining] examples GET error:', error);
            return res.status(500).json({ success: false, error: 'No se pudieron cargar los ejemplos', detail: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const candidateSaid = String(req.body?.candidateSaid || '').trim().slice(0, MAX_TEXT_CHARS);
            const recruiterSaid = String(req.body?.recruiterSaid || '').trim().slice(0, MAX_TEXT_CHARS);
            if (!candidateSaid || !recruiterSaid) {
                return res.status(400).json({ success: false, error: 'Faltan los dos lados del ejemplo (candidato y Brenda)' });
            }

            const example = await addTrainingExample(redis, { candidateSaid, recruiterSaid, addedBy: user.name || user.id });
            return res.status(200).json({ success: true, example });
        } catch (error) {
            console.error('❌ [BrendaTraining] examples POST error:', error);
            return res.status(500).json({ success: false, error: 'No se pudo agregar el ejemplo', detail: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const id = req.body?.id || req.query?.id;
            if (!id) return res.status(400).json({ success: false, error: 'Falta el id del ejemplo' });

            const removed = await removeTrainingExample(redis, id);
            if (!removed) return res.status(404).json({ success: false, error: 'No se encontro ese ejemplo' });

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error('❌ [BrendaTraining] examples DELETE error:', error);
            return res.status(500).json({ success: false, error: 'No se pudo quitar el ejemplo', detail: error.message });
        }
    }

    return res.status(405).json({ success: false, error: 'Metodo no permitido' });
}
