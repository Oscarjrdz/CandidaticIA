import { processMessage } from '../ai/agent.js';
import { getCandidateById, getWaitlist, markMessageAsDone, unlockCandidate, isCandidateLocked } from '../utils/storage.js';

/**
 * 🚀 SERVERLESS TURBO ENGINE
 * Processes candidate messages in bursts to handle high-frequency WhatsApp traffic.
 */

async function drainWaitlist(candidateId) {
    let loopSafety = 0;
    while (loopSafety < 10) {
        const rawPendingMsgs = await getWaitlist(candidateId);
        if (!rawPendingMsgs || rawPendingMsgs.length === 0) break;

        const pendingMsgs = rawPendingMsgs.map(m => {
            try { return typeof m === 'string' ? JSON.parse(m) : m; }
            catch (e) { return { text: m }; }
        });

        const aggregatedText = pendingMsgs.map(m => {
            const val = m.text?.url || m.text || m;
            return (typeof val === 'object') ? JSON.stringify(val) : val;
        }).join(' | ');

        const msgIds = pendingMsgs.map(m => m.msgId).filter(id => id);

        console.log(`[Serverless Engine] 🌪️ Draining burst for ${candidateId}. Count: ${pendingMsgs.length}`);

        try {
            await processMessage(candidateId, aggregatedText, msgIds[0] || null);
            await Promise.all(msgIds.map(id => markMessageAsDone(id).catch(() => { })));

            // 🧹 CLEANUP: Only clear waitlist after success (Safety Net)
            const { clearWaitlist } = await import('../utils/storage.js');
            await clearWaitlist(candidateId);

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

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { candidateId, from } = req.body;
    if (!candidateId) return res.status(400).json({ error: 'Missing candidateId' });

    console.log(`🔄 Worker triggered for ${candidateId} from ${from}`);

    try {
        // 🔒 1. ACQUIRE LOCK
        const isLocked = await isCandidateLocked(candidateId);
        if (isLocked) {
            console.log(`[Serverless Engine] ⏳ ${candidateId} busy. Another instance is processing.`);
            return res.status(202).json({ success: true, status: 'locked' });
        }

        try {
            // 🚀 2. DRAIN WAITLIST
            await drainWaitlist(candidateId);
            return res.status(200).json({ success: true, candidateId });
        } finally {
            // 🔓 3. UNLOCK
            await unlockCandidate(candidateId);
            console.log(`[Serverless Engine] 🔓 ${candidateId} unlocked.`);
        }
    } catch (error) {
        console.error('❌ Worker Critical Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
