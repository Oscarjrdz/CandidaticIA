
import { getRedisClient, auditProfile, getCandidateByPhone } from '../utils/storage.js';

export default async function handler(req, res) {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'Missing phone parameter (e.g. ?phone=8116038195)' });

    const report = {
        step: 'INIT',
        phoneInput: phone,
        cleanPhone: phone.replace(/\D/g, ''),
        isBetaTester: false,
        aiConfig: {},
        audit: {},
        decision: 'PENDING'
    };

    try {
        const redis = getRedisClient();

        // 1. Get Candidate
        const candidateKey = await redis.hget('candidatic:phone_index', phone);
        if (!candidateKey) {
            report.decision = 'CANDIDATE_NOT_FOUND_IN_INDEX';
            return res.json(report);
        }

        const candidateData = JSON.parse(await redis.get(`candidate:${candidateKey}`) || '{}');
        report.candidateData = {
            id: candidateKey,
            whatsapp: candidateData.whatsapp,
            nombreReal: candidateData.nombreReal
        };

        // 2. Beta Check
        const cleanPhoneStored = candidateData.whatsapp ? candidateData.whatsapp.replace(/\D/g, '') : '';
        report.cleanPhoneStored = cleanPhoneStored;
        report.isBetaTester = cleanPhoneStored.endsWith('8116038195');

        // 3. AI Config
        const configRaw = await redis.get('ai_config');
        report.aiConfigRaw = configRaw;
        const aiConfig = configRaw ? JSON.parse(configRaw) : {};
        report.aiConfig = {
            gptHostEnabled: aiConfig.gptHostEnabled,
            hasKey: !!aiConfig.openaiApiKey,
            model: aiConfig.openaiModel
        };

        // 4. Audit
        const audit = auditProfile(candidateData);
        report.audit = {
            status: audit.paso1Status,
            missing: audit.camposFaltantes
        };

        // 5. Final Decision Logic (Mirroring agent.js)
        if ((audit.paso1Status === 'COMPLETO' || report.isBetaTester) && report.isBetaTester && aiConfig.gptHostEnabled && aiConfig.openaiApiKey) {
            report.decision = '✅ GPT HOST SHOULD TRIGGER';
        } else {
            report.decision = '❌ GEMINI FALLBACK';
            report.reason = [];
            if (!report.isBetaTester) report.reason.push('Not a Beta Tester');
            if (!aiConfig.gptHostEnabled) report.reason.push('Host Disabled');
            if (!aiConfig.openaiApiKey) report.reason.push('Missing API Key');
        }

        return res.json(report);

    } catch (e) {
        return res.status(500).json({ error: e.message, stack: e.stack });
    }
}
