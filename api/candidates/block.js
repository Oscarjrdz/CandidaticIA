
/**
 * Endpoint para bloquear un candidato en WhatsApp vía UltraMsg
 * POST /api/candidates/block
 */

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    try {
        const { id, block = true } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, error: 'ID de candidato requerido' });
        }

        // 1. Obtener datos del candidato y configuración de UltraMsg
        const { getCandidateById, updateCandidate, HUMAN_INTERVENTION_SILENCE_MS } = await import('../utils/storage.js');
        const { getUltraMsgConfig } = await import('../whatsapp/utils.js');

        const candidate = await getCandidateById(id);
        if (!candidate) {
            return res.status(404).json({ success: false, error: 'Candidato no encontrado' });
        }

        const config = await getUltraMsgConfig();
        if (!config) {
            return res.status(500).json({ success: false, error: 'Configuración de WhatsApp incompleta' });
        }

        const now = new Date();
        const silencePatch = block
            ? {
                blocked: true,
                blockedAt: now.toISOString(),
                blockedExpiresAt: new Date(now.getTime() + HUMAN_INTERVENTION_SILENCE_MS).toISOString(),
                blockedReason: 'human_intervention'
            }
            : {
                blocked: false,
                blockedAt: null,
                blockedExpiresAt: null,
                blockedExpiredAt: null,
                blockedReason: null
            };

        // Solo queremos silenciar la IA (marcar al candidato como bloqueado),
        // NO queremos bloquearlo físicamente en WhatsApp para que el reclutador humano pueda seguir hablando.
        const updatedCandidate = await updateCandidate(id, silencePatch);

        return res.status(200).json({
            success: true,
            message: block ? 'Chat silenciado de la IA correctamente' : 'IA reactivada para este chat',
            candidate: updatedCandidate,
            remote: { success: true }
        });

    } catch (error) {
        console.error('❌ Error bloqueando candidato:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            details: error.message
        });
    }
}
