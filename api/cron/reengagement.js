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

// ── Generador de mensajes ─────────────────────────────────────────────────────
function buildMessage(candidate, missingFields, attemptNumber) {
    const rawName = candidate.nombreReal || candidate.nombre || '';
    const firstName = rawName.split(' ')[0] || '';
    const nombre = firstName
        ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
        : null;

    const campo1 = missingFields[0] ? `*${missingFields[0]}*` : null;
    const campo2 = missingFields[1] ? `*${missingFields[1]}*` : null;

    if (attemptNumber === 1) {
        // Primer intento: cálido y directo
        if (nombre && campo1) {
            return `¡Hola ${nombre}! 😊 Solo me falta saber ${campo1} para poder encontrarte la vacante ideal. ¿Me lo compartes?`;
        }
        if (campo1) {
            return `¡Hola! 👋 Solo necesito saber ${campo1} para poder ayudarte a encontrar empleo. ¿Me lo dices?`;
        }
        return `¡Hola! 👋 Quedé esperando algunos datos para poder ayudarte. ¿Seguimos con tu registro?`;
    }

    if (attemptNumber === 2) {
        // Segundo intento: urgencia suave con reconocimiento de avance
        const camposList = [campo1, campo2].filter(Boolean).join(' y ');
        if (nombre) {
            return `¡${nombre}, casi terminas tu registro! 💪 Ya tengo varios de tus datos — solo me falta ${camposList}. ¡No dejes pasar esta oportunidad!`;
        }
        return `¡Casi terminas tu registro! 💪 Solo falta ${camposList}. ¿Me lo dices para poder ayudarte?`;
    }

    // Tercer intento o más: FOMO / cierre
    if (nombre && campo1) {
        return `${nombre}, esta es mi última pregunta para considerarte en nuestras vacantes activas 🎯 ¿Cuál es tu ${campo1}? ¡Solo eso nos falta!`;
    }
    return `Esta es la última oportunidad de considerarte en nuestras vacantes activas 🎯 Solo falta ${campo1 || 'un dato'}. ¿Me lo compartes?`;
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

    if (!settings?.enabled) {
        return res.json({ success: true, skipped: 'disabled', processed: 0 });
    }

    // ── Verificar horario de negocio ─────────────────────────────────────────
    const startH = settings.businessHoursStart ?? 8;
    const endH   = settings.businessHoursEnd   ?? 20;
    if (!isBusinessHour(startH, endH)) {
        return res.json({ success: true, skipped: 'outside_business_hours', processed: 0 });
    }

    const activeFromMs  = settings.activeFrom ? new Date(settings.activeFrom).getTime() : 0;
    const silenceMs     = (settings.silenceHours  || 2)  * 3_600_000;
    const intervalMs    = (settings.intervalHours || 24) * 3_600_000;
    const maxSilenceMs  = (settings.maxSilenceDays || 7) * 86_400_000;
    const maxAttempts   = settings.maxAttempts || 2;
    const now           = Date.now();

    // ── Cargar candidatos ─────────────────────────────────────────────────────
    let candidates;
    try {
        const result = await getCandidates(10000, 0, '', false, '');
        candidates = result.candidates || result;
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
            if (!lastMsgTs || lastMsgTs < activeFromMs) { skipped++; continue; }

            const missingLabels = getMissingFields(candidate).map(f => FIELD_LABELS[f]);
            if (missingLabels.length === 0) { skipped++; continue; }  // perfil completo
            if (candidate.blocked || candidate.reengagement_skip) { skipped++; continue; }

            const attempts    = Number(candidate.reengagement_attempts) || 0;
            const lastSentTs  = candidate.reengagement_last_sent
                ? new Date(candidate.reengagement_last_sent).getTime()
                : 0;
            const silenceElapsed = now - lastMsgTs;

            if (attempts >= maxAttempts)   { skipped++; continue; }
            if (silenceElapsed > maxSilenceMs) { skipped++; continue; }  // demasiado viejo

            // ¿Ya ha pasado el tiempo de silencio requerido?
            if (lastSentTs === 0) {
                // Primer intento
                if (silenceElapsed < silenceMs) { skipped++; continue; }
            } else {
                // Intentos posteriores — respetar intervalo entre mensajes
                if ((now - lastSentTs) < intervalMs) { skipped++; continue; }
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
