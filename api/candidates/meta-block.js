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
        if (!config.accessToken) {
            return res.status(500).json({ success: false, error: 'Configuración de Meta incompleta (META_ACCESS_TOKEN)' });
        }

        // Candidatic es MULTI-NÚMERO. Bloqueamos en TODOS los números de negocio del WABA a la vez
        // ("de todos"): así un candidato que escribió a varios números en distintos momentos queda
        // bloqueado en todos. El número donde conversa hoy (incomingPhoneNumberId) SIEMPRE va en la
        // lista para garantizar al menos un bloqueo válido (el Block API es por phone-number-id y solo
        // permite bloquear a quien te escribió EN ese número → en los demás fallará, y es esperado).
        const authHeaders = {
            'Authorization': `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json'
        };
        const activeNumber = candidate.incomingPhoneNumberId || candidate.instanceId || config.phoneNumberId;

        // Lista de todos los números del WABA (fallback al activo/principal si no se puede listar).
        let phoneNumberIds = [];
        if (config.wabaId) {
            try {
                const listRes = await axios.get(`${GRAPH_BASE_URL}/${config.wabaId}/phone_numbers`, {
                    headers: authHeaders, timeout: 10000, params: { fields: 'id', limit: 50 }, validateStatus: () => true
                });
                phoneNumberIds = (listRes.data?.data || []).map(n => n.id).filter(Boolean);
            } catch { /* fallback abajo */ }
        }
        // Garantiza el número activo y quita duplicados/vacíos.
        phoneNumberIds = [...new Set([activeNumber, ...phoneNumberIds].filter(Boolean))];
        if (phoneNumberIds.length === 0) {
            return res.status(500).json({ success: false, error: 'No se pudo determinar ningún número de WhatsApp para el bloqueo' });
        }

        // Block API: POST para bloquear, DELETE para desbloquear. Mismo cuerpo en cada número.
        const payload = { messaging_product: 'whatsapp', block_users: [{ user: phone }] };
        const perNumber = await Promise.all(phoneNumberIds.map(async (pid) => {
            try {
                const r = await axios({
                    method: block ? 'post' : 'delete',
                    url: `${GRAPH_BASE_URL}/${pid}/block_users`,
                    data: payload, headers: authHeaders, timeout: 30000, validateStatus: () => true
                });
                const d = r.data || {};
                const numberOk = r.status >= 200 && r.status < 300 &&
                    !(Array.isArray(d?.block_users?.failed_users) && d.block_users.failed_users.length > 0);
                return { pid, ok: numberOk, status: r.status, data: d };
            } catch (e) {
                return { pid, ok: false, error: e?.response?.data?.error?.message || e.message };
            }
        }));

        // Éxito si al menos UN número se bloqueó/desbloqueó (los otros fallan por no tener
        // conversación con ese candidato — esperado en multi-número).
        const ok = perNumber.some(r => r.ok);
        if (!ok) {
            const firstErr = perNumber.find(r => !r.ok);
            const metaErr = firstErr?.data?.error?.message
                || firstErr?.data?.block_users?.failed_users?.[0]?.errors?.[0]?.message
                || firstErr?.error
                || `Meta respondió ${firstErr?.status}`;
            return res.status(502).json({
                success: false,
                error: block ? 'No se pudo bloquear en WhatsApp' : 'No se pudo desbloquear en WhatsApp',
                metaError: metaErr,
                perNumber
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
            blockedOn: perNumber.filter(r => r.ok).map(r => r.pid),
            perNumber
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
