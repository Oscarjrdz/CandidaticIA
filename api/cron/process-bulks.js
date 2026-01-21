import { getRedisClient, saveBulk, getCandidateById, saveMessage, updateCandidate } from '../../api/utils/storage.js';

/**
 * CRON JOB: Process Bulk Campaigns
 * Runs every minute to send pending/scheduled messages in batches.
 */
export default async function handler(req, res) {
    // Basic security
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
        if (process.env.CRON_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    try {
        const redis = getRedisClient();

        // 1. Get all campaing keys
        const campaignIds = await redis.zrevrange('bulks:list', 0, -1);
        if (!campaignIds || campaignIds.length === 0) {
            return res.status(200).json({ message: 'No campaigns found' });
        }

        const now = Date.now();
        const logs = [];
        let totalSentInRun = 0;

        // 2. Process each campaign
        for (const id of campaignIds) {
            const bulkJson = await redis.get(`bulk:${id}`);
            if (!bulkJson) continue;

            const bulk = JSON.parse(bulkJson);

            // Only process pending or sending
            if (bulk.status !== 'pending' && bulk.status !== 'sending') {
                logs.push(`Campaign '${bulk.name}' skipped: status is ${bulk.status}`);
                continue;
            }

            // Check schedule (with 5s buffer to avoid race conditions)
            const scheduledTime = new Date(bulk.scheduledAt).getTime();
            if (scheduledTime > now + 5000) {
                logs.push(`Campaign '${bulk.name}' is scheduled for later (${new Date(bulk.scheduledAt).toLocaleString()})`);
                continue;
            }

            // Check progress
            if (bulk.sentCount >= bulk.recipients.length) {
                bulk.status = 'completed';
                await saveBulk(bulk);
                logs.push(`Campaign '${bulk.name}' marked as completed`);
                continue;
            }

            // Check delay (cooldown between messages in this campaign)
            const lastProcessed = bulk.lastProcessedAt ? new Date(bulk.lastProcessedAt).getTime() : 0;
            const elapsedSeconds = (now - lastProcessed) / 1000;

            if (elapsedSeconds < bulk.delaySeconds) {
                logs.push(`Campaign '${bulk.name}' is on cooldown (${elapsedSeconds.toFixed(0)}s < ${bulk.delaySeconds}s)`);
                continue;
            }

            // Determine how many to send in THIS run (Vercel timeout limits)
            // We'll send up to 5 messages per run per campaign to be safe and stay within seconds
            const nextIndex = bulk.sentCount;
            const candidatesToSend = bulk.recipients.slice(nextIndex, nextIndex + 5);

            bulk.status = 'sending';

            for (const candidateId of candidatesToSend) {
                const candidate = await getCandidateById(candidateId);
                if (!candidate) {
                    bulk.sentCount++;
                    continue;
                }

                const phone = (candidate.whatsapp || '').replace(/\D/g, '');
                if (!phone) {
                    bulk.sentCount++;
                    continue;
                }

                // Pick a RANDOM message variant
                const messageVariants = bulk.messages;
                const message = messageVariants[Math.floor(Math.random() * messageVariants.length)];

                // SEND via BuilderBot
                const success = await sendBuilderBotMessage(phone, message);

                if (success) {
                    totalSentInRun++;
                    bulk.sentCount++;
                    bulk.lastProcessedAt = new Date().toISOString();

                    // Proactive save to history
                    await saveMessage(candidate.id, {
                        from: 'bot',
                        content: message,
                        type: 'text',
                        timestamp: new Date().toISOString(),
                        bulkId: bulk.id
                    });

                    // Update candidate timestamps
                    await updateCandidate(candidate.id, {
                        lastBotMessageAt: new Date().toISOString(),
                        ultimoMensaje: new Date().toISOString()
                    });

                    // Break if we hit a limit or simply process sequentially with the delay
                    // Since Vercel hits timeouts, sending a few then stopping is best.
                } else {
                    logs.push(`Failed to send to ${candidate.nombre}`);
                }
            }

            // Save progress
            if (bulk.sentCount >= bulk.recipients.length) {
                bulk.status = 'completed';
            }
            await saveBulk(bulk);
        }

        return res.status(200).json({
            success: true,
            totalSentInRun,
            summary: logs
        });

    } catch (error) {
        console.error('Bulk Process Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

async function sendBuilderBotMessage(phone, message) {
    try {
        const BUILDERBOT_API_URL = 'https://app.builderbot.cloud/api/v2';
        const redis = getRedisClient();
        const credsJson = await redis.get('builderbot_credentials');

        let botId = process.env.BOT_ID;
        let apiKey = process.env.BOT_TOKEN;

        if (credsJson) {
            const creds = JSON.parse(credsJson);
            if (!botId) botId = creds.botId;
            if (!apiKey) apiKey = creds.apiKey;
        }

        if (!botId || !apiKey) return false;

        const response = await fetch(`${BUILDERBOT_API_URL}/${botId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': apiKey,
            },
            body: JSON.stringify({
                messages: { type: "text", content: message },
                number: phone,
                checkIfExists: false
            }),
        });

        return response.ok;
    } catch (error) {
        return false;
    }
}
