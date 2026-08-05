/**
 * AGENT ATTEND — motor de atención automática de "Agent Candidatic".
 *
 * Se dispara desde api/ai/agent.js en el MISMO instante en que un candidato pasa a
 * completo y queda encolado (maybeEnqueueForLiveAgent). Claude lee la(s) skill(s) de
 * reclutamiento y decide qué hacer con ESE candidato — reemplaza el mensaje fijo del
 * viejo agent-katcon por una decisión real por caso.
 *
 * ALCANCE DELIBERADO (léase antes de tocar este archivo):
 *   Las skills documentan flujos de VARIOS pasos que dependen de lo que el candidato
 *   responda (ej. "manda la cita → pregunta si va a ir → según conteste, confirma/
 *   resuelve dudas/rechaza → cierra y mueve al CRM"). Esta función SOLO ejecuta los
 *   pasos que NO dependen de una respuesta que todavía no existe (los de "cuando el
 *   candidato acaba de completarse"). Reaccionar a la RESPUESTA del candidato para
 *   continuar el flujo requiere engancharse al webhook de mensajes entrantes — eso
 *   es un motor aparte, no implementado aquí todavía.
 *
 *   Si no hay skill clara para la etiqueta, o la skill no dice qué hacer en el
 *   momento "recién completado", el motor NO improvisa: pide ayuda a Oscar por el
 *   feed (pushLiveFeed → AgentChat) y deja al candidato en estado 'waiting'.
 *
 * Envíos SIN tarjeta de confirmación: prender el toggle de Agent Candidatic para una
 * etiqueta YA ES la autorización (mismo criterio que el viejo agent-katcon, que
 * auto-enviaba en cuanto Oscar prendía su toggle).
 *
 * RIESGO DE SERVERLESS (confirmado en producción, agosto 2026): esta función se llama
 * SIN await desde api/ai/agent.js (fire-and-forget, para no retrasar la respuesta al
 * candidato). Eso significa que corre en la MISMA invocación serverless que procesó el
 * webhook de WhatsApp — y Vercel puede congelar la función en cuanto se manda esa
 * respuesta, sin garantía de que esta promesa termine. Cuando eso pasa, el candidato
 * queda con status 'attending' para siempre. Por eso el guard de abajo NO usa un candado
 * permanente (SADD): usa el status de la cola, para que api/cron/agent-candidatic.js
 * (cada 15 min, mismo patrón que el backstop de agent-katcon) pueda reintentar lo que
 * se quedó a medias — esa corrida del cron NO compite por tiempo con el webhook, así
 * que sí alcanza a terminar.
 */
import { getRedisClient, getCandidateById, updateCandidate } from './storage.js';
import {
    getAnthropicClient,
    hasAnthropicKey,
    AGENT_MODEL,
    getSkills,
    getSkillByName,
    getQuickReplyNames,
    getQuickReplyByName,
    buildBankSendPayload,
    getVacancyNames,
    getVacancyByName,
    vacancyMessageText
} from './agent-ia.js';
import { moveCandidateToProject } from './agent-crm.js';
import { sendMessageBundleTo } from './agent-send.js';
import { pushLiveFeed } from './agent-live-feed.js';
import { updateQueueEntryStatus, getLiveQueue, recordAttended, recordGoal, recordAttendingDuration } from './agent-candidatic.js';

const MAX_TOOL_LOOPS = 5;
const MAX_TOKENS = 1200;
const STALE_ATTENDING_MS = 3 * 60 * 1000; // "attending" más viejo que esto = se quedó a medias, se puede reintentar

function extractText(content) {
    if (!Array.isArray(content)) return '';
    return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function candidateContextBlock(c) {
    return [
        `Nombre: ${c.nombreReal || c.nombre || c.id}`,
        `Teléfono: ${c.whatsapp || '(sin teléfono)'}`,
        c.municipio ? `Municipio: ${c.municipio}` : null,
        c.colonia ? `Colonia: ${c.colonia}` : null,
        c.escolaridad ? `Escolaridad: ${c.escolaridad}` : null,
        c.categoria ? `Categoría: ${c.categoria}` : null,
        c.experiencia ? `Experiencia: ${c.experiencia}` : null
    ].filter(Boolean).join('\n');
}

function buildSystemPrompt({ candidate, tag, skillNames, bankNames, vacancyNames }) {
    return `Eres el motor de atención automática de "Agent Candidatic" en Candidatic. Un candidato ACABA de completar su perfil ahora mismo, con la etiqueta "${tag}". Todavía NO ha respondido nada después de esto (no hay conversación posterior a este evento).

Datos del candidato:
${candidateContextBlock(candidate)}

Skills de reclutamiento disponibles (playbooks): ${skillNames.length ? skillNames.join(', ') : '(ninguna creada todavía)'}
Respuestas del banco disponibles: ${bankNames.length ? bankNames.join(', ') : '(ninguna)'}
Vacantes disponibles: ${vacancyNames.length ? vacancyNames.join(', ') : '(ninguna)'}

Tu tarea, en este orden:
1. Busca (con leer_skill) la skill que corresponda a la etiqueta "${tag}". El nombre de la skill no siempre es idéntico al de la etiqueta — usa tu criterio (ej. la etiqueta "YAGEO SAN NICOLAS ANUNCIO" corresponde a una skill llamada algo como "Yageo San Nicolas").
2. Si encuentras una skill clara: ejecuta SOLO las acciones que la skill indica para el momento "el candidato acaba de completarse" — es decir, las que NO dependen de una respuesta del candidato que todavía no existe. Normalmente es mandar uno o dos mensajes del banco (en el orden que diga la skill).
   - NO inventes ni asumas una respuesta del candidato.
   - NO ejecutes pasos que la skill condiciona a "si confirma / si pregunta / si rechaza" — eso depende de una respuesta que aún no llega. Detente ahí.
   - Si la skill indica mover al candidato de proyecto/paso en el CRM en ESTE momento (no condicionado a una respuesta futura), hazlo con mover_candidato_crm.
3. Si NO hay ninguna skill para esta etiqueta, o la skill no dice qué hacer en el momento "recién completado" (todo está condicionado a una respuesta futura), NO mandes nada al azar: usa pedir_ayuda para preguntarle a Oscar qué hacer, explicando la situación en una frase clara.
4. EVALÚA SI MARCASTE GOL: cada skill tiene un objetivo real (busca algo como "Objetivo Principal" en su texto — ej. "confirmar la asistencia del candidato a la entrevista", no solo "mandarle un mensaje"). Si lo que acabas de hacer YA cumple ese objetivo, usa marcar_gol. Si solo diste un paso intermedio (ej. mandaste la invitación pero el objetivo depende de que el candidato conteste algo que todavía no existe), NO marques gol — es lo normal en la mayoría de los casos en este momento, no te fuerces a marcar uno.
5. Al terminar (hayas actuado, marcado gol o pedido ayuda), responde con un resumen MUY breve (1-2 frases, en español, tono directo) de lo que hiciste o de tu duda — ese texto se le muestra a Oscar en su chat tal cual.

No hay tarjeta de confirmación aquí: si usas enviar_banco_ahora, enviar_vacante_ahora o mover_candidato_crm, la acción se ejecuta al instante (prender Agent Candidatic para esta etiqueta ya fue la autorización de Oscar).`;
}

const ATTEND_TOOLS = [
    {
        name: 'leer_skill',
        description: 'Abre el contenido completo de una skill de reclutamiento por su nombre.',
        input_schema: { type: 'object', properties: { nombre: { type: 'string' } }, required: ['nombre'] }
    },
    {
        name: 'enviar_banco_ahora',
        description: 'Envía YA (sin confirmación, ya autorizado) una respuesta del Banco de Respuestas a ESTE candidato.',
        input_schema: { type: 'object', properties: { nombre: { type: 'string', description: 'Nombre de la respuesta del banco.' } }, required: ['nombre'] }
    },
    {
        name: 'enviar_vacante_ahora',
        description: 'Envía YA (sin confirmación) la info de una vacante a ESTE candidato.',
        input_schema: { type: 'object', properties: { nombre: { type: 'string', description: 'Nombre de la vacante.' } }, required: ['nombre'] }
    },
    {
        name: 'mover_candidato_crm',
        description: 'Mete/mueve a ESTE candidato a un proyecto y paso del CRM, SOLO si la skill lo indica para este momento (no condicionado a una respuesta futura).',
        input_schema: {
            type: 'object',
            properties: {
                proyecto: { type: 'string' },
                paso: { type: 'string', description: 'Opcional; por defecto el primer paso.' }
            },
            required: ['proyecto']
        }
    },
    {
        name: 'pedir_ayuda',
        description: 'No hay skill clara o no sabes qué hacer: pregúntale a Oscar en vez de improvisar. NO manda nada al candidato.',
        input_schema: { type: 'object', properties: { pregunta: { type: 'string', description: 'Tu duda, en una frase clara.' } }, required: ['pregunta'] }
    },
    {
        name: 'marcar_gol',
        description: 'Marca que CUMPLISTE el objetivo real de la skill para este candidato (no solo "mandé un mensaje" — el objetivo de verdad, ej. "confirmó su asistencia"). Úsala SOLO cuando de verdad se cumplió en este momento; la mayoría de las veces todavía no aplica porque el objetivo depende de una respuesta futura del candidato. No la uses "por cumplir" — si tienes duda, no la marques.',
        input_schema: { type: 'object', properties: { razon: { type: 'string', description: 'En una frase: qué objetivo se cumplió y por qué.' } }, required: ['razon'] }
    }
];

async function sendBankReplyNow(candidate, nombre) {
    const qr = await getQuickReplyByName(nombre);
    if (!qr) return { ok: false, error: `no encontré la respuesta de banco "${nombre}"` };
    const built = buildBankSendPayload(qr, nombre);
    if (built.error) return { ok: false, error: built.error };
    const r = await sendMessageBundleTo(candidate, { templateName: qr.name, ...built.payload }, { agent: 'agent-candidatic', auto: true });
    return { ok: r.ok, sentCount: r.sentCount, error: r.error, name: qr.name || nombre };
}

async function sendVacancyReplyNow(candidate, nombre) {
    const v = await getVacancyByName(nombre);
    if (!v) return { ok: false, error: `no encontré la vacante "${nombre}"` };
    const r = await sendMessageBundleTo(candidate, { templateType: 'text', messageText: vacancyMessageText(v) }, { agent: 'agent-candidatic', auto: true });
    return { ok: r.ok, sentCount: r.sentCount, error: r.error, name: v.name || nombre };
}

// Se llama fire-and-forget desde el extractor justo después de encolar. NUNCA lanza
// (todo error se traga) — no debe poder romper ni retrasar el flujo de Brenda.
export async function attendLiveCandidate(candidateId, tag) {
    const redis = getRedisClient();
    if (!redis || !hasAnthropicKey()) return;

    // Guard basado en el status de la cola (no un candado permanente): solo procesa si
    // sigue 'pending' (nunca arrancó) o quedó 'attending' colgado (la llamada anterior
    // se cortó — típicamente porque Vercel congeló la función justo después de responder
    // el webhook de WhatsApp, ya que esta llamada corre sin await). Esto es lo que permite
    // que el CRON de respaldo (api/cron/agent-candidatic.js) reintente lo que se atoró.
    // 'done' / 'waiting' / 'error' son terminales — no se reintentan solos.
    const queueBefore = await getLiveQueue();
    const entryBefore = queueBefore.find((q) => q.id === candidateId);
    if (!entryBefore) return; // ya no está en la cola (se limpió, o se re-prendió el toggle)
    const staleAttending = entryBefore.status === 'attending'
        && (Date.now() - new Date(entryBefore.updatedAt || entryBefore.completedAt).getTime()) > STALE_ATTENDING_MS;
    if (entryBefore.status !== 'pending' && !staleAttending) return;

    await updateQueueEntryStatus(candidateId, { status: 'attending' });
    const startedAt = Date.now(); // para "tiempo atendiendo" acumulado (métrica), no confundir con completedAt

    let candidate = null;
    try {
        candidate = await getCandidateById(candidateId);
        if (!candidate) {
            await updateQueueEntryStatus(candidateId, { status: 'error', note: 'candidato no encontrado' });
            return;
        }

        const [skills, bankNames, vacancyNames] = await Promise.all([getSkills(), getQuickReplyNames(), getVacancyNames()]);
        const candidateName = candidate.nombreReal || candidate.nombre || candidateId;

        const client = getAnthropicClient();
        const system = buildSystemPrompt({ candidate, tag, skillNames: skills.map((s) => s.name), bankNames, vacancyNames });
        let messages = [{ role: 'user', content: 'Atiende a este candidato según corresponda. Sigue las instrucciones del sistema al pie de la letra.' }];

        let response = await client.messages.create({ model: AGENT_MODEL, max_tokens: MAX_TOKENS, system, tools: ATTEND_TOOLS, messages });
        let loops = 0;
        let actedSomething = false;
        let askedHelp = false;
        let helpQuestion = '';
        let goalMarked = false;
        let goalReason = '';

        while (response.stop_reason === 'tool_use' && loops < MAX_TOOL_LOOPS) {
            loops++;
            messages.push({ role: 'assistant', content: response.content });
            const toolResults = [];

            for (const block of response.content) {
                if (block.type !== 'tool_use') continue;
                let result;
                if (block.name === 'leer_skill') {
                    const skill = await getSkillByName(block.input?.nombre || '');
                    result = skill ? `Skill "${skill.name}":\n\n${skill.content || '(sin contenido)'}` : `No encontré una skill llamada "${block.input?.nombre || ''}".`;
                } else if (block.name === 'enviar_banco_ahora') {
                    const r = await sendBankReplyNow(candidate, block.input?.nombre || '');
                    if (r.ok) { actedSomething = true; result = `Enviado "${r.name}" (${r.sentCount} mensaje(s)).`; }
                    else result = `No se pudo enviar: ${r.error}`;
                } else if (block.name === 'enviar_vacante_ahora') {
                    const r = await sendVacancyReplyNow(candidate, block.input?.nombre || '');
                    if (r.ok) { actedSomething = true; result = `Enviada vacante "${r.name}" (${r.sentCount} mensaje(s)).`; }
                    else result = `No se pudo enviar: ${r.error}`;
                } else if (block.name === 'mover_candidato_crm') {
                    const r = await moveCandidateToProject({ candidateId, proyecto: block.input?.proyecto, paso: block.input?.paso });
                    if (r.error) result = r.error;
                    else { actedSomething = true; result = `Movido a proyecto "${r.projectName}", paso "${r.stepName}".`; }
                } else if (block.name === 'pedir_ayuda') {
                    askedHelp = true;
                    helpQuestion = block.input?.pregunta || '';
                    result = 'Anotado — se le mostrará a Oscar en su chat.';
                } else if (block.name === 'marcar_gol') {
                    goalMarked = true;
                    goalReason = block.input?.razon || '';
                    result = '⚽ Gol registrado.';
                } else {
                    result = 'Herramienta desconocida.';
                }
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }

            messages.push({ role: 'user', content: toolResults });
            response = await client.messages.create({ model: AGENT_MODEL, max_tokens: MAX_TOKENS, system, tools: ATTEND_TOOLS, messages });
        }

        // Si el candidato recibió un mensaje real, silenciar a Brenda para este candidato
        // (mismo efecto que una intervención humana) — evita que Brenda responda en paralelo
        // mientras el seguimiento de la respuesta (aún no automatizado) queda pendiente.
        if (actedSomething) {
            await updateCandidate(candidateId, { blocked: true }).catch(() => {});
        }

        const finalText = extractText(response.content) || helpQuestion;

        if (askedHelp || !actedSomething) {
            await pushLiveFeed({
                kind: 'question',
                text: finalText || 'No encontré una skill clara para esta etiqueta — revisa qué debo hacer.',
                candidateId, candidateName, tag
            });
            await updateQueueEntryStatus(candidateId, { status: 'waiting', note: finalText });
        } else {
            await recordAttended();
            if (goalMarked) await recordGoal();
            await pushLiveFeed({
                kind: goalMarked ? 'goal' : 'action',
                text: goalMarked ? `⚽ ¡Gol! ${goalReason || finalText}` : (finalText || 'Atendido según la skill.'),
                candidateId, candidateName, tag
            });
            await updateQueueEntryStatus(candidateId, { status: 'done', note: finalText, goal: goalMarked });
        }
    } catch (e) {
        console.error('[AGENT-ATTEND] attendLiveCandidate:', e?.message);
        await pushLiveFeed({
            kind: 'error',
            text: `Tuve un error atendiendo a este candidato: ${e.message}`,
            candidateId, candidateName: candidate?.nombreReal || candidate?.nombre || candidateId, tag
        }).catch(() => {});
        await updateQueueEntryStatus(candidateId, { status: 'error', note: e.message });
    } finally {
        // Se suma en TODOS los casos (éxito, duda o error) — el tiempo se gastó igual.
        await recordAttendingDuration(Date.now() - startedAt).catch(() => {});
    }
}
