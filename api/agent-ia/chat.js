import {
    requireSuperAdmin,
    getAnthropicClient,
    hasAnthropicKey,
    assembleSystemPrompt,
    setAgentsMd,
    addMemoryProposal,
    getTagCounts,
    getCandidateCounts,
    getCrossedCandidateCounts,
    getDetailedCandidatesList,
    findCandidateByPhone,
    getCandidateChatTranscript,
    proposeQuickReplyBulkSend,
    buildDateKeys,
    getCapturesTotal,
    getCapturesByTag,
    getCapturesByAllTags,
    getActiveCandidates,
    resolveTagName,
    getQuickReplyNames,
    getQuickReplyContent,
    proposeQuickReplyEdit,
    getVacancyNames,
    getVacancyContent,
    proposeVacancyBulkSend,
    getSkills,
    getSkillByName,
    upsertSkill,
    AGENT_MODEL
} from '../utils/agent-ia.js';
import { setAgentLiveState, getAgentLiveState, getLiveQueue, getLiveStats } from '../utils/agent-candidatic.js';
import { getProjectsOverview, getProjectDetail, moveCandidateToProject } from '../utils/agent-crm.js';

// ════════════════════════════════════════════════════════════════════════════
// Agent IA — chat con el agente propio (Claude nativo).
//
// SDK oficial @anthropic-ai/sdk, modelo AGENT_MODEL (hoy claude-haiku-4-5, elegido
// por costo — ver nota en agent-ia.js), SIN thinking (Haiku 4.5 no lo soporta y así
// es más barato), y un LOOP MANUAL de tool use. Herramientas: editar_agents_md,
// proponer_memoria, skills, conteos (candidatos/etiquetas/altas), candidatos_activos.
//
// Body: { message, history: [{role, content}] }
// Requiere ANTHROPIC_API_KEY. Sin ella responde un aviso claro (200).
// ════════════════════════════════════════════════════════════════════════════

const MAX_INPUT = 4000;
const MAX_HISTORY = 6; // menos historial reenviado = menos tokens de entrada por acción
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
        description: 'Consulta y filtra candidatos por estado (completos/incompletos), etiqueta (ej. "Yageo", "Metalsa") y/o no leídos (burbujas sin responder). Permite consultas cruzadas (ej. "cuántos completos con etiqueta Yageo están no leídos"). Lectura BARATA de intersecciones de Sets en Redis (SINTER O(N)); no escanea ni gasta tokens.',
        input_schema: {
            type: 'object',
            properties: {
                etiqueta: { type: 'string', description: 'Nombre o parte del nombre de la etiqueta (opcional, ej. "Yageo", "Metalsa").' },
                estado: { type: 'string', enum: ['completos', 'incompletos', 'todos'], description: 'Filtrar por perfil completo o incompleto (opcional).' },
                no_leidos: { type: 'boolean', description: 'Si es true, sólo cuenta los que tienen mensajes no leídos (burbujas sin responder por el reclutador).' }
            },
            required: []
        }
    },
    {
        name: 'contar_etiquetas',
        description: 'Las etiquetas de Candidatic CON su cantidad de candidatos (y cuántos sin etiqueta). También sirve para saber qué etiquetas existen. Lectura BARATA de contadores; no inventes nombres ni números.',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'contar_altas',
        description: 'Cuántos candidatos LLEGARON (altas nuevas) en una fecha o rango. Lectura BARATA de contadores diarios; no escanea. Rango por defecto: hoy.',
        input_schema: {
            type: 'object',
            properties: {
                rango: { type: 'string', enum: ['hoy', 'ayer', 'semana', 'mes'], description: 'Atajo de rango. Por defecto "hoy".' },
                desde: { type: 'string', description: 'Fecha inicio explícita YYYY-MM-DD (opcional).' },
                hasta: { type: 'string', description: 'Fecha fin explícita YYYY-MM-DD (opcional).' }
            },
            required: []
        }
    },
    {
        name: 'contar_altas_etiqueta',
        description: 'Cuántos candidatos llegaron en una fecha o rango, desglosado por etiqueta (ej. "cuántos de Yageo llegaron hoy", o "desglósame las altas de hoy por etiqueta"). Si mandas `etiqueta`, da el total de esa etiqueta. Si la OMITES, da el desglose de TODAS las etiquetas en una sola llamada — úsala así para "por etiqueta" sin nombrar una en específico, en vez de llamar esta tool una vez por cada etiqueta. Lectura BARATA. El conteo por etiqueta y día se registra desde que se activó la función, así que fechas muy anteriores pueden salir en 0.',
        input_schema: {
            type: 'object',
            properties: {
                etiqueta: { type: 'string', description: 'Nombre de la etiqueta (ej. "Yageo" o "Anuncio Yageo"). Opcional: si se omite, responde el desglose de todas las etiquetas.' },
                rango: { type: 'string', enum: ['hoy', 'ayer', 'semana', 'mes'], description: 'Atajo de rango. Por defecto "hoy".' },
                desde: { type: 'string', description: 'Fecha inicio explícita YYYY-MM-DD (opcional).' },
                hasta: { type: 'string', description: 'Fecha fin explícita YYYY-MM-DD (opcional).' }
            },
            required: []
        }
    },
    {
        name: 'candidatos_activos',
        description: 'Candidatos ACTIVOS ahora mismo (actividad reciente) y cuántos siguen INCOMPLETOS (completándose en vivo), con una muestra de nombres y hace cuánto. Lectura BARATA (ventana acotada). Úsala para "quién se está completando ahorita" o "cuántos están activos".',
        input_schema: {
            type: 'object',
            properties: { minutos: { type: 'number', description: 'Ventana de actividad en minutos (por defecto 30).' } },
            required: []
        }
    },
    {
        name: 'listar_respuestas_banco',
        description: 'Devuelve los nombres reales de las respuestas del Banco de Respuestas (plantillas que los reclutadores mandan a los candidatos). Úsala cuando el usuario pregunte qué respuestas de banco hay o sus nombres. Solo lectura.',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'leer_respuesta_banco',
        description: 'Abre el CONTENIDO completo de una respuesta del Banco de Respuestas por su nombre (ej. "Punto Yageo"): su texto exacto, tipo, cuántas imágenes tiene, si lleva ubicación (maps) o audio. Solo lectura. Úsala cuando el usuario pregunte qué dice una respuesta o antes de proponer editarla.',
        input_schema: {
            type: 'object',
            properties: {
                nombre: { type: 'string', description: 'Nombre (o parte) de la respuesta del banco, ej. "Punto Yageo".' }
            },
            required: ['nombre']
        }
    },
    {
        name: 'proponer_edicion_banco',
        description: 'Propón editar el TEXTO de una respuesta del Banco de Respuestas. NO guarda de inmediato: genera una tarjeta de aprobación en el chat con el antes/después y botones Aprobar / Descartar; el usuario decide ahí. Manda el texto COMPLETO ya editado (reemplaza todo el texto actual). Solo edita el texto — no imágenes, ubicación ni audio. Lee primero con leer_respuesta_banco.',
        input_schema: {
            type: 'object',
            properties: {
                nombre: { type: 'string', description: 'Nombre (o parte) de la respuesta del banco a editar, ej. "Punto Yageo".' },
                nuevo_mensaje: { type: 'string', description: 'El texto COMPLETO ya editado que reemplazará al actual. Conserva las variables como {{nombre}} si aplican.' }
            },
            required: ['nombre', 'nuevo_mensaje']
        }
    },
    {
        name: 'listar_proyectos',
        description: 'Devuelve TODOS los proyectos del CRM con sus pasos y cuántos candidatos hay en cada paso. Solo lectura. Úsala cuando el usuario pregunte qué proyectos/pasos hay.',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'ver_proyecto',
        description: 'Abre el detalle de UN proyecto del CRM por su nombre: cada paso con los NOMBRES de los candidatos que están dentro. Solo lectura. Úsala cuando el usuario pregunte quién está en un proyecto o en un paso.',
        input_schema: {
            type: 'object',
            properties: {
                nombre: { type: 'string', description: 'Nombre (o parte) del proyecto, ej. "Yageo".' }
            },
            required: ['nombre']
        }
    },
    {
        name: 'mover_candidato_crm',
        description: 'Mete/mueve a UN candidato (por su teléfono) a un proyecto y a un paso del CRM (ej. proyecto "Yageo", paso "Cita"). Si el candidato ya estaba en otro proyecto, se cambia a este (un candidato vive en un solo proyecto). Si no indicas paso, cae en el primer paso del proyecto. Es una acción directa (se aplica al momento y el tablero CRM se actualiza en vivo).',
        input_schema: {
            type: 'object',
            properties: {
                telefono: { type: 'string', description: 'Teléfono del candidato (ej. "8116038195").' },
                proyecto: { type: 'string', description: 'Nombre (o parte) del proyecto, ej. "Yageo".' },
                paso: { type: 'string', description: 'Nombre (o parte) del paso, ej. "Cita" (opcional; por defecto el primer paso).' }
            },
            required: ['telefono', 'proyecto']
        }
    },
    {
        name: 'prender_agent_candidatic',
        description: 'Prende el modo de atención automática en vivo ("Agent Candidatic") para una o varias etiquetas. Úsala cuando el usuario diga cosas como "me voy a comer, atiende a los de Yageo San Nicolás" o "prende el agente para la etiqueta X". Se activa el toggle del panel y, de ahí en adelante, los candidatos que se completen de esas etiquetas entran a la cola de atención. Requiere al menos una etiqueta.',
        input_schema: {
            type: 'object',
            properties: {
                etiquetas: { type: 'array', items: { type: 'string' }, description: 'Una o más etiquetas a atender (ej. ["Yageo San Nicolás"]).' }
            },
            required: ['etiquetas']
        }
    },
    {
        name: 'apagar_agent_candidatic',
        description: 'Apaga el modo de atención automática en vivo ("Agent Candidatic"). Úsala cuando el usuario diga "ya volví", "apaga el agente", "deja de atender", etc.',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'ver_cola_agent_candidatic',
        description: 'Consulta el estado de "Agent Candidatic": si está prendido o apagado, para qué etiqueta(s), la LISTA de candidatos en la cola con su status (en espera / atendiendo / atendido / duda / error, y si marcó gol ⚽), y sus MÉTRICAS acumuladas (candidatos atendidos, goles, tiempo atendiendo, tiempo despierto). Solo lectura. Úsala cuando pregunten "quién está en la cola", "cómo va el agente en vivo", "cuántos ha atendido" o "cuánto tiempo lleva despierto".',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'listar_vacantes',
        description: 'Devuelve los nombres de las vacantes del "maletín" del Chat Web que tienen info lista para enviar al candidato. Solo lectura. Úsala cuando el usuario pregunte qué vacantes hay.',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'leer_vacante',
        description: 'Abre el contenido de una vacante por su nombre: empresa, categoría y el MENSAJE EXACTO que se le enviaría al candidato. Solo lectura. Úsala cuando el usuario pregunte por una vacante o antes de enviarla.',
        input_schema: {
            type: 'object',
            properties: {
                nombre: { type: 'string', description: 'Nombre (o parte) de la vacante.' }
            },
            required: ['nombre']
        }
    },
    {
        name: 'proponer_envio_vacante',
        description: 'Propón enviar la info de UNA vacante a candidatos. Igual que proponer_envio_banco pero con una vacante. NO envía de inmediato: genera una tarjeta de confirmación en el chat con Confirmar / Cancelar. Para UN candidato pasa su "telefono"; para una LISTA usa filtros (etiqueta/estado/no_leidos).',
        input_schema: {
            type: 'object',
            properties: {
                vacante: { type: 'string', description: 'Nombre (o parte) de la vacante a enviar.' },
                telefono: { type: 'string', description: 'Teléfono de UN candidato para enviarle sólo a él (ej. "8116038195"). Si lo usas, ignora los filtros de lista.' },
                etiqueta: { type: 'string', description: 'Nombre o parte de la etiqueta (ej. "Anuncio Yageo").' },
                estado: { type: 'string', enum: ['completos', 'incompletos', 'todos'], description: 'Filtrar por perfil completo o incompleto (opcional).' },
                no_leidos: { type: 'boolean', description: 'Si es true, sólo los que tienen mensajes no leídos.' },
                limite: { type: 'number', description: 'Máximo de candidatos (por defecto 20, tope 50).' }
            },
            required: ['vacante']
        }
    },
    {
        name: 'listar_candidatos',
        description: 'Devuelve la LISTA detallada (nombre completo y número de WhatsApp) de los candidatos que cumplen los filtros (etiqueta, estado, no leídos), hasta el límite indicado. Úsala cuando el usuario pida VER la lista de candidatos o sus teléfonos (ej. "los 20 completos no leídos con etiqueta Anuncio Yageo"). Lectura BARATA de Sets en Redis; no escanea.',
        input_schema: {
            type: 'object',
            properties: {
                etiqueta: { type: 'string', description: 'Nombre o parte del nombre de la etiqueta (ej. "Yageo", "Anuncio Yageo").' },
                estado: { type: 'string', enum: ['completos', 'incompletos', 'todos'], description: 'Filtrar por perfil completo o incompleto (opcional).' },
                no_leidos: { type: 'boolean', description: 'Si es true, sólo los que tienen mensajes no leídos (sin responder por el reclutador).' },
                limite: { type: 'number', description: 'Máximo de candidatos a listar (por defecto 20, tope 50).' }
            },
            required: []
        }
    },
    {
        name: 'buscar_candidato',
        description: 'Busca UN candidato por su número de teléfono/WhatsApp (ej. "8116038195"). Devuelve su nombre completo, WhatsApp, y datos del perfil (municipio, escolaridad, categoría, edad, colonia, si está completo, etiquetas). Tolera prefijos de México (10 dígitos, 52+10, 521+10). Úsala cuando el usuario pida buscar/ver a un candidato por teléfono.',
        input_schema: {
            type: 'object',
            properties: {
                telefono: { type: 'string', description: 'Número de teléfono/WhatsApp del candidato (ej. "8116038195").' }
            },
            required: ['telefono']
        }
    },
    {
        name: 'leer_chat_candidato',
        description: 'Lee la conversación real de WhatsApp de UN candidato (lo que se han dicho, en orden, con quién habló: Brenda, el reclutador o el candidato). Úsala cuando el usuario pida ver/revisar qué le dijo un candidato, resumir una conversación, o antes de decidir qué responderle. Tolera prefijos de México igual que buscar_candidato.',
        input_schema: {
            type: 'object',
            properties: {
                telefono: { type: 'string', description: 'Número de teléfono/WhatsApp del candidato (ej. "8116038195").' },
                limite: { type: 'number', description: 'Máximo de mensajes recientes a traer (por defecto 40, tope 100).' }
            },
            required: ['telefono']
        }
    },
    {
        name: 'proponer_envio_banco',
        description: 'Propón enviar un mensaje del Banco de Respuestas (ej. "Punto Yageo") a candidatos. NO envía de inmediato: genera una tarjeta de confirmación en el chat con botones Confirmar Envíos / Cancelar, y el usuario decide ahí. Úsala cuando el usuario pida enviar/mandar un mensaje del banco. Para enviar a UN solo candidato, pasa su "telefono" (ej. tras buscarlo). Para enviar a una LISTA, usa los MISMOS filtros (etiqueta/estado/no_leidos) con los que la listaste.',
        input_schema: {
            type: 'object',
            properties: {
                respuesta_banco: { type: 'string', description: 'Nombre de la respuesta del Banco de Respuestas a enviar (ej. "Punto Yageo").' },
                telefono: { type: 'string', description: 'Teléfono de UN candidato para enviarle sólo a él (ej. "8116038195"). Si lo usas, ignora los filtros de lista.' },
                etiqueta: { type: 'string', description: 'Nombre o parte del nombre de la etiqueta (ej. "Anuncio Yageo").' },
                estado: { type: 'string', enum: ['completos', 'incompletos', 'todos'], description: 'Filtrar por perfil completo o incompleto (opcional).' },
                no_leidos: { type: 'boolean', description: 'Si es true, sólo los que tienen mensajes no leídos.' },
                limite: { type: 'number', description: 'Máximo de candidatos (por defecto 20, tope 50).' }
            },
            required: ['respuesta_banco']
        }
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
        // Caché de prompts: AGENTS.md + MEMORY.md + skills + la descripción de las
        // ~20 tools (bloque "HERRAMIENTAS") es idéntico en casi todos los turnos y
        // entre distintos SuperAdmins — solo cambia cuando alguien edita AGENTS.md,
        // aprueba una memoria, o crea/edita una skill. El breakpoint va en el ÚLTIMO
        // bloque de system: cachea TOOLS + system juntos (tools se renderiza antes
        // que system, y el prefijo cacheado cubre todo lo anterior al breakpoint).
        const systemBlocks = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
        const messages = [...normalizeHistory(req.body?.history), { role: 'user', content: message }];

        let agentsUpdated = false;      // el agente editó AGENTS.md este turno
        let skillsUpdated = false;      // el agente creó/editó una skill este turno
        let bulkProposal = null;        // propuesta de envío masivo de este turno (tarjeta de confirmación)
        let bankEditProposal = null;    // propuesta de edición de una respuesta del banco (tarjeta antes/después)
        let agentLiveUpdated = false;   // el agente prendió/apagó Agent Candidatic este turno (refresca el panel)
        const memoryProposals = [];     // propuestas de memoria de este turno: {id, text}
        let usageTokens = 0;
        let usageCacheRead = 0;
        let usageCacheCreation = 0;
        let toolCalls = 0;

        let response = await client.messages.create({
            model: AGENT_MODEL,
            max_tokens: MAX_TOKENS,
            // Sin thinking ni output_config: Haiku 4.5 no los soporta, y omitir el
            // razonamiento abarata cada acción (menos tokens de salida).
            system: systemBlocks,
            tools: TOOLS,
            messages
        });
        usageTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
        usageCacheRead += response.usage?.cache_read_input_tokens || 0;
        usageCacheCreation += response.usage?.cache_creation_input_tokens || 0;

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
                    const input = block.input || {};
                    if (input.etiqueta || input.estado || input.no_leidos != null) {
                        const c = await getCrossedCandidateCounts({
                            etiqueta: input.etiqueta,
                            estado: input.estado,
                            noLeidos: input.no_leidos
                        });
                        if (!c) {
                            result = 'No pude leer la consulta cruzada de candidatos en este momento.';
                        } else if (c.error) {
                            result = c.error;
                        } else {
                            const filtersStr = [
                                c.tag ? `Etiqueta: "${c.tag}"` : null,
                                c.estadoFilter !== 'todos' ? `Estado: ${c.estadoFilter}` : null,
                                c.noLeidosFilter ? 'No leídos (sin responder): sí' : null
                            ].filter(Boolean).join(', ') || 'Sin filtros';
                            const sampleStr = c.sample && c.sample.length
                                ? ` Muestra: ${c.sample.join(', ')}.`
                                : '';
                            result = `Candidatos encontrados: ${c.count} (${filtersStr}).${sampleStr}`;
                        }
                    } else {
                        const c = await getCandidateCounts();
                        result = c
                            ? `Candidatos totales: ${c.complete} completos, ${c.incomplete} incompletos, ${c.unread} con mensajes no leídos (listos para responder) (total ${c.total}).`
                            : 'No pude leer el conteo de candidatos en este momento.';
                    }
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
                } else if (block.name === 'contar_altas') {
                    const { keys, label } = buildDateKeys(block.input || {});
                    const total = await getCapturesTotal(keys);
                    result = `Candidatos que llegaron ${label}: ${total}.`;
                } else if (block.name === 'contar_altas_etiqueta') {
                    const { keys, label } = buildDateKeys(block.input || {});
                    if (!block.input?.etiqueta) {
                        const breakdown = await getCapturesByAllTags(keys);
                        if (!breakdown.length) {
                            result = 'No hay etiquetas configuradas en Candidatic.';
                        } else {
                            const lines = breakdown.map((t) => `- ${t.name}: ${t.total}`);
                            result = `Altas ${label} por etiqueta:\n${lines.join('\n')}\n(Nota: el conteo por etiqueta y día se registra desde que se activó esta función; fechas muy anteriores pueden salir en 0.)`;
                        }
                    } else {
                        const canonical = await resolveTagName(block.input.etiqueta);
                        if (!canonical) {
                            result = `No encontré una etiqueta que coincida con "${block.input.etiqueta}". Usa contar_etiquetas para ver los nombres reales.`;
                        } else {
                            const total = await getCapturesByTag(canonical, keys);
                            result = `Candidatos con la etiqueta "${canonical}" que llegaron ${label}: ${total}. (Nota: el conteo por etiqueta y día se registra desde que se activó esta función; fechas muy anteriores pueden salir en 0.)`;
                        }
                    }
                } else if (block.name === 'candidatos_activos') {
                    const mins = Math.min(180, Math.max(1, Number(block.input?.minutos) || 30));
                    const data = await getActiveCandidates(mins);
                    if (!data) {
                        result = 'No pude leer la actividad en vivo en este momento.';
                    } else {
                        const lines = data.sample.map((s) => `- ${s.name} (hace ${s.minsAgo} min)`);
                        result = `En los últimos ${data.windowMinutes} min: ${data.totalActive} candidatos activos, ${data.incompleteActive} de ellos aún incompletos (completándose en vivo).`
                            + (lines.length ? `\nAlgunos completándose ahora:\n${lines.join('\n')}` : '');
                    }
                } else if (block.name === 'listar_respuestas_banco') {
                    const names = await getQuickReplyNames();
                    result = names.length
                        ? `Respuestas del Banco de Respuestas (${names.length}):\n${names.map((n) => `- ${n}`).join('\n')}`
                        : 'No hay respuestas guardadas en el Banco de Respuestas.';
                } else if (block.name === 'leer_respuesta_banco') {
                    const data = await getQuickReplyContent(block.input?.nombre || '');
                    result = data
                        ? `Contenido de la respuesta del banco:\n${data.summary}`
                        : `No encontré la respuesta de banco "${block.input?.nombre || ''}". Usa listar_respuestas_banco para ver los nombres reales.`;
                } else if (block.name === 'proponer_edicion_banco') {
                    const r = await proposeQuickReplyEdit({
                        nombre: block.input?.nombre,
                        nuevo_mensaje: block.input?.nuevo_mensaje
                    });
                    if (r.error) {
                        result = r.error;
                    } else {
                        bankEditProposal = r.proposal; // la UI pinta la tarjeta antes/después
                        result = `Propuesta de edición creada para "${r.proposal.name}". En el chat le apareció al usuario una tarjeta con el antes/después y botones Aprobar / Descartar. PREGÚNTALE explícitamente si quiere aplicar el cambio. NO afirmes que ya quedó guardado — queda pendiente hasta que el usuario apruebe en la tarjeta.`;
                    }
                } else if (block.name === 'listar_proyectos') {
                    const projects = await getProjectsOverview();
                    if (!projects.length) {
                        result = 'No hay proyectos en el CRM.';
                    } else {
                        const lines = projects.map((p) => {
                            const pasos = p.steps.map((s) => `${s.name}: ${s.count}`).join(' · ') || '(sin pasos)';
                            return `- ${p.name} (${p.total} candidatos) → ${pasos}`;
                        });
                        result = `Proyectos del CRM (${projects.length}):\n${lines.join('\n')}`;
                    }
                } else if (block.name === 'ver_proyecto') {
                    const detail = await getProjectDetail(block.input?.nombre || '');
                    if (!detail) {
                        result = `No encontré un proyecto llamado "${block.input?.nombre || ''}". Usa listar_proyectos para ver los reales.`;
                    } else {
                        const bloques = detail.steps.map((s) => {
                            const nombres = s.candidates.length ? s.candidates.map((n) => `   • ${n}`).join('\n') : '   (vacío)';
                            return `${s.name} (${s.candidates.length}):\n${nombres}`;
                        });
                        result = `Proyecto "${detail.name}" — ${detail.total} candidatos:\n${bloques.join('\n')}`;
                    }
                } else if (block.name === 'mover_candidato_crm') {
                    const r = await moveCandidateToProject({
                        telefono: block.input?.telefono,
                        proyecto: block.input?.proyecto,
                        paso: block.input?.paso
                    });
                    if (r.error) {
                        result = r.error;
                    } else {
                        const quien = r.candidateName || 'El candidato';
                        const extra = r.removedFromOthers ? ' (se sacó de su proyecto anterior)' : '';
                        result = `Listo: ${quien} quedó en el proyecto "${r.projectName}", paso "${r.stepName}"${extra}. El tablero CRM se actualizó en vivo.`;
                    }
                } else if (block.name === 'prender_agent_candidatic') {
                    const r = await setAgentLiveState({ on: true, tags: block.input?.etiquetas });
                    if (r.error) {
                        result = r.error;
                    } else {
                        agentLiveUpdated = true;
                        result = `Agent Candidatic PRENDIDO para: ${r.state.tags.join(', ')}. El toggle del panel se activó. De ahora en adelante, los candidatos que se completen de esas etiquetas entran a la cola y el motor los atiende automáticamente según su skill (o pregunta si no sabe qué hacer). No es retroactivo: candidatos que ya estaban completos ANTES de este momento no entran.`;
                    }
                } else if (block.name === 'apagar_agent_candidatic') {
                    const r = await setAgentLiveState({ on: false });
                    if (r.error) {
                        result = r.error;
                    } else {
                        agentLiveUpdated = true;
                        result = 'Agent Candidatic APAGADO. El toggle del panel se desactivó y ya no se atiende ninguna etiqueta.';
                    }
                } else if (block.name === 'ver_cola_agent_candidatic') {
                    const [state, queue, stats] = await Promise.all([getAgentLiveState(), getLiveQueue(), getLiveStats()]);
                    const estadoStr = state.on
                        ? `PRENDIDO para: ${state.tags.join(', ')} (desde ${new Date(state.since).toLocaleString('es-MX')})`
                        : 'APAGADO';
                    const fmtMin = (ms) => `${Math.round(ms / 60000)}min`;
                    const metricsStr = `Métricas: ${stats.totalAttended} atendidos, ${stats.totalGoals} goles, ${fmtMin(stats.totalAttendingMs)} atendiendo, ${fmtMin(stats.totalAwakeMs)} despierto.`;
                    if (!queue.length) {
                        result = `Estado: ${estadoStr}.\n${metricsStr}\nCola: vacía (nadie ha llegado a atender todavía).`;
                    } else {
                        const STATUS_LABEL = { pending: 'en espera', attending: 'atendiendo…', done: 'atendido', waiting: 'duda — revisa el feed', error: 'error' };
                        const lines = queue.slice(0, 40).map((c, i) => `${i + 1}. ${c.name}${c.goal ? ' ⚽' : ''} — ${STATUS_LABEL[c.status] || 'en espera'}${c.note ? ` (${c.note})` : ''}`);
                        const extra = queue.length > 40 ? `\n(mostrando 40 de ${queue.length})` : '';
                        result = `Estado: ${estadoStr}.\n${metricsStr}\nCola (${queue.length}):\n${lines.join('\n')}${extra}`;
                    }
                } else if (block.name === 'listar_vacantes') {
                    const names = await getVacancyNames();
                    result = names.length
                        ? `Vacantes con info para enviar (${names.length}):\n${names.map((n) => `- ${n}`).join('\n')}`
                        : 'No hay vacantes con "info para el bot" configuradas en el maletín.';
                } else if (block.name === 'leer_vacante') {
                    const data = await getVacancyContent(block.input?.nombre || '');
                    result = data
                        ? data.summary
                        : `No encontré una vacante con "info para el bot" llamada "${block.input?.nombre || ''}". Usa listar_vacantes para ver las disponibles.`;
                } else if (block.name === 'proponer_envio_vacante') {
                    const input = block.input || {};
                    let candidatoIds;
                    let telError = null;
                    if (input.telefono) {
                        const found = await findCandidateByPhone(input.telefono);
                        if (found?.error) telError = found.error;
                        else if (found?.notFound) telError = `No encontré ningún candidato con el teléfono ${found.telefono || input.telefono}.`;
                        else candidatoIds = [found.candidate.id];
                    }
                    if (telError) {
                        result = telError;
                    } else {
                        const r = await proposeVacancyBulkSend({
                            vacante: input.vacante,
                            etiqueta: input.etiqueta,
                            estado: input.estado,
                            noLeidos: input.no_leidos,
                            limite: input.limite,
                            candidatoIds
                        });
                        if (r.error) {
                            result = r.error;
                        } else {
                            bulkProposal = r.proposal;
                            const cuantos = r.proposal.candidateCount === 1 ? '1 candidato' : `${r.proposal.candidateCount} candidatos`;
                            result = `Propuesta de envío de la vacante "${r.proposal.templateName}" a ${cuantos}. En el chat le apareció al usuario una tarjeta con la lista y botones Confirmar Envíos / Cancelar. PREGÚNTALE explícitamente si quiere que se envíe. NO afirmes que ya se envió — queda pendiente hasta que el usuario confirme en la tarjeta.`;
                        }
                    }
                } else if (block.name === 'listar_candidatos') {
                    const input = block.input || {};
                    const data = await getDetailedCandidatesList({
                        etiqueta: input.etiqueta,
                        estado: input.estado,
                        noLeidos: input.no_leidos,
                        limite: input.limite
                    });
                    if (!data) {
                        result = 'No pude leer la lista de candidatos en este momento.';
                    } else if (data.error) {
                        result = data.error;
                    } else if (!data.candidates.length) {
                        result = 'No hay candidatos que cumplan esos filtros.';
                    } else {
                        const lines = data.candidates.map((c, idx) => `${idx + 1}. ${c.name} — ${c.phone}`);
                        const extra = data.totalMatches > data.candidates.length
                            ? `\n(Mostrando ${data.candidates.length} de ${data.totalMatches} en total.)`
                            : '';
                        result = `Candidatos (${data.candidates.length}):\n${lines.join('\n')}${extra}`;
                    }
                } else if (block.name === 'buscar_candidato') {
                    const found = await findCandidateByPhone(block.input?.telefono || '');
                    if (found?.error) {
                        result = found.error;
                    } else if (found?.notFound) {
                        result = `No encontré ningún candidato con el teléfono ${found.telefono || block.input?.telefono || ''}.`;
                    } else {
                        const c = found.candidate;
                        const datos = [
                            `Nombre: ${c.name}`,
                            `WhatsApp: ${c.phone}`,
                            c.municipio ? `Municipio: ${c.municipio}` : null,
                            c.colonia ? `Colonia: ${c.colonia}` : null,
                            c.escolaridad ? `Escolaridad: ${c.escolaridad}` : null,
                            c.categoria ? `Categoría: ${c.categoria}` : null,
                            c.edad ? `Edad: ${c.edad}` : null,
                            `Perfil: ${c.completo ? 'completo' : 'incompleto'}`,
                            c.etiquetas.length ? `Etiquetas: ${c.etiquetas.join(', ')}` : null
                        ].filter(Boolean).join('\n');
                        result = `Candidato encontrado:\n${datos}`;
                    }
                } else if (block.name === 'leer_chat_candidato') {
                    const r = await getCandidateChatTranscript(block.input?.telefono || '', block.input?.limite);
                    if (r.error) {
                        result = r.error;
                    } else if (r.transcript === '(sin mensajes)') {
                        result = `${r.candidate.name} (${r.candidate.phone}) todavía no tiene mensajes.`;
                    } else {
                        result = `Conversación con ${r.candidate.name} (${r.candidate.phone}) — ${r.count} mensaje(s):\n\n${r.transcript}`;
                    }
                } else if (block.name === 'proponer_envio_banco') {
                    const input = block.input || {};
                    let candidatoIds;
                    let telError = null;
                    if (input.telefono) {
                        const found = await findCandidateByPhone(input.telefono);
                        if (found?.error) telError = found.error;
                        else if (found?.notFound) telError = `No encontré ningún candidato con el teléfono ${found.telefono || input.telefono}.`;
                        else candidatoIds = [found.candidate.id];
                    }
                    if (telError) {
                        result = telError;
                    } else {
                        const r = await proposeQuickReplyBulkSend({
                            respuesta_banco: input.respuesta_banco,
                            etiqueta: input.etiqueta,
                            estado: input.estado,
                            noLeidos: input.no_leidos,
                            limite: input.limite,
                            candidatoIds
                        });
                        if (r.error) {
                            result = r.error;
                        } else {
                            bulkProposal = r.proposal; // la UI pinta la tarjeta de confirmación con esta propuesta
                            const cuantos = r.proposal.candidateCount === 1 ? '1 candidato' : `${r.proposal.candidateCount} candidatos`;
                            result = `Propuesta de envío creada: "${r.proposal.templateName}" a ${cuantos}. En el chat le apareció al usuario una tarjeta con la lista y botones Confirmar Envíos / Cancelar. PREGÚNTALE explícitamente si quiere que se envíe. NO afirmes que ya se envió — queda pendiente hasta que el usuario confirme en la tarjeta.`;
                        }
                    }
                } else {
                    result = 'Herramienta desconocida.';
                }
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }

            messages.push({ role: 'user', content: toolResults });

            response = await client.messages.create({
                model: AGENT_MODEL,
                max_tokens: MAX_TOKENS,
                // Sin thinking ni output_config (ver arriba): Haiku 4.5 + más barato.
                system: systemBlocks,
                tools: TOOLS,
                messages
            });
            usageTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
            usageCacheRead += response.usage?.cache_read_input_tokens || 0;
            usageCacheCreation += response.usage?.cache_creation_input_tokens || 0;
        }

        if (response.stop_reason === 'refusal') {
            return res.status(200).json({ success: true, reply: 'No puedo ayudar con eso en este momento.', model: response.model, usageTokens, usageCacheRead, usageCacheCreation, agentsUpdated, skillsUpdated, memoryProposals, memoryProposed: memoryProposals.length });
        }

        return res.status(200).json({
            success: true,
            reply: extractText(response.content) || '(sin respuesta)',
            model: response.model,
            usageTokens,
            usageCacheRead,       // tokens servidos desde caché este turno (~0.1x costo) — 0 en el primer mensaje de cada ventana de 5 min
            usageCacheCreation,   // tokens escritos a caché este turno (~1.25x costo, se paga una vez por ventana)
            toolCalls,
            agentsUpdated,                       // la UI refresca AGENTS.md si true
            skillsUpdated,                       // la UI refresca el panel de Skills si true
            bulkProposal,                        // {id, templateName, candidates,...} → tarjeta Confirmar/Cancelar envío
            bankEditProposal,                    // {id, name, before, after} → tarjeta Aprobar/Descartar edición
            agentLiveUpdated,                    // true si el agente prendió/apagó Agent Candidatic → la UI refresca el panel
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
