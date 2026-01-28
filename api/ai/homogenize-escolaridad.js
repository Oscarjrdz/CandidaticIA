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

        // --- 🏎️ [FAST-FORWARD ENGINE] ---
        // Allowed clean terms
        const CLEAN_TERMS = ['Primaria', 'Secundaria', 'Prepa', 'Licenciatura', 'Técnica', 'Posgrado', 'N/A'];

        let targetCandidate = null;
        let finalGlobalTotal = 0;
        let skippedCount = 0;

        // We try to find 1 candidate that needs work in a window of 20
        const searchWindow = 20;
        const { candidates, total } = await getCandidates(searchWindow, currentOffset);
        finalGlobalTotal = total;

        for (let i = 0; i < candidates.length; i++) {
            const cand = candidates[i];
            const currentEsc = cand.escolaridad || '';

            // SKIP IF: already clean
            if (CLEAN_TERMS.includes(currentEsc)) {
                skippedCount++;
                continue;
            }

            // FOUND ONE to process
            targetCandidate = cand;
            break;
        }

        if (!targetCandidate) {
            // If we didn't find anyone in this window, we advance the offset and ask for refresh
            const nextGlobalOffset = currentOffset + candidates.length;
            if (redis && candidates.length > 0) await redis.set('homogenize:escolaridad:offset', nextGlobalOffset.toString());

            return res.status(200).json({
                success: true,
                message: candidates.length === 0 ? "¡Proceso terminado!" : `Buscando... (Saltados ${candidates.length} candidatos ya limpios)`,
                progreso: `${Math.min(currentOffset + candidates.length, total)} / ${total}`,
                instruccion: "🔄 REFRESCA para seguir buscando candidatos por limpiar",
                is_finished: candidates.length === 0
            });
        }

        // --- 🧠 [PROCESSING TARGET] ---
        const cand = targetCandidate;
        const messages = await getMessages(cand.id);

        let updateResult = {
            id: cand.id,
            nombre: cand.nombreReal || cand.nombre,
            phone: cand.whatsapp,
            valor_actual: cand.escolaridad || 'Vacio'
        };

        if (messages.length > 0) {
            const historyText = messages
                .filter(m => m.from === 'user' || m.from === 'bot' || m.from === 'me')
                .slice(-30)
                .map(m => `${m.from === 'user' ? 'Candidato' : 'Reclutador'}: ${m.content}`)
                .join('\n');

            const extracted = await intelligentExtract(cand.id, historyText);

            if (extracted && extracted.escolaridad) {
                const finalValue = await cleanEscolaridadWithAI(extracted.escolaridad);
                await updateCandidate(cand.id, { escolaridad: finalValue });

                updateResult.status = "✅ HOMOLOGADO";
                updateResult.antes = extracted.escolaridad;
                updateResult.ahora = finalValue;
            } else {
                updateResult.status = "⏭️ SIN DATOS (No se detectó estudios en chat)";
                await updateCandidate(cand.id, { escolaridad: 'N/A' });
            }
        } else {
            updateResult.status = "❌ SIN CHAT";
            await updateCandidate(cand.id, { escolaridad: 'N/A' });
        }

        // Advance pointer past the processed candidate and his predecessors in the window
        const nextOffset = currentOffset + skippedCount + 1;
        if (redis) await redis.set('homogenize:escolaridad:offset', nextOffset.toString());

        return res.status(200).json({
            success: true,
            progreso: `${nextOffset} / ${total}`,
            instruccion: "🔄 REFRESCA para procesar el siguiente",
            detalle: updateResult,
            next_link: `/api/ai/homogenize-escolaridad?token=${MASTER_TOKEN}`
        });

    } catch (error) {
        console.error('❌ [Homogenize] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
