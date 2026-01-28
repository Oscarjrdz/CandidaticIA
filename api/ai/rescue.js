import { getRedisClient, getMessages, updateCandidate, getCandidates } from '../utils/storage.js';
import { intelligentExtract } from '../utils/intelligent-extractor.js';

export default async function handler(req, res) {
    // 🏎️ FERRARI RESCUE: Allow GET for easy manual detonation via URL
    if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { candidateId, batch, limit = '1', offset = '0', token, auto } = (req.method === 'GET') ? req.query : req.body;
        const isAuto = auto === 'true';

        // Simple Security (Optional but recommended)
        const MASTER_TOKEN = 'titanio_rescue_2026';
        if (token !== MASTER_TOKEN) {
            return res.status(403).json({ success: false, error: 'Acceso denegado. Se requiere Token de Rescate.' });
        }

        if (batch === 'true' || isAuto) {
            const redis = getRedisClient();
            let o = parseInt(offset);
            const l = parseInt(limit);

            // 🔄 [AUTO-MODE] Retrieve persistent offset if no manual offset is provided
            if (isAuto && redis) {
                const savedOffset = await redis.get('rescue:current_offset');
                if (savedOffset) o = parseInt(savedOffset);
            }


            // Fetch a larger window to find 10 "incomplete" candidates efficiently
            const windowSize = 50;
            const { candidates, total } = await getCandidates(windowSize, o);
            const results = [];
            let lastInWindowIndex = 0;

            for (let i = 0; i < candidates.length; i++) {
                const cand = candidates[i];
                lastInWindowIndex = i;

                // 🕵️ SKIP LOGIC: If candidate already has core data, move to next
                if (cand.nombreReal && cand.nombreReal !== 'No proporcionado' && cand.municipio) {
                    continue;
                }

                const messages = await getMessages(cand.id);
                if (messages.length < 2) continue; // Skip if basically empty chat

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

                // Stop if we reached the limit of processed candidates in this run
                if (results.length >= l) break;
            }

            // Update persistent offset for next refresh
            const nextGlobalOffset = o + lastInWindowIndex + 1;
            if (isAuto && redis) {
                await redis.set('rescue:current_offset', nextGlobalOffset);
            }

            return res.status(200).json({
                success: true,
                processed_in_this_window: lastInWindowIndex + 1,
                rescued_count: results.length,
                total_in_db: total,
                current_offset: o,
                next_offset: nextGlobalOffset,
                is_finished: nextGlobalOffset >= total,
                message: results.length === 0 ? "No se encontraron candidatos incompletos en este bloque. Refresca para seguir buscando." : "Rescate exitoso.",
                rescued: results
            });
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
