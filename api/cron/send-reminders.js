/* global process */
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

const REDIS_ZSET_KEY = 'scheduled_reminders';
const DIRECT_REMINDER_TTL_AFTER_SEND_SECONDS = 60 * 60 * 24 * 7;

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

    // Removed global config checking as it evaluates per-candidate now.

    const now = Date.now();

    // ZRANGEBYSCORE scheduled_reminders 0 now  →  O(log N + M)
    let members;
    try {
        members = await redis.zrangebyscore(REDIS_ZSET_KEY, 0, now);
    } catch (e) {
        console.error('[SEND-REMINDERS] Redis ZRANGEBYSCORE error:', e.message);
        return res.status(500).json({ error: 'Redis query failed' });
    }

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const member of members) {
        // Always remove from set first — prevents re-processing even on error
        await redis.zrem(REDIS_ZSET_KEY, member).catch(() => { });

        try {
            // member = "{projectId}|{stepId}|{candidateId}|{reminderId}|{citaFecha}"
            const [projectId, stepId, candidateId, reminderId, citaFecha] = member.split('|');

            if (!candidateId || !reminderId) {
                skipped++;
                continue;
            }

            // ── Load candidate ────────────────────────────────────────────────
            const candidate = await getCandidateById(candidateId);
            if (!candidate?.whatsapp) {
                console.warn(`[SEND-REMINDERS] No WhatsApp for candidate ${candidateId} — skipping`);
                skipped++;
                continue;
            }

            // ── Load step's reminder config ────────────────────────────────────
            const project = await getProjectById(projectId);
            const step    = project?.steps?.find(s => s.id === stepId);
            const reminder = step?.scheduledReminders?.find(r => r.id === reminderId);

            if (!reminder?.enabled || !reminder.message) {
                skipped++;
                continue;
            }

            // ── Load Meta Cloud API Config — use candidate's incomingPhoneNumberId ──
            const config = await getUltraMsgConfig(candidate.incomingPhoneNumberId || candidate.instanceId);
            if (!config) {
                console.warn(`[SEND-REMINDERS] No Meta API config — skipping`);
                skipped++;
                continue;
            }

            // ── Load candidate metadata ────────────────────────────────────────
            const metadataKey = `projects:metadata:${projectId}`;
            const rawMetadata = await redis.hget(metadataKey, candidateId);
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

            await sendUltraMsgMessage(
                config.instanceId,
                config.token,
                candidate.whatsapp,
                finalMessagePayload,
                messageType,
                { priority: 1 }
            );

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
        }
    }

    // ── Recordatorios directos de candidato (direct_reminders ZSET) ──────────
    let directMembers = [];
    try {
        directMembers = await redis.zrangebyscore('direct_reminders', 0, now);
    } catch (e) {
        console.error('[SEND-REMINDERS] direct_reminders ZRANGEBYSCORE error:', e.message);
    }

    for (const remId of directMembers) {
        await redis.zrem('direct_reminders', remId).catch(() => {});
        let reminder = null;

        try {
            const raw = await redis.get(`direct_reminder:${remId}`);
            if (!raw) { skipped++; continue; }

            reminder = JSON.parse(raw);
            if (!reminder.whatsapp || !reminder.message) {
                await saveDirectReminderStatus(redis, remId, reminder, {
                    status: 'failed',
                    failedAt: new Date().toISOString(),
                    failureReason: 'Recordatorio incompleto: falta WhatsApp o mensaje.'
                });
                skipped++;
                continue;
            }

            // Look up candidate to get incomingPhoneNumberId for correct number routing
            const candForReminder = reminder.candidateId ? await getCandidateById(reminder.candidateId) : null;
            const config = await getUltraMsgConfig(candForReminder?.incomingPhoneNumberId || candForReminder?.instanceId);
            if (!config) {
                await saveDirectReminderStatus(redis, remId, reminder, {
                    status: 'failed',
                    failedAt: new Date().toISOString(),
                    failureReason: 'No hay configuración de WhatsApp/Meta para enviar este recordatorio.'
                });
                skipped++;
                continue;
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
                        ? 'Meta rechazó texto libre por ventana de 24h cerrada y no había plantilla Plan B.'
                        : (finalResult?.error || textResult?.error || 'No se pudo enviar el recordatorio');
                    await saveDirectReminderStatus(redis, remId, reminder, {
                        status: 'failed',
                        failedAt: new Date().toISOString(),
                        failureReason,
                        metaError: finalResult?.data?.error || textResult?.data?.error || null
                    });
                    errors++;
                    continue;
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

            console.log(`[SEND-REMINDERS] ✅ Direct reminder (${sentVia}) → ${reminder.nombre} (${reminder.whatsapp})`);
            sent++;
        } catch (e) {
            console.error(`[SEND-REMINDERS] Error in direct reminder "${remId}":`, e.message);
            if (reminder) {
                await saveDirectReminderStatus(redis, remId, reminder, {
                    status: 'failed',
                    failedAt: new Date().toISOString(),
                    failureReason: e.message || 'Error inesperado procesando el recordatorio.'
                });
            }
            errors++;
        }
    }

    return res.json({
        success: true,
        processed: members.length + directMembers.length,
        sent,
        skipped,
        errors,
        timestamp: new Date().toISOString()
    });
}
