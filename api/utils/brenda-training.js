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

// ════════════════════════════════════════════════════════════════════════════
// SKILLS CANDIDATIC — Agentes (reclutadores) × Skills (clientes)
// ════════════════════════════════════════════════════════════════════════════
//
// ARQUITECTURA (definida por Oscar, ver memoria del proyecto):
//
//   Brenda = LA CUENTA DE WHATSAPP/META (el canal, ya existe, ya opera).
//            El candidato SIEMPRE ve "Brenda" porque es la cuenta que envía.
//            NO se construye aquí — es el cimiento que ya está vivo.
//
//   Agente = el RECLUTADOR real (Oscar, Paty, Sam...). Es el ESTILO/persuasión
//            que conduce a Brenda por detrás. Agnóstico del cliente. Se entrena
//            de los mensajes manuales reales de ese reclutador.
//
//   Skill  = el CLIENTE/vacante (Katcon, Metalsa, Yageo...). Son HECHOS CERRADOS
//            (sueldo, turno, ubicación, reglas). Datos rígidos, no negociables.
//
//   Conversación viva = Brenda (canal) + un Agente (estilo) + una Skill (hechos).
//   Ej: Brenda + Paty Agent + Skill Metalsa.
//
// Este archivo SOLO guarda/lee la data de entrenamiento y ENSAMBLA el system prompt
// (composeSystemPrompt). El envío real al candidato NO vive aquí — sale por la cuenta
// de Brenda igual que hoy (api/chat.js → Meta Cloud API). Aislado a propósito de
// Brenda Extractora (api/ai/agent.js): son llaves nuevas, sin relación con el resto.
// ════════════════════════════════════════════════════════════════════════════

const AGENTS_KEY = 'brenda_training:agents';
const SKILLS_KEY = 'brenda_training:skills';
const MAX_AGENTS = 50;
const MAX_SKILLS = 100;

/**
 * Upsert genérico sobre una lista de Redis de objetos {id, ...}. Si el `item` trae
 * un `id` que ya existe, lo reemplaza en su lugar (LSET); si no, crea uno nuevo
 * (LPUSH al frente + LTRIM al tope). Devuelve el registro final ya con timestamps.
 * Se comparte entre Agentes y Skills porque el patrón es idéntico. N es chico
 * (decenas), así que leer toda la lista para localizar el índice es barato.
 */
async function upsertListItem(redis, key, max, item, defaults, updatedBy) {
    const rows = await redis.lrange(key, 0, -1);
    const parsed = rows.map(r => safeParse(r, null));
    const now = new Date().toISOString();

    if (item.id) {
        const idx = parsed.findIndex(x => x?.id === item.id);
        if (idx !== -1) {
            const record = { ...parsed[idx], ...item, updatedAt: now, updatedBy: updatedBy || null };
            await redis.lset(key, idx, JSON.stringify(record));
            return record;
        }
    }

    const record = {
        ...defaults,
        ...item,
        id: `${defaults._idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: now,
        updatedAt: now,
        createdBy: updatedBy || null
    };
    delete record._idPrefix;
    await redis.lpush(key, JSON.stringify(record));
    await redis.ltrim(key, 0, max - 1);
    return record;
}

async function removeListItem(redis, key, id) {
    if (!redis || !id) return false;
    const rows = await redis.lrange(key, 0, -1);
    const target = rows.find(r => safeParse(r, {})?.id === id);
    if (!target) return false;
    await redis.lrem(key, 0, target);
    return true;
}

// ─── Agentes (reclutadores) ──────────────────────────────────────────────────

export async function listAgents(redis) {
    if (!redis) return [];
    const rows = await redis.lrange(AGENTS_KEY, 0, -1);
    return rows.map(r => safeParse(r, null)).filter(Boolean);
}

export async function saveAgent(redis, agent, updatedBy) {
    if (!redis) return null;
    return upsertListItem(redis, AGENTS_KEY, MAX_AGENTS, agent, {
        _idPrefix: 'agent',
        name: '',            // ej. "Oscar Agent" (nombre del reclutador, NO de empresa)
        recruiterName: '',   // ej. "Oscar"
        styleGuide: '',      // guía de estilo/persuasión aprendida de sus mensajes
        notes: '',
        color: '#2563eb'     // azul = capa de agentes
    }, updatedBy);
}

export async function removeAgent(redis, id) {
    return removeListItem(redis, AGENTS_KEY, id);
}

// ─── Skills (clientes / vacantes cerradas) ───────────────────────────────────

export async function listSkills(redis) {
    if (!redis) return [];
    const rows = await redis.lrange(SKILLS_KEY, 0, -1);
    return rows.map(r => safeParse(r, null)).filter(Boolean);
}

export async function saveSkill(redis, skill, updatedBy) {
    if (!redis) return null;
    return upsertListItem(redis, SKILLS_KEY, MAX_SKILLS, skill, {
        _idPrefix: 'skill',
        name: '',          // ej. "Skill Katcon" (nombre del cliente/empresa)
        clientName: '',    // ej. "Katcon"
        // HECHOS CERRADOS de la vacante — rígidos, no negociables:
        salary: '',        // ej. "1500 semanal"
        schedule: '',      // ej. "8 horas, turno fijo"
        restDays: '',      // ej. "Domingos"
        location: '',      // ej. "Planta Santa Catarina"
        benefits: [],      // ej. ["Planta climatizada", "Transporte", "Comedor"]
        rules: [],         // límites/reglas duras que el agente NO puede cruzar
        notes: '',
        color: '#d97706'   // ámbar = capa de skills/clientes
    }, updatedBy);
}

export async function removeSkill(redis, id) {
    return removeListItem(redis, SKILLS_KEY, id);
}

// ─── Composición: Brenda + Agente + Skill = system prompt ensamblado ──────────

/**
 * Base común "Brenda" — compartida por TODOS los agentes. Es el canal + las reglas
 * de comportamiento que no dependen ni del reclutador ni del cliente. Esto es lo
 * único que se mantiene constante para el candidato (siempre habla con "Brenda").
 */
const BRENDA_BASE = `# BRENDA — Reclutadora de Candidatic (canal WhatsApp)
Hablas por WhatsApp como "Brenda". Para el candidato SIEMPRE eres Brenda: nunca reveles que hay un reclutador humano distinto detrás, ni menciones "agente", "IA", "skill" ni nada de esto.
Reglas base (aplican a todos los clientes):
- Nunca prometas nada que no esté explícito en los HECHOS de la vacante de abajo. Si no sabes un dato, dilo con naturalidad y ofrece confirmarlo, no lo inventes.
- Los hechos de la vacante son CERRADOS: sueldo, horario y demás no se negocian aunque el candidato pida más. Tu trabajo es persuadir y reencuadrar, no cambiar el hecho.
- Tono humano, cálido y directo, mensajes cortos de WhatsApp. Sin sonar robótica ni corporativa.
- Si el candidato se pone difícil o pregunta algo delicado fuera de lo que sabes, ofrece pasar con una persona del equipo en vez de improvisar.`;

/**
 * Formatea los hechos cerrados de una Skill (cliente) en texto para el prompt.
 * Solo incluye los campos que tienen valor, para no meter ruido vacío.
 */
export function formatSkillFacts(skill) {
    if (!skill) return '(sin cliente seleccionado)';
    const lines = [];
    if (skill.salary) lines.push(`- Sueldo: ${skill.salary}`);
    if (skill.schedule) lines.push(`- Horario/turno: ${skill.schedule}`);
    if (skill.restDays) lines.push(`- Descansos: ${skill.restDays}`);
    if (skill.location) lines.push(`- Ubicación: ${skill.location}`);
    if (Array.isArray(skill.benefits) && skill.benefits.length) {
        lines.push(`- Beneficios (úsalos para persuadir): ${skill.benefits.join(', ')}`);
    }
    if (Array.isArray(skill.rules) && skill.rules.length) {
        lines.push(`- Reglas duras (NO cruzar): ${skill.rules.join('; ')}`);
    }
    return lines.length ? lines.join('\n') : '(sin hechos cargados todavía)';
}

/**
 * EL ARTEFACTO CENTRAL. Ensambla el system prompt final que consumiría el agente
 * conversacional = Brenda (base/canal) + Agente (estilo del reclutador) + Skill
 * (hechos cerrados del cliente). Es una función pura para poder previsualizarla en
 * la UI y reutilizarla tanto en el chat de prueba (GPT hoy) como en el futuro agente
 * Claude. Cambiar de reclutador o de cliente = cambiar una pieza, sin reescribir el resto.
 */
export function composeSystemPrompt(agent, skill) {
    const parts = [BRENDA_BASE];

    parts.push(agent
        ? `\n# ESTILO DEL RECLUTADOR: ${agent.name || agent.recruiterName || 'Reclutador'}\nImita este estilo, tácticas y frases reales al hablar con el candidato:\n${agent.styleGuide || '(sin guía de estilo cargada todavía)'}`
        : `\n# ESTILO DEL RECLUTADOR\n(no hay agente seleccionado — usa un tono neutro de reclutador)`);

    parts.push(skill
        ? `\n# VACANTE / CLIENTE: ${skill.name || skill.clientName || 'Cliente'}\nHECHOS CERRADOS de esta vacante (no negociables):\n${formatSkillFacts(skill)}`
        : `\n# VACANTE / CLIENTE\n(no hay cliente seleccionado — no des datos concretos de sueldo/horario)`);

    return parts.join('\n');
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
