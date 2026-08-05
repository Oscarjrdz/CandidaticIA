/**
 * AGENT SEND — envío del bundle de un mensaje (texto/imágenes/ubicación/audio) a UN
 * candidato. Fuente única compartida entre:
 *   - api/agent-ia/bulk-send.js (envío masivo con confirmación de la UI)
 *   - api/utils/agent-attend.js (motor de Agent Candidatic, envío directo sin confirmación)
 * para no duplicar la lógica de envío (evita divergencias/bugs entre ambos flujos).
 */
import { saveMessage } from './storage.js';
import { substituteVariables } from './shortcuts.js';
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const HOST = process.env.PUBLIC_BASE_URL || 'https://www.candidatic.com';

// /api/image?id=med_X → https://HOST/api/media/med_X.jpg (URL pública que Meta jala)
export const toAbsoluteImageUrl = (u) => {
    if (!u) return u;
    const m = /[?&]id=([^&]+)/.exec(u);
    if (m) return `${HOST}/api/media/${m[1]}.jpg`;
    if (u.startsWith('/')) return `${HOST}${u}`;
    return u;
};

// Audio u otro media relativo: absolutizar SIN forzar extensión (no es .jpg).
export const toAbsoluteMediaUrl = (u) => {
    if (!u) return u;
    if (u.startsWith('http')) return u;
    if (u.startsWith('/')) return `${HOST}${u}`;
    return u;
};

// Envía a UN candidato el bundle COMPLETO de un mensaje (banco o vacante), reproduciendo
// TODAS las variantes en orden: ubicación (maps), o audio/nota de voz, o la mezcla
// texto + N imágenes (cada elemento es su propio mensaje de WhatsApp). `payload` tiene
// el mismo shape que arma agent-ia.js (templateType, messageText, imageUrls, location,
// audioUrl, voice). `meta` se guarda en cada mensaje (ej. { bulk: true } o { agent: 'agent-candidatic', auto: true }).
export async function sendMessageBundleTo(candidate, payload, meta = { bulk: true }) {
    const phone = String(candidate.whatsapp || '').replace(/\D/g, '');
    if (!phone) return { ok: false, sentCount: 0, error: 'sin teléfono' };

    const config = await getUltraMsgConfig(candidate.incomingPhoneNumberId || candidate.instanceId);
    if (!config || !config.instanceId || !config.token) return { ok: false, sentCount: 0, error: 'sin config de WhatsApp' };
    const { instanceId, token } = config;
    const now = () => new Date().toISOString();
    let sentCount = 0;

    // ── UBICACIÓN (maps) ──
    if (payload.templateType === 'location' && payload.location) {
        const loc = payload.location;
        const r = await sendUltraMsgMessage(instanceId, token, phone, '', 'location', { name: loc.name, address: loc.address, lat: loc.lat, lng: loc.lng });
        if (r?.success) {
            sentCount++;
            await saveMessage(candidate.id, { from: 'me', content: `[Ubicación: ${loc.name || 'Mapa'}]`, type: 'location', timestamp: now(), meta }).catch(() => {});
        }
        return { ok: sentCount > 0, sentCount, error: sentCount ? null : 'falló ubicación' };
    }

    // ── AUDIO / nota de voz ──
    if (payload.templateType === 'audio' && payload.audioUrl) {
        const extra = {};
        if (payload.voice) extra.voice = true;
        const r = await sendUltraMsgMessage(instanceId, token, phone, toAbsoluteMediaUrl(payload.audioUrl), 'audio', extra);
        if (r?.success) {
            sentCount++;
            await saveMessage(candidate.id, { from: 'me', content: payload.voice ? '🎤 Nota de voz' : '🎵 Audio', type: 'audio', mediaUrl: payload.audioUrl, timestamp: now(), meta }).catch(() => {});
        }
        return { ok: sentCount > 0, sentCount, error: sentCount ? null : 'falló audio' };
    }

    // ── TEXTO + IMÁGENES (mezcla) ── cada uno es un mensaje independiente.
    if (payload.messageText) {
        const text = substituteVariables(payload.messageText, candidate); // resuelve {{nombre}} por candidato
        const r = await sendUltraMsgMessage(instanceId, token, phone, text, 'chat', {});
        if (r?.success) {
            sentCount++;
            await saveMessage(candidate.id, { from: 'me', content: text, timestamp: now(), meta }).catch(() => {});
        }
    }
    for (const imgUrl of (payload.imageUrls || [])) {
        const r = await sendUltraMsgMessage(instanceId, token, phone, toAbsoluteImageUrl(imgUrl), 'image', {});
        if (r?.success) {
            sentCount++;
            await saveMessage(candidate.id, { from: 'me', content: '', type: 'image', mediaUrl: imgUrl, timestamp: now(), meta }).catch(() => {});
        }
        await new Promise((res) => setTimeout(res, 150)); // respiro entre imágenes
    }

    return { ok: sentCount > 0, sentCount, error: sentCount ? null : 'no se envió nada' };
}
