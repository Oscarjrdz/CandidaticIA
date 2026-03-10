import { processMessage } from '../ai/agent.js';
import { logTelemetry } from '../utils/telemetry.js';
import {
    getWaitlist,
    isCandidateLocked,
    unlockCandidate,
    markMessageAsDone,
    getCandidateById
} from '../utils/storage.js';

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

        console.log(`[Serverless Engine] 🌪️ Draining burst for ${candidateId}. Count: ${pendingMsgs.length}. Text: ${aggregatedText}`);

        try {
            await logTelemetry('processing_start', { candidateId, count: pendingMsgs.length });

            await processMessage(candidateId, aggregatedText, msgIds[0] || null);
            await logTelemetry('ai_complete', { candidateId });
            await Promise.all(msgIds.map(id => markMessageAsDone(id).catch(() => { })));

            // 🧹 CLEANUP: Only clear processed waitlist items (Safety Net)
            const { clearWaitlist } = await import('../utils/storage.js');
            await clearWaitlist(candidateId, pendingMsgs.length);

            console.log(`[Serverless Engine] ✅ Completed burst of ${pendingMsgs.length} messages.`);
        } catch (procErr) {
            console.error(`[Serverless Engine] ❌ Error in burst processing:`, procErr.message);
            break;
        }

        loopSafety++;
        const more = await getWaitlist(candidateId);
        if (!more || more.length === 0) break;
    }
}

export async function runTurboEngine(candidateId, from) {
    console.log(`🔄 Worker triggered for ${candidateId} from ${from}`);

    try {
        // 🔒 1. ACQUIRE LOCK
        const isLocked = await isCandidateLocked(candidateId);
        if (isLocked) {
            console.log(`[Serverless Engine] ⏳ ${candidateId} busy. Another instance is processing.`);
            return { success: true, status: 'locked' };
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
