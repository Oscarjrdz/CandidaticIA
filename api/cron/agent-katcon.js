/* global process */
import { getRedisClient, getUsers, saveMessage, updateCandidate, isProfileComplete } from '../utils/storage.js';
import { getUltraMsgConfig, sendUltraMsgMessage } from '../whatsapp/utils.js';
import { substituteVariables } from '../utils/shortcuts.js';

// ════════════════════════════════════════════════════════════════════════════
// CRON: AGENTE KATCON — disparador AUTOMÁTICO del Paso 1 (PUNTO KATCON).
//
// Corre cada 15 min (registrado en vercel.json). A diferencia del toggle en Chat
// Web (que dispara al ABRIR el chat), esto es AUTOMÁTICO: no requiere que Oscar
// abra nada. Manda el mensaje de banco "PUNTO KATCON" (texto + imágenes EXACTO)
// a los candidatos que cumplen los CANDADOS, y deja la IA en modo manual.
//
// CANDADOS (regla de Oscar, "estamos de acuerdo"):
//   1. perfil COMPLETO            → isProfileComplete(c)
//   2. etiqueta "KATCON ANUNCIO"  → tags incluye el tag exacto
//   3. humano NUNCA intervino     → !c.blocked (blocked lo pone la intervención manual)
//   + una sola vez por candidato  → set atómico Redis `agent:punto_sent:v1` (SADD)
//
// SEGURIDAD (candidato-facing, envío real a personas):
//   - GATEADO POR EL TOGGLE DE OSCAR: solo corre si su preferencia agentMode está ON
//     (user.preferences.agentMode del perfil user_1768974645880). Toggle OFF = no hace nada.
//   - TOPE POR CORRIDA (BATCH_CAP): para no bombardear a cientos de golpe; hace una
//     rampa suave (máx N cada 15 min). El SADD atómico evita doble envío entre corridas.
//   - Al enviar: marca blocked=true (modo manual) + registra el envío. El mensaje
//     aparece en el chat vía SSE → Oscar lo audita.
//
// Envío de imágenes: por URL absoluta pública (/api/image es público → Meta la jala).
// No usa la re-subida a Meta de /api/chat (más simple; suficiente para este flujo).
// ════════════════════════════════════════════════════════════════════════════

const OSCAR_USER_ID = 'user_1768974645880';   // el toggle vive en su perfil
const AGENT_TAG = 'KATCON ANUNCIO';
const BANK_NAME = 'PUNTO KATCON';
const SENT_SET_KEY = 'agent:punto_sent:v1';   // set de candidatos ya atendidos por el agente
const HOST = 'https://www.candidatic.com';
const BATCH_CAP = 15;                          // máx envíos por corrida (rampa suave)
const MAX_SCAN = 3000;                         // cuántos candidatos escanear

function normTag(t) {
    return String(typeof t === 'string' ? t : t?.name || '').trim().toUpperCase();
}

// /api/image?id=med_X  →  https://www.candidatic.com/api/media/med_X.jpg  (Meta la jala público)
function toAbsoluteImageUrl(u) {
    const m = /[?&]id=([^&]+)/.exec(u || '');
    if (m) return `${HOST}/api/media/${m[1]}.jpg`;
    if (u && u.startsWith('/')) return `${HOST}${u}`;
    return u;
}

export default async function handler(req, res) {
    // Auth de cron (igual que send-reminders): solo Vercel Cron con el secreto.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    try {
        // ── CANDADO MAESTRO: el toggle de Oscar ──
        const users = await getUsers();
        const oscar = users.find(u => u.id === OSCAR_USER_ID);
        if (!oscar?.preferences?.agentMode) {
            return res.status(200).json({ ok: true, skipped: 'toggle OFF (agentMode del perfil de Oscar)' });
        }

        // ── El mensaje de banco PUNTO KATCON (exacto) ──
        const bankRaw = await redis.get('candidatic:quick_replies');
        const replies = bankRaw ? JSON.parse(bankRaw) : [];
        const pk = replies.find(q => String(q.name || '').trim().toUpperCase() === BANK_NAME);
        if (!pk || !pk.message) {
            return res.status(200).json({ ok: true, error: `No encontré el mensaje de banco "${BANK_NAME}"` });
        }
        const bankImages = Array.isArray(pk.imageUrls) && pk.imageUrls.length
            ? pk.imageUrls
            : [pk.imageUrl].filter(Boolean);

        // ── Escaneo de candidatos elegibles ──
        const ids = await redis.zrevrange('candidates:list', 0, MAX_SCAN - 1);
        const pipe = redis.pipeline();
        ids.forEach(id => pipe.get(`candidate:${id}`));
        const rows = await pipe.exec();

        const eligible = [];
        for (const [, raw] of rows) {
            if (!raw) continue;
            let c;
            try { c = JSON.parse(raw); } catch { continue; }
            if (!c || !c.id || !c.whatsapp) continue;
            if (c.blocked) continue;                                  // candado 3: humano nunca intervino
            if (!isProfileComplete(c)) continue;                     // candado 1: perfil completo
            const tags = Array.isArray(c.tags) ? c.tags.map(normTag) : [];
            if (!tags.includes(AGENT_TAG)) continue;                 // candado 2: etiqueta
            eligible.push(c);
        }

        let sent = 0;
        let errors = 0;
        const detail = [];

        for (const c of eligible) {
            if (sent >= BATCH_CAP) break;                            // tope por corrida
            // Claim atómico: SADD devuelve 1 si es nuevo (lo reservamos), 0 si ya estaba.
            const claimed = await redis.sadd(SENT_SET_KEY, c.id);
            if (claimed === 0) continue;                             // ya atendido → saltar

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

                sent++;
                detail.push({ id: c.id, nombre: c.nombreReal || c.nombre });
                console.log(`[AGENT-KATCON] ✅ PUNTO KATCON → ${c.nombreReal || c.nombre} (${c.whatsapp})`);
            } catch (e) {
                errors++;
                // Falló: liberamos el claim para reintentar en la próxima corrida.
                await redis.srem(SENT_SET_KEY, c.id).catch(() => {});
                console.error(`[AGENT-KATCON] ❌ ${c.id}:`, e.message);
            }
        }

        return res.status(200).json({
            ok: true,
            elegibles: eligible.length,
            enviados: sent,
            errores: errors,
            topePorCorrida: BATCH_CAP,
            detalle: detail
        });
    } catch (error) {
        console.error('[AGENT-KATCON] error general:', error);
        return res.status(500).json({ ok: false, error: error.message });
    }
}
