
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

        // 1. Get Candidate (Multi-Format Lookup)
        const possibleKeys = [
            phone,
            phone.replace(/\D/g, ''),
            `52${phone.replace(/\D/g, '')}`,
            `521${phone.replace(/\D/g, '')}`,
            `+52 ${phone.replace(/\D/g, '').slice(-10).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')}`, // +52 811 603 8195
            `52 ${phone.replace(/\D/g, '').slice(-10)}`
        ];

        let candidateKey = null;
        for (const key of possibleKeys) {
            const found = await redis.hget('candidatic:phone_index', key);
            if (found) {
                candidateKey = found;
                break;
            }
        }

        if (!candidateKey) {
            // Last Resort: Scan the index for the 10-digit match
            const allIndex = await redis.hgetall('candidatic:phone_index');
            for (const [k, v] of Object.entries(allIndex)) {
                if (k.replace(/\D/g, '').endsWith(phone.slice(-10))) {
                    candidateKey = v;
                    break;
                }
            }
        }

        if (!candidateKey) {
            report.decision = 'CANDIDATE_NOT_FOUND_IN_INDEX';
            report.triedKeys = possibleKeys;
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
