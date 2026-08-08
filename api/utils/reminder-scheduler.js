/**
 * reminder-scheduler.js
 * Pre-schedules WhatsApp reminder messages into a Redis Sorted Set.
 * Score = Unix timestamp (ms) when the message should be sent.
 * Member = "{projectId}|{stepId}|{candidateId}|{reminderId}|{citaFecha}"
 *
 * The cron at /api/cron/send-reminders  does: ZRANGEBYSCORE 0 → now
 * and sends only what's ready. O(log N) — no full candidate scan.
 *
 * Un índice secundario por candidato (`scheduled_reminders:candidate:<id>`, un SET
 * de members) permite cancelar/limpiar los recordatorios de un candidato en O(1)
 * en vez de un ZSCAN completo del sorted set — mismo patrón que ya usa
 * `direct_reminders:candidate:<id>` en api/candidate-reminders.js.
 */

import { getRedisClient, getProjectById } from './storage.js';

const REDIS_ZSET_KEY = 'scheduled_reminders';
const candidateIndexKey = (candidateId) => `scheduled_reminders:candidate:${candidateId}`;

/**
 * Parse "12:00 PM" or "8:30 AM ⏰" → Unix timestamp (ms) in CST (UTC-6).
 */
function parseAppointmentMs(citaFecha, citaHora) {
    if (!citaFecha || !citaHora) return null;

    // Strip emojis / non-time chars
    const clean = citaHora.replace(/[^\d:APM ]/gi, '').trim();
    const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return null;

    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const period = match[3] ? match[3].toUpperCase() : null;

    if (period === 'PM' && h < 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;

    // Build ISO string with CST offset (-06:00) so getTime() returns correct UTC ms
    const dateStr = `${citaFecha}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-06:00`;
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * Called right after a candidate is moved to the CITADOS step.
 * Reads the step's scheduledReminders config and pre-inserts trigger timestamps
 * into the Redis Sorted Set (+ the per-candidate index used to cancel them later).
 *
 * @param {{ candidateId, projectId, stepId, citaFecha, citaHora }} opts
 * @returns {Promise<number>} cuántos recordatorios se agendaron
 */
export async function scheduleRemindersForCandidate({ candidateId, projectId, stepId, citaFecha, citaHora }) {
    const redis = getRedisClient();
    if (!redis) return 0;

    try {
        const appointmentMs = parseAppointmentMs(citaFecha, citaHora);
        if (!appointmentMs) {
            console.warn(`[REMINDER-SCHEDULER] Could not parse appointment time: ${citaFecha} ${citaHora}`);
            return 0;
        }

        const project = await getProjectById(projectId);
        if (!project) return 0;

        const step = project.steps?.find(s => s.id === stepId);
        const reminders = step?.scheduledReminders || [];
        if (reminders.length === 0) return 0;

        const now = Date.now();
        const members = [];

        for (const reminder of reminders) {
            if (!reminder.enabled || !reminder.message) continue;

            let triggerMs;

            if (reminder.triggerMode === 'exact_time' && reminder.exactTime) {
                // 🕐 EXACT TIME MODE: Fire at a specific HH:MM on the appointment day (CST)
                const [hStr, mStr] = reminder.exactTime.split(':');
                const h = parseInt(hStr, 10);
                const m = parseInt(mStr, 10);
                if (isNaN(h) || isNaN(m)) {
                    console.warn(`[REMINDER-SCHEDULER] Invalid exactTime "${reminder.exactTime}" for reminder ${reminder.id}. Skipping.`);
                    continue;
                }
                const dateStr = `${citaFecha}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-06:00`;
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) {
                    console.warn(`[REMINDER-SCHEDULER] Could not build exact time date for ${citaFecha} ${reminder.exactTime}. Skipping.`);
                    continue;
                }
                triggerMs = d.getTime();
                console.log(`[REMINDER-SCHEDULER] Exact-time reminder "${reminder.id}" for candidate ${candidateId} at ${d.toISOString()} (${reminder.exactTime} on ${citaFecha})`);
            } else {
                // ⏳ HOURS BEFORE MODE (default / backwards-compatible)
                const hoursBefor = Number(reminder.hoursBefor) || 0;
                triggerMs = appointmentMs - (hoursBefor * 3600 * 1000);
                console.log(`[REMINDER-SCHEDULER] Hours-before reminder "${reminder.id}" for candidate ${candidateId} at ${new Date(triggerMs).toISOString()} (${hoursBefor}h before appointment)`);
            }

            if (triggerMs <= now) {
                console.warn(`[REMINDER-SCHEDULER] Trigger time in the past for reminder ${reminder.id}. Skipping.`);
                continue;
            }

            // Member encodes all lookup info — pipe-separated
            members.push({ member: `${projectId}|${stepId}|${candidateId}|${reminder.id}|${citaFecha}`, triggerMs });
        }

        if (members.length === 0) return 0;

        const pipeline = redis.pipeline();
        members.forEach(({ member, triggerMs }) => {
            pipeline.zadd(REDIS_ZSET_KEY, triggerMs, member);
            pipeline.sadd(candidateIndexKey(candidateId), member);
        });
        // El índice por candidato vive mientras haya recordatorios pendientes; TTL de
        // seguridad generoso (90 días) por si algún candidato nunca vuelve a tocar el flujo.
        pipeline.expire(candidateIndexKey(candidateId), 60 * 60 * 24 * 90);
        await pipeline.exec();

        return members.length;
    } catch (e) {
        console.error('[REMINDER-SCHEDULER] Error scheduling reminders:', e.message);
        return 0;
    }
}

/**
 * Remove scheduled reminders for a candidate from the ZSET + su índice.
 * Sin `citaFecha`, cancela TODOS los recordatorios pendientes del candidato
 * (usado al borrar un candidato). Con `citaFecha`, solo cancela los de esa cita
 * específica (usado al reagendar: se cancela la cita vieja antes de agendar la nueva).
 *
 * @returns {Promise<number>} cuántos recordatorios se cancelaron
 */
export async function cancelRemindersForCandidate(candidateId, citaFecha = null) {
    const redis = getRedisClient();
    if (!redis) return 0;

    try {
        const indexKey = candidateIndexKey(candidateId);
        let members = await redis.smembers(indexKey);

        // Compat: candidatos agendados antes de que existiera el índice no van a tener
        // nada en `indexKey` — fallback a ZSCAN sobre el ZSET completo (más caro, pero
        // solo corre para el remanente histórico previo a este cambio).
        if (members.length === 0) {
            members = await scanZsetForCandidate(redis, candidateId);
        }

        const toRemove = citaFecha
            ? members.filter(m => m.endsWith(`|${citaFecha}`))
            : members;

        if (toRemove.length === 0) return 0;

        const pipeline = redis.pipeline();
        pipeline.zrem(REDIS_ZSET_KEY, ...toRemove);
        pipeline.srem(indexKey, ...toRemove);
        await pipeline.exec();

        console.log(`[REMINDER-SCHEDULER] Cancelled ${toRemove.length} reminders for candidate ${candidateId}${citaFecha ? ` (cita ${citaFecha})` : ''}`);
        return toRemove.length;
    } catch (e) {
        console.error('[REMINDER-SCHEDULER] Error cancelling reminders:', e.message);
        return 0;
    }
}

async function scanZsetForCandidate(redis, candidateId) {
    const found = [];
    let cursor = '0';
    do {
        const [nextCursor, entries] = await redis.zscan(REDIS_ZSET_KEY, cursor, 'MATCH', `*|${candidateId}|*`, 'COUNT', 100);
        cursor = nextCursor;
        for (let i = 0; i < entries.length; i += 2) found.push(entries[i]);
    } while (cursor !== '0');
    return found;
}

/**
 * Quita un member puntual del ZSET + su índice — usado por el cron cuando un
 * recordatorio ya se procesó (enviado, saltado o descartado por viejo).
 */
export async function removeScheduledReminderMember(redis, member) {
    if (!redis || !member) return;
    // member = "{projectId}|{stepId}|{candidateId}|{reminderId}|{citaFecha}"
    const candidateId = member.split('|')[2];
    const pipeline = redis.pipeline();
    pipeline.zrem(REDIS_ZSET_KEY, member);
    if (candidateId) pipeline.srem(candidateIndexKey(candidateId), member);
    await pipeline.exec().catch(() => {});
}
