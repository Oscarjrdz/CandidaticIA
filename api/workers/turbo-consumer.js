import dotenv from 'dotenv';
dotenv.config();
import { processMessage } from '../ai/agent.js';
import { getRedisClient, markMessageAsDone, unlockCandidate } from '../utils/storage.js';

/**
 * 🚀 BRENDA TURBO ENGINE (Async Consumer)
 * This worker runs in the background, pulls messages from Redis queue,
 * and processes them using the AI Agent.
 */

async function startConsumer() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('❌ [Turbo Engine] Redis client not found. Retrying in 5s...');
        setTimeout(startConsumer, 5000);
        return;
    }

    const QUEUE_KEY = 'queue:messages';
    console.log('🚀 [Turbo Engine] Engine started. Listening for messages...');

    while (true) {
        try {
            // BRPOP blocks until a message is available
            // Result is [key, value]
            const result = await redis.brpop(QUEUE_KEY, 0);
            if (!result) continue;

            const [_, rawData] = result;
            const data = JSON.parse(rawData);
            const { candidateId } = data;

            // 🏁 1. ACQUIRE LOCK (If already locked, another worker is handling this candidate)
            const { isCandidateLocked, getWaitlist, markMessageAsDone, unlockCandidate } = await import('../utils/storage.js');
            const alreadyLocked = await isCandidateLocked(candidateId);
            if (alreadyLocked) {
                console.log(`[Turbo Engine] ⏳ Candidate ${candidateId} is busy. Skipping task.`);
                continue;
            }

            try {
                console.log(`[Turbo Engine] ⚡ Processing candidate ${candidateId}...`);
                // 🏁 2. WORKER DRAIN LOOP (Burst Aggregation)
                let loopSafety = 0;
                while (loopSafety < 10) {
                    const { getWaitlist, markMessageAsDone } = await import('../utils/storage.js');
                    const rawPendingMsgs = await getWaitlist(candidateId);

                    if (!rawPendingMsgs || rawPendingMsgs.length === 0) break;

                    const pendingMsgs = rawPendingMsgs.map(m => {
                        try { return typeof m === 'string' ? JSON.parse(m) : m; }
                        catch (e) { return { text: m }; }
                    });

                    // Aggregate text (e.g., "Hola" | "Soy Oscar")
                    const aggregatedText = pendingMsgs.map(m => {
                        const val = m.text?.url || m.text || m;
                        return (typeof val === 'object') ? JSON.stringify(val) : val;
                    }).join(' | ');

                    const msgIds = pendingMsgs.map(m => m.msgId).filter(id => id);

                    console.log(`[Turbo Engine] 🌪️ Draining burst for ${candidateId}. Count: ${pendingMsgs.length}`);

                    try {
                        // Call the existing agent logic with aggregated text
                        // We use the first msgId as reference for reactions
                        await processMessage(candidateId, aggregatedText, msgIds[0] || null);

                        // Finalize deduplication for all messages in this burst
                        await Promise.all(msgIds.map(id => markMessageAsDone(id).catch(() => { })));

                        console.log(`[Turbo Engine] ✅ Completed burst of ${pendingMsgs.length} messages.`);
                    } catch (procErr) {
                        console.error(`[Turbo Engine] ❌ Error in burst processing:`, procErr.message);
                        break; // Stop loop on error
                    }

                    loopSafety++;
                    // Check if more arrived while we were talking to Gemini
                    const more = await getWaitlist(candidateId);
                    if (!more || more.length === 0) break;
                }
            } catch (jobErr) {
                console.error(`[Turbo Engine] ❌ Critical job error for ${candidateId}:`, jobErr.message);
            } finally {
                // Always unlock the candidate after processing
                await unlockCandidate(candidateId);
                console.log(`[Turbo Engine] 🔓 Candidate ${candidateId} unlocked.`);
            }

        } catch (err) {
            console.error('[Turbo Engine] ⚠️ Loop error:', err.message);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Cool down
        }
    }
}

// Global error handling
process.on('uncaughtException', (err) => console.error('💥 Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('💥 Unhandled Rejection:', reason));

startConsumer();
