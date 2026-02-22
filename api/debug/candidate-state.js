import { getRedisClient, getCandidateIdByPhone, getCandidateById, getProjectById } from '../utils/storage.js';

export default async function handler(req, res) {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });

    try {
        const candidateId = await getCandidateIdByPhone(phone);
        if (!candidateId) return res.status(404).json({ error: 'Candidate not found for phone ' + phone });

        const candidate = await getCandidateById(candidateId);
        if (!candidate) return res.status(404).json({ error: 'Candidate data not found' });

        const projectId = candidate.projectId;
        const stepId = candidate.stepId;
        const currentVacancyIndex = candidate.currentVacancyIndex ?? candidate.projectMetadata?.currentVacancyIndex ?? 0;

        let activeVacancyId = null;
        let activeVacancyName = null;
        let vacancyIds = [];
        let project = null;

        if (projectId) {
            project = await getProjectById(projectId);
            vacancyIds = project?.vacancyIds || (project?.vacancyId ? [project.vacancyId] : []);
            const safeIndex = Math.min(currentVacancyIndex, vacancyIds.length - 1);
            activeVacancyId = vacancyIds[safeIndex] || null;

            if (activeVacancyId) {
                const vacRaw = await redis.get(`vacancy:${activeVacancyId}`);
                if (vacRaw) {
                    const vac = JSON.parse(vacRaw);
                    activeVacancyName = vac.name;
                }
            }
        }

        // FAQ data for active vacancy
        let faqData = [];
        if (activeVacancyId) {
            const faqRaw = await redis.get(`vacancy_faq:${activeVacancyId}`);
            if (faqRaw) faqData = JSON.parse(faqRaw);
        }

        // Last 3 agent traces to inspect GPT output
        const traceKeys = await redis.lrange(`debug:agent:logs:${candidateId}`, 0, 2);
        const traces = traceKeys.map(t => {
            try {
                const p = JSON.parse(t);
                return {
                    msg: p.receivedMessage?.substring(0, 60),
                    unanswered_question: p.aiResult?.unanswered_question,
                    thought_process: p.aiResult?.thought_process?.substring(0, 100),
                    response_text: p.aiResult?.response_text?.substring(0, 80)
                };
            } catch { return t; }
        });

        return res.status(200).json({
            success: true,
            candidateId,
            phone,
            nombre: candidate.nombreReal || candidate.nombre,
            projectId,
            stepId,
            currentVacancyIndex,
            vacancyIds,
            activeVacancyId,
            activeVacancyName,
            faqCount: faqData.length,
            faqTopics: faqData.map(f => ({ topic: f.topic, freq: f.frequency, hasAnswer: !!f.officialAnswer }))
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
