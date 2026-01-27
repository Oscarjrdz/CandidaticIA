import { getRedisClient, getMessages, updateCandidate, getCandidates } from '../utils/storage.js';
import { intelligentExtract } from '../utils/intelligent-extractor.js';

export default async function handler(req, res) {
    // 🏎️ FERRARI RESCUE: Allow GET for easy manual detonation via URL
    if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { candidateId, batch, token } = (req.method === 'GET') ? req.query : req.body;

        // Simple Security (Optional but recommended)
        const MASTER_TOKEN = 'titanio_rescue_2026';
        if (token !== MASTER_TOKEN) {
            return res.status(403).json({ success: false, error: 'Acceso denegado. Se requiere Token de Rescate.' });
        }

        if (batch) {
            console.log('🚀 [Rescue] Starting Batch Extraction...');
            const { candidates } = await getCandidates(100); // Process last 100 for safety
            const results = [];

            for (const cand of candidates) {
                const messages = await getMessages(cand.id);
                if (messages.length === 0) continue;

                const historyText = messages
                    .filter(m => m.from === 'user' || m.from === 'bot' || m.from === 'me')
                    .slice(-20)
                    .map(m => {
                        const sender = (m.from === 'user') ? 'Candidato' : 'Reclutador';
                        let content = m.content || '';
                        if (m.type === 'audio' || m.type === 'ptt') content = '((Mensaje de Audio))';
                        return `${sender}: ${content}`;
                    })
                    .join('\n');

                const extracted = await intelligentExtract(cand.id, historyText);
                if (extracted) {
                    results.push({ id: cand.id, phone: cand.whatsapp, data: extracted });
                }
            }

            return res.status(200).json({ success: true, count: results.length, samples: results.slice(0, 5) });
        }

        if (!candidateId) return res.status(400).json({ success: false, error: 'Candidate ID is required' });

        const messages = await getMessages(candidateId);
        if (messages.length === 0) return res.status(404).json({ success: false, error: 'No messages found for this candidate' });

        const historyText = messages
            .filter(m => m.from === 'user' || m.from === 'bot' || m.from === 'me')
            .slice(-20)
            .map(m => {
                const sender = (m.from === 'user') ? 'Candidato' : 'Reclutador';
                let content = m.content || '';
                if (m.type === 'audio' || m.type === 'ptt') content = '((Mensaje de Audio))';
                return `${sender}: ${content}`;
            })
            .join('\n');

        const extracted = await intelligentExtract(candidateId, historyText);

        return res.status(200).json({ success: true, extracted });

    } catch (error) {
        console.error('❌ [Rescue] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
