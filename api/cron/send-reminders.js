/**
 * /api/cron/send-reminders
 * Runs every 15 minutes via Vercel Cron.
 *
 * Envía los recordatorios directos por candidato (`direct_reminders` ZSET) — creados
 * a mano desde CandidateReminderModal.jsx (la campanita del chat) o de un clic desde
 * una plantilla guardada (api/reminder-templates.js). Las plantillas no tienen envío
 * propio: solo prellenan datos y terminan en la misma cola vía POST /api/candidate-reminders.
 *
 * Pattern (industry-standard Bull/BullMQ approach adapted for serverless):
 *   ZRANGEBYSCORE direct_reminders 0 {now}
 *   → only processes reminders that are due (O log N, no full scan)
 *   → removes each member after sending to prevent duplicates
 *
 * `processDirectReminderItem` está separada del handler para poder probarla item por
 * item contra Redis real sin disparar el ZRANGEBYSCORE completo (que procesaría
 * también recordatorios reales pendientes).
 */

import { getRedisClient, getCandidateById, saveMessage } from '../utils/storage.js';
import { getUltraMsgConfig, sendUltraMsgMessage } from '../whatsapp/utils.js';
import { acquireProcessingLock, releaseProcessingLock, markCompleted, isCompleted } from '../utils/reminder-lock.js';
import { recordBandwidthSnapshot } from '../utils/redis-bandwidth.js';
import { isMeta24hWindowError, attemptReminderTemplateFallback } from '../utils/reminder-fallback.js';
import { splitBubbles } from '../utils/shortcuts.js';

const DIRECT_REMINDERS_ZSET_KEY = 'direct_reminders';
const DIRECT_REMINDER_TTL_AFTER_SEND_SECONDS = 60 * 60 * 24 * 7;
// Recordatorios vencidos por más de esto se descartan en vez de reintentarse para
// siempre — evita que uno roto (config caída, red, etc.) se reintente cada 15 min
// por semanas sin que nadie se entere.
export const STALE_REMINDER_MS = 48 * 60 * 60 * 1000;

const HEALTH_KEY_PREFIX = 'reminders:health:daily:';
const HEALTH_TZ = 'America/Monterrey';
const HEALTH_TTL_SECONDS = 60 * 60 * 24 * 90;

/** true si `dueMs` (score del ZSET / scheduledAt) lleva vencido más de `thresholdMs`. Pura — fácil de probar sin Redis. */
export function isStaleDue(dueMs, now, thresholdMs = STALE_REMINDER_MS) {
    return Number.isFinite(dueMs) && (now - dueMs) > thresholdMs;
}

function todayMty() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: HEALTH_TZ });
}

/** Métricas mínimas por corrida — para poder decir "¿cuántos recordatorios fallaron esta semana?" sin abrir candidato por candidato. */
export async function recordHealthSnapshot(redis, { sent = 0, skipped = 0, errors = 0 }) {
    try {
        const key = `${HEALTH_KEY_PREFIX}${todayMty()}`;
        const pipeline = redis.pipeline();
        if (sent) pipeline.hincrby(key, 'sent', sent);
        if (skipped) pipeline.hincrby(key, 'skipped', skipped);
        if (errors) pipeline.hincrby(key, 'errors', errors);
        pipeline.hincrby(key, 'runs', 1);
        pipeline.expire(key, HEALTH_TTL_SECONDS);
        await pipeline.exec();
    } catch {
        // Observabilidad best-effort — nunca debe tumbar el envío real.
    }
}

function getMetaErrorCode(result = {}) {
    return Number(result.data?.error?.code || result.code || 0);
}

function isTerminalDirectReminderFailure(result = {}) {
    return getMetaErrorCode(result) === 131026;
}

async function saveDirectReminderStatus(redis, remId, reminder, patch) {
    await redis.set(
        `direct_reminder:${remId}`,
        JSON.stringify({ ...reminder, ...patch }),
        'EX',
        DIRECT_REMINDER_TTL_AFTER_SEND_SECONDS
    ).catch(() => {});
}

async function removeDueMember(redis, zsetKey, member) {
    await redis.zrem(zsetKey, member).catch(() => {});
}

/**
 * Procesa un item de `direct_reminders`. Adquiere/libera su propio lock —
 * seguro de llamar de forma aislada (ej. en pruebas) sin afectar otros items.
 * @returns {Promise<'sent'|'skipped'|'error'|'locked'>}
 */
export async function processDirectReminderItem(redis, remId, now = Date.now()) {
    const lock = await acquireProcessingLock(redis, 'direct_reminder', remId);
    if (!lock) return 'locked';

    let reminder = null;

    try {
        if (await isCompleted(redis, 'direct_reminder', remId)) {
            await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
            return 'skipped';
        }

        const raw = await redis.get(`direct_reminder:${remId}`);
        if (!raw) {
            await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
            return 'skipped';
        }

        reminder = JSON.parse(raw);
        if (['sent', 'failed'].includes(reminder.status)) {
            await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
            return 'skipped';
        }

        // Si lleva vencido más de 48h reintentando sin éxito (config rota, red caída,
        // etc.) se marca failed en vez de seguir reintentando cada 15 min para siempre
        // y quedarse invisible en "Programados".
        const dueScore = await redis.zscore(DIRECT_REMINDERS_ZSET_KEY, remId).catch(() => null);
        if (isStaleDue(Number(dueScore), now)) {
            console.warn(`[SEND-REMINDERS] Dropping stale direct reminder "${remId}" (overdue by ${Math.round((now - Number(dueScore)) / 3_600_000)}h)`);
            await saveDirectReminderStatus(redis, remId, reminder, {
                status: 'failed',
                failedAt: new Date().toISOString(),
                failureReason: `Se reintentó por más de ${Math.round(STALE_REMINDER_MS / 3_600_000)}h sin éxito (${reminder.failureReason || 'ver lastAttemptAt'}) y se descartó.`
            });
            await markCompleted(redis, 'direct_reminder', remId, 'failed');
            await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
            return 'error';
        }

        if (!reminder.whatsapp || !reminder.message) {
            await saveDirectReminderStatus(redis, remId, reminder, {
                status: 'failed',
                failedAt: new Date().toISOString(),
                failureReason: 'Recordatorio incompleto: falta WhatsApp o mensaje.'
            });
            await markCompleted(redis, 'direct_reminder', remId, 'failed');
            await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
            return 'skipped';
        }

        // Look up candidate to get incomingPhoneNumberId for correct number routing
        const candForReminder = reminder.candidateId ? await getCandidateById(reminder.candidateId) : null;
        const config = await getUltraMsgConfig(candForReminder?.incomingPhoneNumberId || candForReminder?.instanceId);
        if (!config?.token || !config?.instanceId) {
            throw new Error('No hay configuración de WhatsApp/Meta para enviar este recordatorio.');
        }

        // Si reminder.message trae el marcador [burbuja] (banco de respuestas / plantillas
        // de recordatorio lo permiten igual que el resto de Flujos), solo el PRIMER trozo
        // pasa por el intento normal + fallback de plantilla de 24h de abajo — es el único
        // que decide si el recordatorio quedó 'sent' o 'failed'. Los trozos siguientes se
        // mandan después, best-effort, y solo si el primero salió por texto libre (si cayó
        // a fallback de plantilla, la ventana sigue cerrada y un segundo texto libre
        // fallaría igual, así que no tiene caso intentarlo).
        const [firstBubble, ...restBubbles] = splitBubbles(reminder.message);

        const textResult = await sendUltraMsgMessage(
            config.instanceId,
            config.token,
            reminder.whatsapp,
            firstBubble,
            'chat',
            { priority: 1 }
        );

        let sentVia = 'text';
        let contentToSave = firstBubble;
        let finalResult = textResult;

        if (!textResult?.success) {
            if (isMeta24hWindowError(textResult)) {
                const fallback = await attemptReminderTemplateFallback({ reminder, candidate: candForReminder });
                if (fallback.attempted) {
                    finalResult = fallback.result;
                    if (fallback.success) {
                        sentVia = 'template_fallback';
                        contentToSave = fallback.contentToSave;
                    }
                }
            }

            if (!finalResult?.success) {
                const failureReason = textResult?.success === false && isMeta24hWindowError(textResult) && !reminder.fallbackTemplateData?.name
                    ? 'Meta rechazó texto libre por ventana de 24h cerrada y no había template para ventana expirada.'
                    : (finalResult?.error || textResult?.error || 'No se pudo enviar el recordatorio');

                const terminalFailure = isMeta24hWindowError(textResult) || isTerminalDirectReminderFailure(finalResult) || isTerminalDirectReminderFailure(textResult);
                if (terminalFailure) {
                    await saveDirectReminderStatus(redis, remId, reminder, {
                        status: 'failed',
                        failedAt: new Date().toISOString(),
                        failureReason,
                        metaError: finalResult?.data?.error || textResult?.data?.error || null
                    });
                    await markCompleted(redis, 'direct_reminder', remId, 'failed');
                    await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
                    return 'error';
                }

                throw new Error(failureReason);
            }
        }

        // Marcar como enviado ANTES de guardar el historial: si saveMessage falla o el
        // proceso muere a medias, el recordatorio ya quedó completo y no se reenvía.
        await saveDirectReminderStatus(redis, remId, reminder, {
            status: 'sent',
            sentAt: new Date().toISOString(),
            sentVia
        });
        await markCompleted(redis, 'direct_reminder', remId, 'sent');
        await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);

        await saveMessage(reminder.candidateId, {
            from: 'me',
            content: contentToSave,
            type: sentVia === 'template_fallback' ? 'template' : 'text',
            timestamp: new Date().toISOString(),
            ultraMsgId: finalResult?.messageId || null,
            meta: {
                directReminder: true,
                reminderId: remId,
                sentVia,
                usedFallbackTemplate: sentVia === 'template_fallback'
            }
        }).catch(() => {});

        if (sentVia === 'text' && restBubbles.length) {
            for (const bubbleText of restBubbles) {
                const extraRes = await sendUltraMsgMessage(config.instanceId, config.token, reminder.whatsapp, bubbleText, 'chat', { priority: 1 }).catch(() => null);
                if (extraRes?.success) {
                    await saveMessage(reminder.candidateId, {
                        from: 'me', content: bubbleText, type: 'text', timestamp: new Date().toISOString(),
                        ultraMsgId: extraRes?.messageId || null,
                        meta: { directReminder: true, reminderId: remId, sentVia: 'text', bubbleExtra: true }
                    }).catch(() => {});
                }
            }
        }

        console.log(`[SEND-REMINDERS] ✅ Direct reminder (${sentVia}) → ${reminder.nombre} (${reminder.whatsapp})`);
        return 'sent';
    } catch (e) {
        console.error(`[SEND-REMINDERS] Error in direct reminder "${remId}":`, e.message);
        if (reminder) {
            await saveDirectReminderStatus(redis, remId, reminder, {
                status: 'pending',
                lastAttemptAt: new Date().toISOString(),
                failureReason: e.message || 'Error inesperado procesando el recordatorio.'
            });
        }
        return 'error';
    } finally {
        await releaseProcessingLock(redis, lock);
    }
}

function tally(counters, outcome) {
    if (outcome === 'sent') counters.sent++;
    else if (outcome === 'error') counters.errors++;
    else counters.skipped++; // 'skipped' | 'locked'
}

export default async function handler(req, res) {
    // ── Security: Vercel cron sends Authorization header ──────────────────────
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const redis = getRedisClient();
    if (!redis) {
        return res.status(500).json({ error: 'Redis unavailable' });
    }

    recordBandwidthSnapshot(redis).catch(() => {});

    const now = Date.now();
    const counters = { sent: 0, skipped: 0, errors: 0 };

    let directMembers = [];
    try {
        directMembers = await redis.zrangebyscore(DIRECT_REMINDERS_ZSET_KEY, 0, now);
    } catch (e) {
        console.error('[SEND-REMINDERS] direct_reminders ZRANGEBYSCORE error:', e.message);
        return res.status(500).json({ error: 'Redis query failed' });
    }

    for (const remId of directMembers) {
        const outcome = await processDirectReminderItem(redis, remId, now);
        tally(counters, outcome);
    }

    await recordHealthSnapshot(redis, counters);

    return res.json({
        success: true,
        processed: directMembers.length,
        ...counters,
        timestamp: new Date().toISOString()
    });
}
