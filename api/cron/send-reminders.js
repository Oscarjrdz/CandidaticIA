/* global process, Buffer */
/**
 * /api/cron/send-reminders
 * Runs every 15 minutes via Vercel Cron.
 *
 * Pattern (industry-standard Bull/BullMQ approach adapted for serverless):
 *   ZRANGEBYSCORE scheduled_reminders 0 {now}
 *   → only processes reminders that are due (O log N, no full scan)
 *   → removes each member after sending to prevent duplicates
 */

import { getRedisClient, getCandidateById, getProjectById, saveMessage } from '../utils/storage.js';
import { getUltraMsgConfig, sendUltraMsgMessage, buildMetaTemplateComponents, renderMetaTemplatePreviewText } from '../whatsapp/utils.js';
import { generateTTS } from '../utils/openai.js';
import { estimateJsonBytes, recordUsageMetric } from '../utils/usage-metrics.js';
import { randomUUID } from 'crypto';

const REDIS_ZSET_KEY = 'scheduled_reminders';
const DIRECT_REMINDERS_ZSET_KEY = 'direct_reminders';
const DIRECT_REMINDER_TTL_AFTER_SEND_SECONDS = 60 * 60 * 24 * 7;
const PROCESSING_LOCK_TTL_SECONDS = 10 * 60;
const COMPLETION_MARKER_TTL_SECONDS = 60 * 60 * 24 * 30;

// Humanize YYYY-MM-DD → "Jueves 12 de Marzo"
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAY_NAMES   = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function humanizeFecha(isoDate) {
    if (!isoDate) return isoDate;
    try {
        // Parse as local CST date: append T00:00:00-06:00
        const d = new Date(`${isoDate}T00:00:00-06:00`);
        const dayName  = DAY_NAMES[d.getUTCDay()]; // UTC day after offset
        const dayNum   = d.getUTCDate();
        const month    = MONTH_NAMES[d.getUTCMonth()];
        return `${dayName} ${dayNum} de ${month.charAt(0).toUpperCase() + month.slice(1)}`;
    } catch {
        return isoDate;
    }
}

function isMeta24hWindowError(result = {}) {
    const error = result.data?.error || {};
    const code = Number(error.code || result.code || 0);
    const text = [
        result.error,
        error.message,
        error.error_data?.details,
        JSON.stringify(result.data || {})
    ].filter(Boolean).join(' ').toLowerCase();

    return code === 131047 ||
        text.includes('131047') ||
        text.includes('24 hour') ||
        text.includes('24-hour') ||
        text.includes('outside the allowed window') ||
        text.includes('re-engagement');
}

function getMetaErrorCode(result = {}) {
    return Number(result.data?.error?.code || result.code || 0);
}

function isTerminalDirectReminderFailure(result = {}) {
    return getMetaErrorCode(result) === 131026;
}

function candidateFirstName(candidate = {}, fallback = 'Candidato') {
    const name = candidate.nombreReal || candidate.nombre || fallback;
    return String(name || fallback).trim().split(/\s+/)[0] || fallback;
}

async function saveDirectReminderStatus(redis, remId, reminder, patch) {
    await redis.set(
        `direct_reminder:${remId}`,
        JSON.stringify({ ...reminder, ...patch }),
        'EX',
        DIRECT_REMINDER_TTL_AFTER_SEND_SECONDS
    ).catch(() => {});
}

function processingLockKey(scope, id) {
    return `lock:${scope}:${Buffer.from(String(id)).toString('base64url')}`;
}

function completionMarkerKey(scope, id) {
    return `done:${scope}:${Buffer.from(String(id)).toString('base64url')}`;
}

async function acquireProcessingLock(redis, scope, id) {
    const lock = { key: processingLockKey(scope, id), token: randomUUID() };
    const result = await redis.set(lock.key, lock.token, 'EX', PROCESSING_LOCK_TTL_SECONDS, 'NX').catch(() => null);
    return result === 'OK' ? lock : null;
}

async function releaseProcessingLock(redis, lock) {
    if (!redis || !lock) return;
    try {
        const current = await redis.get(lock.key);
        if (current === lock.token) await redis.del(lock.key);
    } catch {
        // Best-effort lock cleanup only.
    }
}

async function removeDueMember(redis, zsetKey, member) {
    await redis.zrem(zsetKey, member).catch(() => {});
}

async function markCompleted(redis, scope, id, value = 'done') {
    await redis.set(completionMarkerKey(scope, id), value, 'EX', COMPLETION_MARKER_TTL_SECONDS).catch(() => {});
}

async function isCompleted(redis, scope, id) {
    return Boolean(await redis.get(completionMarkerKey(scope, id)).catch(() => null));
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

    const usageMetrics = {
        redisReads: 0,
        redisWrites: 0,
        candidateReads: 0,
        estimatedRedisBytes: 0
    };

    // Removed global config checking as it evaluates per-candidate now.

    const now = Date.now();

    // ZRANGEBYSCORE scheduled_reminders 0 now  →  O(log N + M)
    let members;
    try {
        members = await redis.zrangebyscore(REDIS_ZSET_KEY, 0, now);
        usageMetrics.redisReads += 1;
        usageMetrics.estimatedRedisBytes += estimateJsonBytes(members);
    } catch (e) {
        console.error('[SEND-REMINDERS] Redis ZRANGEBYSCORE error:', e.message);
        return res.status(500).json({ error: 'Redis query failed' });
    }

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const member of members) {
        const lock = await acquireProcessingLock(redis, 'scheduled_reminder', member);
        if (!lock) { skipped++; continue; }

        try {
            if (await isCompleted(redis, 'scheduled_reminder', member)) {
                await removeDueMember(redis, REDIS_ZSET_KEY, member);
                usageMetrics.redisReads += 1;
                usageMetrics.redisWrites += 1;
                skipped++;
                continue;
            }

            // member = "{projectId}|{stepId}|{candidateId}|{reminderId}|{citaFecha}"
            const [projectId, stepId, candidateId, reminderId, citaFecha] = member.split('|');

            if (!candidateId || !reminderId) {
                await removeDueMember(redis, REDIS_ZSET_KEY, member);
                usageMetrics.redisWrites += 1;
                skipped++;
                continue;
            }

            // ── Load candidate ────────────────────────────────────────────────
            const candidate = await getCandidateById(candidateId);
            usageMetrics.candidateReads += 1;
            usageMetrics.estimatedRedisBytes += estimateJsonBytes(candidate);
            if (!candidate?.whatsapp) {
                console.warn(`[SEND-REMINDERS] No WhatsApp for candidate ${candidateId} — skipping`);
                await removeDueMember(redis, REDIS_ZSET_KEY, member);
                usageMetrics.redisWrites += 1;
                skipped++;
                continue;
            }

            // ── Load step's reminder config ────────────────────────────────────
            const project = await getProjectById(projectId);
            usageMetrics.redisReads += 1;
            usageMetrics.estimatedRedisBytes += estimateJsonBytes(project);
            const step    = project?.steps?.find(s => s.id === stepId);
            const reminder = step?.scheduledReminders?.find(r => r.id === reminderId);

            if (!reminder?.enabled || !reminder.message) {
                await removeDueMember(redis, REDIS_ZSET_KEY, member);
                usageMetrics.redisWrites += 1;
                skipped++;
                continue;
            }

            // ── Load Meta Cloud API Config — use candidate's incomingPhoneNumberId ──
            const config = await getUltraMsgConfig(candidate.incomingPhoneNumberId || candidate.instanceId);
            if (!config) {
                console.warn(`[SEND-REMINDERS] No Meta API config — skipping`);
                throw new Error('No Meta API config');
            }

            // ── Load candidate metadata ────────────────────────────────────────
            const metadataKey = `projects:metadata:${projectId}`;
            const rawMetadata = await redis.hget(metadataKey, candidateId);
            usageMetrics.redisReads += 1;
            usageMetrics.estimatedRedisBytes += rawMetadata ? Buffer.byteLength(rawMetadata) : 0;
            const metadata = rawMetadata ? JSON.parse(rawMetadata) : {};
            const citaHora = metadata.citaHora || '';

            // ── Build message from template ───────────────────────────────────
            const nombre   = candidate.nombreReal || candidate.nombre || 'Candidato';
            const primerNombre = nombre.trim().split(/\s+/)[0] || 'Candidato';
            const fechaHuman = humanizeFecha(citaFecha);

            const message = reminder.message
                .replace(/\{\{candidato\}\}/gi, primerNombre)
                .replace(/\{\{nombre\}\}/gi, nombre)
                .replace(/\{\{citaFecha\}\}/gi, fechaHuman || citaFecha)
                .replace(/\{\{citaHora\}\}/gi, citaHora);

            // ── Send ──────────────────────────────────────────────────────────
            let finalMessagePayload = message;
            let messageType = 'chat';
            let isAudio = false;

            if (reminder.sendAsAudio) {
                try {
                    console.log(`[SEND-REMINDERS] Synthesizing TTS for reminder ${reminderId}`);
                    finalMessagePayload = await generateTTS(message, 'nova');
                    messageType = 'audio';
                    isAudio = true;
                } catch (ttsErr) {
                    console.error(`[SEND-REMINDERS] Fallback: TTS Failed for ${reminderId}, sending as text. Error:`, ttsErr.message);
                }
            }

            const sendResult = await sendUltraMsgMessage(
                config.instanceId,
                config.token,
                candidate.whatsapp,
                finalMessagePayload,
                messageType,
                { priority: 1 }
            );
            if (!sendResult?.success) {
                throw new Error(sendResult?.error || 'No se pudo enviar el recordatorio programado');
            }

            await markCompleted(redis, 'scheduled_reminder', member, 'sent');
            await removeDueMember(redis, REDIS_ZSET_KEY, member);
            usageMetrics.redisWrites += 2;

            // ── Save to chat history ──────────────────────────────────────────
            await saveMessage(candidateId, {
                from: 'me',
                content: isAudio ? `[Nota de voz Brenda] ${message}` : message,
                timestamp: new Date().toISOString(),
                meta: { reminder: true, reminderId, hoursBefor: reminder.hoursBefor, isAudio }
            }).catch(() => { });

            console.log(`[SEND-REMINDERS] ✅ Sent reminder "${reminderId}" to ${nombre} (${candidate.whatsapp})`);
            sent++;

        } catch (e) {
            console.error(`[SEND-REMINDERS] Error processing member "${member}":`, e.message);
            errors++;
        } finally {
            await releaseProcessingLock(redis, lock);
        }
    }

    // ── Recordatorios directos de candidato (direct_reminders ZSET) ──────────
    let directMembers = [];
    try {
        directMembers = await redis.zrangebyscore(DIRECT_REMINDERS_ZSET_KEY, 0, now);
        usageMetrics.redisReads += 1;
        usageMetrics.estimatedRedisBytes += estimateJsonBytes(directMembers);
    } catch (e) {
        console.error('[SEND-REMINDERS] direct_reminders ZRANGEBYSCORE error:', e.message);
    }

    for (const remId of directMembers) {
        const lock = await acquireProcessingLock(redis, 'direct_reminder', remId);
        if (!lock) { skipped++; continue; }

        let reminder = null;

        try {
            if (await isCompleted(redis, 'direct_reminder', remId)) {
                await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
                usageMetrics.redisReads += 1;
                usageMetrics.redisWrites += 1;
                skipped++;
                continue;
            }

            const raw = await redis.get(`direct_reminder:${remId}`);
            usageMetrics.redisReads += 1;
            usageMetrics.estimatedRedisBytes += raw ? Buffer.byteLength(raw) : 0;
            if (!raw) {
                await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
                usageMetrics.redisWrites += 1;
                skipped++;
                continue;
            }

            reminder = JSON.parse(raw);
            if (['sent', 'failed'].includes(reminder.status)) {
                await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
                usageMetrics.redisWrites += 1;
                skipped++;
                continue;
            }

            if (!reminder.whatsapp || !reminder.message) {
                await saveDirectReminderStatus(redis, remId, reminder, {
                    status: 'failed',
                    failedAt: new Date().toISOString(),
                    failureReason: 'Recordatorio incompleto: falta WhatsApp o mensaje.'
                });
                await markCompleted(redis, 'direct_reminder', remId, 'failed');
                await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
                usageMetrics.redisWrites += 2;
                skipped++;
                continue;
            }

            // Look up candidate to get incomingPhoneNumberId for correct number routing
            const candForReminder = reminder.candidateId ? await getCandidateById(reminder.candidateId) : null;
            if (reminder.candidateId) {
                usageMetrics.candidateReads += 1;
                usageMetrics.estimatedRedisBytes += estimateJsonBytes(candForReminder);
            }
            const config = await getUltraMsgConfig(candForReminder?.incomingPhoneNumberId || candForReminder?.instanceId);
            if (!config) {
                throw new Error('No hay configuración de WhatsApp/Meta para enviar este recordatorio.');
            }

            const textResult = await sendUltraMsgMessage(
                config.instanceId,
                config.token,
                reminder.whatsapp,
                reminder.message,
                'chat',
                { priority: 1 }
            );

            let sentVia = 'text';
            let contentToSave = reminder.message;
            let finalResult = textResult;

            if (!textResult?.success) {
                const hasTemplateFallback = reminder.fallbackTemplateData?.name;
                if (isMeta24hWindowError(textResult) && hasTemplateFallback) {
                    const fallbackName = candidateFirstName(candForReminder, reminder.nombre || 'Candidato');
                    const templateData = reminder.fallbackTemplateData;
                    const templateParams = reminder.fallbackTemplateParams || {};
                    const extraParams = {
                        templateName: templateData.name,
                        languageCode: templateData.language || 'es_MX',
                        priority: 1
                    };
                    const componentsToSend = buildMetaTemplateComponents(
                        templateData.components,
                        fallbackName,
                        { templateParams, parameterFormat: templateData.parameter_format }
                    );
                    if (componentsToSend.length > 0) {
                        extraParams.components = componentsToSend;
                    }

                    const templateResult = await sendUltraMsgMessage(
                        config.instanceId,
                        config.token,
                        reminder.whatsapp,
                        templateData.name,
                        'template',
                        extraParams
                    );

                    finalResult = templateResult;
                    if (templateResult?.success) {
                        sentVia = 'template_fallback';
                        const displayName = templateData.name.replace(/_/g, ' ');
                        const renderedBody = renderMetaTemplatePreviewText(templateData, fallbackName, { templateParams });
                        contentToSave = `⚡ Plantilla de recordatorio: *${displayName}*\n\n${renderedBody}`.trim();
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
                        usageMetrics.redisWrites += 2;
                        errors++;
                        continue;
                    }

                    throw new Error(failureReason);
                }
            }

            await saveMessage(reminder.candidateId, {
                from: 'me',
                content: contentToSave,
                type: sentVia === 'template_fallback' ? 'template' : 'text',
                timestamp: new Date().toISOString(),
                meta: {
                    directReminder: true,
                    reminderId: remId,
                    sentVia,
                    usedFallbackTemplate: sentVia === 'template_fallback'
                }
            }).catch(() => {});

            // Marcar como enviado (no eliminar — sirve para historial)
            await saveDirectReminderStatus(redis, remId, reminder, {
                status: 'sent',
                sentAt: new Date().toISOString(),
                sentVia
            });
            await markCompleted(redis, 'direct_reminder', remId, 'sent');
            await removeDueMember(redis, DIRECT_REMINDERS_ZSET_KEY, remId);
            usageMetrics.redisWrites += 2;

            console.log(`[SEND-REMINDERS] ✅ Direct reminder (${sentVia}) → ${reminder.nombre} (${reminder.whatsapp})`);
            sent++;
        } catch (e) {
            console.error(`[SEND-REMINDERS] Error in direct reminder "${remId}":`, e.message);
            if (reminder) {
                await saveDirectReminderStatus(redis, remId, reminder, {
                    status: 'pending',
                    lastAttemptAt: new Date().toISOString(),
                    failureReason: e.message || 'Error inesperado procesando el recordatorio.'
                });
            }
            errors++;
        } finally {
            await releaseProcessingLock(redis, lock);
        }
    }

    recordUsageMetric(redis, '/api/cron/send-reminders', usageMetrics).catch(() => {});

    return res.json({
        success: true,
        processed: members.length + directMembers.length,
        sent,
        skipped,
        errors,
        timestamp: new Date().toISOString()
    });
}
