import { getRedisClient, getUsers, saveMessage, updateCandidate, isProfileComplete } from './storage.js';
import { getUltraMsgConfig, sendUltraMsgMessage } from '../whatsapp/utils.js';
import { substituteVariables } from './shortcuts.js';

// ════════════════════════════════════════════════════════════════════════════
// AGENTE KATCON — lógica COMPARTIDA del Paso 1 (mensaje de banco "PUNTO KATCON").
//
// La usan DOS disparadores:
//   A) EVENT-DRIVEN (principal): `maybeSendKatconOnComplete()` — se llama desde el
//      extractor (api/ai/agent.js) EN EL INSTANTE en que Brenda termina de sacar los
//      datos (paso2Estado → 'completo'). No requiere abrir el chat ni esperar al cron.
//      Es lo que pidió Oscar: "prendo el toggle, me voy a comer, y a todos los que
//      entren y completen que les mande la cita" — automático y sin dashboard abierto.
//   B) CRON (red de seguridad): api/cron/agent-katcon.js — barre a los frescos cada
//      15 min por si el evento se perdió (deploy, error puntual). Consumo mínimo: solo
//      lee candidatos con actividad posterior al corte (zrevrangebyscore).
//
// CANDADOS (regla de Oscar):
//   1. perfil COMPLETO            → isProfileComplete(c)   (paso 1 + paso2Estado 'completo')
//   2. etiqueta "KATCON ANUNCIO"  → se asigna al ENTRAR por el anuncio; el completo lo
//                                    marca Brenda al terminar → por eso el disparo va ahí.
//   3. humano NUNCA intervino     → !c.blocked
//   + una sola vez por candidato  → set atómico Redis `agent:punto_sent:v1` (SADD)
//   + CORTE no-retroactivo        → actividad >= agentModeSince (cuando Oscar prendió el toggle)
//
// El toggle de Oscar (user.preferences.agentMode) es el CANDADO MAESTRO: OFF = nada dispara.
// ════════════════════════════════════════════════════════════════════════════

export const OSCAR_USER_ID = 'user_1768974645880';   // el toggle vive en su perfil
export const AGENT_TAG = 'KATCON ANUNCIO';
export const BANK_NAME = 'PUNTO KATCON';
export const SENT_SET_KEY = 'agent:punto_sent:v1';   // candidatos ya atendidos por el agente
export const BATCH_CAP = 15;                          // tope del cron por corrida (rampa suave)
const HOST = 'https://www.candidatic.com';

export function normTag(t) {
    return String(typeof t === 'string' ? t : t?.name || '').trim().toUpperCase();
}

// /api/image?id=med_X  →  https://www.candidatic.com/api/media/med_X.jpg  (Meta la jala público)
function toAbsoluteImageUrl(u) {
    const m = /[?&]id=([^&]+)/.exec(u || '');
    if (m) return `${HOST}/api/media/${m[1]}.jpg`;
    if (u && u.startsWith('/')) return `${HOST}${u}`;
    return u;
}

// Estado del toggle maestro de Oscar. { on, since }.
export async function getToggleState() {
    const users = await getUsers();
    const oscar = users.find(u => u.id === OSCAR_USER_ID);
    return {
        on: !!oscar?.preferences?.agentMode,
        since: Number(oscar?.preferences?.agentModeSince || 0)
    };
}

// Lee el mensaje de banco PUNTO KATCON (texto + imágenes exactos). null si no existe.
export async function getPuntoKatconBank(redis) {
    const bankRaw = await redis.get('candidatic:quick_replies');
    const replies = bankRaw ? JSON.parse(bankRaw) : [];
    const pk = replies.find(q => String(q.name || '').trim().toUpperCase() === BANK_NAME);
    if (!pk || !pk.message) return null;
    const bankImages = Array.isArray(pk.imageUrls) && pk.imageUrls.length
        ? pk.imageUrls
        : [pk.imageUrl].filter(Boolean);
    return { pk, bankImages };
}

// Candados baratos (sin I/O extra): perfil completo + etiqueta + humano nunca intervino.
// El corte (since) y "una sola vez" (SADD) se checan aparte según el disparador.
export function cumpleCandados(c) {
    if (!c || !c.id || !c.whatsapp) return false;
    if (c.blocked) return false;                                 // candado 3: humano nunca intervino
    if (!isProfileComplete(c)) return false;                     // candado 1: perfil completo
    const tags = Array.isArray(c.tags) ? c.tags.map(normTag) : [];
    if (!tags.includes(AGENT_TAG)) return false;                 // candado 2: etiqueta
    return true;
}

// Envía PUNTO KATCON a UN candidato: claim atómico → no re-citar → texto → imágenes → blocked.
// Devuelve 'sent' | 'claimed' (ya atendido) | 'yaCitado' | 'error:<msg>'.
export async function sendPuntoKatconTo(redis, c, pk, bankImages) {
    // Claim atómico: SADD devuelve 1 si es nuevo (lo reservamos), 0 si ya estaba.
    const claimed = await redis.sadd(SENT_SET_KEY, c.id);
    if (claimed === 0) return 'claimed';                         // ya atendido → saltar

    // NO re-citar si ya tiene la invitación en su historial (ej. Oscar lo citó a mano).
    try {
        const hist = (await redis.lrange(`messages:${c.id}`, 0, -1))
            .map(m => { try { return JSON.parse(m); } catch { return null; } }).filter(Boolean);
        const yaCitado = hist.some(m => m.from === 'me' && /vengas a una/i.test(String(m.content || '')));
        if (yaCitado) return 'yaCitado';                         // deja el claim puesto (ya no re-checar)
    } catch { /* si falla la lectura, seguimos con el envío */ }

    try {
        const config = await getUltraMsgConfig(c.incomingPhoneNumberId || c.instanceId);
        if (!config) throw new Error('sin credenciales de WhatsApp');
        const cleanTo = String(c.whatsapp).replace(/\D/g, '');

        // 1) Texto EXACTO del banco (con {{nombre}} resuelto)
        const text = substituteVariables(pk.message, c);
        const textRes = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, text, 'chat', { priority: 1 });
        if (!textRes?.success) throw new Error(textRes?.error || 'falló el texto');
        await saveMessage(c.id, {
            from: 'me', content: text, timestamp: new Date().toISOString(),
            meta: { agent: 'punto-katcon', auto: true }
        }).catch(() => {});

        // 2) Imágenes del banco (exactas, por URL pública)
        for (const imgUrl of bankImages) {
            const abs = toAbsoluteImageUrl(imgUrl);
            const imgRes = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, abs, 'image', { priority: 1 });
            if (imgRes?.success) {
                await saveMessage(c.id, {
                    from: 'me', content: '', type: 'image', mediaUrl: imgUrl,
                    timestamp: new Date().toISOString(), meta: { agent: 'punto-katcon', auto: true }
                }).catch(() => {});
            }
        }

        // 3) Silenciar la IA → modo manual (mismo efecto que la intervención humana).
        await updateCandidate(c.id, { blocked: true }).catch(() => {});
        console.log(`[AGENT-KATCON] ✅ PUNTO KATCON → ${c.nombreReal || c.nombre} (${c.whatsapp})`);
        return 'sent';
    } catch (e) {
        // Falló: liberamos el claim para reintentar (cron) o en el próximo evento.
        await redis.srem(SENT_SET_KEY, c.id).catch(() => {});
        console.error(`[AGENT-KATCON] ❌ ${c.id}:`, e.message);
        return `error:${e.message}`;
    }
}

// ── DISPARADOR EVENT-DRIVEN (principal) ──────────────────────────────────────
// Se llama desde el extractor (agent.js) en el MOMENTO EXACTO en que Brenda termina
// la extracción (paso2Estado → 'completo'). Fire-and-forget: NUNCA bloquea ni rompe
// el extractor (todo error se traga). Recibe el snapshot ya mergeado del candidato
// para NO re-leerlo de Redis.
export async function maybeSendKatconOnComplete(candidateId, candidateSnapshot) {
    try {
        const redis = getRedisClient();
        if (!redis) return;

        const { on, since } = await getToggleState();
        if (!on || !since) return;                    // toggle OFF o sin corte → nada

        const c = candidateSnapshot;
        if (!cumpleCandados(c)) return;               // completo + tag + humano nunca intervino

        // CORTE no-retroactivo: el candidato acaba de completar AHORA, así que su actividad
        // es >= since siempre que el toggle se prendió antes. Guard extra por seguridad.
        const lastAct = new Date(c.lastUserMessageAt || c.ultimoMensaje || Date.now()).getTime();
        if (lastAct < since) return;

        const bank = await getPuntoKatconBank(redis);
        if (!bank) return;
        await sendPuntoKatconTo(redis, c, bank.pk, bank.bankImages);
    } catch (e) {
        // Fire-and-forget: jamás propaga error al extractor.
        console.error('[AGENT-KATCON] maybeSendKatconOnComplete:', e?.message);
    }
}
