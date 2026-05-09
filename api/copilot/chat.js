import { getOpenAIResponse } from '../utils/openai.js';
import { getRedisClient } from '../utils/storage.js';
import { 
    getCandidateKnowledgeSnapshot, 
    formatCompactSnapshot, 
    searchCandidateRoster, 
    formatSearchResults 
} from '../utils/copilot-candidate-knowledge.js';

const REDIS_RULES_KEY = 'copilot:custom_rules';

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

// ─── Custom Rules Engine ─────────────────────────────────────────────────────

function normalizeText(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

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
    const normalized = normalizeText(text);
    return RULE_TRIGGERS.some(trigger => normalized.includes(trigger));
}

function isDeleteAllMessage(text) {
    const normalized = normalizeText(text);
    return DELETE_TRIGGERS.some(trigger => normalized.includes(trigger));
}

function isListRulesMessage(text) {
    const normalized = normalizeText(text);
    return LIST_TRIGGERS.some(trigger => normalized.includes(trigger));
}

function isDeleteOneMessage(text) {
    const normalized = normalizeText(text);
    return DELETE_ONE_TRIGGERS.some(trigger => normalized.includes(trigger));
}

async function getCustomRules(redis) {
    if (!redis) return [];
    try {
        const raw = await redis.get(REDIS_RULES_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

async function saveCustomRules(redis, rules) {
    if (!redis) return;
    await redis.set(REDIS_RULES_KEY, JSON.stringify(rules));
}

async function addCustomRule(redis, ruleText) {
    const rules = await getCustomRules(redis);
    // Avoid exact duplicates
    const normalized = normalizeText(ruleText);
    if (rules.some(r => normalizeText(r.text) === normalized)) {
        return { rules, added: false, duplicate: true };
    }
    rules.push({ text: ruleText, createdAt: new Date().toISOString() });
    await saveCustomRules(redis, rules);
    return { rules, added: true, duplicate: false };
}

async function deleteAllRules(redis) {
    await saveCustomRules(redis, []);
    return [];
}

async function deleteRuleByIndex(redis, index) {
    const rules = await getCustomRules(redis);
    if (index < 0 || index >= rules.length) return { rules, removed: false };
    const removed = rules.splice(index, 1);
    await saveCustomRules(redis, rules);
    return { rules, removed: removed[0] };
}

function formatRulesForPrompt(rules) {
    if (!rules.length) return '';
    const lines = rules.map((r, i) => `${i + 1}. ${r.text}`);
    return `\nREGLAS PERSONALIZADAS DEL USUARIO (CUMPLIR SIEMPRE, MÁXIMA PRIORIDAD):\n${lines.join('\n')}\n`;
}

function formatRulesListForReply(rules) {
    if (!rules.length) return '📋 No tienes reglas personalizadas guardadas. Puedes decirme cosas como:\n• "Nunca uses asteriscos"\n• "Siempre háblame como dios Oscar"\n• "A partir de ahora usa negritas para los números"';
    const lines = rules.map((r, i) => `${i + 1}. ${r.text}`);
    return `📋 Tus reglas personalizadas:\n${lines.join('\n')}\n\nPara borrar una regla di: "borra la regla #N"\nPara borrar todas: "borra las reglas"`;
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
        
        // List rules
        if (isListRulesMessage(question)) {
            const rules = await getCustomRules(redis);
            return res.status(200).json({
                success: true,
                reply: formatRulesListForReply(rules),
                model: 'system',
                skill: 'custom_rules'
            });
        }

        // Delete all rules
        if (isDeleteAllMessage(question)) {
            await deleteAllRules(redis);
            return res.status(200).json({
                success: true,
                reply: '🗑️ Listo, borré todas tus reglas personalizadas. Empezamos de cero ✨',
                model: 'system',
                skill: 'custom_rules'
            });
        }

        // Delete one rule by number
        if (isDeleteOneMessage(question)) {
            const numMatch = question.match(/#?(\d+)/);
            if (numMatch) {
                const idx = parseInt(numMatch[1]) - 1;
                const { rules, removed } = await deleteRuleByIndex(redis, idx);
                if (removed) {
                    return res.status(200).json({
                        success: true,
                        reply: `🗑️ Regla eliminada: "${removed.text}"\n\n${formatRulesListForReply(rules)}`,
                        model: 'system',
                        skill: 'custom_rules'
                    });
                }
            }
            const rules = await getCustomRules(redis);
            return res.status(200).json({
                success: true,
                reply: `No encontré esa regla. ${formatRulesListForReply(rules)}`,
                model: 'system',
                skill: 'custom_rules'
            });
        }

        // Detect and save new rule
        let ruleAdded = false;
        if (isRuleMessage(question)) {
            const result = await addCustomRule(redis, question);
            ruleAdded = true;
            if (result.duplicate) {
                return res.status(200).json({
                    success: true,
                    reply: '👌 Ya tengo esa regla guardada, no te preocupes ✨',
                    model: 'system',
                    skill: 'custom_rules'
                });
            }
        }

        // ─── Build system prompt with custom rules ────────────────────────

        const customRules = await getCustomRules(redis);
        const customRulesText = formatRulesForPrompt(customRules);

        const snapshot = await getCandidateKnowledgeSnapshot();
        const compactStats = formatCompactSnapshot(snapshot);
        
        // Pass context from the last few messages for cross-referenced questions
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

INSTRUCCIONES FINALES:
- Responde como copiloto operativo interno, no como bot externo para candidatos.
- Eres capaz de responder sobre cómo funciona la plataforma Y sobre las estadísticas reales de candidatos.
- Si el usuario pregunta "cuántos", "cuántas", o hace preguntas de conteo cruzado y hay una "BÚSQUEDA ESPECÍFICA", usa el "Total coincidencias" de esa búsqueda como la respuesta matemática.
- Si te preguntan "hoy" o "ayer", usa zona horaria ${snapshot.timezone}.
- No inventes métricas, candidatos, ni campañas. Usa SOLO los datos proporcionados.
- Mantén respuestas breves y ejecutivas salvo que el usuario pida detalle.
- Las REGLAS PERSONALIZADAS del usuario tienen MÁXIMA PRIORIDAD sobre cualquier otra instrucción.
`;

        // If a rule was just added, tell GPT to acknowledge it naturally
        const userContent = ruleAdded
            ? `[SISTEMA: El usuario acaba de guardar una nueva regla personalizada. Confirma brevemente que la entendiste y que la aplicarás siempre. La regla fue: "${question}"]\n\n${question}`
            : question;

        const result = await getOpenAIResponse(
            [...history, { role: 'user', content: userContent }],
            systemPrompt,
            model,
            null,
            null,
            null,
            1200
        );

        return res.status(200).json({
            success: true,
            reply: result.content,
            model: result.model,
            skill: ruleAdded ? 'custom_rules' : 'unified_omni_knowledge'
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
