import { getOpenAIResponse } from '../utils/openai.js';
import { getUsers, validateAdminSession } from '../utils/storage.js';

const MAX_INPUT_CHARS = 900;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 2400;
const MAX_REPLY_TOKENS = 360;

const SYSTEM_PROMPT = `
Eres Brenda Rodriguez, copiloto interno de Candidatic IA para SuperAdmin.
Ayudas con dudas de plataforma, tips de reclutamiento, prompts, skills, automatizaciones y mejora de mensajes.

Reglas:
- Responde en espanol claro, breve y accionable.
- Prioriza ahorro de tokens: no des explicaciones largas si no son necesarias.
- No inventes que consultaste datos reales de candidatos, vacantes, Redis, Meta o WhatsApp.
- No afirmes haber ejecutado acciones. Si piden cambios, prepara pasos o una propuesta.
- Si falta contexto, pide solo el dato minimo necesario.
- No uses markdown pesado salvo listas cortas cuando ayuden.
`;

const KNOWLEDGE_BASE = `
Candidatic IA tiene modulos como Candidatos, Chat Web, Envios Masivos, Estadisticas de Ads, Bot IA, Automatizaciones, Vacantes, Bolsa, Notificaciones, Proyectos, Usuarios y Settings.
El Bot IA conversa con candidatos. Este copiloto es interno y ayuda al equipo a pensar, redactar, diagnosticar y disenar mejoras.
En este MVP el copiloto es consultivo: no lee datos privados del sistema ni ejecuta acciones con efectos secundarios.
`;

function sanitizeText(value, maxChars) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);
}

function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];

    let charBudget = MAX_HISTORY_CHARS;
    const compact = history
        .slice(-MAX_HISTORY_MESSAGES)
        .map((item) => {
            const role = item?.role === 'assistant' ? 'assistant' : 'user';
            const remaining = Math.max(0, Math.min(500, charBudget));
            const content = sanitizeText(item?.content, remaining);
            charBudget -= content.length;
            return content ? { role, content } : null;
        })
        .filter(Boolean);

    return compact;
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Metodo no permitido' });
    }

    const userId = await validateAdminSession(req);
    if (!userId) {
        return res.status(401).json({ success: false, error: 'No autorizado' });
    }

    const users = await getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user || user.role !== 'SuperAdmin') {
        return res.status(403).json({ success: false, error: 'Solo SuperAdmin puede usar Brenda Copiloto' });
    }

    const message = sanitizeText(req.body?.message, MAX_INPUT_CHARS);
    if (!message) {
        return res.status(400).json({ success: false, error: 'Mensaje requerido' });
    }

    const history = normalizeHistory(req.body?.history);
    const messages = [
        ...history,
        { role: 'user', content: message }
    ];

    try {
        const result = await getOpenAIResponse(
            messages,
            `${SYSTEM_PROMPT}\n\n${KNOWLEDGE_BASE}`,
            'gpt-4o-mini',
            null,
            null,
            null,
            MAX_REPLY_TOKENS
        );

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
        console.error('❌ [Copilot] chat error:', error);
        return res.status(500).json({
            success: false,
            error: 'No pude responder como copiloto en este momento.',
            detail: error.message
        });
    }
}
