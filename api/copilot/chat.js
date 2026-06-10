import { getOpenAIResponse } from '../utils/openai.js';
import { getRedisClient } from '../utils/storage.js';
import { 
    getCandidateKnowledgeSnapshot, 
    formatCompactSnapshot, 
    searchCandidateRoster, 
    formatSearchResults 
} from '../utils/copilot-candidate-knowledge.js';
import { searchWeb, formatSearchResultsForPrompt, detectWebSearchIntent } from '../utils/web-search.js';

const REDIS_RULES_KEY = 'copilot:custom_rules';
const REDIS_SKILLS_KEY = 'copilot:learned_skills';

const SYSTEM_KNOWLEDGE = `
Candidatic IA es una plataforma web de reclutamiento con módulos internos:
- Candidatos: gestión de perfiles capturados desde WhatsApp y otras fuentes.
- Chat Web: conversaciones con candidatos.
- Envíos Masivos: campañas y secuencias de mensajes.
- Estadísticas de Ads: seguimiento de campañas Meta/Facebook.
- Bot IA: configuración de Brenda Rodríguez, prompts, reglas y modo host.
- Automatizaciones: reglas de extracción inteligente hacia campos del candidato.
- Vacantes: gestión de vacantes, FAQ y contenido de reclutamiento.
- Bolsa de Empleo: experiencia pública/app para candidatos.
- ByPass: enrutamiento automático de candidatos.
- Proyectos: CRM/Kanban de reclutamiento.
- Post Maker: creación de posts para Facebook.
- Usuarios: roles, permisos y equipo.
- Settings: credenciales y configuración general.

Capacidades técnicas ya existentes:
- OpenAI configurable desde ai_config o variables de entorno.
- Redis como almacenamiento principal.
- Endpoints serverless en /api.
- Webhooks de WhatsApp/UltraMsg y Messenger.
- Extracción inteligente de datos de candidatos.
- Recordatorios, reactivación y procesos cron.

Estado actual del copiloto:
- Puede orientar al usuario sobre cómo funciona la plataforma.
- Puede explicar módulos, flujos y buenas prácticas.
- Puede proponer pasos, prompts y automatizaciones.
- Puede crear, editar y eliminar etiquetas directamente (di "crea la etiqueta X", "cambia el nombre de la etiqueta X a Y", "elimina la etiqueta X", "qué etiquetas hay").
- No debe afirmar que ejecutó cambios de otra naturaleza (mensajes, candidatos, reglas) sin confirmación.
`;

const FALLBACK_BRENDA_PERSONALITY = `
Brenda Rodríguez es una asistente de reclutamiento cálida, clara, profesional y práctica.
Habla en español natural, con tono humano, directo y servicial.
Evita sonar robótica, exagerada o demasiado técnica.
Prioriza ayudar al equipo a avanzar con orden, criterio y buena comunicación.
`;

function normalizeHistory(history = []) {
    return history
        .filter((message) => message && typeof message.content === 'string')
        .slice(-10)
        .map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content.slice(0, 3000)
        }));
}

function normalizeText(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// ─── Custom Rules Engine ─────────────────────────────────────────────────────

const RULE_TRIGGERS = [
    'quiero que siempre', 'siempre que', 'a partir de ahora', 'de ahora en adelante',
    'nunca uses', 'no uses', 'no utilices', 'nunca utilices', 'nunca digas', 'no digas',
    'siempre hablame', 'siempre dime', 'siempre llamame', 'siempre respondeme',
    'quiero que me', 'tratame como', 'llamame', 'dime siempre',
    'recuerda que', 'ten en cuenta que', 'acuerdate que', 'nueva regla',
    'quiero que nunca', 'quiero que no', 'necesito que siempre', 'necesito que nunca',
    'formatea siempre', 'usa siempre', 'pon siempre', 'agrega siempre'
];

const DELETE_TRIGGERS = [
    'borra las reglas', 'elimina las reglas', 'quita las reglas', 'resetea las reglas',
    'borra todas las reglas', 'elimina todas las reglas', 'limpia las reglas',
    'borra reglas', 'elimina reglas', 'quita reglas', 'sin reglas'
];

const LIST_TRIGGERS = [
    'mis reglas', 'que reglas', 'cuales son mis reglas', 'lista de reglas',
    'muestra las reglas', 'dime las reglas', 'que instrucciones', 'muestra instrucciones'
];

const DELETE_ONE_TRIGGERS = [
    'borra la regla', 'elimina la regla', 'quita la regla'
];

function isRuleMessage(text) {
    const n = normalizeText(text);
    return RULE_TRIGGERS.some(t => n.includes(t));
}
function isDeleteAllMessage(text) {
    const n = normalizeText(text);
    return DELETE_TRIGGERS.some(t => n.includes(t));
}
function isListRulesMessage(text) {
    const n = normalizeText(text);
    return LIST_TRIGGERS.some(t => n.includes(t));
}
function isDeleteOneMessage(text) {
    const n = normalizeText(text);
    return DELETE_ONE_TRIGGERS.some(t => n.includes(t));
}

async function getCustomRules(redis) {
    if (!redis) return [];
    try { const r = await redis.get(REDIS_RULES_KEY); return r ? JSON.parse(r) : []; }
    catch { return []; }
}
async function saveCustomRules(redis, rules) {
    if (!redis) return;
    await redis.set(REDIS_RULES_KEY, JSON.stringify(rules));
}
async function addCustomRule(redis, ruleText) {
    const rules = await getCustomRules(redis);
    const n = normalizeText(ruleText);
    if (rules.some(r => normalizeText(r.text) === n)) return { rules, added: false, duplicate: true };
    rules.push({ text: ruleText, createdAt: new Date().toISOString() });
    await saveCustomRules(redis, rules);
    return { rules, added: true, duplicate: false };
}
async function deleteAllRules(redis) { await saveCustomRules(redis, []); return []; }
async function deleteRuleByIndex(redis, index) {
    const rules = await getCustomRules(redis);
    if (index < 0 || index >= rules.length) return { rules, removed: false };
    const removed = rules.splice(index, 1);
    await saveCustomRules(redis, rules);
    return { rules, removed: removed[0] };
}

function formatRulesForPrompt(rules) {
    if (!rules.length) return '';
    return `\nREGLAS PERSONALIZADAS DEL USUARIO (CUMPLIR SIEMPRE, MÁXIMA PRIORIDAD):\n${rules.map((r, i) => `${i + 1}. ${r.text}`).join('\n')}\n`;
}
function formatRulesListForReply(rules) {
    if (!rules.length) return '📋 No tienes reglas personalizadas guardadas. Puedes decirme cosas como:\n• "Nunca uses asteriscos"\n• "Siempre háblame como dios Oscar"';
    return `📋 Tus reglas personalizadas:\n${rules.map((r, i) => `${i + 1}. ${r.text}`).join('\n')}\n\nPara borrar una regla di: "borra la regla #N"\nPara borrar todas: "borra las reglas"`;
}

// ─── Learned Skills Engine ───────────────────────────────────────────────────

const LEARN_TRIGGERS = [
    'aprende a', 'aprendete', 'enseñate a', 'aprende como',
    'quiero que aprendas', 'necesito que aprendas',
    'aprende a darme', 'aprende a decirme', 'aprende a mostrarme',
    'nueva skill', 'nuevo skill', 'agrega skill'
];

const LIST_SKILLS_TRIGGERS = [
    'mis skills', 'que skills', 'cuales skills', 'lista de skills',
    'muestra skills', 'que sabes hacer', 'que has aprendido',
    'tus habilidades', 'que aprendiste'
];

const DELETE_SKILL_TRIGGERS = [
    'borra la skill', 'elimina la skill', 'quita la skill',
    'olvida la skill', 'desaprende'
];

const DELETE_ALL_SKILLS_TRIGGERS = [
    'borra todas las skills', 'elimina todas las skills', 'olvida todo lo aprendido',
    'borra skills', 'resetea skills'
];

function isLearnMessage(text) {
    const n = normalizeText(text);
    return LEARN_TRIGGERS.some(t => n.includes(t));
}
function isListSkillsMessage(text) {
    const n = normalizeText(text);
    return LIST_SKILLS_TRIGGERS.some(t => n.includes(t));
}
function isDeleteSkillMessage(text) {
    const n = normalizeText(text);
    return DELETE_SKILL_TRIGGERS.some(t => n.includes(t));
}
function isDeleteAllSkillsMessage(text) {
    const n = normalizeText(text);
    return DELETE_ALL_SKILLS_TRIGGERS.some(t => n.includes(t));
}

async function getLearnedSkills(redis) {
    if (!redis) return [];
    try { const r = await redis.get(REDIS_SKILLS_KEY); return r ? JSON.parse(r) : []; }
    catch { return []; }
}
async function saveLearnedSkills(redis, skills) {
    if (!redis) return;
    await redis.set(REDIS_SKILLS_KEY, JSON.stringify(skills));
}

async function generateSkillDefinition(userRequest, model) {
    const prompt = `El usuario quiere que yo (Brenda, copiloto de reclutamiento) "aprenda" una nueva habilidad.
Su petición: "${userRequest}"

Genera un JSON con esta estructura exacta:
{
  "name": "nombre corto de la skill (2-5 palabras)",
  "description": "qué hace esta skill en una oración",
  "triggers": ["palabra clave 1", "palabra clave 2", "frase trigger 3"],
  "instruction": "Instrucción detallada que debo seguir cuando detecte esta skill. Incluye qué datos buscar, cómo formatear la respuesta, y cualquier lógica necesaria.",
  "dataSource": "candidates|web|general"
}

Reglas:
- triggers: 5-10 palabras/frases cortas que el usuario usaría naturalmente para activar esta skill
- instruction: ser muy específico sobre qué hacer y cómo responder
- dataSource: "candidates" si necesita datos de candidatos, "web" si necesita internet, "general" si solo necesita razonamiento
- Responde SOLO con JSON válido, sin markdown`;

    try {
        const result = await getOpenAIResponse(
            [{ role: 'user', content: prompt }],
            'Eres un generador de definiciones de skills. Responde solo JSON.',
            model, null, { type: 'json_object' }, null, 300
        );
        return JSON.parse(result.content);
    } catch (e) {
        console.error('[Skills] Failed to generate definition:', e.message);
        return null;
    }
}

async function learnNewSkill(redis, userRequest, model) {
    const skills = await getLearnedSkills(redis);
    
    if (skills.length >= 100) {
        return { success: false, error: 'limit', skills };
    }

    const definition = await generateSkillDefinition(userRequest, model);
    if (!definition) return { success: false, error: 'generation_failed', skills };

    // Check for duplicate by name
    const normalizedName = normalizeText(definition.name);
    if (skills.some(s => normalizeText(s.name) === normalizedName)) {
        return { success: false, error: 'duplicate', existing: definition.name, skills };
    }

    const skill = {
        ...definition,
        createdAt: new Date().toISOString(),
        usageCount: 0
    };

    skills.push(skill);
    await saveLearnedSkills(redis, skills);
    return { success: true, skill, skills };
}

function matchLearnedSkill(message, skills) {
    if (!skills.length) return null;
    const normalized = normalizeText(message);
    
    let bestMatch = null;
    let bestScore = 0;

    for (const skill of skills) {
        if (!skill.triggers?.length) continue;
        let score = 0;
        for (const trigger of skill.triggers) {
            if (normalized.includes(normalizeText(trigger))) {
                score += trigger.length; // longer matches = higher confidence
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = skill;
        }
    }

    return bestScore >= 3 ? bestMatch : null;
}

function formatSkillsForPrompt(matchedSkill) {
    if (!matchedSkill) return '';
    return `\n=== SKILL APRENDIDA ACTIVADA: "${matchedSkill.name}" ===\nINSTRUCCIÓN DE LA SKILL: ${matchedSkill.instruction}\nFuente de datos: ${matchedSkill.dataSource}\nAPLICA ESTA SKILL PARA RESPONDER.\n`;
}

function formatSkillsListForReply(skills) {
    if (!skills.length) return '🧠 No tengo skills aprendidas aún. Puedes enseñarme diciendo:\n• "Aprende a darme el candidato más nuevo"\n• "Aprende a buscar candidatos por puesto"\n• "Aprende a darme un resumen diario"';
    const lines = skills.map((s, i) => `${i + 1}. **${s.name}** — ${s.description}\n   Triggers: ${s.triggers.slice(0, 4).join(', ')}`);
    return `🧠 Mis skills aprendidas:\n${lines.join('\n')}\n\nPara borrar: "borra la skill #N"\nPara enseñarme más: "aprende a..."`;
}

// ─── Tag Management Engine ───────────────────────────────────────────────────

const TAG_REDIS_KEY = 'candidatic:chat_tags';
const TAG_COUNTS_CACHE_KEY = 'candidatic:tag_counts_cache';

const DEFAULT_TAG_COLORS = [
    '#3b82f6', '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#a855f7', '#ec4899', '#8b5cf6', '#64748b'
];

const TAG_MGMT_TRIGGERS = [
    'crea la etiqueta', 'crea etiqueta', 'nueva etiqueta', 'agrega la etiqueta',
    'agrega etiqueta', 'añade etiqueta', 'añade la etiqueta',
    'elimina la etiqueta', 'elimina etiqueta', 'borra la etiqueta', 'borra etiqueta',
    'quita la etiqueta', 'quita etiqueta', 'borrar etiqueta', 'eliminar etiqueta',
    'edita la etiqueta', 'edita etiqueta', 'cambia la etiqueta', 'modifica la etiqueta',
    'modifica etiqueta', 'renombra la etiqueta', 'renombra etiqueta',
    'cambia el nombre de la etiqueta', 'cambia el color de la etiqueta',
    'que etiquetas hay', 'que etiquetas existen', 'lista etiquetas', 'lista de etiquetas',
    'muéstrame las etiquetas', 'muestrame las etiquetas', 'ver etiquetas', 'etiquetas disponibles',
    'cuantas etiquetas', 'cuántas etiquetas'
];

function isTagManagementMessage(text) {
    const n = normalizeText(text);
    return TAG_MGMT_TRIGGERS.some(t => n.includes(normalizeText(t)));
}

async function parseTagIntent(userMessage, model) {
    const prompt = `El usuario quiere hacer una operación con etiquetas (tags) en un sistema de reclutamiento.

Su mensaje: "${userMessage}"

Extrae la intención y los parámetros. Responde SOLO con JSON válido:
{
  "action": "create|edit|delete|list",
  "name": "nombre de la etiqueta (para create/edit/delete, null para list)",
  "newName": "nuevo nombre (solo para edit si cambia nombre, null si no cambia)",
  "color": "color en hex (solo si el usuario especificó un color, null si no)"
}

Mapeo de colores del español al hex:
rojo → #ef4444, naranja → #f97316, amarillo → #eab308, verde → #22c55e,
azul → #3b82f6, morado/purpura → #a855f7, rosa/pink → #ec4899,
violeta → #8b5cf6, gris/plomo/slate → #64748b

Responde SOLO JSON válido, sin markdown.`;

    try {
        const result = await getOpenAIResponse(
            [{ role: 'user', content: prompt }],
            'Eres un extractor de intenciones. Responde solo JSON válido.',
            model, null, { type: 'json_object' }, null, 200
        );
        return JSON.parse(result.content);
    } catch {
        return null;
    }
}

async function getTagsFromRedis(redis) {
    const raw = await redis.get(TAG_REDIS_KEY);
    if (!raw) return [
        { name: 'Urgente', color: '#64748b' },
        { name: 'Entrevista', color: '#f97316' },
        { name: 'Contratado', color: '#eab308' },
        { name: 'Rechazado', color: '#22c55e' },
        { name: 'Duda', color: '#3b82f6' }
    ];
    const tags = JSON.parse(raw);
    return tags.map(t => typeof t === 'string' ? { name: t, color: '#3b82f6' } : t);
}

async function saveTagsToRedis(redis, tags) {
    await redis.set(TAG_REDIS_KEY, JSON.stringify(tags));
    await redis.del(TAG_COUNTS_CACHE_KEY);
}

async function removeTagFromAllCandidates(tagName) {
    const { getCandidates, updateCandidate } = await import('../utils/storage.js');
    const { candidates } = await getCandidates(20000, 0, '');
    const promises = candidates
        .filter(c => Array.isArray(c.tags) && c.tags.includes(tagName))
        .map(c => updateCandidate(c.id, { tags: c.tags.filter(t => t !== tagName) }));
    if (promises.length > 0) await Promise.all(promises);
}

async function renameTagInAllCandidates(oldName, newName) {
    const { getCandidates, updateCandidate } = await import('../utils/storage.js');
    const { candidates } = await getCandidates(20000, 0, '');
    const promises = candidates
        .filter(c => Array.isArray(c.tags) && c.tags.includes(oldName))
        .map(c => updateCandidate(c.id, { tags: c.tags.map(t => t === oldName ? newName : t) }));
    if (promises.length > 0) await Promise.all(promises);
}

async function executeTagOperation(redis, intent) {
    const tags = await getTagsFromRedis(redis);

    if (intent.action === 'list') {
        if (!tags.length) return '📋 No hay etiquetas configuradas aún.';
        const lines = tags.map((t, i) => `${i + 1}. **${t.name}**`);
        return `🏷️ Etiquetas disponibles (${tags.length}):\n${lines.join('\n')}\n\nPuedes pedirme crear, editar o eliminar cualquiera.`;
    }

    if (intent.action === 'create') {
        if (!intent.name?.trim()) return '❌ No entendí el nombre. ¿Cómo quieres llamarla?';
        const name = intent.name.trim();
        if (tags.some(t => normalizeText(t.name) === normalizeText(name))) {
            return `⚠️ Ya existe una etiqueta llamada **"${name}"**.`;
        }
        const usedColors = new Set(tags.map(t => t.color));
        const color = intent.color || DEFAULT_TAG_COLORS.find(c => !usedColors.has(c)) || DEFAULT_TAG_COLORS[tags.length % DEFAULT_TAG_COLORS.length];
        tags.push({ name, color });
        await saveTagsToRedis(redis, tags);
        return `✅ Etiqueta **"${name}"** creada correctamente.`;
    }

    if (intent.action === 'delete') {
        if (!intent.name?.trim()) return '❌ No entendí qué etiqueta eliminar. ¿Puedes especificarla?';
        const name = intent.name.trim();
        const idx = tags.findIndex(t => normalizeText(t.name) === normalizeText(name));
        if (idx === -1) {
            const list = tags.map(t => `"${t.name}"`).join(', ');
            return `❌ No encontré la etiqueta **"${name}"**.\nEtiquetas disponibles: ${list || 'ninguna'}`;
        }
        tags.splice(idx, 1);
        await saveTagsToRedis(redis, tags);
        // Quitar de candidatos en background
        removeTagFromAllCandidates(name).catch(() => {});
        return `🗑️ Etiqueta **"${name}"** eliminada. Se está quitando de los candidatos que la tenían.`;
    }

    if (intent.action === 'edit') {
        if (!intent.name?.trim()) return '❌ No entendí qué etiqueta editar.';
        const name = intent.name.trim();
        const idx = tags.findIndex(t => normalizeText(t.name) === normalizeText(name));
        if (idx === -1) {
            const list = tags.map(t => `"${t.name}"`).join(', ');
            return `❌ No encontré la etiqueta **"${name}"**.\nEtiquetas disponibles: ${list || 'ninguna'}`;
        }
        const changes = [];
        if (intent.newName?.trim() && normalizeText(intent.newName) !== normalizeText(tags[idx].name)) {
            const newName = intent.newName.trim();
            if (tags.some((t, i) => i !== idx && normalizeText(t.name) === normalizeText(newName))) {
                return `⚠️ Ya existe una etiqueta llamada **"${newName}"**.`;
            }
            changes.push(`nombre: "${tags[idx].name}" → "${newName}"`);
            renameTagInAllCandidates(tags[idx].name, newName).catch(() => {});
            tags[idx].name = newName;
        }
        if (intent.color) {
            changes.push(`color: ${tags[idx].color} → ${intent.color}`);
            tags[idx].color = intent.color;
        }
        if (!changes.length) return '🤔 No detecté ningún cambio. ¿Qué quieres modificar: nombre, color, o ambos?';
        await saveTagsToRedis(redis, tags);
        return `✅ Etiqueta actualizada:\n${changes.map(c => `• ${c}`).join('\n')}`;
    }

    return '🤔 No entendí la operación. Puedo crear, editar, eliminar o listar etiquetas.';
}

// ─── Assign Tag to Candidates Engine ─────────────────────────────────────────

const SEARCH_CONTEXT_KEY = 'copilot:last_search';
const SEARCH_CONTEXT_TTL = 600; // 10 minutos

const ASSIGN_TAG_TRIGGERS = [
    'asígnale la etiqueta', 'asignale la etiqueta',
    'ponle la etiqueta', 'ponles la etiqueta',
    'aplica la etiqueta', 'aplícale la etiqueta', 'aplicale la etiqueta',
    'etiquétalos', 'etiquetalos', 'etiquétalas', 'etiquétalas',
    'asigna la etiqueta', 'asignar la etiqueta',
    'agrega la etiqueta a esos', 'agrega esa etiqueta',
    'dale la etiqueta', 'dales la etiqueta',
    'ponles esa etiqueta', 'ponle esa etiqueta', 'asigna esa etiqueta',
    'a todos ponle', 'a esos ponle', 'ponle a todos la etiqueta',
];

function isAssignTagMessage(text) {
    const n = normalizeText(text);
    return ASSIGN_TAG_TRIGGERS.some(t => n.includes(normalizeText(t)));
}

async function parseAssignTagIntent(userMessage, model) {
    const prompt = `El usuario quiere asignar una etiqueta a candidatos.

Su mensaje: "${userMessage}"

Extrae los parámetros. Responde SOLO con JSON válido:
{
  "tagName": "nombre de la etiqueta a asignar",
  "targetType": "search_context|named",
  "targetName": "nombre del candidato (solo si targetType es 'named', null si no)"
}

- "search_context": El usuario se refiere a resultados de una búsqueda anterior ("a esos", "a ellos", "a los de santa catarina", sin mencionar un nombre específico)
- "named": El usuario menciona un candidato específico por nombre ("a Juan García", "al candidato X")

Responde SOLO JSON válido, sin markdown.`;

    try {
        const result = await getOpenAIResponse(
            [{ role: 'user', content: prompt }],
            'Eres un extractor de intenciones. Responde solo JSON válido.',
            model, null, { type: 'json_object' }, null, 200
        );
        return JSON.parse(result.content);
    } catch {
        return null;
    }
}

const PENDING_CONFIRM_KEY = 'copilot:pending_confirm';
const PENDING_CONFIRM_TTL = 300; // 5 minutos

// Resuelve quiénes son los targets y devuelve la acción pendiente (sin ejecutar)
async function buildAssignTagConfirmation(redis, intent, roster) {
    const tagName = intent.tagName?.trim();
    if (!tagName) return { error: '❌ No entendí el nombre de la etiqueta. ¿Cuál quieres asignar?' };

    let targetIds = [];
    let targetDescription = '';

    if (intent.targetType === 'named' && intent.targetName) {
        const nameNorm = normalizeText(intent.targetName);
        const matches = (roster || []).filter(c => normalizeText(c.nombre).includes(nameNorm));
        if (!matches.length) return { error: `❌ No encontré candidatos con el nombre **"${intent.targetName}"**.` };
        targetIds = matches.map(c => c.id);
        targetDescription = matches.length === 1
            ? `**${matches[0].nombre}**`
            : `**${matches.length} candidatos** que coinciden con "${intent.targetName}"`;
    } else {
        if (!redis) return { error: '⚠️ No hay conexión a la base de datos.' };
        const raw = await redis.get(SEARCH_CONTEXT_KEY);
        if (!raw) return { error: '⚠️ No tengo una búsqueda reciente guardada.\n\nPrimero hazme una pregunta como *"¿cuántos candidatos viven en Santa Catarina?"* y luego pídeme asignar la etiqueta.' };
        const ctx = JSON.parse(raw);
        if (!ctx.ids?.length) return { error: '⚠️ La última búsqueda no tuvo resultados para etiquetar.' };
        targetIds = ctx.ids;
        targetDescription = `**${ctx.total} candidatos** de la búsqueda *"${ctx.query}"*`;
    }

    if (!targetIds.length) return { error: '❌ No hay candidatos para etiquetar.' };

    return { tagName, targetIds, targetDescription };
}

// Ejecuta la asignación real (se llama solo después de confirmación)
async function executeAssignTagByIds(redis, tagName, targetIds, targetDescription) {
    const tags = await getTagsFromRedis(redis);
    const tagCreated = !tags.some(t => normalizeText(t.name) === normalizeText(tagName));
    if (tagCreated) {
        const usedColors = new Set(tags.map(t => t.color));
        const color = DEFAULT_TAG_COLORS.find(c => !usedColors.has(c)) || DEFAULT_TAG_COLORS[tags.length % DEFAULT_TAG_COLORS.length];
        tags.push({ name: tagName, color });
        await saveTagsToRedis(redis, tags);
    }

    const { getCandidateById, updateCandidate } = await import('../utils/storage.js');
    let updated = 0;
    let skipped = 0;
    for (const id of targetIds) {
        try {
            const cand = await getCandidateById(id);
            if (!cand) { skipped++; continue; }
            const existingTags = Array.isArray(cand.tags) ? cand.tags : [];
            if (!existingTags.includes(tagName)) {
                await updateCandidate(id, { tags: [...existingTags, tagName] });
                updated++;
            } else {
                skipped++;
            }
        } catch { skipped++; }
    }

    await redis?.del(TAG_COUNTS_CACHE_KEY);

    let reply = `✅ Etiqueta **"${tagName}"** asignada a ${targetDescription}.`;
    if (updated > 0) reply += `\n• ${updated} candidatos actualizados`;
    if (skipped > 0) reply += `\n• ${skipped} ya la tenían o no se encontraron`;
    if (tagCreated) reply += `\n\n_(La etiqueta fue creada automáticamente)_`;
    return reply;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Método no permitido' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const question = String(body.message || '').trim();
        const history = normalizeHistory(body.history);

        if (!question) {
            return res.status(400).json({ success: false, error: 'Falta el mensaje para Brenda' });
        }

        const redis = getRedisClient();
        let model = 'gpt-4o-mini';

        if (redis) {
            try {
                const storedModel = await redis.get('bot_ia_model');
                model = storedModel || model;
            } catch (error) {
                console.warn('[Copilot] No se pudo leer configuración:', error.message);
            }
        }

        // ─── Handle pending confirmations ─────────────────────────────────

        if (question === '__CONFIRM__') {
            const raw = redis ? await redis.get(PENDING_CONFIRM_KEY) : null;
            if (!raw) {
                return res.status(200).json({ success: true, reply: '⏰ La acción ya expiró o fue cancelada.', model: 'system', skill: 'confirmation' });
            }
            const pending = JSON.parse(raw);
            await redis.del(PENDING_CONFIRM_KEY);
            if (pending.type === 'assign_tag') {
                const reply = await executeAssignTagByIds(redis, pending.tagName, pending.targetIds, pending.targetDescription);
                return res.status(200).json({ success: true, reply, model: 'system', skill: 'tag_assignment' });
            }
        }

        if (question === '__CANCEL__') {
            if (redis) await redis.del(PENDING_CONFIRM_KEY).catch(() => {});
            return res.status(200).json({ success: true, reply: '❌ Acción cancelada.', model: 'system', skill: 'confirmation' });
        }

        // ─── Handle custom rules commands ─────────────────────────────────
        
        if (isListRulesMessage(question)) {
            const rules = await getCustomRules(redis);
            return res.status(200).json({ success: true, reply: formatRulesListForReply(rules), model: 'system', skill: 'custom_rules' });
        }
        if (isDeleteAllMessage(question)) {
            await deleteAllRules(redis);
            return res.status(200).json({ success: true, reply: '🗑️ Listo, borré todas tus reglas personalizadas. Empezamos de cero ✨', model: 'system', skill: 'custom_rules' });
        }
        if (isDeleteOneMessage(question)) {
            const numMatch = question.match(/#?(\d+)/);
            if (numMatch) {
                const idx = parseInt(numMatch[1]) - 1;
                const { rules, removed } = await deleteRuleByIndex(redis, idx);
                if (removed) {
                    return res.status(200).json({ success: true, reply: `🗑️ Regla eliminada: "${removed.text}"\n\n${formatRulesListForReply(rules)}`, model: 'system', skill: 'custom_rules' });
                }
            }
            const rules = await getCustomRules(redis);
            return res.status(200).json({ success: true, reply: `No encontré esa regla. ${formatRulesListForReply(rules)}`, model: 'system', skill: 'custom_rules' });
        }

        let ruleAdded = false;
        if (isRuleMessage(question)) {
            const result = await addCustomRule(redis, question);
            ruleAdded = true;
            if (result.duplicate) {
                return res.status(200).json({ success: true, reply: '👌 Ya tengo esa regla guardada, no te preocupes ✨', model: 'system', skill: 'custom_rules' });
            }
        }

        // ─── Handle learned skills commands ───────────────────────────────

        if (isListSkillsMessage(question)) {
            const skills = await getLearnedSkills(redis);
            return res.status(200).json({ success: true, reply: formatSkillsListForReply(skills), model: 'system', skill: 'learned_skills' });
        }
        if (isDeleteAllSkillsMessage(question)) {
            await saveLearnedSkills(redis, []);
            return res.status(200).json({ success: true, reply: '🗑️ Borré todas mis skills aprendidas. Puedes enseñarme de nuevo cuando quieras 🧠', model: 'system', skill: 'learned_skills' });
        }
        if (isDeleteSkillMessage(question)) {
            const numMatch = question.match(/#?(\d+)/);
            if (numMatch) {
                const skills = await getLearnedSkills(redis);
                const idx = parseInt(numMatch[1]) - 1;
                if (idx >= 0 && idx < skills.length) {
                    const removed = skills.splice(idx, 1)[0];
                    await saveLearnedSkills(redis, skills);
                    return res.status(200).json({ success: true, reply: `🗑️ Skill olvidada: "${removed.name}"\n\n${formatSkillsListForReply(skills)}`, model: 'system', skill: 'learned_skills' });
                }
            }
            const skills = await getLearnedSkills(redis);
            return res.status(200).json({ success: true, reply: `No encontré esa skill. ${formatSkillsListForReply(skills)}`, model: 'system', skill: 'learned_skills' });
        }

        // Learn new skill
        let skillLearned = false;
        let learnedSkillResult = null;
        if (isLearnMessage(question)) {
            learnedSkillResult = await learnNewSkill(redis, question, model);
            skillLearned = true;

            if (!learnedSkillResult.success) {
                const errorMsgs = {
                    limit: '⚠️ Ya tengo 20 skills aprendidas (máximo). Borra alguna con "borra la skill #N" para hacer espacio.',
                    duplicate: `👌 Ya sé hacer eso: "${learnedSkillResult.existing}". No necesito aprenderlo de nuevo.`,
                    generation_failed: '😅 No pude entender bien qué quieres que aprenda. ¿Puedes explicármelo de otra forma?'
                };
                return res.status(200).json({
                    success: true,
                    reply: errorMsgs[learnedSkillResult.error] || 'No pude aprender eso, intenta de nuevo.',
                    model: 'system',
                    skill: 'learned_skills'
                });
            }
        }

        // ─── Handle tag management ────────────────────────────────────────
        if (isTagManagementMessage(question)) {
            const intent = await parseTagIntent(question, model);
            if (intent) {
                const reply = await executeTagOperation(redis, intent);
                return res.status(200).json({ success: true, reply, model: 'system', skill: 'tag_management' });
            }
        }

        // ─── Handle assign tag to candidates ──────────────────────────────
        if (isAssignTagMessage(question)) {
            const intent = await parseAssignTagIntent(question, model);
            if (intent?.tagName) {
                const snapshot = await getCandidateKnowledgeSnapshot();
                const result = await buildAssignTagConfirmation(redis, intent, snapshot.allCandidatesSummary);
                if (result.error) {
                    return res.status(200).json({ success: true, reply: result.error, model: 'system', skill: 'tag_assignment' });
                }
                // Guardar acción pendiente y pedir confirmación
                if (redis) {
                    await redis.set(PENDING_CONFIRM_KEY, JSON.stringify({
                        type: 'assign_tag',
                        tagName: result.tagName,
                        targetIds: result.targetIds,
                        targetDescription: result.targetDescription,
                        savedAt: new Date().toISOString()
                    }), 'EX', PENDING_CONFIRM_TTL);
                }
                const reply = `⚠️ Vas a asignar la etiqueta **"${result.tagName}"** a ${result.targetDescription}.\n\n¿Confirmas?`;
                return res.status(200).json({ success: true, reply, model: 'system', skill: 'tag_assignment', confirmation: true });
            }
        }

        // ─── Match learned skills ─────────────────────────────────────────

        const allSkills = await getLearnedSkills(redis);
        const matchedSkill = skillLearned ? null : matchLearnedSkill(question, allSkills);
        const skillPromptText = formatSkillsForPrompt(matchedSkill);

        // Track usage
        if (matchedSkill && redis) {
            matchedSkill.usageCount = (matchedSkill.usageCount || 0) + 1;
            await saveLearnedSkills(redis, allSkills);
        }

        // ─── Web Search Skill ─────────────────────────────────────────────
        let webSearchText = '';
        let usedWebSearch = false;

        // Web search if: explicit intent, matched skill wants web, or no other data source matches
        const webQuery = detectWebSearchIntent(question);
        const shouldSearchWeb = webQuery || (matchedSkill?.dataSource === 'web');
        
        if (shouldSearchWeb) {
            const query = webQuery || question;
            const webResults = await searchWeb(query);
            if (webResults.success && webResults.results.length > 0) {
                webSearchText = formatSearchResultsForPrompt(webResults);
                usedWebSearch = true;
            } else if (!webResults.success && webResults.error?.includes('API key')) {
                webSearchText = '\n[NOTA: El usuario quiso buscar en internet pero no hay API key de Serper configurada. Dile que necesita agregar serperApiKey en Settings.]\n';
            }
        }

        // ─── Build system prompt ──────────────────────────────────────────

        const customRules = await getCustomRules(redis);
        const customRulesText = formatRulesForPrompt(customRules);

        const snapshot = await getCandidateKnowledgeSnapshot();
        const compactStats = formatCompactSnapshot(snapshot);
        
        const searchContext = history.slice(-2).map(m => m.content).join(' ') + ' ' + question;
        const searchResults = await searchCandidateRoster(snapshot.allCandidatesSummary, searchContext);
        const searchText = formatSearchResults(searchResults);

        // Guardar contexto de búsqueda en Redis para asignación posterior de etiquetas
        if (redis && searchResults?.allMatchingIds?.length > 0) {
            redis.set(SEARCH_CONTEXT_KEY, JSON.stringify({
                ids: searchResults.allMatchingIds,
                total: searchResults.totalMatches,
                query: question,
                savedAt: new Date().toISOString()
            }), 'EX', SEARCH_CONTEXT_TTL).catch(() => {});
        }

        const systemPrompt = `
Eres Brenda Rodríguez, copiloto interno de Candidatic IA.

PERSONALIDAD (COPILOTO, NO BOT DE WHATSAPP):
${FALLBACK_BRENDA_PERSONALITY}
${customRulesText}
CONOCIMIENTO DEL SISTEMA Y MÓDULOS:
${SYSTEM_KNOWLEDGE}

CONOCIMIENTO DE LA BASE DE CANDIDATOS (DATOS REALES):
${compactStats}
${searchText}
${webSearchText}
${skillPromptText}
INSTRUCCIONES FINALES:
- Responde como copiloto operativo interno, no como bot externo para candidatos.
- Eres capaz de responder sobre cómo funciona la plataforma Y sobre las estadísticas reales de candidatos.
- Si el usuario pregunta "cuántos", "cuántas", o hace preguntas de conteo cruzado y hay una "BÚSQUEDA ESPECÍFICA", usa el "Total coincidencias" de esa búsqueda como la respuesta matemática.
- Si te preguntan "hoy" o "ayer", usa zona horaria ${snapshot.timezone}.
- No inventes métricas, candidatos, ni campañas. Usa SOLO los datos proporcionados.
- Mantén respuestas breves y ejecutivas salvo que el usuario pida detalle.
- Las REGLAS PERSONALIZADAS del usuario tienen MÁXIMA PRIORIDAD sobre cualquier otra instrucción.
- Si hay RESULTADOS DE BÚSQUEDA WEB, úsalos para responder y cita las fuentes brevemente.
- Si hay una SKILL APRENDIDA ACTIVADA, sigue su instrucción al pie de la letra.
`;

        // Context injection for special events
        let userContent = question;
        if (ruleAdded) {
            userContent = `[SISTEMA: El usuario guardó una nueva regla. Confirma brevemente. Regla: "${question}"]\n\n${question}`;
        } else if (skillLearned && learnedSkillResult?.success) {
            const s = learnedSkillResult.skill;
            userContent = `[SISTEMA: Acabas de aprender una nueva skill llamada "${s.name}". Confirma que la aprendiste, explica brevemente qué harás cuando la activen, y menciona los triggers que la activan. Sé entusiasta.]\n\n${question}`;
        }

        const result = await getOpenAIResponse(
            [...history, { role: 'user', content: userContent }],
            systemPrompt,
            model,
            null,
            null,
            null,
            1200
        );

        const usedSkill = skillLearned ? 'learned_skills' : ruleAdded ? 'custom_rules' : matchedSkill ? `skill:${matchedSkill.name}` : usedWebSearch ? 'web_search' : 'unified_omni_knowledge';

        return res.status(200).json({
            success: true,
            reply: result.content,
            model: result.model,
            skill: usedSkill
        });
    } catch (error) {
        console.error('[Copilot] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'No pude responder como copiloto en este momento.',
            detail: error.message
        });
    }
}
