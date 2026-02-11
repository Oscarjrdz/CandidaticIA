
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
        if (!config || !config.instanceId || !config.token) {
            return res.status(500).json({ success: false, error: 'Configuración de UltraMsg incompleta' });
        }

        // 2. Ejecutar acción en UltraMsg
        let remoteResult;
        const chatId = candidate.whatsapp || candidate.phone || id;

        if (block) {
            remoteResult = await blockUltraMsgContact(config.instanceId, config.token, chatId);
        } else {
            remoteResult = await unblockUltraMsgContact(config.instanceId, config.token, chatId);
        }

        if (!remoteResult.success) {
            console.warn(`❌ [Block] UltraMsg error for ${id}:`, remoteResult.error);
        } else {
            console.log(`✅ [Block] UltraMsg success for ${id}:`, remoteResult.data);
        }

        // 3. Marcar en base de datos local
        await updateCandidate(id, { blocked: block });

        return res.status(200).json({
            success: true,
            message: block ? 'Candidato bloqueado correctamente' : 'Candidato desbloqueado',
            remote: remoteResult // Expose the actual answer from UltraMsg
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
