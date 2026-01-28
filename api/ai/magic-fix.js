import { getMessages, updateCandidate, getRedisClient } from '../utils/storage.js';
import { intelligentExtract } from '../utils/intelligent-extractor.js';
import { cleanEscolaridadWithAI, cleanCategoryWithAI, cleanNameWithAI, cleanMunicipioWithAI } from '../utils/ai.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { candidateId, field } = req.body;

        if (!candidateId || !field) {
            return res.status(400).json({ success: false, error: 'candidateId and field are required' });
        }

        const messages = await getMessages(candidateId);
        if (messages.length === 0) {
            return res.status(404).json({ success: false, error: 'No se encontraron mensajes para procesar.' });
        }

        const historyText = messages
            .filter(m => m.from === 'user' || m.from === 'bot' || m.from === 'me')
            .slice(-30)
            .map(m => `${m.from === 'user' ? 'Candidato' : 'Reclutador'}: ${m.content}`)
            .join('\n');

        // 🧠 RE-EXTRACT specifically
        const extracted = await intelligentExtract(candidateId, historyText);

        if (!extracted || !extracted[field]) {
            return res.status(200).json({ success: true, message: 'No se detectó información nueva en el chat.', value: 'N/A' });
        }

        let finalValue = extracted[field];

        // 🪄 Apply MAGIC Homogenization based on field
        if (field === 'escolaridad') {
            finalValue = await cleanEscolaridadWithAI(extracted.escolaridad);
        } else if (field === 'categoria') {
            finalValue = await cleanCategoryWithAI(extracted.categoria);
        } else if (field === 'nombreReal') {
            finalValue = await cleanNameWithAI(extracted.nombreReal);
        } else if (field === 'municipio') {
            finalValue = await cleanMunicipioWithAI(extracted.municipio);
        }

        // Update database
        await updateCandidate(candidateId, { [field]: finalValue });

        return res.status(200).json({
            success: true,
            newValue: finalValue,
            message: `Campo ${field} actualizado con magia IA.`
        });

    } catch (error) {
        console.error('❌ [MagicFix] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
