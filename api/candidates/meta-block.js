import axios from 'axios';

/**
 * Bloqueo REAL en WhatsApp vía Meta Cloud API (Block API).
 * POST /api/candidates/meta-block  { id, block: true|false }
 *
 * OJO: esto es DISTINTO de /api/candidates/block, que solo SILENCIA a la IA
 * (marca `blocked` interno) sin tocar Meta. Aquí sí bloqueamos al número en
 * WhatsApp: al bloquear dejamos de recibir sus mensajes por el webhook, y sus
 * envíos no nos llegan. Al desbloquear se revierte.
 *
 * Requisito de Meta: solo se puede bloquear a un usuario que YA te haya escrito
 * (conversación existente). El estado se refleja en el candidato como `metaBlocked`.
 */
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    try {
        // Seguridad: acción de dashboard que muta datos → requiere sesión admin.
        const { validateAdminSession, getCandidateById, updateCandidate } = await import('../utils/storage.js');
        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ success: false, error: 'No autorizado' });

        const { id, block = true } = req.body || {};
        if (!id) return res.status(400).json({ success: false, error: 'ID de candidato requerido' });

        const candidate = await getCandidateById(id);
        if (!candidate) return res.status(404).json({ success: false, error: 'Candidato no encontrado' });

        // Teléfono en formato wa_id (solo dígitos, con lada) — igual que en los envíos.
        const phone = String(candidate.whatsapp || '').replace(/\D/g, '');
        if (!phone) return res.status(400).json({ success: false, error: 'El candidato no tiene número de WhatsApp válido' });

        const { getMetaConfig, GRAPH_BASE_URL } = await import('../whatsapp/utils.js');
        const config = getMetaConfig();
        if (!config.phoneNumberId || !config.accessToken) {
            return res.status(500).json({ success: false, error: 'Configuración de Meta incompleta (META_PHONE_NUMBER_ID / META_ACCESS_TOKEN)' });
        }

        // Block API: POST para bloquear, DELETE para desbloquear. Mismo endpoint y cuerpo.
        const url = `${GRAPH_BASE_URL}/${config.phoneNumberId}/block_users`;
        const payload = { messaging_product: 'whatsapp', block_users: [{ user: phone }] };
        const response = await axios({
            method: block ? 'post' : 'delete',
            url,
            data: payload,
            headers: {
                'Authorization': `Bearer ${config.accessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000,
            validateStatus: () => true
        });

        // Meta responde con resultado POR usuario (block_users.added_users /
        // failed_users). Consideramos éxito si el número quedó en la lista correcta.
        const data = response.data || {};
        const ok = response.status >= 200 && response.status < 300 &&
            !(Array.isArray(data?.block_users?.failed_users) && data.block_users.failed_users.length > 0);

        if (!ok) {
            const metaErr = data?.error?.message
                || data?.block_users?.failed_users?.[0]?.errors?.[0]?.message
                || `Meta respondió ${response.status}`;
            return res.status(502).json({
                success: false,
                error: block ? 'No se pudo bloquear en WhatsApp' : 'No se pudo desbloquear en WhatsApp',
                metaError: metaErr,
                meta: data
            });
        }

        const now = new Date();
        const updatedCandidate = await updateCandidate(id, block
            ? { metaBlocked: true, metaBlockedAt: now.toISOString() }
            : { metaBlocked: false, metaBlockedAt: null });

        return res.status(200).json({
            success: true,
            message: block ? 'Número bloqueado en WhatsApp' : 'Número desbloqueado en WhatsApp',
            candidate: updatedCandidate,
            meta: data
        });

    } catch (error) {
        console.error('❌ Error en meta-block:', error?.response?.data || error.message);
        return res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            details: error?.response?.data?.error?.message || error.message
        });
    }
}
