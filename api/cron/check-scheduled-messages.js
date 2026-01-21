import { getRedisClient, getCandidates, saveMessage, updateCandidate } from '../../api/utils/storage.js';

/**
 * CRON JOB: Check Scheduled Messages
 * This endpoint should be called every 1 minute
 */
export default async function handler(req, res) {
    // Basic security for CRON
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
        if (process.env.CRON_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    try {
        const redis = getRedisClient();

        // 1. Get Scheduled Rules
        const rulesJson = await redis.get('scheduled_message_rules');
        if (!rulesJson) {
            console.log('⏰ No rules configured in Redis.');
            return res.status(200).json({ message: 'No rules configured' });
        }
        const rules = JSON.parse(rulesJson).filter(r => r.enabled);

        if (rules.length === 0) {
            console.log('⏰ No enabled rules found.');
            return res.status(200).json({ message: 'No enabled rules' });
        }

        // 2. Get Candidates (All)
        const candidates = await getCandidates(1000, 0);
        if (!candidates || candidates.length === 0) {
            console.log('⏰ No candidates found in database.');
            return res.status(200).json({ message: 'No candidates found' });
        }

        const now = Date.now();
        const timestamp = new Date().toISOString();
        let sentCount = 0;
        const sentDetails = [];

        console.log(`⏰ Checking ${candidates.length} candidates against ${rules.length} rules...`);

        // 3. Check Candidates against Rules
        for (const candidate of candidates) {
            const phone = candidate.whatsapp || candidate.telefono || candidate.phone;
            if (!phone) continue;

            const lastUserMsg = candidate.lastUserMessageAt ? new Date(candidate.lastUserMessageAt).getTime() : 0;
            const lastBotMsg = candidate.lastBotMessageAt ? new Date(candidate.lastBotMessageAt).getTime() : 0;

            const userRefTime = lastUserMsg || new Date(candidate.createdAt || candidate.primerContacto || 0).getTime();

            const userInactivityMins = (now - userRefTime) / (1000 * 60);
            const botInactivityMins = lastBotMsg > 0 ? (now - lastBotMsg) / (1000 * 60) : 999999;

            for (const rule of rules) {
                if (userInactivityMins < rule.userInactivityMinutes) continue;

                if (rule.botInactivityMinutes > 0 && botInactivityMins < rule.botInactivityMinutes) continue;

                const trackKey = `sched_sent:${phone}:${rule.id}`;
                const lastSentTs = await redis.get(trackKey);

                if (rule.oneTime && lastSentTs) continue;

                if (!rule.oneTime && lastSentTs) {
                    const minsSinceLastSent = (now - parseInt(lastSentTs)) / (1000 * 60);
                    const definedCooldown = rule.botInactivityMinutes || rule.userInactivityMinutes;
                    const safeCooldown = Math.max(1, definedCooldown);

                    if (minsSinceLastSent < safeCooldown) continue;
                }

                // SEND MESSAGE
                console.log(`🚀 Sending scheduled message '${rule.name}' to ${candidate.nombre} (${phone})`);

                const success = await sendBuilderBotMessage(phone, rule.message);

                if (success) {
                    sentCount++;
                    sentDetails.push({ candidate: candidate.nombre, phone, rule: rule.name });

                    // Mark as sent in Redis (recurrence control)
                    await redis.set(trackKey, now.toString());

                    // ✅ PROACTIVE SAVE: Save to chat history immediately
                    // This ensures it appears in exported history even if webhook is slow or missing
                    await saveMessage(candidate.id, {
                        from: 'bot',
                        content: rule.message,
                        type: 'text',
                        timestamp: timestamp,
                        scheduled: true
                    });

                    // Update candidate timestamps to reset inactivity timer
                    await updateCandidate(candidate.id, {
                        lastBotMessageAt: timestamp,
                        ultimoMensaje: timestamp
                    });

                    break;
                }
            }
        }

        return res.status(200).json({
            success: true,
            sent: sentCount,
            details: sentDetails,
            checked: candidates.length,
            timestamp: timestamp
        });

    } catch (error) {
        console.error('Cron Error:', error);
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

        const cleanPhone = phone.replace(/\D/g, '');

        const response = await fetch(`${BUILDERBOT_API_URL}/${botId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': apiKey,
            },
            body: JSON.stringify({
                messages: { type: "text", content: message },
                number: cleanPhone,
                checkIfExists: false
            }),
        });

        return response.ok;
    } catch (error) {
        console.error('❌ Send Message Error:', error);
        return false;
    }
}
