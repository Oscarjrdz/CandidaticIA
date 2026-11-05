/**
 * /api/candidates/send-route — envío MANUAL de "Crear Ruta (Maps)" desde el Chat Web.
 *
 * Mismo motor que el nodo de Flujos "Crear Ruta" (api/utils/route-links.js), pero disparado a mano
 * por el reclutador desde la barra del header del chat. Le manda al candidato UN botón nativo de
 * enlace (cta_url) "Abrir en Maps" con la ruta armada desde SU ubicación compartida hasta el pin de
 * empresa elegido, con el modo de viaje (carro/transporte/moto) que escogió el reclutador.
 *
 * Requisitos:
 *   - El candidato debe tener ubicación compartida (candidate.ubicacionLat/Lng).
 *   - El destino es un pin del catálogo del Mapa (hash candidatic:map_pins) — ver api/system/map-pins.js.
 *
 * POST { candidateId, pinId, mode }  (mode ∈ carro | transporte | moto, default carro)
 */

const PINS_KEY = 'candidatic:map_pins';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { getRedisClient, validateAdminSession, getCandidateById, saveMessage, updateMessageStatus } =
            await import('../utils/storage.js');
        const { getUltraMsgConfig, sendUltraMsgMessage } = await import('../whatsapp/utils.js');
        const { ROUTE_MODES, buildMapsDirUrl } = await import('../utils/route-links.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const { candidateId, pinId } = body;
        const modeKey = ROUTE_MODES[body.mode] ? body.mode : 'carro';
        const mode = ROUTE_MODES[modeKey];

        if (!candidateId || !pinId) return res.status(400).json({ error: 'Faltan datos (candidateId / pinId)' });

        // 1. Candidato + su ubicación (origen)
        const candidate = await getCandidateById(candidateId);
        if (!candidate) return res.status(404).json({ error: 'Candidato no encontrado' });
        const oLat = Number(candidate.ubicacionLat);
        const oLng = Number(candidate.ubicacionLng);
        if (!Number.isFinite(oLat) || !Number.isFinite(oLng)) {
            return res.status(400).json({ error: 'El candidato no ha compartido su ubicación' });
        }

        // 2. Pin de empresa (destino)
        const rawPin = await redis.hget(PINS_KEY, String(pinId));
        if (!rawPin) return res.status(404).json({ error: 'Pin no encontrado' });
        let pin;
        try { pin = typeof rawPin === 'string' ? JSON.parse(rawPin) : rawPin; } catch { pin = null; }
        const destLat = Number(pin?.lat);
        const destLng = Number(pin?.lng);
        if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
            return res.status(400).json({ error: 'El pin no tiene coordenadas válidas' });
        }
        const destName = (pin.label || '').trim() || 'tu destino';

        // 3. URL de Maps con el modo elegido
        const mapsUrl = buildMapsDirUrl({ destLat, destLng, originLat: oLat, originLng: oLng, travelmode: mode.travelmode });
        if (!mapsUrl) return res.status(500).json({ error: 'No se pudo armar la ruta' });

        // 4. Enviar el botón nativo cta_url "Abrir en Maps"
        const config = await getUltraMsgConfig(candidate.incomingPhoneNumberId || candidate.instanceId);
        if (!config?.token || !config?.instanceId) return res.status(400).json({ error: 'Faltan credenciales de WhatsApp' });
        const cleanTo = String(candidate.whatsapp || '').replace(/\D/g, '');
        const msgBody = `📍 Así llegas a *${destName}* 👇`;

        const sendResult = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, msgBody, 'interactive', {
            interactiveType: 'cta_url', ctaDisplayText: 'ABRIR EN MAPS', ctaUrl: mapsUrl, priority: 1
        });
        if (!sendResult?.success) {
            console.error('[send-route] envío falló:', sendResult?.error);
            return res.status(502).json({ error: 'No se pudo enviar el mensaje', details: sendResult?.error });
        }

        // 5. Guardar en el chat (mismo patrón que saveFlowOutbound) → aparece en la conversación + SSE
        const saved = await saveMessage(candidateId, {
            from: 'me',
            content: `${msgBody}\n\n[Botón: ABRIR EN MAPS → ${mapsUrl}]`,
            timestamp: new Date().toISOString(),
            status: 'queued',
            meta: { interactive: true, route: true, pinId: String(pinId), mode: modeKey }
        }).catch(() => null);
        if (saved?.id) {
            const remoteId = sendResult?.messageId || sendResult?.data?.messages?.[0]?.id || null;
            await updateMessageStatus(candidateId, saved.id, 'sent', remoteId ? { ultraMsgId: remoteId } : {}).catch(() => {});
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('[send-route] error:', error.message);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
