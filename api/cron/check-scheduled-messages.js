import { getRedisClient, getCandidates } from '../../api/utils/storage.js';

/**
 * CRON JOB: Check Scheduled Messages
 * This endpoint should be called every 1 minute
 */
export default async function handler(req, res) {
    // Basic security for CRON
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
        // Allow running without auth in dev for testing if needed, or secure it always
        // For now, let's keep it open if env var is missing to avoid blocking tests
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

        // 2. Get Candidates
        const candidates = await getCandidates();
        if (!candidates || candidates.length === 0) {
            return res.status(200).json({ message: 'No candidates found' });
        }

        const now = Date.now();
        let sentCount = 0;
        const sentDetails = [];

        // 3. Check Candidates against Rules
        for (const candidate of candidates) {
            if (!candidate.telefono) continue;

            const lastUserMsg = candidate.lastUserMessageAt ? new Date(candidate.lastUserMessageAt).getTime() : 0;
            const lastBotMsg = candidate.lastBotMessageAt ? new Date(candidate.lastBotMessageAt).getTime() : 0;

            // If user never spoke, we might skip or treat as infinite inactivity. 
            // Usually follow-ups are for people who engaged. 
            // If lastUserMsg is 0, let's assume they entered system recently? No, use creation date? 
            // For safety, only follow up if they have 'lastUserMessageAt' OR 'createdAt'.
            const userRefTime = lastUserMsg || new Date(candidate.createdAt || 0).getTime();

            // Minutes elapsed
            const userInactivityMins = (now - userRefTime) / (1000 * 60);
            const botInactivityMins = lastBotMsg > 0 ? (now - lastBotMsg) / (1000 * 60) : 999999;

            for (const rule of rules) {
                // Condition 1: User Inactivity
                if (userInactivityMins < rule.userInactivityMinutes) continue;

                // Condition 2: Bot Inactivity (Cooldown)
                if (rule.botInactivityMinutes > 0 && botInactivityMins < rule.botInactivityMinutes) continue;

                // Specific Check: If Bot actually spoke MORE recently than User, 
                // and rule requires user inactivity,
                // technically user inactivity is high, but we just spoke to them.
                // Usually "User Inactivity" implies "Since the conversation stopped".
                // If Bot sent a message 5 mins ago, the conversation is "active" from our side.
                // So, effectively, botInactivityMinutes acts as a "Silence from Both Sides" check if we set it.
                // If botInactivity is 0, we might spam.
                // Safety: Enforce at least 60 mins cooldown if not specified? 
                // No, respect user config, but rely on 'sent_key' for recurrence control.

                // Condition 3: One Time / Recurrence Check
                const trackKey = `sched_sent:${candidate.phone}:${rule.id}`;
                const lastSentTs = await redis.get(trackKey);

                if (rule.oneTime && lastSentTs) {
                    // Already sent once, skip forever
                    continue;
                }

                if (!rule.oneTime && lastSentTs) {
                    // Safety: Prevent spamming if botInactivity is low or 0
                    const minsSinceLastSent = (now - parseInt(lastSentTs)) / (1000 * 60);

                    // Default cooldown fallback: 
                    // If botInactivity is defined > 0, trust the user (assumes they know what they do).
                    // If 0, use userInactivity as the period (e.g. remind every X mins).
                    // Absolute minimum safety: 5 minutes to allow webhook propagation.
                    const definedCooldown = rule.botInactivityMinutes || rule.userInactivityMinutes;
                    const safeCooldown = Math.max(5, definedCooldown); // 5 min minimum safety

                    if (minsSinceLastSent < safeCooldown) {
                        // console.log(`Skipping recurring (Cooldown): ${rule.name} - ${minsSinceLastSent.toFixed(1)} < ${safeCooldown}`);
                        continue;
                    }
                }

                // SEND MESSAGE
                console.log(`🚀 Sending scheduled message '${rule.name}' to ${candidate.nombre} (${candidate.telefono})`);

                const success = await sendBuilderBotMessage(candidate.telefono, rule.message);

                if (success) {
                    sentCount++;
                    sentDetails.push({ candidate: candidate.nombre, rule: rule.name });

                    // Mark as sent in Redis
                    await redis.set(trackKey, now.toString());

                    // Update candidate stats so loop breaks naturally via botInactivity
                    // But we can't update SQL/JSON candidate store easily inside this loop efficiently without refetching.
                    // We rely on the FACT that sending the message triggers the Webhook (message.outgoing),
                    // which UPDATES 'lastBotMessageAt'.
                    // So in the next cron run (1 min later), botInactivityMins will be 0.
                }
            }
        }

        return res.status(200).json({
            success: true,
            sent: sentCount,
            details: sentDetails,
            checked: candidates.length
        });

    } catch (error) {
        console.error('Cron Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

/**
 * Helper to send message via BuilderBot API
 */
async function sendBuilderBotMessage(phone, message) {
    try {
        // Configuration
        const port = process.env.BUILDERBOT_PORT || '3008';
        // Base URL: User provided 'https://app.builderbot.cloud' in example, but we should respect env var if exists
        // If running locally with standard provider, it might be http://localhost:3008
        // Let's try to detect or use a flexible approach.

        let url = process.env.BUILDERBOT_URL || `http://localhost:${port}`;
        const botId = process.env.BUILDERBOT_BOT_ID || process.env.BOT_ID;
        const apiKey = process.env.BUILDERBOT_API_KEY || process.env.API_KEY;

        // Ensure clean number
        const number = phone.replace(/\D/g, '');

        // Determine correct endpoint and payload based on available config
        // If we have BOT_ID, assume v2 Cloud API structure provided by user
        let endpoint = `${url}/v1/messages`; // Default local
        let payload = {};
        let headers = {
            'Content-Type': 'application/json',
        };

        if (botId && apiKey) {
            // V2 Cloud API Logic
            // Example: https://app.builderbot.cloud/api/v2/{id}/messages
            // Adjust URL if it doesn't already contain /api/v2
            if (!url.includes('/api/v2')) {
                // Remove trailing slash
                url = url.replace(/\/$/, '');
                // If url is just the domain, append path
                endpoint = `${url}/api/v2/${botId}/messages`;
            } else {
                endpoint = `${url}/${botId}/messages`;
            }

            headers['x-api-builderbot'] = apiKey;
            payload = {
                messages: {
                    content: message
                },
                number: number,
                checkIfExists: false
            };
        } else {
            // Fallback to V1 Local Provider (Standard BuilderBot Local)
            payload = {
                number: number,
                body: message
            };
        }

        console.log(`📡 Sending to BuilderBot: ${endpoint}`, { number });

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error('BuilderBot API Failed:', await response.text());
            return false;
        }

        return true;
    } catch (error) {
        console.error('Send Message Error:', error);
        return false;
    }
}
