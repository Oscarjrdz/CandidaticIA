import { getOpenAIResponse } from '../utils/openai.js';
import { getRedisClient } from '../utils/storage.js';
import {
    requireSuperAdmin,
    extractManualExchangesByTag,
    addTrainingTokens
} from '../utils/brenda-training.js';

const DEFAULT_TAG = 'KATCON ANUNCIO';
const DEFAULT_MAX_CANDIDATES = 100;
const MAX_EXCHANGES_TO_GPT = 150;
const MAX_OUTPUT_TOKENS = 2000;

const SYNTHESIS_PROMPT = `
Eres un analista de estilo conversacional. Te voy a dar una lista de mensajes reales que un reclutador humano (Oscar, alias "Brenda") le mando por WhatsApp a candidatos de una vacante, junto con lo que el candidato dijo justo antes.

Tu tarea: escribir una guia de estilo en markdown ("personalidad entrenada") que capture su tono real, tacticas de persuasion, manejo de objeciones, plantillas de cierre/logistica, y limites (que NO hace). Debe quedar lista para usarse como system prompt de un bot que va a hablar con candidatos imitando este estilo.

Reglas:
- Español, tono directo, sin inventar tacticas que no esten sustentadas en los ejemplos.
- Usa subtitulos claros (##) y ejemplos textuales entre comillas cuando ilustren un patron.
- No repitas los mismos 900 ejemplos, sintetiza el patron.
- Maximo ~1800 tokens de salida.
`;

function sanitizeText(value, maxChars) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Metodo no permitido' });
    }

    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ success: false, error: 'Redis unavailable' });

    const tag = sanitizeText(req.body?.tag, 80) || DEFAULT_TAG;
    const maxCandidates = Math.max(1, Math.min(Number(req.body?.maxCandidates) || DEFAULT_MAX_CANDIDATES, 300));

    try {
        const extraction = await extractManualExchangesByTag(redis, tag, maxCandidates);

        if (!extraction.uniqueExchanges.length) {
            return res.status(200).json({
                success: true,
                proposedStyleGuide: null,
                stats: extraction,
                message: `No se encontraron mensajes manuales para el tag "${tag}". Revisa que el nombre del tag sea exacto.`
            });
        }

        const capped = extraction.uniqueExchanges
            .sort((a, b) => b.oscarRespondio.length - a.oscarRespondio.length)
            .slice(0, MAX_EXCHANGES_TO_GPT);

        const exchangesText = capped
            .map(e => `Candidato dijo: "${e.candidatoDijo}"\nOscar respondio: "${e.oscarRespondio}"`)
            .join('\n\n');

        const result = await getOpenAIResponse(
            [{ role: 'user', content: exchangesText }],
            SYNTHESIS_PROMPT,
            'gpt-4o-mini',
            null,
            null,
            null,
            MAX_OUTPUT_TOKENS
        );

        await addTrainingTokens(redis, result.usage?.total_tokens);

        return res.status(200).json({
            success: true,
            proposedStyleGuide: result.content,
            stats: {
                ...extraction,
                uniqueExchangesUsed: capped.length
            },
            model: result.model,
            usage: result.usage || null
        });
    } catch (error) {
        console.error('❌ [BrendaTraining] resync error:', error);
        return res.status(500).json({ success: false, error: 'No se pudo generar la propuesta de personalidad', detail: error.message });
    }
}
