
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
        const { getCandidateById, updateCandidate } = await import('../utils/storage.js');
        const { getUltraMsgConfig, blockUltraMsgContact, unblockUltraMsgContact } = await import('../whatsapp/utils.js');

        const candidate = await getCandidateById(id);
        if (!candidate) {
            return res.status(404).json({ success: false, error: 'Candidato no encontrado' });
        }

        const config = await getUltraMsgConfig();
        if (!config) {
            return res.status(500).json({ success: false, error: 'Configuración de WhatsApp incompleta' });
        }

        // Solo queremos silenciar la IA (marcar al candidato como bloqueado), 
        // NO queremos bloquearlo físicamente en WhatsApp para que el reclutador humano pueda seguir hablando.
        await updateCandidate(id, { blocked: block });

        return res.status(200).json({
            success: true,
            message: block ? 'Chat silenciado de la IA correctamente' : 'IA reactivada para este chat',
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
