import { getOpenAIResponse } from '../utils/openai.js';
import { getRedisClient } from '../utils/storage.js';
import {
    requireSuperAdmin,
    getPersona,
    getTrainingExamples,
    addTrainingTokens
} from '../utils/brenda-training.js';

const MAX_INPUT_CHARS = 900;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 2400;
const MAX_REPLY_TOKENS = 360;
const MAX_FEWSHOT_EXAMPLES = 15;

const BASE_CONTEXT = `
Eres Brenda, reclutadora de Candidatic. Estas en una simulacion de practica dentro del panel de SuperAdmin: la persona que te escribe es Oscar, el reclutador humano, actuando COMO SI fuera un candidato — no es un candidato real, no mandes esto a ningun canal real.

Contexto de la conversacion que estas simulando: el candidato YA completo su perfil con Brenda Extractora (ya se sabe su nombre, municipio, categoria, escolaridad, experiencia). Tu tarea en esta fase es tener una platica amistosa y persuasiva para invitarlo a una cita de entrevista, evaluando su intencion real, personalizando con los datos que Oscar mencione en la conversacion (municipio, rutas, etc).

Usa el tono, tacticas y frases reales descritas en la guia de estilo de abajo. Si Oscar (como candidato) menciona una ubicacion o dato que no está en la guia, resuelvelo con el mismo criterio que usarias en la vida real (rutas de camion, puntos de referencia), sin inventar datos que contradigan la guia.
`;

function sanitizeText(value, maxChars) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];
    let charBudget = MAX_HISTORY_CHARS;
    return history
        .slice(-MAX_HISTORY_MESSAGES)
        .map((item) => {
            const role = item?.role === 'assistant' ? 'assistant' : 'user';
            const remaining = Math.max(0, Math.min(500, charBudget));
            const content = sanitizeText(item?.content, remaining);
            charBudget -= content.length;
            return content ? { role, content } : null;
        })
        .filter(Boolean);
}

function formatFewShot(examples) {
    if (!examples.length) return '';
    const block = examples
        .slice(0, MAX_FEWSHOT_EXAMPLES)
        .map(e => `Candidato: "${e.candidateSaid}"\nBrenda: "${e.recruiterSaid}"`)
        .join('\n\n');
    return `\n\n[EJEMPLOS REALES CURADOS POR OSCAR — imita este tono y estas decisiones]\n${block}`;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Metodo no permitido' });
    }

    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ success: false, error: 'Redis unavailable' });

    const message = sanitizeText(req.body?.message, MAX_INPUT_CHARS);
    if (!message) {
        return res.status(400).json({ success: false, error: 'Mensaje requerido' });
    }

    try {
        const [persona, examples] = await Promise.all([
            getPersona(redis),
            getTrainingExamples(redis)
        ]);

        if (!persona.styleGuide) {
            return res.status(200).json({
                success: true,
                reply: 'Todavia no hay una guia de personalidad guardada. Escribe algo en el panel de Personalidad (3ra columna) o genera una propuesta con "Actualizar con chats leidos" antes de probar el chat.',
                model: 'skill:no-persona',
                usage: null
            });
        }

        const systemPrompt = `${BASE_CONTEXT}\n\n[GUIA DE ESTILO]\n${persona.styleGuide}${formatFewShot(examples)}`;
        const history = normalizeHistory(req.body?.history);
        const messages = [...history, { role: 'user', content: message }];

        const result = await getOpenAIResponse(
            messages,
            systemPrompt,
            'gpt-4o-mini',
            null,
            null,
            null,
            MAX_REPLY_TOKENS
        );

        await addTrainingTokens(redis, result.usage?.total_tokens);

        return res.status(200).json({
            success: true,
            reply: sanitizeText(result.content, 2200),
            model: result.model,
            usage: result.usage || null,
            limits: {
                maxInputChars: MAX_INPUT_CHARS,
                maxHistoryMessages: MAX_HISTORY_MESSAGES,
                maxReplyTokens: MAX_REPLY_TOKENS
            }
        });
    } catch (error) {
        console.error('❌ [BrendaTraining] chat-candidato error:', error);
        return res.status(500).json({ success: false, error: 'No pude responder como Brenda en este momento.', detail: error.message });
    }
}
