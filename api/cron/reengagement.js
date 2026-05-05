/**
 * /api/cron/reengagement
 * Vercel Cron — runs every 15 minutes.
 *
 * Busca candidatos incompletos que llevan N horas en silencio
 * y les manda un mensaje personalizado de Brenda invitándolos a completar su perfil.
 */
import { getRedisClient, getCandidates, updateCandidate, saveMessage } from '../utils/storage.js';
import { getUltraMsgConfig, sendUltraMsgMessage } from '../whatsapp/utils.js';
import { getMissingFields, FIELD_LABELS } from '../reengagement-queue.js';

const SETTINGS_KEY = 'reengagement:settings';

// ── Horario de negocio (Monterrey CST = UTC-6) ────────────────────────────────
function isBusinessHour(startH, endH) {
    const now = new Date();
    // Convert UTC to CST (UTC-6)
    const cst = new Date(now.getTime() - 6 * 3_600_000);
    const h = cst.getUTCHours();
    return h >= startH && h < endH;
}

// ── Selector determinista: mismo candidato → misma variante siempre ───────────
// Usa el ID del candidato para elegir variante (no aleatorio en cada ejecución)
function pickVariant(candidateId, count) {
    let hash = 0;
    const s = String(candidateId);
    for (let i = 0; i < s.length; i++) {
        hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
    return hash % count;
}

// ── Generador de mensajes — 3 variantes por intento, ángulos completamente distintos
function buildMessage(candidate, missingFields, attemptNumber) {
    // Solo nombreReal — candidate.nombre es el display name de WhatsApp (puede tener emojis o texto no relacionado)
    const rawName = candidate.nombreReal || '';
    const firstName = rawName.split(' ')[0] || '';
    const n = firstName
        ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
        : null;

    const c1 = missingFields[0] ? `tu *${missingFields[0]}*` : null;
    const c2 = missingFields[1] ? `tu *${missingFields[1]}*` : null;
    const lista = [c1, c2].filter(Boolean).join(' y ');

    const v = pickVariant(candidate.id, 3);

    // ── Intento 1: Cálido y directo ── ángulo: "te estoy esperando"
    if (attemptNumber === 1) {
        const opts = [
            // Variante A — pregunta directa
            n && c1
                ? `¡Hola ${n}! 😊 Solo me falta saber ${c1} para encontrarte la vacante ideal. ¿Me lo compartes? 🌸`
                : c1 ? `¡Hola! 😊 Solo necesito ${c1} para ayudarte a encontrar empleo. ¿Me lo dices? 🌸`
                      : `¡Hola! 😊 Quedé esperando algunos datos. ¿Seguimos con tu registro? ✨`,

            // Variante B — ángulo: "ya casi está listo tu perfil"
            n && c1
                ? `Hola ${n} 🌸 Tu registro quedó casi completo, solo falta ${c1}. ¿Me lo dices para poder buscarte opciones? ✨`
                : c1 ? `Hola 🌸 Tu registro quedó casi completo, solo falta ${c1}. ¿Me lo compartes? ✨`
                      : `Hola 🌸 Tu registro quedó incompleto. ¿Puedes ayudarme con los datos que faltan? ✨`,

            // Variante C — ángulo: "necesito ese dato para ayudarte"
            n && c1
                ? `${n}, me quedé a medias con tu registro 😊 Necesito que me digas ${c1} para poder buscarte trabajo. ¿Me ayudas? 🌟`
                : c1 ? `Me quedé a medias con tu registro 😊 Necesito ${c1} para poder buscarte trabajo. ¿Me lo dices? 🌟`
                      : `Me quedé a medias con tu registro 😊 ¿Puedes completar los datos que faltan? 🌟`,
        ];
        return opts[v];
    }

    // ── Intento 2: Urgencia suave + contexto ── ángulo: "otros candidatos avanzan"
    if (attemptNumber === 2) {
        const opts = [
            // Variante A — "estamos recibiendo muchos candidatos"
            n && lista
                ? `${n}, esta semana estamos recibiendo muchos candidatos 🌟 Para considerarte necesito que me confirmes ${lista}. ¿Puedes? 😊`
                : lista ? `Esta semana estamos recibiendo muchos candidatos 🌟 Para considerarte falta ${lista}. ¿Me lo dices? 😊`
                        : `Seguimos recibiendo candidatos esta semana 🌟 ¿Puedes completar tu registro? 😊`,

            // Variante B — "ya tengo candidatos con perfil similar avanzando"
            n && lista
                ? `${n} 🌸 Tengo candidatos con un perfil similar al tuyo avanzando en el proceso. Solo me falta ${lista} de tu parte. ¿Seguimos? ✨`
                : lista ? `Tengo candidatos similares avanzando en el proceso 🌸 Solo falta ${lista}. ¿Seguimos? ✨`
                        : `Tengo candidatos avanzando en proceso 🌸 ¿Completamos tu registro? ✨`,

            // Variante C — "no quiero que pierdas la oportunidad"
            n && lista
                ? `${n}, no quiero que pierdas una buena oportunidad 🙏 Solo me falta ${lista}. ¿Me lo compartes? 🌸`
                : lista ? `No quiero que pierdas una buena oportunidad 🙏 Solo falta ${lista}. ¿Me lo dices? 🌸`
                        : `No quiero que pierdas una buena oportunidad 🙏 ¿Completamos tu registro? 🌸`,
        ];
        return opts[v];
    }

    // ── Intento 3: Cierre definitivo con calidez ── ángulo: "última oportunidad"
    const opts3 = [
        // Variante A — "voy a cerrar tu expediente"
        n && c1
            ? `${n}, voy a cerrar tu expediente si no me confirmas ${c1} 😊 ¿Me lo dices antes de que lo archive? 🌸`
            : c1 ? `Voy a cerrar tu expediente si no me confirmas ${c1} 😊 ¿Me lo dices? 🌸`
                  : `Voy a archivar tu registro 😊 ¿Deseas continuar con tu búsqueda de empleo? 🌸`,

        // Variante B — "tengo una vacante pero necesito ese dato"
        n && c1
            ? `${n} 🌟 Tengo una vacante que podría ser para ti pero necesito confirmar ${c1} antes de incluirte. ¿Me lo dices? 💖`
            : c1 ? `Tengo una vacante disponible pero necesito confirmar ${c1} para incluirte 🌟 ¿Me lo dices? 💖`
                  : `Tengo vacantes disponibles pero tu perfil está incompleto 🌟 ¿Terminamos el registro? 💖`,

        // Variante C — tono directo y cálido
        n && c1
            ? `${n}, solo para cerrar: necesito ${c1} para tenerte en cuenta en futuras vacantes. ¿Me lo puedes decir? 🌸✨`
            : c1 ? `Para cerrar tu registro necesito ${c1}. ¿Me lo puedes decir? 🌸✨`
                  : `Para cerrar tu registro me faltan algunos datos. ¿Puedes completarlos? 🌸✨`,
    ];
    return opts3[v];
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    // Seguridad: Vercel envía Authorization header en crons
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    // ── Leer configuración ────────────────────────────────────────────────────
    let settings;
    try {
        const raw = await redis.get(SETTINGS_KEY);
        settings = raw ? JSON.parse(raw) : null;
    } catch (e) {
        return res.status(500).json({ error: 'Cannot read settings' });
    }

    // ── Modo forzado: "Enviar ya" desde UI ───────────────────────────────────
    const forceCandidateId = req.body?.forceCandidateId || null;

    if (!settings?.enabled && !forceCandidateId) {
        return res.json({ success: true, skipped: 'disabled', processed: 0 });
    }

    // ── Verificar horario de negocio (omitir si es envío forzado) ────────────
    const startH = settings?.businessHoursStart ?? 8;
    const endH   = settings?.businessHoursEnd   ?? 20;
    if (!forceCandidateId && !isBusinessHour(startH, endH)) {
        return res.json({ success: true, skipped: 'outside_business_hours', processed: 0 });
    }

    const activeFromMs  = settings?.activeFrom ? new Date(settings.activeFrom).getTime() : 0;
    const silenceMs     = (settings?.silenceHours  || 2)  * 3_600_000;
    const intervalMs    = (settings?.intervalHours || 24) * 3_600_000;
    const maxSilenceMs  = (settings?.maxSilenceDays || 7) * 86_400_000;
    const maxAttempts   = settings?.maxAttempts || 2;
    const now           = Date.now();

    // ── Cargar candidatos ─────────────────────────────────────────────────────
    let candidates;
    try {
        const result = await getCandidates(10000, 0, '', false, '');
        candidates = result.candidates || result;
        // Si es envío forzado, filtrar solo ese candidato
        if (forceCandidateId) {
            candidates = candidates.filter(c => c.id === forceCandidateId);
        }
    } catch (e) {
        return res.status(500).json({ error: 'Cannot fetch candidates' });
    }

    // ── Cargar config de WhatsApp ─────────────────────────────────────────────
    let waConfig;
    try {
        waConfig = await getUltraMsgConfig();
    } catch (e) {
        waConfig = null;
    }

    if (!waConfig) {
        return res.status(500).json({ error: 'No WhatsApp config available' });
    }

    let sent = 0, skipped = 0, errors = 0;
    const log = [];

    for (const candidate of candidates) {
        try {
            const lastMsgTs = candidate.lastUserMessageAt
                ? new Date(candidate.lastUserMessageAt).getTime()
                : 0;

            // Solo candidatos que interactuaron después de activar el feature
            // Si no es envío forzado, validar fecha de activación
            if (!forceCandidateId && (!lastMsgTs || lastMsgTs < activeFromMs)) { skipped++; continue; }

            const missingLabels = getMissingFields(candidate).map(f => FIELD_LABELS[f]);
            if (missingLabels.length === 0) { skipped++; continue; }  // perfil completo
            if (candidate.blocked || candidate.reengagement_skip) { skipped++; continue; }

            const attempts    = Number(candidate.reengagement_attempts) || 0;
            const lastSentTs  = candidate.reengagement_last_sent
                ? new Date(candidate.reengagement_last_sent).getTime()
                : 0;
            const silenceElapsed = now - (lastMsgTs || now);

            // Envío forzado omite checks de tiempo — va directo
            if (!forceCandidateId) {
                if (attempts >= maxAttempts)            { skipped++; continue; }
                if (silenceElapsed > maxSilenceMs)      { skipped++; continue; }
                if (lastSentTs === 0) {
                    if (silenceElapsed < silenceMs)     { skipped++; continue; }
                } else {
                    if ((now - lastSentTs) < intervalMs){ skipped++; continue; }
                }
            }

            // ── Generar y enviar mensaje ──────────────────────────────────────
            const attemptNumber = attempts + 1;
            const message = buildMessage(candidate, missingLabels, attemptNumber);
            const nombre  = candidate.nombreReal || candidate.nombre || candidate.whatsapp;

            await sendUltraMsgMessage(
                waConfig.instanceId,
                waConfig.token,
                candidate.whatsapp,
                message,
                'chat',
                { priority: 5 }
            );

            // ── Guardar en historial del chat ─────────────────────────────────
            await saveMessage(candidate.id, {
                from: 'bot',
                content: message,
                timestamp: new Date().toISOString(),
                meta: { reengagement: true, attempt: attemptNumber }
            }).catch(() => {});

            // ── Actualizar contadores en el candidato ─────────────────────────
            await updateCandidate(candidate.id, {
                reengagement_attempts: attemptNumber,
                reengagement_last_sent: new Date().toISOString(),
            });

            console.log(`[REENGAGEMENT] ✅ Intento ${attemptNumber} → ${nombre} (${candidate.whatsapp})`);
            log.push({ candidateId: candidate.id, nombre, attempt: attemptNumber });
            sent++;

        } catch (e) {
            console.error(`[REENGAGEMENT] ❌ Error con candidato ${candidate.id}:`, e.message);
            errors++;
        }
    }

    return res.json({
        success: true,
        processed: sent + skipped + errors,
        sent,
        skipped,
        errors,
        log,
        timestamp: new Date().toISOString(),
    });
}
