/**
 * reminder-scheduler.js
 * Pre-schedules WhatsApp reminder messages into a Redis Sorted Set.
 * Score = Unix timestamp (ms) when the message should be sent.
 * Member = "{projectId}|{stepId}|{candidateId}|{reminderId}|{citaFecha}"
 *
 * The cron at /api/cron/send-reminders  does: ZRANGEBYSCORE 0 → now
 * and sends only what's ready. O(log N) — no full candidate scan.
 */

import { getRedisClient, getProjectById } from './storage.js';

const REDIS_ZSET_KEY = 'scheduled_reminders';

/**
 * Parse "12:00 PM" or "8:30 AM ⏰" → Unix timestamp (ms) in CST (UTC-6).
 */
function parseAppointmentMs(citaFecha, citaHora) {
    if (!citaFecha || !citaHora) return null;

    // Strip emojis / non-time chars
    const clean = citaHora.replace(/[^\d:APM ]/gi, '').trim();
    const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;

    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const period = match[3].toUpperCase();

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
 * into the Redis Sorted Set.
 *
 * @param {{ candidateId, projectId, stepId, citaFecha, citaHora }} opts
 */
export async function scheduleRemindersForCandidate({ candidateId, projectId, stepId, citaFecha, citaHora }) {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        const appointmentMs = parseAppointmentMs(citaFecha, citaHora);
        if (!appointmentMs) {
            console.warn(`[REMINDER-SCHEDULER] Could not parse appointment time: ${citaFecha} ${citaHora}`);
            return;
        }

        const project = await getProjectById(projectId);
        if (!project) return;

        const step = project.steps?.find(s => s.id === stepId);
        const reminders = step?.scheduledReminders || [];
        if (reminders.length === 0) return;

        const now = Date.now();
        const pipeline = redis.pipeline();

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
            const member = `${projectId}|${stepId}|${candidateId}|${reminder.id}|${citaFecha}`;
            pipeline.zadd(REDIS_ZSET_KEY, triggerMs, member);
        }

        await pipeline.exec();
    } catch (e) {
        console.error('[REMINDER-SCHEDULER] Error scheduling reminders:', e.message);
    }
}

/**
 * Remove all scheduled reminders for a candidate (citaFecha-specific).
 * Call this if the candidate cancels or reschedules their appointment.
 */
export async function cancelRemindersForCandidate(candidateId, citaFecha) {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        // Scan all members and remove ones matching this candidate+date
        // (ZSCAN is efficient for this purpose)
        let cursor = '0';
        do {
            const [nextCursor, entries] = await redis.zscan(REDIS_ZSET_KEY, cursor, 'MATCH', `*|${candidateId}|*|${citaFecha}`, 'COUNT', 100);
            cursor = nextCursor;

            if (entries.length > 0) {
                // entries = [member, score, member, score, ...]
                const members = entries.filter((_, i) => i % 2 === 0);
                if (members.length > 0) {
                    await redis.zrem(REDIS_ZSET_KEY, ...members);
                    console.log(`[REMINDER-SCHEDULER] Cancelled ${members.length} reminders for candidate ${candidateId}`);
                }
            }
        } while (cursor !== '0');
    } catch (e) {
        console.error('[REMINDER-SCHEDULER] Error cancelling reminders:', e.message);
    }
}
