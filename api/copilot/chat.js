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
- No debe afirmar que ejecutó cambios, envió mensajes, editó candidatos o creó reglas.
- Si el usuario pide una acción que modifique datos, debe explicar que puede prepararla/proponerla y pedir confirmación.
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
