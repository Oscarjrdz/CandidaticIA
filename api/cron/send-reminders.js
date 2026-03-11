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
import { getUltraMsgConfig, sendUltraMsgMessage } from '../whatsapp/utils.js';

const REDIS_ZSET_KEY = 'scheduled_reminders';

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

    const config = await getUltraMsgConfig();
    if (!config?.instanceId || !config?.token) {
        console.warn('[SEND-REMINDERS] UltraMsg not configured — skipping');
        return res.json({ success: true, skipped: true, reason: 'no_ultramsg_config' });
    }

    const now = Date.now();

    // ZRANGEBYSCORE scheduled_reminders 0 now  →  O(log N + M)
    let members;
    try {
        members = await redis.zrangebyscore(REDIS_ZSET_KEY, 0, now);
    } catch (e) {
        console.error('[SEND-REMINDERS] Redis ZRANGEBYSCORE error:', e.message);
        return res.status(500).json({ error: 'Redis query failed' });
    }

    if (!members || members.length === 0) {
        return res.json({ success: true, processed: 0, sent: 0 });
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

            // ── Build message from template ───────────────────────────────────
            const nombre   = candidate.nombreReal || candidate.nombre || 'Candidato';
            const citaHora = candidate.projectMetadata?.citaHora || '';
            const fechaHuman = humanizeFecha(citaFecha);

            const message = reminder.message
                .replace(/\{\{nombre\}\}/gi, nombre)
                .replace(/\{\{citaFecha\}\}/gi, fechaHuman || citaFecha)
                .replace(/\{\{citaHora\}\}/gi, citaHora);

            // ── Send ──────────────────────────────────────────────────────────
            await sendUltraMsgMessage(
                config.instanceId,
                config.token,
                candidate.whatsapp,
                message,
                'chat',
                { priority: 1 }
            );

            // ── Save to chat history ──────────────────────────────────────────
            await saveMessage(candidateId, {
                from: 'me',
                content: message,
                timestamp: new Date().toISOString(),
                meta: { reminder: true, reminderId, hoursBefor: reminder.hoursBefor }
            }).catch(() => { });

            console.log(`[SEND-REMINDERS] ✅ Sent reminder "${reminderId}" to ${nombre} (${candidate.whatsapp})`);
            sent++;

        } catch (e) {
            console.error(`[SEND-REMINDERS] Error processing member "${member}":`, e.message);
            errors++;
        }
    }

    return res.json({
        success: true,
        processed: members.length,
        sent,
        skipped,
        errors,
        timestamp: new Date().toISOString()
    });
}
