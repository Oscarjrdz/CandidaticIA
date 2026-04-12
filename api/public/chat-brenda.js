import { getOpenAIResponse } from '../utils/openai.js';
import { getRedisClient } from '../utils/storage.js';
import {
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_CEREBRO1_RULES,
    DEFAULT_EXTRACTION_RULES,
} from '../ai/agent.js';

/**
 * 🌟 PUBLIC ENDPOINT — Chat with the REAL Brenda (Landing Page)
 * Uses the exact same system prompt, personality, and extraction rules
 * as the WhatsApp bot. Each browser session = a new "candidate" experience.
 * Stateless per request — history is maintained client-side.
 * No auth required.
 */
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        const { message, history = [] } = body || {};

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ error: 'Falta el mensaje' });
        }

        // Cap history to 20 messages to prevent abuse
        const safeHistory = Array.isArray(history) ? history.slice(-20) : [];

        // ─── Pull LIVE config from Redis (same as WhatsApp bot) ───
        let customPrompt = null;
        let categories = '';
        let extractionRules = DEFAULT_EXTRACTION_RULES;
        let cerebro1Rules = DEFAULT_CEREBRO1_RULES;
        let modelName = 'gpt-4o-mini';

        try {
            const redis = getRedisClient();
            if (redis) {
                const [
                    livePrompt,
                    liveCategories,
                    liveExtraction,
                    liveCerebro1,
                    liveModel,
                ] = await redis.mget([
                    'bot_ia_prompt',
                    'candidatic_categories',
                    'bot_extraction_rules',
                    'bot_cerebro1_rules',
                    'bot_ia_model',
                ]);
                if (livePrompt) customPrompt = livePrompt;
                if (liveCategories) categories = liveCategories;
                if (liveExtraction) extractionRules = liveExtraction;
                if (liveCerebro1) cerebro1Rules = liveCerebro1;
                if (liveModel) modelName = liveModel;
            }
        } catch (e) {
            console.warn('[Brenda Web] Redis unavailable, using defaults:', e.message);
        }

        // ─── Build the EXACT same system prompt the WhatsApp bot uses ───
        const identityLayer = customPrompt || DEFAULT_SYSTEM_PROMPT;

        // Determine what data we've "extracted" from the conversation so far
        // (simulated — we scan the history for any data the visitor shared)
        const extractedState = buildExtractedState(safeHistory);
        const missingFields = getMissingFields(extractedState);

        // Inject categories into the rules (same as real bot)
        const cerebro1 = cerebro1Rules
            .replace(/\{\{categorias\}\}/g, categories || 'Operador, Soldador, Almacenista, Montacarguista, Producción, Limpieza, Vigilancia, Cocina, Otro')
            .replace(/\{\{faltantes\}\}/g, missingFields.join(', ') || 'todos los datos están completos');

        const extraction = extractionRules
            .replace(/\{\{categorias\}\}/g, categories || 'Operador, Soldador, Almacenista, Montacarguista, Producción, Limpieza, Vigilancia, Cocina, Otro');

        const fullSystemPrompt = `${identityLayer}

${cerebro1}

${extraction}

[ESTADO DEL CANDIDATO]:
${formatState(extractedState)}

[CANAL]: Chat web (la persona está chateando desde la página web de Candidatic, NO por WhatsApp).
[REGLAS EXTRA PARA CHAT WEB]:
- Actúa exactamente igual que en WhatsApp — misma personalidad, mismo flujo de captura.
- NO menciones WhatsApp, ni "te mando mensaje", ni "te escribo".
- Si te preguntan algo de la plataforma o quieren registrarse de verdad, diles que pueden escanear el QR en la página o dar click en "Hablar con Brenda" para continuar por WhatsApp.
- PROHIBIDO usar asteriscos (*) para formato.
- MENSAJES CORTOS: máximo 3-4 líneas, estilo chat.`;

        // Build messages array
        const formattedHistory = safeHistory.map(m => ({
            role: m.from === 'brenda' ? 'assistant' : 'user',
            content: m.text
        }));
        formattedHistory.push({ role: 'user', content: message.trim() });

        const result = await getOpenAIResponse(
            formattedHistory,
            fullSystemPrompt,
            modelName,
            null,
            null,
            null,
            300
        );

        if (!result || !result.content) {
            throw new Error('No response from AI');
        }

        // Clean asterisks (same post-processing as real bot)
        let reply = result.content.trim().replace(/\*/g, '');

        return res.status(200).json({
            success: true,
            reply
        });

    } catch (error) {
        console.error('❌ [Brenda Web Chat] Error:', error.message);
        return res.status(500).json({
            success: false,
            reply: '¡Ups! Parece que tengo un problemita técnico 😅 ¿Puedes intentar de nuevo?'
        });
    }
}

/**
 * Scan conversation history to build a simulated extracted state
 * (mimics what the real bot does with Redis/DB, but from chat history alone)
 */
function buildExtractedState(history) {
    const state = {
        nombreReal: null,
        genero: null,
        fechaNacimiento: null,
        edad: null,
        municipio: null,
        categoria: null,
        escolaridad: null,
    };

    // We don't extract from client-sent history for security
    // Let GPT handle extraction naturally through conversation
    return state;
}

function getMissingFields(state) {
    const labels = {
        nombreReal: 'nombre completo',
        municipio: 'municipio/ciudad donde vive',
        escolaridad: 'nivel de escolaridad',
        categoria: 'categoría de trabajo que busca',
        fechaNacimiento: 'fecha de nacimiento',
    };
    return Object.entries(labels)
        .filter(([key]) => !state[key])
        .map(([, label]) => label);
}

function formatState(state) {
    const lines = [];
    lines.push(`nombreReal: ${state.nombreReal || '(pendiente)'}`);
    lines.push(`genero: ${state.genero || '(pendiente)'}`);
    lines.push(`fechaNacimiento: ${state.fechaNacimiento || '(pendiente)'}`);
    lines.push(`edad: ${state.edad || '(pendiente)'}`);
    lines.push(`municipio: ${state.municipio || '(pendiente)'}`);
    lines.push(`categoria: ${state.categoria || '(pendiente)'}`);
    lines.push(`escolaridad: ${state.escolaridad || '(pendiente)'}`);
    return lines.join('\n');
}
