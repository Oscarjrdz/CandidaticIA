import { getOpenAIResponse } from '../utils/openai.js';
import { getUsers, validateAdminSession } from '../utils/storage.js';
import {
    formatPlatformStatsForPrompt,
    getDirectPlatformStatsReply,
    getPlatformStats,
    isLightweightPlatformStatsIntent,
    isPlatformStatsIntent
} from '../utils/copilot-platform-stats.js';
import { detectWebSearchIntent, formatSearchResultsForPrompt, searchWeb } from '../utils/web-search.js';

const MAX_INPUT_CHARS = 900;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 2400;
const MAX_REPLY_TOKENS = 360;
const MAX_CONTEXT_CHARS = 120;
const WEB_SEARCH_MAX_RESULTS = 3;

const SYSTEM_PROMPT = `
Eres Brenda IA, asistente interna de Candidatic IA para SuperAdmin.
Ayudas con operacion, reclutamiento, prompts, skills, automatizaciones, busqueda web y mejora de mensajes.

Reglas:
- Responde en espanol claro, breve y accionable.
- Prioriza ahorro de tokens: no des explicaciones largas si no son necesarias.
- Si se adjuntan resultados web, usalos como fuente y no inventes datos fuera de esos resultados.
- No inventes que consultaste datos reales de candidatos, vacantes, Redis, Meta o WhatsApp si no se incluyeron en el contexto.
- No afirmes haber ejecutado acciones. Si piden cambios, prepara pasos o una propuesta.
- Si falta contexto, pide solo el dato minimo necesario.
- No uses markdown pesado salvo listas cortas cuando ayuden.
`;

const KNOWLEDGE_BASE = `
Candidatic IA tiene modulos como Candidatos, Chat Web, Envios Masivos, Estadisticas de Ads, Bot IA, Automatizaciones, Vacantes, Bolsa, Notificaciones, Proyectos, Usuarios y Settings.
El Bot IA conversa con candidatos. Brenda IA es interna y ayuda al equipo a pensar, redactar, diagnosticar y disenar mejoras.
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

function normalizeForIntent(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function getMonterreyNow() {
    const now = new Date();
    return {
        date: now.toLocaleDateString('es-MX', {
            timeZone: 'America/Monterrey',
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }),
        time: now.toLocaleTimeString('es-MX', {
            timeZone: 'America/Monterrey',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        })
    };
}

function sanitizeAppContext(appContext) {
    const ctx = appContext && typeof appContext === 'object' ? appContext : {};
    return {
        activeSection: sanitizeText(ctx.activeSection, MAX_CONTEXT_CHARS) || 'desconocida',
        sectionLabel: sanitizeText(ctx.sectionLabel, MAX_CONTEXT_CHARS) || 'Candidatic',
        path: sanitizeText(ctx.path, MAX_CONTEXT_CHARS) || '/'
    };
}

function getOyeBrendaSearchQuery(message) {
    const normalized = normalizeForIntent(message);
    if (!/^oye\s+brenda\b/.test(normalized)) return null;

    const query = String(message || '')
        .replace(/^\s*[oó]ye\s+brenda[\s,:;.-]*/i, '')
        .trim();

    return query || message;
}

function getDirectSkillReply(message, appContext) {
    const normalized = normalizeForIntent(message);
    const asksTime = /\b(hora|fecha|dia|día|hoy)\b/.test(normalized) && /\b(monterrey|actual|real|es|estamos|estamos a)\b/.test(normalized);
    const asksLocation = /\b(donde estoy|dónde estoy|donde estas|dónde estás|en que modulo|en qué módulo|en que pantalla|en qué pantalla)\b/.test(normalized);
    const now = getMonterreyNow();

    if (asksTime && asksLocation) {
        return `Estas en ${appContext.sectionLabel}. En Monterrey es ${now.date}, ${now.time}.`;
    }

    if (asksTime) {
        return `En Monterrey es ${now.date}, ${now.time}.`;
    }

    if (asksLocation) {
        return `Estas en ${appContext.sectionLabel}.`;
    }

    return null;
}

function isShortGenderFollowUp(message) {
    const normalized = normalizeForIntent(message)
        .replace(/[¿?¡!.,;:]/g, '')
        .trim();
    return /^(y\s+)?(puras?\s+)?(puros?\s+)?(hombres?|mujeres?|masculinos?|femeninas?|femeninos?|masculinas?)$/.test(normalized);
}

function enrichStatsFollowUp(message, history) {
    if (!isShortGenderFollowUp(message)) return message;

    const previousContext = [...(history || [])]
        .reverse()
        .filter(item => item.role === 'user')
        .map(item => sanitizeText(item.content, 220))
        .find(content => {
            const normalized = normalizeForIntent(content);
            if (!normalized || isShortGenderFollowUp(normalized)) return false;
            return /candidat|base|municipio|apodaca|monterrey|guadalupe|san nicolas|escobedo|santa catarina|garcia|juarez|pesqueria|metalsa|proyecto|tag|categoria|colonia|origen|escolaridad/.test(normalized);
        });

    return previousContext ? `${previousContext}. ${message}` : message;
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
        return res.status(403).json({ success: false, error: 'Solo SuperAdmin puede usar Brenda IA' });
    }

    const message = sanitizeText(req.body?.message, MAX_INPUT_CHARS);
    if (!message) {
        return res.status(400).json({ success: false, error: 'Mensaje requerido' });
    }

    const appContext = sanitizeAppContext(req.body?.appContext);
    const directReply = getDirectSkillReply(message, appContext);
    if (directReply) {
        return res.status(200).json({
            success: true,
            reply: directReply,
            model: 'skill:context',
            usage: null,
            skills: ['context']
        });
    }

    const history = normalizeHistory(req.body?.history);
    const now = getMonterreyNow();
    const statsMessage = enrichStatsFollowUp(message, history);
    const needsPlatformStats = isPlatformStatsIntent(statsMessage);
    const lightweightStats = needsPlatformStats ? isLightweightPlatformStatsIntent(statsMessage) : false;
    let platformStatsContext = '';
    let platformStats = null;

    if (needsPlatformStats) {
        // Use the light metrics profile for ops questions so Brenda avoids candidate scans.
        platformStats = await getPlatformStats({ lightweight: lightweightStats });
        const directStatsReply = getDirectPlatformStatsReply(statsMessage, platformStats);
        if (directStatsReply) {
            return res.status(200).json({
                success: true,
                reply: directStatsReply,
                model: 'skill:platform-stats',
                usage: null,
                skills: [lightweightStats ? 'platform-stats-light' : 'platform-stats'],
                statsProfile: platformStats.profile || null
            });
        }
        platformStatsContext = formatPlatformStatsForPrompt(platformStats);
    }

    const commandSearchQuery = getOyeBrendaSearchQuery(message);
    const detectedSearchQuery = commandSearchQuery ? null : detectWebSearchIntent(message);
    const searchQuery = commandSearchQuery || detectedSearchQuery;
    let searchContext = '';
    let skills = [];

    if (searchQuery) {
        const searchData = await searchWeb(searchQuery, {
            maxResults: WEB_SEARCH_MAX_RESULTS,
            lang: 'es',
            country: 'mx'
        });

        if (!searchData.success && commandSearchQuery) {
            return res.status(200).json({
                success: true,
                reply: `No pude consultar internet todavia: ${searchData.error || 'busqueda web no disponible'}.`,
                model: 'skill:web-search',
                usage: null,
                skills: ['web-search']
            });
        }

        if (searchData.success) {
            searchContext = formatSearchResultsForPrompt(searchData);
            skills.push(commandSearchQuery ? 'web-search-command' : 'web-search');
        }
    }

    const runtimeContext = `
[CONTEXTO ACTUAL]
- Usuario: ${sanitizeText(user.name, MAX_CONTEXT_CHARS) || 'SuperAdmin'}
- Pantalla actual: ${appContext.sectionLabel}
- Ruta app: ${appContext.path}
- Hora real en Monterrey: ${now.date}, ${now.time}
- Comando de busqueda "Oye Brenda": ${commandSearchQuery ? 'activado' : 'no activado'}
${searchContext ? `\n${searchContext}` : ''}
${platformStatsContext ? `\n${platformStatsContext}` : ''}
`;

    const messages = [
        ...history,
        { role: 'user', content: message }
    ];

    try {
        const result = await getOpenAIResponse(
            messages,
            `${SYSTEM_PROMPT}\n\n${KNOWLEDGE_BASE}\n\n${runtimeContext}`,
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
            skills: needsPlatformStats ? [...skills, lightweightStats ? 'platform-stats-light' : 'platform-stats'] : skills,
            statsProfile: platformStats?.profile || null,
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
