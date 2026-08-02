import {
    requireSuperAdmin,
    getAnthropicClient,
    hasAnthropicKey,
    assembleSystemPrompt,
    setAgentsMd,
    addMemoryProposal,
    getTagCounts,
    getCandidateCounts,
    getQuickReplyNames,
    getSkills,
    getSkillByName,
    upsertSkill,
    AGENT_MODEL
} from '../utils/agent-ia.js';

// ════════════════════════════════════════════════════════════════════════════
// Agent IA — chat con el agente propio (Claude nativo).
//
// SDK oficial @anthropic-ai/sdk, modelo claude-opus-4-8, adaptive thinking, y un
// LOOP MANUAL de tool use con dos herramientas:
//   - editar_agents_md  → reescribe AGENTS.md (edición en vivo, se refleja en la UI).
//   - proponer_memoria  → agrega una propuesta de memoria (pendiente de aprobación).
//
// Body: { message, history: [{role, content}] }
// Requiere ANTHROPIC_API_KEY. Sin ella responde un aviso claro (200).
// ════════════════════════════════════════════════════════════════════════════

const MAX_INPUT = 4000;
const MAX_HISTORY = 12;
const MAX_TOKENS = 8000;
const MAX_TOOL_LOOPS = 5;

function sanitize(v, max) {
    return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
        .slice(-MAX_HISTORY)
        .map((m) => {
            const role = m?.role === 'assistant' ? 'assistant' : 'user';
            const content = sanitize(m?.content, 2000);
            return content ? { role, content } : null;
        })
        .filter(Boolean);
}

function extractText(content) {
    if (!Array.isArray(content)) return '';
    return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

const TOOLS = [
    {
        name: 'editar_agents_md',
        description: 'Reescribe tu documento de definición (AGENTS.md). Úsala SOLO cuando el usuario te pida cambiar quién eres o cómo te comportas. Debes enviar el documento COMPLETO ya modificado (no un fragmento): lo que mandes reemplaza el AGENTS.md entero.',
        input_schema: {
            type: 'object',
            properties: {
                contenido: { type: 'string', description: 'El AGENTS.md completo, ya con los cambios aplicados.' }
            },
            required: ['contenido']
        }
    },
    {
        name: 'proponer_memoria',
        description: 'Propón un aprendizaje para recordar entre conversaciones (se agrega a MEMORY.md SOLO si el usuario lo aprueba). Úsala cuando descubras algo estable y útil a futuro. Una idea por llamada, redactada en una frase concisa.',
        input_schema: {
            type: 'object',
            properties: {
                aprendizaje: { type: 'string', description: 'El aprendizaje a recordar, en una frase.' }
            },
            required: ['aprendizaje']
        }
    },
    {
        name: 'listar_skills',
        description: 'Devuelve los nombres de las skills de reclutamiento existentes (playbooks por cliente, ej. "Yageo", "Metalsa"). Solo lectura.',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'leer_skill',
        description: 'Abre el contenido completo de una skill de reclutamiento por su nombre (ej. "Yageo"): sus instrucciones, etiqueta, mensaje de banco y respuestas. Úsala antes de usar o editar una skill.',
        input_schema: {
            type: 'object',
            properties: { nombre: { type: 'string', description: 'Nombre de la skill, ej. "Yageo".' } },
            required: ['nombre']
        }
    },
    {
        name: 'guardar_skill',
        description: 'Crea o edita una skill de reclutamiento. Si el nombre ya existe, reemplaza su contenido; si no, la crea. Manda el contenido COMPLETO (markdown) con el playbook del cliente: qué etiqueta usar, qué mensaje del banco, y cómo responder al candidato en cada caso. Usa nombres reales de etiquetas/banco (consúltalos con contar_etiquetas / listar_respuestas_banco).',
        input_schema: {
            type: 'object',
            properties: {
                nombre: { type: 'string', description: 'Nombre de la skill/cliente, ej. "Metalsa".' },
                contenido: { type: 'string', description: 'El playbook completo en markdown.' }
            },
            required: ['nombre', 'contenido']
        }
    },
    {
        name: 'contar_candidatos',
        description: 'Cuántos candidatos hay completos vs incompletos (y el total). Lectura BARATA de contadores de Redis; no escanea ni gasta tokens. Úsala cuando pregunten por esas cantidades.',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'contar_etiquetas',
        description: 'Las etiquetas de Candidatic CON su cantidad de candidatos (y cuántos sin etiqueta). También sirve para saber qué etiquetas existen. Lectura BARATA de contadores; no inventes nombres ni números.',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'listar_respuestas_banco',
        description: 'Devuelve los nombres reales de las respuestas del Banco de Respuestas (plantillas que los reclutadores mandan a los candidatos). Úsala cuando el usuario pregunte qué respuestas de banco hay o sus nombres. Solo lectura.',
        input_schema: { type: 'object', properties: {}, required: [] }
    }
];

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Método no permitido' });
    }

    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const message = sanitize(req.body?.message, MAX_INPUT);
    if (!message) return res.status(400).json({ success: false, error: 'Mensaje requerido' });

    if (!hasAnthropicKey()) {
        return res.status(200).json({
            success: true,
            reply: '⚠️ El agente aún no está conectado: falta configurar ANTHROPIC_API_KEY en las variables de entorno de Vercel. Una vez agregada, este chat responderá con Claude real.',
            model: 'sin-api-key',
            needsApiKey: true
        });
    }

    const client = getAnthropicClient();

    try {
        const system = await assembleSystemPrompt();
        const messages = [...normalizeHistory(req.body?.history), { role: 'user', content: message }];

        let agentsUpdated = false;      // el agente editó AGENTS.md este turno
        let skillsUpdated = false;      // el agente creó/editó una skill este turno
        const memoryProposals = [];     // propuestas de memoria de este turno: {id, text}
        let usageTokens = 0;
        let toolCalls = 0;

        let response = await client.messages.create({
            model: AGENT_MODEL,
            max_tokens: MAX_TOKENS,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            system,
            tools: TOOLS,
            messages
        });
        usageTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

        let loops = 0;
        while (response.stop_reason === 'tool_use' && loops < MAX_TOOL_LOOPS) {
            loops++;
            messages.push({ role: 'assistant', content: response.content });

            const toolResults = [];
            for (const block of response.content) {
                if (block.type !== 'tool_use') continue;
                toolCalls++;
                let result;
                if (block.name === 'editar_agents_md') {
                    const contenido = block.input?.contenido || '';
                    if (contenido.trim()) {
                        await setAgentsMd(contenido);
                        agentsUpdated = true;
                        result = 'AGENTS.md actualizado. El cambio ya quedó guardado y se refleja en el panel del usuario.';
                    } else {
                        result = 'No actualicé nada: el contenido llegó vacío. Manda el documento completo.';
                    }
                } else if (block.name === 'proponer_memoria') {
                    const aprendizaje = block.input?.aprendizaje || '';
                    const proposal = await addMemoryProposal(aprendizaje);
                    if (proposal) {
                        memoryProposals.push({ id: proposal.id, text: proposal.text });
                        result = 'Propuesta registrada. En el chat le apareció al usuario una tarjeta con botones Guardar/Descartar; él decide ahí. PREGÚNTALE explícitamente en tu respuesta si quiere que lo guardes. NO afirmes que ya quedó guardado.';
                    } else {
                        result = 'No pude registrar la propuesta (llegó vacía).';
                    }
                } else if (block.name === 'listar_skills') {
                    const skills = await getSkills();
                    result = skills.length
                        ? `Skills de reclutamiento (${skills.length}): ${skills.map((s) => s.name).join(', ')}`
                        : 'No hay skills de reclutamiento creadas todavía.';
                } else if (block.name === 'leer_skill') {
                    const skill = await getSkillByName(block.input?.nombre || '');
                    result = skill
                        ? `Skill "${skill.name}":\n\n${skill.content || '(sin contenido)'}`
                        : `No encontré una skill llamada "${block.input?.nombre || ''}". Usa listar_skills para ver los nombres.`;
                } else if (block.name === 'guardar_skill') {
                    const r = await upsertSkill(block.input?.nombre, block.input?.contenido);
                    if (r.success) {
                        skillsUpdated = true;
                        result = `Skill "${r.skill.name}" ${r.created ? 'creada' : 'actualizada'}. Ya quedó guardada y se ve en el panel del usuario.`;
                    } else {
                        result = r.error || 'No pude guardar la skill.';
                    }
                } else if (block.name === 'contar_candidatos') {
                    const c = await getCandidateCounts();
                    result = c
                        ? `Candidatos: ${c.complete} completos, ${c.incomplete} incompletos (total ${c.total}).`
                        : 'No pude leer el conteo de candidatos en este momento.';
                } else if (block.name === 'contar_etiquetas') {
                    const data = await getTagCounts();
                    if (!data) {
                        result = 'No pude leer los conteos de etiquetas en este momento.';
                    } else if (!data.tags.length && !data.untagged) {
                        result = 'No hay etiquetas configuradas en Candidatic.';
                    } else {
                        const lines = data.tags.map((t) => `- ${t.name}: ${t.count}`);
                        lines.push(`- (Sin etiqueta): ${data.untagged}`);
                        result = `Etiquetas y su cantidad de candidatos:\n${lines.join('\n')}`;
                    }
                } else if (block.name === 'listar_respuestas_banco') {
                    const names = await getQuickReplyNames();
                    result = names.length
                        ? `Respuestas del Banco de Respuestas (${names.length}):\n${names.map((n) => `- ${n}`).join('\n')}`
                        : 'No hay respuestas guardadas en el Banco de Respuestas.';
                } else {
                    result = 'Herramienta desconocida.';
                }
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }

            messages.push({ role: 'user', content: toolResults });

            response = await client.messages.create({
                model: AGENT_MODEL,
                max_tokens: MAX_TOKENS,
                thinking: { type: 'adaptive' },
                output_config: { effort: 'medium' },
                system,
                tools: TOOLS,
                messages
            });
            usageTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
        }

        if (response.stop_reason === 'refusal') {
            return res.status(200).json({ success: true, reply: 'No puedo ayudar con eso en este momento.', model: response.model, usageTokens, agentsUpdated, skillsUpdated, memoryProposals, memoryProposed: memoryProposals.length });
        }

        return res.status(200).json({
            success: true,
            reply: extractText(response.content) || '(sin respuesta)',
            model: response.model,
            usageTokens,
            toolCalls,
            agentsUpdated,                       // la UI refresca AGENTS.md si true
            skillsUpdated,                       // la UI refresca el panel de Skills si true
            memoryProposals,                     // [{id, text}] → tarjetas Guardar/Descartar en el chat
            memoryProposed: memoryProposals.length // conteo (refresca panel derecho)
        });
    } catch (error) {
        console.error('❌ [AgentIA] chat error:', error);
        const status = error?.status;
        let msg = 'No pude responder en este momento.';
        if (status === 401) msg = 'La ANTHROPIC_API_KEY es inválida o fue revocada.';
        else if (status === 429) msg = 'Límite de tasa de Anthropic alcanzado. Intenta de nuevo en unos segundos.';
        return res.status(200).json({ success: true, reply: `⚠️ ${msg}`, model: 'error', error: error.message });
    }
}
