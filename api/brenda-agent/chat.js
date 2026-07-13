import {
    requireSuperAdmin,
    getAnthropicClient,
    hasAnthropicKey,
    loadSkill,
    assembleSystemPrompt,
    AGENT_MODEL
} from '../utils/brenda-agent.js';

// ════════════════════════════════════════════════════════════════════════════
// AGENTE NATIVO DE ANTHROPIC (Claude) — endpoint de conversación.
//
// Usa el SDK oficial @anthropic-ai/sdk con client.messages.create, modelo
// claude-opus-4-8, adaptive thinking, y un LOOP MANUAL DE TOOL USE:
//   - System prompt = brenda-recruiter-base + skill del reclutador (estilo).
//   - Herramienta `consultar_vacante` = devuelve los hechos del skill del cliente
//     (progressive disclosure: el modelo la llama solo cuando necesita datos).
//
// Body: { message, history: [{role, content}], recruiter: "recruiter-oscar",
//         client: "client-katcon" }
//
// Requiere ANTHROPIC_API_KEY en el entorno. Sin ella responde un aviso claro
// (200) para que la UI lo muestre sin romperse.
// ════════════════════════════════════════════════════════════════════════════

const MAX_INPUT = 1500;
const MAX_HISTORY = 10;
const MAX_TOKENS = 3000;   // respuestas de WhatsApp son cortas; deja aire para thinking
const MAX_TOOL_LOOPS = 5;  // tope de seguridad del loop agéntico

function sanitize(v, max) {
    return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
        .slice(-MAX_HISTORY)
        .map((m) => {
            const role = m?.role === 'assistant' ? 'assistant' : 'user';
            const content = sanitize(m?.content, 800);
            return content ? { role, content } : null;
        })
        .filter(Boolean);
}

// Extrae el texto final de una respuesta de Claude (ignora bloques thinking/tool_use).
function extractText(content) {
    if (!Array.isArray(content)) return '';
    return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Metodo no permitido' });
    }

    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const message = sanitize(req.body?.message, MAX_INPUT);
    if (!message) return res.status(400).json({ success: false, error: 'Mensaje requerido' });

    // Sin API key: no podemos correr el agente nativo. Aviso claro, no error 500.
    if (!hasAnthropicKey()) {
        return res.status(200).json({
            success: true,
            reply: '⚠️ El agente nativo de Claude aún no está conectado: falta configurar ANTHROPIC_API_KEY en las variables de entorno de Vercel. Una vez agregada, este chat responderá con Claude real.',
            model: 'sin-api-key',
            needsApiKey: true
        });
    }

    const client = getAnthropicClient();

    try {
        const recruiterFolder = req.body?.recruiter || null;
        const clientFolder = req.body?.client || null;

        const system = assembleSystemPrompt(recruiterFolder);
        const clientSkill = clientFolder ? loadSkill(clientFolder) : null;

        // Herramienta nativa de Claude: consultar los hechos cerrados de la vacante.
        // El resultado es el cuerpo del SKILL.md del cliente (los datos reales).
        const tools = [{
            name: 'consultar_vacante',
            description: 'Consulta los hechos cerrados de la vacante del cliente activo: sueldo, turno, descansos, ubicación, beneficios y reglas. Úsala cuando el candidato pregunte por condiciones concretas o cuando necesites un dato para persuadir. Devuelve la ficha oficial de la vacante.',
            input_schema: {
                type: 'object',
                properties: {
                    motivo: { type: 'string', description: 'Qué dato buscas (ej. "sueldo", "horario", "beneficios")' }
                },
                required: []
            }
        }];

        const messages = [...normalizeHistory(req.body?.history), { role: 'user', content: message }];

        let usageTokens = 0;
        let toolCalls = 0;

        // Loop agéntico manual: pedir → si Claude llama la herramienta, resolverla y
        // volver a pedir; terminar cuando Claude deja de llamar herramientas.
        let response = await client.messages.create({
            model: AGENT_MODEL,
            max_tokens: MAX_TOKENS,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'low' }, // chat conversacional: rápido y económico
            system,
            tools,
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
                if (block.name === 'consultar_vacante') {
                    result = clientSkill
                        ? `Ficha de la vacante (${clientSkill.name}):\n\n${clientSkill.body}`
                        : 'No hay una vacante/cliente seleccionado en esta conversación. Dile al candidato que confirmarás los datos y ofrece pasarlo con el equipo.';
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
                output_config: { effort: 'low' },
                system,
                tools,
                messages
            });
            usageTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
        }

        // Claude Fable/Opus pueden devolver stop_reason "refusal" (clasificadores) — manéjalo.
        if (response.stop_reason === 'refusal') {
            return res.status(200).json({ success: true, reply: 'No puedo ayudar con eso en este momento.', model: response.model, usageTokens });
        }

        return res.status(200).json({
            success: true,
            reply: extractText(response.content) || '(sin texto)',
            model: response.model,
            usageTokens,
            toolCalls
        });
    } catch (error) {
        console.error('❌ [BrendaAgent] chat error:', error);
        // Errores típicos: 401 (key inválida), 429 (rate limit), 400 (payload).
        const status = error?.status;
        let msg = 'No pude responder como el agente en este momento.';
        if (status === 401) msg = 'La ANTHROPIC_API_KEY es inválida o fue revocada.';
        else if (status === 429) msg = 'Límite de tasa de Anthropic alcanzado. Intenta de nuevo en unos segundos.';
        return res.status(200).json({ success: true, reply: `⚠️ ${msg}`, model: 'error', error: error.message });
    }
}
