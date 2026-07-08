/**
 * Brenda Training — helpers de Redis para el workspace de entrenamiento de personalidad
 * (seccion "Brenda IA" del dashboard). Aislado de storage.js a proposito: son llaves
 * nuevas, sin relacion con Brenda Extractora ni con el resto de la plataforma.
 */
import { getUsers, validateAdminSession } from './storage.js';

/**
 * Gate compartido por los 4 endpoints de brenda-training: mismo patron de
 * api/copilot/chat.js (sesion valida + rol SuperAdmin). Devuelve el usuario o
 * null junto con la respuesta de error ya armada para que el endpoint solo
 * tenga que hacer `return res.status(...)`.
 */
export async function requireSuperAdmin(req, res) {
    const userId = await validateAdminSession(req);
    if (!userId) {
        res.status(401).json({ success: false, error: 'No autorizado' });
        return null;
    }
    const users = await getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user || user.role !== 'SuperAdmin') {
        res.status(403).json({ success: false, error: 'Solo SuperAdmin puede usar Brenda Training' });
        return null;
    }
    return user;
}

const PERSONA_KEY = 'brenda_training:persona';
const PERSONA_HISTORY_KEY = 'brenda_training:persona_history';
const EXAMPLES_KEY = 'brenda_training:examples';
const TOKENS_PREFIX = 'brenda_training:tokens:';
const TZ = 'America/Monterrey';

const MAX_HISTORY_VERSIONS = 20;
const MAX_EXAMPLES = 200;
const MAX_SCAN_CANDIDATES = 8000;

function todayMty() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

export async function getPersona(redis) {
    if (!redis) return { styleGuide: '', version: 0, updatedAt: null, updatedBy: null };
    const raw = await redis.get(PERSONA_KEY);
    return safeParse(raw, { styleGuide: '', version: 0, updatedAt: null, updatedBy: null });
}

export async function getPersonaHistory(redis, limit = MAX_HISTORY_VERSIONS) {
    if (!redis) return [];
    const rows = await redis.lrange(PERSONA_HISTORY_KEY, 0, limit - 1);
    return rows.map(r => safeParse(r, null)).filter(Boolean);
}

/**
 * Guarda una nueva version de la personalidad. Siempre empuja la version anterior
 * al historial antes de sobreescribir — nunca se pierde una version previa.
 */
export async function savePersona(redis, { styleGuide, updatedBy, source = 'manual-edit' }) {
    if (!redis) return null;
    const current = await getPersona(redis);

    if (current.styleGuide) {
        await redis.lpush(PERSONA_HISTORY_KEY, JSON.stringify(current));
        await redis.ltrim(PERSONA_HISTORY_KEY, 0, MAX_HISTORY_VERSIONS - 1);
    }

    const next = {
        styleGuide: String(styleGuide || ''),
        version: (current.version || 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || null,
        source
    };
    await redis.set(PERSONA_KEY, JSON.stringify(next));
    return next;
}

export async function getTrainingExamples(redis) {
    if (!redis) return [];
    const rows = await redis.lrange(EXAMPLES_KEY, 0, -1);
    return rows.map(r => safeParse(r, null)).filter(Boolean);
}

export async function addTrainingExample(redis, { candidateSaid, recruiterSaid, addedBy }) {
    if (!redis) return null;
    const example = {
        id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        candidateSaid: String(candidateSaid || '').trim(),
        recruiterSaid: String(recruiterSaid || '').trim(),
        addedAt: new Date().toISOString(),
        addedBy: addedBy || null
    };
    await redis.lpush(EXAMPLES_KEY, JSON.stringify(example));
    await redis.ltrim(EXAMPLES_KEY, 0, MAX_EXAMPLES - 1);
    return example;
}

export async function removeTrainingExample(redis, id) {
    if (!redis || !id) return false;
    const rows = await redis.lrange(EXAMPLES_KEY, 0, -1);
    const target = rows.find(r => safeParse(r, {})?.id === id);
    if (!target) return false;
    await redis.lrem(EXAMPLES_KEY, 0, target);
    return true;
}

export async function addTrainingTokens(redis, tokens) {
    if (!redis || !tokens) return;
    const key = `${TOKENS_PREFIX}${todayMty()}`;
    try {
        await redis.incrby(key, Math.round(tokens));
        await redis.expire(key, 60 * 60 * 24 * 30);
    } catch {
        // El contador de costo nunca debe tumbar la respuesta real.
    }
}

export async function getTrainingTokensToday(redis) {
    if (!redis) return 0;
    const val = await redis.get(`${TOKENS_PREFIX}${todayMty()}`);
    return Number(val || 0);
}

/**
 * Extrae, para un tag dado, los mensajes manuales (from:'me') unicos de los candidatos
 * que lo tienen. Dedupea por texto exacto de la respuesta del reclutador para que el
 * costo de sintetizar la personalidad dependa de la VARIEDAD real de respuestas, no del
 * numero de candidatos o mensajes repetidos (plantillas se mandan igual a cientos de
 * candidatos).
 */
export async function extractManualExchangesByTag(redis, tagName, maxCandidates = 100) {
    if (!redis) return { candidatesScanned: 0, candidatesMatched: 0, candidatesSampled: 0, uniqueExchanges: [] };

    const allIds = await redis.zrevrange('candidates:list', 0, MAX_SCAN_CANDIDATES - 1);
    if (!allIds.length) return { candidatesScanned: 0, candidatesMatched: 0, candidatesSampled: 0, uniqueExchanges: [] };

    const pipe = redis.pipeline();
    allIds.forEach(id => pipe.get(`candidate:${id}`));
    const rows = await pipe.exec();

    const normalizedTag = String(tagName || '').trim().toUpperCase();
    const matched = [];
    rows.forEach(([err, raw]) => {
        if (err || !raw) return;
        const c = safeParse(raw, null);
        if (!c) return;
        const tags = Array.isArray(c.tags) ? c.tags : [];
        const hasTag = tags.some(t => String(typeof t === 'string' ? t : t?.name || '').toUpperCase() === normalizedTag);
        if (hasTag) matched.push(c);
    });

    const sampled = matched.slice(0, Math.max(1, Math.min(maxCandidates, 300)));
    const seen = new Map();

    for (const cand of sampled) {
        const rawMsgs = await redis.lrange(`messages:${cand.id}`, 0, -1);
        const msgs = rawMsgs.map(m => safeParse(m, null)).filter(Boolean);

        for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].from !== 'me') continue;
            const text = String(msgs[i].content || '').trim();
            if (!text || seen.has(text)) continue;

            const prevCandidateMsg = [...msgs.slice(0, i)].reverse().find(m => m.from !== 'me' && m.from !== 'bot');
            seen.set(text, {
                candidatoDijo: prevCandidateMsg?.content || '(sin mensaje previo del candidato)',
                oscarRespondio: text,
                municipio: cand.municipio || null
            });
        }
    }

    return {
        candidatesScanned: allIds.length,
        candidatesMatched: matched.length,
        candidatesSampled: sampled.length,
        uniqueExchanges: Array.from(seen.values())
    };
}
