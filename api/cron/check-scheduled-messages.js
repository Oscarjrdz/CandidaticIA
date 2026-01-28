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
            return res.status(200).json({ message: 'No rules configured' });
        }
        const rules = JSON.parse(rulesJson).filter(r => r.enabled);

        if (rules.length === 0) {
            return res.status(200).json({ message: 'No enabled rules' });
        }

        // 2. Get Candidates (All)
        // Fetch enough candidates to process at least the most recent ones
        const candidates = await getCandidates(200, 0);
        if (!candidates || candidates.length === 0) {
            return res.status(200).json({ message: 'No candidates found' });
        }

        const now = Date.now();
        const timestamp = new Date().toISOString();
        let sentCount = 0;
        const sentDetails = [];
        const logs = []; // Detailed execution logs for debugging

        // 3. Check Candidates against Rules
        for (const candidate of candidates) {
            const rawPhone = candidate.whatsapp || candidate.telefono || candidate.phone;
            if (!rawPhone) continue;

            const cleanPhone = rawPhone.replace(/\D/g, '');

            const lastUserMsg = candidate.lastUserMessageAt ? new Date(candidate.lastUserMessageAt).getTime() : 0;
            const lastBotMsg = (candidate.lastBotMessageAt || candidate.ultimoMensajeBot) ? new Date(candidate.lastBotMessageAt || candidate.ultimoMensajeBot).getTime() : 0;

            const userRefTime = lastUserMsg || new Date(candidate.createdAt || candidate.primerContacto || 0).getTime();

            const userInactivityMins = (now - userRefTime) / (1000 * 60);
            const botInactivityMins = lastBotMsg > 0 ? (now - lastBotMsg) / (1000 * 60) : 999999;

            for (const rule of rules) {
                // IMPORTANT: Use cleanPhone for the tracking key to be consistent
                const trackKey = `sched_sent:${cleanPhone}:${rule.id}`;
                const lastSentTs = await redis.get(trackKey);

                // Condition 1: Sent status (One Time)
                if (rule.oneTime && lastSentTs) {
                    logs.push(`[Skip] ${candidate.nombre} - ${rule.name}: Already sent once (OneTime)`);
                    continue;
                }

                // Condition 2: User Inactivity Period
                if (userInactivityMins < rule.userInactivityMinutes) {
                    // logs.push(`[Skip] ${candidate.nombre} - ${rule.name}: Too soon (${userInactivityMins.toFixed(1)} < ${rule.userInactivityMinutes})`);
                    continue;
                }

                // Condition 3: Bot Inactivity (Cooldown since last bot interaction)
                if (rule.botInactivityMinutes > 0 && botInactivityMins < rule.botInactivityMinutes) {
                    logs.push(`[Skip] ${candidate.nombre} - ${rule.name}: Bot cooldown (${botInactivityMins.toFixed(1)} < ${rule.botInactivityMinutes})`);
                    continue;
                }

                // Condition 4: Recurrence Cooldown (for non-OneTime rules)
                if (!rule.oneTime && lastSentTs) {
                    const minsSinceLastSent = (now - parseInt(lastSentTs)) / (1000 * 60);
                    // If no specific botInactivityMinutes is set, use userInactivityMinutes as its own interval
                    const interval = rule.botInactivityMinutes || rule.userInactivityMinutes || 5;

                    if (minsSinceLastSent < interval) {
                        logs.push(`[Skip] ${candidate.nombre} - ${rule.name}: Recurrence interval (${minsSinceLastSent.toFixed(1)} < ${interval})`);
                        continue;
                    }
                }

                // SEND MESSAGE

                const success = await sendScheduledMessage(cleanPhone, rule.message);

                if (success) {
                    sentCount++;
                    sentDetails.push({ candidate: candidate.nombre, phone: cleanPhone, rule: rule.name });
                    logs.push(`[Sent] ${candidate.nombre}: ${rule.name}`);

                    // Mark as sent in Redis using cleaned phone
                    await redis.set(trackKey, now.toString());

                    // Save to history proactively
                    await saveMessage(candidate.id, {
                        from: 'bot',
                        content: rule.message,
                        type: 'text',
                        timestamp: timestamp,
                        scheduled: true,
                        ruleId: rule.id
                    });

                    // Update timestamps
                    await updateCandidate(candidate.id, {
                        lastBotMessageAt: timestamp,
                        ultimoMensaje: timestamp
                    });

                    // Avoid sending multiple rules to the same person in the same minute
                    break;
                } else {
                    logs.push(`[Fail] ${candidate.nombre} - ${rule.name}: API error (UltraMsg)`);
                }
            }
        }

        return res.status(200).json({
            success: true,
            sent: sentCount,
            details: sentDetails,
            checked: candidates.length,
            timestamp: timestamp,
            summary: logs.length > 0 ? logs : 'No actions taken'
        });

    } catch (error) {
        console.error('Cron Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

async function sendScheduledMessage(phone, message) {
    try {
        const { sendUltraMsgMessage, getUltraMsgConfig } = await import('../../whatsapp/utils.js');
        const config = await getUltraMsgConfig();

        if (!config || !config.instanceId || !config.token) {
            console.error('❌ Scheduled Msg Error: No UltraMsg config found');
            return false;
        }

        const res = await sendUltraMsgMessage(config.instanceId, config.token, phone, message);
        return !!res;
    } catch (error) {
        console.error('❌ Scheduled Msg Failed:', error.message);
        return false;
    }
}
