import { getRedisClient, saveBulk, getCandidateById, saveMessage, updateCandidate } from '../../api/utils/storage.js';

/**
 * CRON JOB: Process Bulk Campaigns
 * Runs every minute to send pending/scheduled messages in batches.
 */
export default async function handler(req, res) {
    // Basic security: Allow Bearer (Cron) or BuilderBot API Key (Manual/Admin)
    const authHeader = req.headers.authorization;
    const providedApiKey = req.headers['x-api-builderbot'];

    // Recuperar credenciales guardadas para comparar si es un disparo manual
    const redis = getRedisClient();
    const credsJson = await redis.get('builderbot_credentials');
    const storedApiKey = credsJson ? JSON.parse(credsJson).apiKey : process.env.BOT_TOKEN;

    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
    const isManual = providedApiKey && providedApiKey === storedApiKey;

    if (!isCron && !isManual && process.env.NODE_ENV === 'production' && process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
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

            // Si el delay es grande (>=10s), enviamos SOLO UNO por cada corrida de cron (cada minuto)
            // Esto garantiza que el delay se respeta de forma segura en serverless (cron = 1min).
            const candidatesToProcess = bulk.delaySeconds >= 10
                ? [bulk.recipients[bulk.sentCount]]
                : bulk.recipients.slice(bulk.sentCount, bulk.sentCount + 3);

            bulk.status = 'sending';

            for (const candidateId of candidatesToProcess) {
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

                // --- Substitución de Variables ---
                const variants = bulk.messages;
                let messageBody = variants[Math.floor(Math.random() * variants.length)];

                // Reemplazo dinámico: {{nombre}}, {{municipio}}, etc.
                Object.keys(candidate).forEach(key => {
                    const value = candidate[key] || '';
                    const regex = new RegExp(`{{${key}}}`, 'gi');
                    messageBody = messageBody.replace(regex, value);
                });

                // Enviar mensaje
                const success = await sendBuilderBotMessage(phone, messageBody);

                if (success) {
                    totalSentInRun++;
                    bulk.sentCount++;
                    bulk.lastProcessedAt = new Date().toISOString();

                    await saveMessage(candidate.id, {
                        from: 'bot',
                        content: messageBody,
                        type: 'text',
                        timestamp: new Date().toISOString(),
                        bulkId: bulk.id
                    });

                    await updateCandidate(candidate.id, {
                        ultimoMensaje: new Date().toISOString()
                    });

                    // Si enviamos una ráfaga corta (delay < 10s), esperamos 2s entre ellos
                    if (candidatesToProcess.length > 1) {
                        await new Promise(r => setTimeout(r, 2000));
                    }
                } else {
                    logs.push(`Fallo al enviar a ${candidate.nombre}`);
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
