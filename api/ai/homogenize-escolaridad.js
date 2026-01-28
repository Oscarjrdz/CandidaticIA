import { getRedisClient, getMessages, updateCandidate, getCandidates } from '../utils/storage.js';
import { intelligentExtract } from '../utils/intelligent-extractor.js';
import { cleanEscolaridadWithAI } from '../utils/ai.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { token, offset, reset } = req.query;

        // Security check
        const MASTER_TOKEN = 'titanio_rescue_2026';
        if (token !== MASTER_TOKEN) {
            return res.status(403).json({ success: false, error: 'Token inválido' });
        }

        const redis = getRedisClient();

        if (reset === 'true' && redis) {
            await redis.set('homogenize:escolaridad:offset', '0');
            // Continue execution to process the first one immediately
        }

        let currentOffset = 0;
        const savedOffset = await (redis ? redis.get('homogenize:escolaridad:offset') : null);
        if (savedOffset) currentOffset = parseInt(savedOffset);
        if (offset) currentOffset = parseInt(offset);

        // Fetch candidates (we take 1 to process)
        const { candidates, total } = await getCandidates(1, currentOffset);

        if (!candidates || candidates.length === 0) {
            return res.status(200).json({
                success: true,
                message: "¡Proceso terminado! Todos los candidatos han sido revisados.",
                total_processed: currentOffset,
                is_finished: true
            });
        }

        const cand = candidates[0];
        const messages = await getMessages(cand.id);

        let updateResult = {
            id: cand.id,
            nombre: cand.nombreReal || cand.nombre,
            phone: cand.whatsapp
        };

        if (messages.length > 0) {
            const historyText = messages
                .filter(m => m.from === 'user' || m.from === 'bot' || m.from === 'me')
                .slice(-30)
                .map(m => `${m.from === 'user' ? 'Candidato' : 'Reclutador'}: ${m.content}`)
                .join('\n');

            // 1. Force re-extraction
            const extracted = await intelligentExtract(cand.id, historyText);

            if (extracted && extracted.escolaridad) {
                // 2. Homogenize with the ultra-strict rules
                const finalValue = await cleanEscolaridadWithAI(extracted.escolaridad);
                await updateCandidate(cand.id, { escolaridad: finalValue });

                updateResult.status = "✅ ACTUALIZADO";
                updateResult.antes = extracted.escolaridad;
                updateResult.ahora = finalValue;
            } else {
                updateResult.status = "⏭️ SIN DATOS (No se encontró escolaridad en el chat)";
            }
        } else {
            updateResult.status = "❌ SIN CHAT (No hay mensajes para analizar)";
        }

        // Advance pointer
        const nextOffset = currentOffset + 1;
        if (redis) await redis.set('homogenize:escolaridad:offset', nextOffset.toString());

        return res.status(200).json({
            success: true,
            progreso: `${nextOffset} / ${total}`,
            instruccion: "🔄 REFRESCA ESTA PÁGINA para procesar el siguiente candidato",
            detalle: updateResult,
            next_link: `/api/ai/homogenize-escolaridad?token=${MASTER_TOKEN}`
        });

    } catch (error) {
        console.error('❌ [Homogenize] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
