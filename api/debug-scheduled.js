import { getRedisClient, getCandidates } from './utils/storage.js';

/**
 * DEBUG API: Check scheduled messages status
 * GET /api/debug-scheduled
 */
export default async function handler(req, res) {
    try {
        const redis = getRedisClient();
        const rulesJson = await redis.get('scheduled_message_rules');
        const rules = rulesJson ? JSON.parse(rulesJson) : [];

        const candidates = await getCandidates(100, 0);

        const status = [];

        for (const candidate of candidates) {
            const phone = (candidate.whatsapp || candidate.telefono || '').replace(/\D/g, '');
            if (!phone) continue;

            const candidateRules = [];
            for (const rule of rules) {
                const trackKey = `sched_sent:${phone}:${rule.id}`;
                const sentAt = await redis.get(trackKey);

                candidateRules.push({
                    ruleName: rule.name,
                    ruleId: rule.id,
                    oneTime: rule.oneTime,
                    sentAt: sentAt ? new Date(parseInt(sentAt)).toISOString() : null,
                    trackKey
                });
            }

            status.push({
                nombre: candidate.nombre,
                phone: candidate.whatsapp,
                cleanPhone: phone,
                lastUserMsg: candidate.lastUserMessageAt,
                lastBotMsg: candidate.lastBotMessageAt,
                rules: candidateRules
            });
        }

        return res.status(200).json({
            timestamp: new Date().toISOString(),
            rulesCount: rules.length,
            candidatesChecked: status.length,
            status
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
