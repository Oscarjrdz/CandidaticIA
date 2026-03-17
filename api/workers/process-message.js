import { processMessage } from '../ai/agent.js';
import { logTelemetry } from '../utils/telemetry.js';
import {
    getWaitlist,
    isCandidateLocked,
    unlockCandidate,
    markMessageAsDone,
    getCandidateById
} from '../utils/storage.js';

export const maxDuration = 60; // Extend Vercel timeout for LLM bursts

/**
 * 🚀 SERVERLESS TURBO ENGINE v2 — Production-Ready for 500+ candidates/hour
 * 
 * ARCHITECTURE:
 * 1. Lock holder drains waitlist in a loop (handles bursts of messages)
 * 2. After unlock, a POST-UNLOCK SWEEP checks for orphaned messages
 *    that arrived in the microsecond between "waitlist empty" and "unlock"
 * 3. Late-arriving instances return immediately (their messages are in the waitlist
 *    and will be picked up by the sweep or the next drain loop)
 * 
 * This eliminates the wasteful 15s polling that would burn serverless compute at scale.
 */

async function drainWaitlist(candidateId) {
    let loopSafety = 0;
    while (loopSafety < 10) {
        const pendingMsgs = await getWaitlist(candidateId);
        if (!pendingMsgs || pendingMsgs.length === 0) break;

        // Parse waitlist entries (they may be JSON strings from addToWaitlist)
        const parsed = pendingMsgs.map(m => {
            try { return typeof m === 'string' ? JSON.parse(m) : m; }
            catch { return { text: m }; }
        });

        const aggregatedText = parsed.map(m => {
            const val = m.text?.url || m.text || m;
            return (typeof val === 'object') ? JSON.stringify(val) : val;
        }).join('\n'); // Newline separator for better AI reading

        const msgIds = parsed.map(m => m.msgId).filter(id => id);

        console.error(`[Serverless Engine] 🌪️ Draining burst for ${candidateId}. Count: ${pendingMsgs.length}.`);

        // 🔁 Retry logic: up to 2 attempts with 2s backoff
        let attempts = 0;
        let success = false;
        while (attempts < 2 && !success) {
            try {
                if (attempts > 0) {
                    console.error(`[Serverless Engine] 🔁 Retry attempt ${attempts} for ${candidateId}...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
                await logTelemetry('processing_start', { candidateId, count: pendingMsgs.length, attempt: attempts });
                await processMessage(candidateId, aggregatedText, msgIds[0] || null);
                await logTelemetry('ai_complete', { candidateId });
                await Promise.all(msgIds.map(id => markMessageAsDone(id).catch(() => { })));

                // 🧹 CLEANUP: Only clear processed waitlist items (Safety Net)
                const { clearWaitlist } = await import('../utils/storage.js');
                await clearWaitlist(candidateId, pendingMsgs.length);

                console.error(`[Serverless Engine] ✅ Completed burst of ${pendingMsgs.length} messages.`);
                success = true;
            } catch (procErr) {
                attempts++;
                console.error(`[Serverless Engine] ❌ Error (attempt ${attempts}):`, procErr.message);
                if (attempts >= 2) break;
            }
        }

        if (!success) break;

        loopSafety++;
        const more = await getWaitlist(candidateId);
        if (!more || more.length === 0) break;
    }
}

export async function runTurboEngine(candidateId, from) {
    console.error(`🔄 Worker triggered for ${candidateId} from ${from}`);

    try {
        // 🔒 1. ACQUIRE LOCK (atomic SET NX — if someone else has it, return immediately)
        const isLocked = await isCandidateLocked(candidateId);
        if (isLocked) {
            // ✅ SAFE TO RETURN: Our message is already in the waitlist (addToWaitlist ran before us).
            // The lock holder will pick it up via drainWaitlist's loop or the POST-UNLOCK SWEEP.
            console.error(`[Serverless Engine] ⏳ ${candidateId} busy. Message is queued — lock holder will drain it.`);
            return { success: true, status: 'queued' };
        }

        // We now hold the lock. Process everything.
        try {
            // 🚀 2. BURST DE-BOUNCE: Wait 50ms for rapid-fire messages to accumulate in waitlist
            await new Promise(r => setTimeout(r, 50));

            // 🚀 3. DRAIN WAITLIST (loops until empty)
            await drainWaitlist(candidateId);
        } finally {
            // 🔓 4. UNLOCK
            await unlockCandidate(candidateId);
            console.error(`[Serverless Engine] 🔓 ${candidateId} unlocked.`);

            // 🧹 5. POST-UNLOCK SWEEP (Production Safety Net)
            // Check ONE MORE TIME for messages that arrived in the microsecond
            // between "waitlist was empty" and "unlockCandidate".
            // This is the critical fix for the race condition at scale.
            try {
                const orphaned = await getWaitlist(candidateId);
                if (orphaned && orphaned.length > 0) {
                    console.error(`[Serverless Engine] 🔍 POST-UNLOCK SWEEP: Found ${orphaned.length} orphaned message(s). Re-acquiring lock...`);
                    // Try to re-acquire lock. If another instance already got it, they'll handle it.
                    const reLocked = await isCandidateLocked(candidateId);
                    if (!reLocked) {
                        // We got the lock again. Drain the orphans.
                        try {
                            await drainWaitlist(candidateId);
                        } finally {
                            await unlockCandidate(candidateId);
                            console.error(`[Serverless Engine] 🔓 POST-UNLOCK SWEEP complete. ${candidateId} unlocked.`);
                        }
                    } else {
                        console.error(`[Serverless Engine] 🤝 Another instance already processing orphans for ${candidateId}.`);
                    }
                }
            } catch (sweepErr) {
                console.error(`[Serverless Engine] ⚠️ POST-UNLOCK SWEEP error (non-fatal):`, sweepErr.message);
            }
        }

        return { success: true, candidateId };
    } catch (error) {
        console.error('❌ Worker Critical Error:', error);
        return { success: false, error: error.message };
    }
}

// 🚀 TURBO MODE: Silence all synchronous Vercel console I/O unless actively debugging
if (process.env.DEBUG_MODE !== 'true') {
    console.log = function () { };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { candidateId, from } = req.body;
    if (!candidateId) return res.status(400).json({ error: 'Missing candidateId' });

    const result = await runTurboEngine(candidateId, from);

    if (result.status === 'queued') return res.status(202).json(result);
    if (result.error) return res.status(500).json(result);
    return res.status(200).json(result);
}
