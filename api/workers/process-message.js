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
 * 🚀 SERVERLESS TURBO ENGINE
 * Processes candidate messages in bursts to handle high-frequency WhatsApp traffic.
 */

async function drainWaitlist(candidateId) {
    let loopSafety = 0;
    while (loopSafety < 10) {
        const pendingMsgs = await getWaitlist(candidateId);
        if (!pendingMsgs || pendingMsgs.length === 0) break;

        const aggregatedText = pendingMsgs.map(m => {
            const val = m.text?.url || m.text || m;
            return (typeof val === 'object') ? JSON.stringify(val) : val;
        }).join('\n'); // Change separator to newline for better AI reading

        const msgIds = pendingMsgs.map(m => m.msgId).filter(id => id);

        console.error(`[Serverless Engine] 🌪️ Draining burst for ${candidateId}. Count: ${pendingMsgs.length}.`);

        // 🔁 Retry logic: up to 2 attempts with 2s backoff
        // Without this, a cold-start LLM failure leaves the message in the waitlist
        // and the user has to send it again to get a response.
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
                if (attempts >= 2) break; // Give up after 2 attempts, leave in waitlist for next trigger
            }
        }

        if (!success) break;

        loopSafety++;
        const more = await getWaitlist(candidateId);
        if (!more || more.length === 0) break;
    }
}

export async function runTurboEngine(candidateId, from) {
    console.log(`🔄 Worker triggered for ${candidateId} from ${from}`);

    try {
        // 🔒 1. ACQUIRE LOCK (with wait-and-retry for rapid-fire messages)
        let isLocked = await isCandidateLocked(candidateId);
        if (isLocked) {
            console.error(`[Serverless Engine] ⏳ ${candidateId} busy. Waiting for lock release...`);
            // Wait up to 15s for the lock to clear (30 polls × 500ms)
            let waited = 0;
            const POLL_MS = 500;
            const MAX_WAIT = 15000;
            while (waited < MAX_WAIT) {
                await new Promise(r => setTimeout(r, POLL_MS));
                waited += POLL_MS;
                isLocked = await isCandidateLocked(candidateId);
                if (!isLocked) {
                    console.error(`[Serverless Engine] 🔓 Lock released after ${waited}ms. Draining orphaned messages...`);
                    break;
                }
            }
            if (isLocked) {
                console.error(`[Serverless Engine] ⚠️ ${candidateId} still locked after ${MAX_WAIT}ms. Giving up.`);
                return { success: true, status: 'locked' };
            }
        }

        try {
            // 🚀 2. BURST DE-BOUNCE: Wait 20ms for rapid-fire messages to accumulate
            console.log(`[Serverless Engine] ⏳ De-bouncing burst for ${candidateId}...`);
            await new Promise(r => setTimeout(r, 20));

            // 🚀 3. DRAIN WAITLIST
            await drainWaitlist(candidateId);
            return { success: true, candidateId };
        } finally {
            // 🔓 3. UNLOCK
            await unlockCandidate(candidateId);
            console.log(`[Serverless Engine] 🔓 ${candidateId} unlocked.`);
        }
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

    if (result.status === 'locked') return res.status(202).json(result);
    if (result.error) return res.status(500).json(result);
    return res.status(200).json(result);
}
