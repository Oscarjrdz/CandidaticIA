import { getRedisClient, isProfileComplete, updateCandidate, saveMessage, updateMessageStatus, withCrmProjectLinksLock, HUMAN_INTERVENTION_SILENCE_MS } from './storage.js';
import { getCachedConfig } from './cache.js';
import { getUltraMsgConfig, sendUltraMsgMessage, sendUltraMsgMessageWithRetry } from '../whatsapp/utils.js';
import { substituteVariables, splitBubbles, substituteDynamicPhrase } from './shortcuts.js';
import { getBotVacancies, vacancyMessageText } from './agent-ia.js';
import { runInBackground } from './background.js';
import { businessDayOffset, isPastCutoff } from './reminder-schedule.js';

// ════════════════════════════════════════════════════════════════════════════
// MOTOR DE FLOWS — ejecución determinística de automatizaciones post-extracción.
//
// Se dispara UNA VEZ por candidato, en el instante exacto en que Brenda termina
// de extraer sus datos (paso2Estado → 'completo'), desde api/ai/agent.js — mismo
// patrón fire-and-forget que api/utils/agent-katcon.js. NO hay cron de barrido
// (decisión explícita: solo evento) y NADA aquí llama a un LLM — es comparación
// pura de campos ya extraídos contra criterios configurados en el lienzo.
//
// Cada flujo es un grafo (nodes/edges armado en el editor React Flow). Se recorre
// en orden topológico; cada nodo resuelve un booleano "pasó":
//   - nodos de filtro/condición: pasan si el candidato cumple el criterio.
//   - nodos con VARIOS edges entrantes solo pasan si TODOS sus predecesores
//     pasaron (AND) — así se implementa el fan-in del boceto original
//     (etiqueta → [edad, municipio, categoría, escolaridad] → mandar WhatsApp).
//   - nodos de acción (mandar WhatsApp / agregar etiqueta) y el nodo "contador"
//     siempre "pasan" una vez ejecutados, para no dejar la cadena a medias si
//     el envío falla por un error transitorio (dedupe es de una sola vez).
// ════════════════════════════════════════════════════════════════════════════

// Tipos de nodo que son RAÍZ del grafo: son los únicos que pueden arrancar sin
// ninguna arista entrante. Cualquier otro nodo sin conexión es un nodo "suelto"
// (colgado en el lienzo pero aún no cableado) y NO debe ejecutarse — sin esto,
// un nodo de acción sin conectar se disparaba solo en cada corrida (bug ago 2026).
const ENTRY_NODE_TYPES = new Set(['inicio', 'inicio_lista', 'inicio_incompleto_silencio']);

const FLOWS_KEY = 'flows:v1';
const QUICK_REPLIES_KEY = 'candidatic:quick_replies';
const REMINDER_TEMPLATES_KEY = 'candidatic:reminder_templates';
const DIRECT_REMINDERS_ZSET = 'direct_reminders';
const PROJECTS_KEY = 'candidatic_manual_projects';
const MEDIA_HOST = 'https://www.candidatic.com';

// Mismo helper que api/utils/agent-katcon.js → toAbsoluteImageUrl: el banco de
// respuestas guarda media interna como `/api/image?id=med_X`, que Meta no puede
// jalar directo (no es pública) — se convierte a la ruta pública /api/media/X.jpg.
// La extensión es decorativa: api/image.js hace `id.split('.')[0]` y sirve el mime
// real guardado, así que sirve igual para imagen/audio/documento.
function toAbsoluteMediaUrl(u) {
    const m = /[?&]id=([^&]+)/.exec(u || '');
    if (m) return `${MEDIA_HOST}/api/media/${m[1]}.jpg`;
    if (u && u.startsWith('/')) return `${MEDIA_HOST}${u}`;
    return u;
}
export const EXEC_SET_PREFIX = 'flow:executed:v1:';   // set: candidatos que COMPLETARON el flujo
export const COUNTER_PREFIX = 'flow:counter:v1:';
// ZSET paralelo al contador: member = candidatoId, score = ms de su PRIMER paso por el
// nodo (ZADD NX no lo pisa en repasos). Habilita el desglose por fecha (hoy/ayer/semana/
// mes/rango) sin tocar el SET de total (que preserva el histórico previo a esta feature).
export const COUNTER_TS_PREFIX = 'flow:counter:ts:v1:';
// Ledger de progreso por candidato/flujo (hash nodeId → '1'/'0'): permite RETOMAR una
// corrida que quedó a medias sin re-ejecutar los nodos ya hechos (no re-enviar WhatsApp,
// no re-crear recordatorios). Se borra al completar; TTL como red de seguridad.
const PROGRESS_PREFIX = 'flow:progress:v1:';
const PROGRESS_TTL_SEC = 60 * 60 * 24 * 7; // 7 días
// Lock de exclusión mutua por candidato/flujo: evita que dos invocaciones concurrentes
// (reentrega de webhook, doble disparo) corran el mismo flujo para el mismo candidato a
// la vez. TTL > maxDuration (120s) para que se auto-libere si la instancia muere a medias.
const RUN_LOCK_PREFIX = 'flow:lock:v1:';
const RUN_LOCK_TTL_SEC = 130;

// Registro de esperas activas por candidato (nodo "esperando_respuesta"). Hash:
//   field  = flowId
//   value  = JSON { nodeId, grupos, matchMode, expiresAt }
// Lo consulta resumeWaitingFlowIfMatch() (llamado desde el BLOCK SHIELD de agent.js) para
// reanudar el flujo cuando el candidato responde una frase que coincide. Solo tiene sentido
// tras un nodo "Desactivar Bot": Brenda queda en silencio y este registro atrapa la respuesta.
export const WAITING_PREFIX = 'flow:waiting:v1:';

// ── DISPARADOR "CANDIDATO QUE REGRESA" (event-driven, en vivo) ────────────────
// Cadencia por candidato/flujo para el disparo de regreso (evita reenviar la info
// 3 veces si clickea 3 veces). Espejo del contador de INCOMPLETOS EN SILENCIO
// (flow:silence:count / lastfire), pero con llaves propias.
const RETURN_COUNT_PREFIX = 'flow:return:count:v1:';     // hash flowId → { candidateId: nºdisparos }
const RETURN_FIRE_PREFIX  = 'flow:return:lastfire:v1:';  // hash flowId → { candidateId: msÚltimoDisparo }
// Marca transitoria que pone el webhook cuando llega un click de anuncio (referral):
// value = tagName, TTL corto. El despachador de regreso la lee (y la consume) para saber
// que ESTE turno vino de un anuncio, sin confundirlo con un adId viejo ya persistido.
export const RETURN_ADCLICK_PREFIX = 'return:adclick:v1:';

// Disparadores configurados en el nodo Inicio (data.trigger, array).
//   • 'al_completar' → al terminar la extracción (flanco de subida, disparo histórico).
//   • 'al_regresar'  → cuando un COMPLETO vuelve (click de anuncio o frase).
// Ausente/vacío = ['al_completar'] — compat: los flujos viejos disparaban al completar.
function getInicioTrigger(flow) {
    const inicio = Array.isArray(flow?.nodes) ? flow.nodes.find(n => n.type === 'inicio') : null;
    const t = inicio?.data?.trigger;
    if (Array.isArray(t) && t.length) return t;
    return ['al_completar'];
}

// Normaliza texto para comparar frases: sin acentos, minúsculas, sin espacios de sobra.
function normalizeFlowText(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ¿El texto del candidato coincide con alguna frase del grupo, según el modo?
//   'exacto'   → el mensaje ES exactamente una de las frases.
//   'palabra'  → alguna frase aparece como palabra suelta en el mensaje.
//   'contiene' → (default) alguna frase es substring del mensaje.
function flowTextMatchesGroup(text, grupo, mode) {
    const t = normalizeFlowText(text);
    if (!t) return false;
    const frases = (Array.isArray(grupo?.frases) ? grupo.frases : []).map(normalizeFlowText).filter(Boolean);
    if (!frases.length) return false;
    if (mode === 'exacto') return frases.includes(t);
    if (mode === 'palabra') {
        const words = new Set(t.split(/\s+/));
        return frases.some(f => f.split(/\s+/).every(w => words.has(w)));
    }
    return frases.some(f => t.includes(f)); // 'contiene'
}

// Mismo cálculo que handleApplyReminderTemplate en src/components/ChatSection.jsx,
// pero AHÍ corre en el navegador del reclutador (hora local = Monterrey) y setHours()
// da el resultado correcto. Acá corre en una función serverless de Vercel, cuyo
// proceso Node está en UTC — setHours() interpretaría 06:00 como 06:00 UTC en vez de
// 06:00 Monterrey (bug detectado: guardaba 6 horas antes de lo debido). Por eso se
// arma la fecha en UTC explícitamente, fijando el offset de Monterrey (UTC-6 todo el
// año — México quitó el horario de verano en 2022 fuera de la franja fronteriza, y
// Monterrey no es franja fronteriza).
//
// dayOffset/timeOfDay son relativos al momento en que se aplica la plantilla, no una
// fecha absoluta. Si el offset ya cayó en el pasado (ej. "mismo día" tarde), se corre
// un día para que siga siendo una fecha futura válida (POST /api/candidate-reminders
// exige scheduledAt estrictamente futuro).
const MTY_UTC_OFFSET_HOURS = 6;

// "Próximo día hábil" en hora de Monterrey — Lun–Jue → mañana, Vie/Sáb/Dom → lunes.
// El cálculo vive en ./reminder-schedule.js (fuente única compartida con el frontend),
// porque un offset fijo NO sirve aquí: la plantilla se guarda una vez pero se aplica
// cualquier día, así que hay que recalcular según el día en que corre el flujo (si no,
// un dinámico creado en viernes/sábado/domingo caía en fin de semana — bug confirmado
// ago 2026 con el candidato de prueba 8116038195).
//
// tpl.cutoffTime ("HH:MM", opcional): si el flujo corre a esa hora o después (Monterrey),
// brinca un día hábil más — demasiado tarde para agendar cita para el día siguiente.

function daysUntilSend(tpl) {
    if (tpl.scheduleType === 'nextBusinessDay') {
        // Un solo formateo saca día de la semana Y hora en Monterrey (el proceso Node de
        // Vercel corre en UTC, así que no se puede usar getDay()/getHours() del server).
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Monterrey', weekday: 'short',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(new Date());
        const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
        const nowMinutes = Number(map.hour) * 60 + Number(map.minute);
        return businessDayOffset(map.weekday, isPastCutoff(nowMinutes, tpl.cutoffTime));
    }
    return Number(tpl.dayOffset) || 0; // 'fixedOffset' / plantillas viejas: offset relativo clásico
}

export function resolveReminderSendAt(tpl) {
    const days = daysUntilSend(tpl);
    const [hours, minutes] = String(tpl.timeOfDay || '07:00').split(':').map(Number);

    const mtyDateStr = new Date(Date.now() + days * 86400000)
        .toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' }); // YYYY-MM-DD
    const sendAt = new Date(`${mtyDateStr}T00:00:00.000Z`);
    sendAt.setUTCHours((hours || 0) + MTY_UTC_OFFSET_HOURS, minutes || 0, 0, 0);

    if (sendAt.getTime() <= Date.now() + 60000) sendAt.setUTCDate(sendAt.getUTCDate() + 1);
    return sendAt;
}

// Mismo invariante que la acción 'linkCandidate' de api/manual_projects.js: un
// candidato solo puede estar en un proyecto a la vez, así que primero se desvincula
// de cualquier otro antes de vincularlo al nuevo.
async function linkCandidateToProject(redis, candidateId, projectId, stepId) {
    const raw = await redis.get(PROJECTS_KEY);
    const projects = raw ? JSON.parse(raw) : [];
    const project = projects.find(p => p.id === projectId);
    if (!project) return null;

    // Desvincular de cualquier otro proyecto primero (mismo invariante: uno a la vez) —
    // cada proyecto se bloquea/lee/escribe por separado vía withCrmProjectLinksLock, ver
    // storage.js (bug de carrera confirmado en producción, agosto 2026).
    for (const p of projects) {
        if (!p?.id || p.id === projectId) continue;
        await withCrmProjectLinksLock(p.id, async (links) => {
            const next = links.filter(l => l.candidateId !== candidateId);
            return { links: next.length !== links.length ? next : undefined, result: null };
        });
    }

    const finalStepId = await withCrmProjectLinksLock(projectId, async (links) => {
        const stepIdFinal = stepId || project.steps?.[0]?.id || 'step_inicio';
        const existing = links.find(l => l.candidateId === candidateId);
        const nextLinks = existing
            ? links.map(l => l.candidateId === candidateId ? { ...l, stepId: stepIdFinal } : l)
            : [...links, { candidateId, stepId: stepIdFinal, linkedAt: new Date().toISOString() }];
        return { links: nextLinks, result: stepIdFinal };
    });

    await updateCandidate(candidateId, { manualProjectId: projectId, manualProjectStepId: finalStepId });
    redis.publish('channel:sse:updates', JSON.stringify({
        type: 'crm:candidate', action: 'linkCandidate', projectId, candidateId, stepId: finalStepId,
        timestamp: new Date().toISOString()
    })).catch(() => {});

    return finalStepId;
}

function getCandidateAge(candidate) {
    if (Number.isFinite(candidate?.edad)) return Number(candidate.edad);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(candidate?.fechaNacimiento || ''));
    if (!m) return null;
    const [, dd, mm, yyyy] = m;
    const birth = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (Number.isNaN(birth.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const hadBirthdayThisYear = (now.getMonth() > birth.getMonth()) ||
        (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
    if (!hadBirthdayThisYear) age -= 1;
    return age;
}

export function topoSort(nodes, edges) {
    const inDegree = new Map(nodes.map(n => [n.id, 0]));
    const adj = new Map(nodes.map(n => [n.id, []]));
    for (const e of edges) {
        if (!adj.has(e.source) || !inDegree.has(e.target)) continue;
        adj.get(e.source).push(e.target);
        inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }

    const queue = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const order = [];
    const seen = new Set();

    while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        order.push(byId.get(id));
        for (const next of adj.get(id) || []) {
            inDegree.set(next, inDegree.get(next) - 1);
            if (inDegree.get(next) === 0) queue.push(next);
        }
    }

    // Nodos que quedaron fuera (ciclo o desconectados de la raíz) se ignoran —
    // un ciclo en el lienzo no debe tumbar la ejecución del resto del flujo.
    return order;
}

// Devuelve Map<target, [{source, handle}]>. `handle` es el sourceHandle de la arista:
//   - 'no'  → sale de la ramita "No cumple" de una condición (se activa cuando el
//             origen quedó en 'fail').
//   - null / 'si' / cualquier otro → arista normal (se activa cuando el origen 'pass').
// Las aristas viejas (guardadas antes de esta función) no tienen sourceHandle → null →
// se comportan EXACTO igual que siempre, así que los flujos existentes no cambian.
export function buildIncomingMap(edges) {
    const incoming = new Map();
    for (const e of edges) {
        if (!incoming.has(e.target)) incoming.set(e.target, []);
        incoming.get(e.target).push({ source: e.source, handle: e.sourceHandle || null });
    }
    return incoming;
}

// Mismo valor que ORDERED_MESSAGE_GAP_MS en src/components/ChatSection.jsx — "para que
// Meta respete el orden". A diferencia del chat manual, un flujo puede mandar varios
// WhatsApp SEGUIDOS para el mismo candidato (ej. "PUNTO CORZEN" → "RUTAS CORZEN") sin
// ninguna pausa entre ellos — posible causa de envíos perdidos bajo ráfaga (ago 2026,
// no confirmado con certeza total porque el log de detalle de Meta ya había expirado
// para cuando se investigó, pero es una mitigación segura y barata de todos modos: esto
// corre en segundo plano, nadie espera la respuesta). `opts` vive una sola corrida de
// runOneFlow para UN candidato — se usa como carrier mutable para recordar cuándo fue el
// último envío de ESTE candidato en ESTA corrida.
const FLOW_MESSAGE_GAP_MS = 450;

async function pacedSend(opts, sendFn) {
    if (opts._lastFlowSendAt) {
        const elapsed = Date.now() - opts._lastFlowSendAt;
        if (elapsed < FLOW_MESSAGE_GAP_MS) await new Promise(r => setTimeout(r, FLOW_MESSAGE_GAP_MS - elapsed));
    }
    const result = await sendFn();
    opts._lastFlowSendAt = Date.now();
    return result;
}

// Guarda un mensaje saliente de un flujo con la MISMA lógica de estados que un envío manual
// (ver api/chat.js): nace 'queued' y sube a 'sent' guardando el wamid de Meta, lo que crea
// `message:index:<wamid>` para que los webhooks de entrega (delivered/read) lo actualicen —
// así la palomita se vuelve azul SOLO cuando el candidato lo ve, en vez del 'read' optimista
// que ponía saveMessage por defecto (azul al instante). Nunca lanza.
async function saveFlowOutbound(candidateId, msg, sendResult) {
    const saved = await saveMessage(candidateId, { ...msg, status: 'queued' }).catch(() => null);
    if (!saved?.id) return;
    const remoteId = sendResult?.messageId || sendResult?.data?.messages?.[0]?.id || null;
    await updateMessageStatus(candidateId, saved.id, 'sent', remoteId ? { ultraMsgId: remoteId } : {}).catch(() => {});
}

export async function evaluateOrExecute(node, candidate, flowId, redis, opts = {}) {
    const data = node.data || {};

    switch (node.type) {
        case 'inicio': {
            const filter = data.profileFilter || 'todos';
            if (filter === 'todos') return true;
            if (filter === 'active') return !candidate.blocked;
            if (filter === 'completo') return isProfileComplete(candidate);
            if (filter === 'incompleto') return !isProfileComplete(candidate);
            return true;
        }

        // Raíz de un flujo MANUAL (no en vivo, ver runFlowForListCandidate más abajo): el
        // candidato ya pasó el filtro completo/incompleto/etiqueta/ventana-24h al armar la
        // lista en getCandidatesForFlowList (storage.js), así que aquí siempre "pasa".
        case 'inicio_lista':
            return true;

        // Raíz de un flujo de INCOMPLETOS EN SILENCIO (disparado por cron, no en vivo):
        // la elegibilidad real (perfil incompleto + N horas de silencio + tope de pases)
        // ya la resolvió api/cron/flow-incompletos.js antes de llamar al motor, así que
        // aquí el nodo siempre "pasa" — igual que inicio_lista.
        case 'inicio_incompleto_silencio':
            return true;

        case 'etiqueta': {
            const mode = data.mode || 'todas';
            const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
            if (mode === 'todas') return true;
            if (mode === 'ninguna') return tags.length === 0;
            if (mode === 'especifica') {
                if (!data.tag) return true; // sin configurar aún → no bloquea
                return tags.includes(data.tag);
            }
            if (mode === 'actual') {
                // Ruteo por ÚLTIMA vacante: solo pasa si la etiqueta del último anuncio
                // clickeado (candidate.vacanteActual, sobreescrita en cada click desde el
                // webhook) es JUSTO esta. Así, un candidato con historial [Metalsa, Kemet]
                // que hoy clickeó Kemet pasa solo por el flujo de Kemet — el de Metalsa se
                // cae, aunque siga teniendo esa etiqueta en su historial (tags).
                if (!data.tag) return true; // sin configurar aún → no bloquea
                return candidate.vacanteActual === data.tag;
            }
            return true;
        }

        case 'condicion_genero': {
            const values = Array.isArray(data.generos) ? data.generos : [];
            if (!values.length) return true;
            return values.includes(candidate.genero);
        }

        case 'condicion_edad': {
            const { min, max } = data;
            if (min == null && max == null) return true;
            const age = getCandidateAge(candidate);
            if (age == null) return false;
            if (min != null && age < min) return false;
            if (max != null && age > max) return false;
            return true;
        }

        case 'condicion_municipio': {
            const values = Array.isArray(data.municipios) ? data.municipios : [];
            if (!values.length) return true;
            return values.includes(candidate.municipio);
        }

        case 'condicion_categoria': {
            const values = Array.isArray(data.categorias) ? data.categorias : [];
            if (!values.length) return true;
            return values.includes(candidate.categoria);
        }

        case 'condicion_escolaridad': {
            const values = Array.isArray(data.escolaridades) ? data.escolaridades : [];
            if (!values.length) return true;
            return values.includes(candidate.escolaridad);
        }

        // Fija el valor del token {{frase dinamica}} para los nodos "Mandar WhatsApp" /
        // "WhatsApp Personalizado" que vienen DESPUÉS en la misma corrida. Se arrastra en
        // `opts` (mismo carrier mutable que _lastFlowSendAt). Sin efectos externos: solo
        // setea una variable en memoria, por eso es idempotente y seguro re-aplicarlo al
        // reanudar un flujo pausado. Otro nodo Frase Dinámica más adelante lo sobrescribe.
        case 'frase_dinamica': {
            // Vínculo en vivo: si el nodo referencia una respuesta del banco
            // (linkedQuickReplyId), usa la frase amarilla ACTUAL de esa respuesta — así se
            // actualiza sola al cambiarla en el banco. Lectura DIRECTA sin caché (redis.get,
            // no getCachedConfig) para que el cambio sea INMEDIATO: la caché en memoria es por
            // instancia serverless y no se puede invalidar de forma confiable desde el
            // endpoint que guarda el banco (otro proceso). El costo extra (un GET) solo aplica
            // a nodos VINCULADOS; los manuales no leen nada. Si no hay vínculo, o la respuesta
            // ya no existe / se quedó sin frase, cae al texto manual (data.value). Sin efectos
            // externos → idempotente al reanudar.
            let phrase = typeof data.value === 'string' ? data.value : '';
            if (data.linkedQuickReplyId) {
                try {
                    const raw = await redis.get(QUICK_REPLIES_KEY);
                    const replies = raw ? JSON.parse(raw) : [];
                    const qr = replies.find(r => r.id === data.linkedQuickReplyId);
                    if (qr && typeof qr.dynamicPhrase === 'string' && qr.dynamicPhrase.trim()) {
                        phrase = qr.dynamicPhrase;
                    }
                } catch (_) {}
            }
            opts._dynamicPhrase = phrase;
            return true;
        }

        case 'accion_whatsapp': {
            if (!data.quickReplyId) return true; // sin configurar → no rompe la cadena
            try {
                const raw = await getCachedConfig(redis, QUICK_REPLIES_KEY);
                const replies = raw ? JSON.parse(raw) : [];
                const qr = replies.find(r => r.id === data.quickReplyId);
                if (!qr) return true;

                const config = await getUltraMsgConfig(candidate.incomingPhoneNumberId || candidate.instanceId);
                if (!config?.token || !config?.instanceId) throw new Error('sin credenciales de WhatsApp');
                const cleanTo = String(candidate.whatsapp).replace(/\D/g, '');
                const qrType = qr.type || 'text';

                // Igual que /api/quick_replies documenta: text (+ hasta 4 imágenes) es el
                // default; location/audio/document son variantes exclusivas del mismo banco.
                if (qrType === 'location' && qr.location?.lat && qr.location?.lng) {
                    const locRes = await pacedSend(opts, () => sendUltraMsgMessage(config.instanceId, config.token, cleanTo, qr.location.address || '', 'location', {
                        name: qr.location.name, address: qr.location.address, lat: qr.location.lat, lng: qr.location.lng
                    }));
                    if (locRes?.success) {
                        await saveFlowOutbound(candidate.id, {
                            from: 'me', content: `[Ubicación: ${qr.location.name || 'Mapa'}]`, timestamp: new Date().toISOString(),
                            meta: { flow: true, flowId, nodeId: node.id }
                        }, locRes);
                    } else {
                        console.error(`[FLOW-ENGINE] accion_whatsapp ${flowId}/${node.id} (ubicación) candidato ${candidate.id}: envío falló —`, locRes?.error);
                    }
                    return true;
                }

                if (qrType === 'audio' && qr.audioUrl) {
                    const audioRes = await pacedSend(opts, () => sendUltraMsgMessageWithRetry(config.instanceId, config.token, cleanTo, toAbsoluteMediaUrl(qr.audioUrl), 'audio', { voice: !!qr.voice }));
                    if (audioRes?.success) {
                        await saveFlowOutbound(candidate.id, {
                            from: 'me', content: qr.voice ? '🎤 Nota de voz' : '🎵 Audio', type: 'audio', mediaUrl: qr.audioUrl,
                            timestamp: new Date().toISOString(), meta: { flow: true, flowId, nodeId: node.id }
                        }, audioRes);
                    } else {
                        console.error(`[FLOW-ENGINE] accion_whatsapp ${flowId}/${node.id} (audio) candidato ${candidate.id}: envío falló —`, audioRes?.error);
                    }
                    return true;
                }

                if (qrType === 'document' && qr.documentUrl) {
                    const caption = qr.message ? substituteDynamicPhrase(substituteVariables(qr.message, candidate), opts._dynamicPhrase) : '';
                    const docRes = await pacedSend(opts, () => sendUltraMsgMessageWithRetry(config.instanceId, config.token, cleanTo, toAbsoluteMediaUrl(qr.documentUrl), 'document', {
                        filename: qr.documentName || 'documento.pdf', caption
                    }));
                    if (docRes?.success) {
                        await saveFlowOutbound(candidate.id, {
                            from: 'me', content: caption, type: 'document', mediaUrl: qr.documentUrl, filename: qr.documentName || 'documento.pdf',
                            timestamp: new Date().toISOString(), meta: { flow: true, flowId, nodeId: node.id }
                        }, docRes);
                    } else {
                        console.error(`[FLOW-ENGINE] accion_whatsapp ${flowId}/${node.id} (documento) candidato ${candidate.id}: envío falló —`, docRes?.error);
                    }
                    return true;
                }

                // type 'text' (default): texto (posiblemente partido en varias burbujas
                // por [burbuja]) + hasta 4 imágenes del banco. sendUltraMsgMessageWithRetry
                // reintenta una vez tras un rate-limit/hiccup transitorio de Meta (bug real
                // confirmado en producción, ago 2026: bajo mucha carga se perdían mensajes
                // en silencio, sin reintento ni log con contexto de flujo/nodo/candidato).
                if (qr.message) {
                    const text = substituteDynamicPhrase(substituteVariables(qr.message, candidate), opts._dynamicPhrase);
                    for (const bubbleText of splitBubbles(text)) {
                        const textRes = await pacedSend(opts, () => sendUltraMsgMessageWithRetry(config.instanceId, config.token, cleanTo, bubbleText, 'chat', { priority: 1 }));
                        if (textRes?.success) {
                            await saveFlowOutbound(candidate.id, {
                                from: 'me', content: bubbleText, timestamp: new Date().toISOString(),
                                meta: { flow: true, flowId, nodeId: node.id }
                            }, textRes);
                        } else {
                            console.error(`[FLOW-ENGINE] accion_whatsapp ${flowId}/${node.id} (texto) candidato ${candidate.id}: envío falló tras reintento —`, textRes?.error);
                        }
                    }
                }
                const bankImages = Array.isArray(qr.imageUrls) && qr.imageUrls.length ? qr.imageUrls : [qr.imageUrl].filter(Boolean);
                for (const imgUrl of bankImages) {
                    const imgRes = await pacedSend(opts, () => sendUltraMsgMessageWithRetry(config.instanceId, config.token, cleanTo, toAbsoluteMediaUrl(imgUrl), 'image', { priority: 1 }));
                    if (imgRes?.success) {
                        await saveFlowOutbound(candidate.id, {
                            from: 'me', content: '', type: 'image', mediaUrl: imgUrl,
                            timestamp: new Date().toISOString(), meta: { flow: true, flowId, nodeId: node.id }
                        }, imgRes);
                    } else {
                        console.error(`[FLOW-ENGINE] accion_whatsapp ${flowId}/${node.id} (imagen) candidato ${candidate.id}: envío falló —`, imgRes?.error);
                    }
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_whatsapp ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_vacante': {
            if (!data.vacancyId) return true; // sin configurar → no rompe la cadena
            try {
                const vacancies = await getBotVacancies();
                const vac = vacancies.find(v => v.id === data.vacancyId);
                if (!vac) return true;

                const config = await getUltraMsgConfig(candidate.incomingPhoneNumberId || candidate.instanceId);
                if (!config?.token || !config?.instanceId) throw new Error('sin credenciales de WhatsApp');
                const cleanTo = String(candidate.whatsapp).replace(/\D/g, '');

                // Mismo texto EXACTO que el "maletín" del chat manual — sin substituteVariables,
                // igual que sendVacancyDirect en ChatSection.jsx (no aplica variables ahí tampoco).
                const text = vacancyMessageText(vac);
                const sendResult = await pacedSend(opts, () => sendUltraMsgMessageWithRetry(config.instanceId, config.token, cleanTo, text, 'chat', { priority: 1 }));
                if (sendResult?.success) {
                    await saveFlowOutbound(candidate.id, {
                        from: 'me', content: text, timestamp: new Date().toISOString(),
                        meta: { flow: true, flowId, nodeId: node.id }
                    }, sendResult);
                } else {
                    console.error(`[FLOW-ENGINE] accion_vacante ${flowId}/${node.id} candidato ${candidate.id}: envío falló tras reintento —`, sendResult?.error);
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_vacante ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_whatsapp_personalizado': {
            if (!data.message?.trim()) return true; // sin configurar → no rompe la cadena
            try {
                const config = await getUltraMsgConfig(candidate.incomingPhoneNumberId || candidate.instanceId);
                if (!config?.token || !config?.instanceId) throw new Error('sin credenciales de WhatsApp');
                const cleanTo = String(candidate.whatsapp).replace(/\D/g, '');

                const text = substituteDynamicPhrase(substituteVariables(data.message, candidate), opts._dynamicPhrase);
                for (const bubbleText of splitBubbles(text)) {
                    const sendResult = await pacedSend(opts, () => sendUltraMsgMessageWithRetry(config.instanceId, config.token, cleanTo, bubbleText, 'chat', { priority: 1 }));
                    if (sendResult?.success) {
                        await saveFlowOutbound(candidate.id, {
                            from: 'me', content: bubbleText, timestamp: new Date().toISOString(),
                            meta: { flow: true, flowId, nodeId: node.id }
                        }, sendResult);
                    } else {
                        console.error(`[FLOW-ENGINE] accion_whatsapp_personalizado ${flowId}/${node.id} candidato ${candidate.id}: envío falló tras reintento —`, sendResult?.error);
                    }
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_whatsapp_personalizado ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_etiqueta': {
            if (!data.tag) return true;
            try {
                const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
                if (!tags.includes(data.tag)) {
                    const nextTags = [...tags, data.tag];
                    await updateCandidate(candidate.id, { tags: nextTags });
                    candidate.tags = nextTags; // mantener el snapshot en memoria en sync para el resto de la corrida
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_etiqueta ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_quitar_etiqueta': {
            if (!data.tag) return true;
            try {
                const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
                if (tags.includes(data.tag)) {
                    const nextTags = tags.filter(t => t !== data.tag);
                    await updateCandidate(candidate.id, { tags: nextTags });
                    candidate.tags = nextTags; // mantener el snapshot en memoria en sync para el resto de la corrida
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_quitar_etiqueta ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_limpiar_etiquetas': {
            try {
                const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
                if (tags.length) {
                    await updateCandidate(candidate.id, { tags: [] });
                    candidate.tags = []; // mantener el snapshot en memoria en sync para el resto de la corrida
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_limpiar_etiquetas ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_desactivar_bot': {
            // Silencia a Brenda para este candidato EXACTAMENTE como cuando un humano
            // interviene en el chat (modo humano). Mismo patch que aplica
            // api/candidates/block.js (lo que dispara autoSilenceBot en ChatSection.jsx):
            // blocked + blockedAt + blockedExpiresAt (ahora + HUMAN_INTERVENTION_SILENCE_MS,
            // 5 días) + blockedReason 'human_intervention'. NO bloquea en WhatsApp — solo
            // marca al candidato como intervenido para que la IA no responda. Si algún día
            // cambia la lógica de intervención humana, actualízala en block.js y aquí.
            try {
                const now = new Date();
                const patch = {
                    blocked: true,
                    blockedAt: now.toISOString(),
                    blockedExpiresAt: new Date(now.getTime() + HUMAN_INTERVENTION_SILENCE_MS).toISOString(),
                    blockedReason: 'human_intervention'
                };
                await updateCandidate(candidate.id, patch);
                Object.assign(candidate, patch); // snapshot en memoria en sync para el resto de la corrida
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_desactivar_bot ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_reactivar_bot': {
            // Reactiva a Brenda (deshace lo que hace accion_desactivar_bot / la intervención
            // humana). Mismo patch que api/candidates/block.js con block=false. Útil al final
            // de un ciclo "Desactivar Bot → Esperando respuesta → ... → Reactivar Bot".
            try {
                const patch = {
                    blocked: false,
                    blockedAt: null,
                    blockedExpiresAt: null,
                    blockedExpiredAt: null,
                    blockedReason: null
                };
                await updateCandidate(candidate.id, patch);
                Object.assign(candidate, patch); // snapshot en memoria en sync para el resto de la corrida
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_reactivar_bot ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'esperando_respuesta': {
            // 👂 MODO OYENTE: registra la espera y PAUSA el flujo (sentinel __pause). El flujo
            // NO se marca completado; reanuda desde el nodo SIGUIENTE cuando el candidato manda
            // un mensaje cuya frase coincide (ver resumeWaitingFlowIfMatch + el hook en agent.js).
            // Debe ir DESPUÉS de un nodo "Desactivar Bot": así Brenda está en silencio y su
            // BLOCK SHIELD deja pasar el mensaje a este registro en vez de responder.
            const grupos = (Array.isArray(data.grupos) ? data.grupos : [])
                .filter(g => Array.isArray(g?.frases) && g.frases.some(f => String(f || '').trim()));
            const matchMode = data.matchMode || 'contiene';
            const timeoutHoras = Number(data.timeoutHoras) > 0 ? Number(data.timeoutHoras) : 48;

            // En modo test (skipClaim) o ephemeral (cron) no hay ledger que reanudar → no
            // tiene sentido pausar: pasa de largo para que el tester vea los nodos siguientes.
            if (opts.skipClaim || opts.ephemeral) return true;

            // Sin frases configuradas no hay nada que esperar → deja pasar (no cuelga la cadena).
            if (!grupos.length) return true;

            const ttlSec = Math.max(PROGRESS_TTL_SEC, Math.ceil(timeoutHoras * 3600) + 86400);
            try {
                const key = `${WAITING_PREFIX}${candidate.id}`;
                const payload = JSON.stringify({
                    nodeId: node.id,
                    grupos,
                    matchMode,
                    expiresAt: Date.now() + timeoutHoras * 3600 * 1000
                });
                await redis.hset(key, flowId, payload);
                await redis.expire(key, ttlSec);
            } catch (e) {
                console.error(`[FLOW-ENGINE] esperando_respuesta ${flowId}/${node.id}:`, e?.message);
                return true; // si el registro falla, no dejes el flujo colgado: continúa
            }
            return { __pause: true, ttlSec };
        }

        case 'accion_marcar_leido': {
            // Marca al candidato como "leído" para sacarlo de la lista de no-leídos
            // (quita la burbuja/badge). El estado de no-leído en Redis se deriva de
            // lastUserMessageAt > lastHumanMessageAt (ver "ATOMIC UNREAD" en storage.js):
            // poniendo lastHumanMessageAt = ahora lo dejamos leído, y updateCandidate ya
            // se encarga de sacarlo del set candidates:unread, decrementar el contador y
            // emitir el SSE. Si más tarde el candidato vuelve a escribir, lastUserMessageAt
            // se actualiza y reaparece como no-leído — que es justo lo que se quiere.
            try {
                const nowStr = new Date().toISOString();
                await updateCandidate(candidate.id, {
                    unreadMsgCount: 0,
                    lastHumanMessageAt: nowStr
                });
                candidate.lastHumanMessageAt = nowStr; // snapshot en memoria en sync
                candidate.unreadMsgCount = 0;
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_marcar_leido ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_recordatorio': {
            if (!data.templateId) return true;
            try {
                // Lectura directa, SIN caché (getCachedConfig tiene hasta 5 min de TTL en
                // memoria por instancia de servidor) — si el reclutador edita la plantilla
                // mientras la campaña corre, una instancia con caché viejo podía no
                // encontrarla y saltarse el recordatorio en silencio (bug real confirmado
                // en producción, agosto 2026). Este nodo corre una sola vez por candidato,
                // no por mensaje, así que el costo extra de leer directo es insignificante.
                const raw = await redis.get(REMINDER_TEMPLATES_KEY);
                const templates = raw ? JSON.parse(raw) : [];
                const tpl = templates.find(t => t.id === data.templateId);
                if (!tpl || !tpl.message) {
                    console.error(`[FLOW-ENGINE] accion_recordatorio ${flowId}/${node.id}: plantilla "${data.templateId}" no encontrada o sin mensaje — recordatorio NO creado para candidato ${candidate.id}`);
                    return true;
                }

                const sendAt = resolveReminderSendAt(tpl);
                const id = `dr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                const reminder = {
                    id, candidateId: candidate.id, whatsapp: candidate.whatsapp,
                    nombre: candidate.nombreReal || candidate.nombre || candidate.whatsapp,
                    message: substituteVariables(tpl.message, candidate),
                    scheduledAt: sendAt.toISOString(),
                    fallbackTemplateData: null, fallbackTemplateParams: null,
                    createdAt: new Date().toISOString(), status: 'pending'
                };
                await redis.pipeline()
                    .set(`direct_reminder:${id}`, JSON.stringify(reminder), 'EX', 60 * 60 * 24 * 30)
                    .zadd(DIRECT_REMINDERS_ZSET, sendAt.getTime(), id)
                    .sadd(`direct_reminders:candidate:${candidate.id}`, id)
                    .exec();
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_recordatorio ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'accion_proyecto': {
            if (!data.projectId) return true;
            try {
                const finalStepId = await linkCandidateToProject(redis, candidate.id, data.projectId, data.stepId);
                if (finalStepId) {
                    candidate.manualProjectId = data.projectId; // mantener el snapshot en memoria en sync
                    candidate.manualProjectStepId = finalStepId;
                } else {
                    console.error(`[FLOW-ENGINE] accion_proyecto ${flowId}/${node.id}: proyecto "${data.projectId}" no encontrado — candidato ${candidate.id} NO se vinculó`);
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] accion_proyecto ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        case 'contador': {
            if (opts.skipCounters) return true; // modo test: no ensucia las métricas reales
            try {
                const counterKey = `${COUNTER_PREFIX}${flowId}:${node.id}`;
                const counterTsKey = `${COUNTER_TS_PREFIX}${flowId}:${node.id}`;
                const [[, added], [, count]] = await redis.pipeline()
                    .sadd(counterKey, candidate.id)
                    .scard(counterKey)
                    // Registra el timestamp del primer paso (NX = no lo pisa si ya existe) para el
                    // desglose por fecha. No rompe nada si falla: el total sigue saliendo del SET.
                    .zadd(counterTsKey, 'NX', Date.now(), candidate.id)
                    .exec();
                // Solo empuja el push si el candidato SUMÓ al set (sadd=1) — si ya estaba
                // (reintento del mismo evento), el número en pantalla no cambió, no hay
                // nada que avisarle a los editores de flujo abiertos.
                if (added === 1) {
                    redis.publish('channel:sse:updates', JSON.stringify({
                        type: 'flow:counter', flowId, nodeId: node.id, count,
                        timestamp: new Date().toISOString()
                    })).catch(() => {});
                }
            } catch (e) {
                console.error(`[FLOW-ENGINE] contador ${flowId}/${node.id}:`, e?.message);
            }
            return true;
        }

        default:
            return true;
    }
}

// Corre UN flujo para UN candidato, de forma IDEMPOTENTE y RETOMABLE.
//
// opts.skipClaim  → modo test: no toca dedupe/ledger/lock (para repetir la prueba).
// opts.skipCounters → modo test: no incrementa los nodos "contador".
//
// Semántica de idempotencia (fuera de modo test):
//   1. Si el candidato ya COMPLETÓ el flujo (está en flow:executed) → no hace nada.
//   2. Toma un lock por candidato/flujo; si otra invocación ya lo tiene → no hace nada
//      (evita doble ejecución concurrente por reentrega de webhook / doble disparo).
//   3. Recorre el grafo en orden topológico. Cada nodo YA ejecutado en una corrida
//      previa (en el ledger de progreso) se SALTA — se reusa su resultado guardado para
//      la elegibilidad de los siguientes, pero NO se re-ejecuta (no re-enviar WhatsApp).
//   4. Al terminar TODO el grafo, marca al candidato como completado y borra el ledger.
//   Si la corrida muere a medias (raro con waitUntil), el ledger sobrevive y el próximo
//   disparo retoma exactamente donde se quedó.
//
// Devuelve un Map<nodeId, boolean> con el resultado de cada nodo alcanzable — usado por
// el modo test para mostrar hasta dónde llegó (los nodos fuera del Map nunca se evaluaron:
// ciclo o desconectados de la raíz). Un Map vacío fuera de modo test significa "ya
// completado antes" o "otra invocación lo está corriendo".
async function runOneFlow(redis, flow, candidateId, candidate, opts = {}) {
    const passed = new Map();

    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    const edges = Array.isArray(flow.edges) ? flow.edges : [];
    if (!nodes.length) return passed;

    const testMode = !!opts.skipClaim;
    // Modo ephemeral (cron de incompletos-en-silencio): corre el grafo FRESCO en cada
    // disparo. La cadencia la gobierna el contador de pases del cron, NO el dedupe
    // permanente (flow:executed) — por eso se salta el claim de "ya completado" y el
    // ledger de retomar. SÍ toma el lock de concurrencia y SÍ incrementa los contadores.
    const ephemeral = !!opts.ephemeral;
    const useClaim = !testMode && !ephemeral;   // idempotencia permanente (flujos normales en vivo)
    const execKey = `${EXEC_SET_PREFIX}${flow.id}`;
    const progressKey = `${PROGRESS_PREFIX}${flow.id}:${candidateId}`;
    const lockKey = `${RUN_LOCK_PREFIX}${flow.id}:${candidateId}`;

    let prior = {};          // ledger de una corrida previa parcial (nodeId → '1'/'0')
    let lockAcquired = false;

    if (useClaim) {
        if (await redis.sismember(execKey, candidateId)) return passed; // ya completado
    }
    if (!testMode) {
        const lock = await redis.set(lockKey, '1', 'EX', RUN_LOCK_TTL_SEC, 'NX').catch(() => null);
        if (lock !== 'OK') return passed; // otra invocación lo está corriendo (o fallo transitorio)
        lockAcquired = true;
    }
    if (useClaim) {
        prior = (await redis.hgetall(progressKey)) || {};
    }

    try {
        const order = topoSort(nodes, edges);
        const incoming = buildIncomingMap(edges);

        // outcome por nodo: 'pass' (cumplió/se ejecutó), 'fail' (se alcanzó pero la
        // condición NO se cumplió) o 'unreached' (nunca fue elegible). La arista normal
        // exige que su origen quede en 'pass'; la arista "No" (handle === 'no') exige que
        // quede en 'fail' — así se rutean los que NO cumplen sin re-ejecutar la condición.
        // El Map `passed` que se devuelve conserva su semántica de antes (true = cumplió),
        // para el badge del nodo test.
        const outcome = new Map();

        // Ruteo por rama para nodos multi-salida (hoy solo "esperando_respuesta" al reanudar):
        //   Map<sourceNodeId, Set<handle>> con la(s) rama(s) EFECTIVAMENTE tomada(s).
        // Vacío en toda corrida normal → no altera el comportamiento existente.
        const branchTaken = new Map();

        // Elegibilidad de un nodo según sus aristas entrantes:
        //   • Aristas normales ("Sí"/sin handle) → se unen con Y (AND): TODAS deben venir
        //     de un origen que cumplió. Preserva el patrón de convergencia original
        //     (varias condiciones → una acción que solo corre si TODAS pasan) y deja los
        //     flujos ya guardados EXACTO igual que antes (no tienen aristas "No").
        //   • Aristas "No cumple" (handle === 'no') → se unen con O (OR): basta que UNA
        //     traiga un origen que NO cumplió. Así un único nodo "Marcar Leído" puede
        //     recibir la rama roja de muchas condiciones/ramas y dispararse en cuanto el
        //     candidato falle en la rama que le tocó (cada candidato recorre una sola).
        //   • Si un nodo mezcla ambos tipos, debe cumplir las dos reglas a la vez.
        const isEligible = (deps, node) => {
            // Sin aristas entrantes: solo los nodos de INICIO arrancan solos. Un nodo de
            // acción/condición sin conectar es un nodo suelto y NO se ejecuta (antes se
            // disparaba en cada corrida, incluidas las pruebas — bug ago 2026).
            if (deps.length === 0) return ENTRY_NODE_TYPES.has(node.type);
            // Aristas cuyo origen es un nodo multi-rama ya reanudado (branchTaken): solo
            // cuentan si su handle es EXACTAMENTE una de las ramas tomadas. Se unen con O.
            const branchDeps = deps.filter(d => branchTaken.has(d.source));
            const rest = deps.filter(d => !branchTaken.has(d.source));
            const branchOk = branchDeps.length === 0
                || branchDeps.some(d => branchTaken.get(d.source).has(d.handle || null));
            const normal = rest.filter(d => d.handle !== 'no');
            const negativos = rest.filter(d => d.handle === 'no');
            const normalOk = normal.length === 0 || normal.every(d => outcome.get(d.source) === 'pass');
            const negativoOk = negativos.length === 0 || negativos.some(d => outcome.get(d.source) === 'fail');
            return branchOk && normalOk && negativoOk;
        };

        for (const node of order) {
            const deps = incoming.get(node.id) || [];
            const eligible = isEligible(deps, node);
            if (!eligible) {
                outcome.set(node.id, 'unreached');
                passed.set(node.id, false);
                continue;
            }

            // Reanudación de un nodo "esperando_respuesta": fija la rama tomada (Sí = coincidió
            // una frase / No = timeout) y continúa DESPUÉS de él, sin re-ejecutar ni re-registrar
            // la espera. Va ANTES del reuse del ledger porque el nodo quedó marcado '1' al pausar,
            // y necesitamos setear branchTaken para rutear la rama correcta.
            if (opts.resumeWait && node.id === opts.resumeWait.nodeId) {
                branchTaken.set(node.id, new Set([opts.resumeWait.handle]));
                outcome.set(node.id, 'pass');
                passed.set(node.id, true);
                continue;
            }

            // Resume: nodo ya hecho en una corrida previa → reusa resultado, no re-ejecuta.
            if (Object.prototype.hasOwnProperty.call(prior, node.id)) {
                const priorPass = prior[node.id] === '1';
                // Excepción: 'frase_dinamica' no tiene efectos externos (solo fija una variable
                // en memoria para los WhatsApp siguientes). Al reanudar un flujo pausado hay que
                // re-aplicar su valor aunque ya cuente como ejecutado, o los mensajes posteriores
                // a la pausa perderían la frase.
                if (priorPass && node.type === 'frase_dinamica') {
                    opts._dynamicPhrase = typeof node.data?.value === 'string' ? node.data.value : '';
                }
                outcome.set(node.id, priorPass ? 'pass' : 'fail');
                passed.set(node.id, priorPass);
                continue;
            }

            const result = await evaluateOrExecute(node, candidate, flow.id, redis, opts);

            // ⏸️ PAUSA (nodo "esperando_respuesta"): marca el nodo como hecho para reanudar
            // DESPUÉS de él y detiene la corrida SIN marcar el flujo completado (no sadd execKey,
            // no borra el ledger). El TTL del ledger se alarga a la ventana de espera para que
            // una reanudación tardía no re-empiece el flujo desde cero.
            if (result && typeof result === 'object' && result.__pause) {
                if (useClaim) {
                    await redis.pipeline()
                        .hset(progressKey, node.id, '1')
                        .expire(progressKey, result.ttlSec || PROGRESS_TTL_SEC)
                        .exec();
                }
                passed.set(node.id, true);
                return passed;
            }

            outcome.set(node.id, result ? 'pass' : 'fail');
            passed.set(node.id, result);

            // Persistir el avance ANTES de seguir: si la instancia muere aquí, el próximo
            // disparo retoma desde el siguiente nodo (no re-envía lo ya enviado).
            // En modo ephemeral no hay ledger: cada disparo del cron corre fresco.
            if (useClaim) {
                await redis.pipeline()
                    .hset(progressKey, node.id, result ? '1' : '0')
                    .expire(progressKey, PROGRESS_TTL_SEC)
                    .exec();
            }
        }

        // Grafo completo → marcar candidato como terminado y limpiar el ledger.
        // (No en ephemeral: no se marca "completado para siempre" — puede volver a disparar.)
        if (useClaim) {
            await redis.pipeline().sadd(execKey, candidateId).del(progressKey).exec();
        }
    } finally {
        if (lockAcquired) await redis.del(lockKey).catch(() => {});
    }

    return passed;
}

// Punto de entrada en vivo — llamado (vía waitUntil, ver api/utils/background.js) desde
// api/ai/agent.js con el snapshot del candidato ya mergeado. Nunca lanza.
//
// Los flujos activos corren en SECUENCIA (no en paralelo) sobre UN MISMO objeto candidato
// compartido: así una etiqueta/proyecto que agrega un flujo ya está presente cuando corre
// el siguiente. Antes corrían con Promise.allSettled y cada uno con su propio snapshot
// stale → el updateCandidate de uno pisaba al del otro (read-modify-write no atómico).
// El objeto opts compartido también preserva la pausa entre envíos ENTRE flujos (no solo
// dentro de uno), para no atropellar a Meta con ráfagas al mismo candidato.
export async function runFlowsForCandidate(candidateId, candidateSnapshot) {
    try {
        const redis = getRedisClient();
        if (!redis || !candidateSnapshot?.id || !candidateSnapshot?.whatsapp) return;

        const raw = await getCachedConfig(redis, FLOWS_KEY);
        const flows = raw ? JSON.parse(raw) : [];
        // Los flujos de INCOMPLETOS EN SILENCIO se disparan por cron (por AUSENCIA de
        // respuesta), no en este path en vivo (que corre al COMPLETAR el perfil). Se
        // excluyen aquí para que el evento de completado nunca los dispare.
        const active = flows.filter(f => f.active && Array.isArray(f.nodes) && f.nodes.length
            && !f.nodes.some(n => n.type === 'inicio_incompleto_silencio')
            // Excluye los flujos cuyo Inicio dispara SOLO 'al_regresar': esos no deben
            // correr en el flanco de completado. Los que incluyen 'al_completar' (o no
            // tienen trigger = legado) sí corren aquí, exactamente como antes.
            && getInicioTrigger(f).includes('al_completar'));
        if (!active.length) return;

        const candidate = { ...candidateSnapshot };
        const opts = {};
        for (const flow of active) {
            try {
                await runOneFlow(redis, flow, candidateId, candidate, opts);
            } catch (e) {
                console.error(`[FLOW-ENGINE] flujo ${flow.id} para candidato ${candidateId}:`, e?.message);
            }
        }
    } catch (e) {
        console.error('[FLOW-ENGINE] runFlowsForCandidate:', e?.message);
    }
}

// 🔁 DISPARADOR "CANDIDATO QUE REGRESA" (event-driven, en vivo): lo llama agent.js cuando
// llega un mensaje de un candidato YA COMPLETO, ANTES de la Sala de Espera. Corre los flujos
// cuyo Inicio dispara 'al_regresar' y que además cumplen la señal (click de anuncio o frase),
// la antigüedad y la cadencia configuradas en el nodo. Corre en modo `ephemeral` (re-ejecuta
// las acciones sin el dedupe permanente de flow:executed) — la cadencia la gobierna el
// contador flow:return:count, no el "ya completado". Devuelve cuántos flujos disparó (0 = no
// aplicó): agent.js usa eso para callar a Brenda-extractora (que el flujo hable, no la Sala).
// Espejo estructural de runFlowForIncompleteSilence, pero disparado por evento en vez de cron.
export async function runReturningFlowsForCandidate(candidateId, candidateSnapshot, { incomingText = '' } = {}) {
    try {
        const redis = getRedisClient();
        if (!redis || !candidateSnapshot?.id || !candidateSnapshot?.whatsapp) return 0;
        // Solo completos (el caller ya lo garantiza; doble candado barato por si acaso).
        if (!isProfileComplete(candidateSnapshot)) return 0;

        const raw = await getCachedConfig(redis, FLOWS_KEY);
        const flows = raw ? JSON.parse(raw) : [];
        const returnFlows = (Array.isArray(flows) ? flows : []).filter(f =>
            f.active && Array.isArray(f.nodes) && f.nodes.length
            && getInicioTrigger(f).includes('al_regresar'));
        if (!returnFlows.length) return 0;

        // ¿Este turno vino de un click de anuncio? (marca transitoria puesta por el webhook)
        const adClicked = !!(await redis.get(`${RETURN_ADCLICK_PREFIX}${candidateId}`).catch(() => null));
        const now = Date.now();
        const completedAt = candidateSnapshot.paso2CompletadoAt
            ? new Date(candidateSnapshot.paso2CompletadoAt).getTime() : 0;

        const eligible = [];
        for (const flow of returnFlows) {
            const inicio = flow.nodes.find(n => n.type === 'inicio');
            const d = inicio?.data || {};

            // 1) SEÑAL — anuncio y/o frase (OR). Default: si no configuran nada, exige anuncio.
            const wantAd = d.returnOnAd !== false;   // default true
            const wantPhrase = !!d.returnOnPhrase;
            let signal = false;
            if (wantAd && adClicked) signal = true;
            if (!signal && wantPhrase) {
                const grupos = Array.isArray(d.returnGrupos) ? d.returnGrupos : [];
                if (grupos.some(g => flowTextMatchesGroup(incomingText, g, d.returnMatchMode))) signal = true;
            }
            if (!signal) continue;

            // 2) ANTIGÜEDAD — solo si completó hace ≥ N días. Sin paso2CompletadoAt (completos
            // viejos, previos a esta feature) no se puede medir → no bloquea.
            const minDays = Number(d.minReturnDays) || 0;
            if (minDays > 0 && completedAt && (now - completedAt) < minDays * 86400000) continue;

            // 3) CADENCIA — tope de disparos + cooldown entre disparos.
            const maxReturns = Number(d.maxReturns) || 0;        // 0 = sin tope
            const cooldownDays = Number(d.returnCooldownDays) || 0;
            const [lastFireRaw, countRaw] = await Promise.all([
                redis.hget(`${RETURN_FIRE_PREFIX}${flow.id}`, candidateId).catch(() => null),
                redis.hget(`${RETURN_COUNT_PREFIX}${flow.id}`, candidateId).catch(() => null),
            ]);
            const lastFire = Number(lastFireRaw) || 0;
            const count = Number(countRaw) || 0;
            if (cooldownDays > 0 && lastFire && (now - lastFire) < cooldownDays * 86400000) continue;
            if (maxReturns > 0 && count >= maxReturns) continue;

            eligible.push(flow);
        }
        if (!eligible.length) return 0;

        // Reserva la cadencia YA (antes de ejecutar) para que dos mensajes seguidos no
        // disparen doble, y consume la marca de adclick (un click = un disparo).
        const pipe = redis.pipeline();
        for (const flow of eligible) {
            pipe.hincrby(`${RETURN_COUNT_PREFIX}${flow.id}`, candidateId, 1);
            pipe.hset(`${RETURN_FIRE_PREFIX}${flow.id}`, candidateId, String(now));
        }
        if (adClicked) pipe.del(`${RETURN_ADCLICK_PREFIX}${candidateId}`);
        await pipe.exec().catch(() => {});

        // Ejecuta en segundo plano (envíos con pausa no bloquean el turno de Brenda). El
        // ephemeral re-corre el grafo fresco; el ruteo por vacante lo hace el nodo Etiqueta
        // en modo "actual" contra vacanteActual.
        runInBackground((async () => {
            for (const flow of eligible) {
                await runOneFlow(redis, flow, candidateId, { ...candidateSnapshot }, { ephemeral: true })
                    .catch(e => console.error(`[FLOW-RETURN] flujo ${flow.id} candidato ${candidateId}:`, e?.message));
            }
        })());

        return eligible.length;
    } catch (e) {
        console.error('[FLOW-ENGINE] runReturningFlowsForCandidate:', e?.message);
        return 0;
    }
}

// 👂 REANUDACIÓN POR MENSAJE (nodo "esperando_respuesta"): lo llama el BLOCK SHIELD de
// api/ai/agent.js cuando llega un mensaje de un candidato con Brenda en silencio (blocked).
// Busca si el candidato tiene un flujo pausado esperando una frase; si el texto coincide,
// reanuda el flujo por la rama "Sí"; si la espera ya expiró, reanuda por la rama "No" (timeout).
// Devuelve true si reanudó algún flujo (para telemetría/decisiones del caller). Nunca lanza.
export async function resumeWaitingFlowIfMatch(candidateId, candidateSnapshot, incomingText) {
    try {
        const redis = getRedisClient();
        if (!redis || !candidateId || !incomingText || typeof incomingText !== 'string') return false;

        const key = `${WAITING_PREFIX}${candidateId}`;
        const all = await redis.hgetall(key);
        if (!all || !Object.keys(all).length) return false;

        const raw = await getCachedConfig(redis, FLOWS_KEY);
        const flows = raw ? JSON.parse(raw) : [];
        const now = Date.now();

        for (const [flowId, val] of Object.entries(all)) {
            let st;
            try { st = JSON.parse(val); } catch { await redis.hdel(key, flowId).catch(() => {}); continue; }

            const expired = st.expiresAt && now > Number(st.expiresAt);
            let matched = false;
            if (!expired) {
                for (const g of (Array.isArray(st.grupos) ? st.grupos : [])) {
                    if (flowTextMatchesGroup(incomingText, g, st.matchMode)) { matched = true; break; }
                }
            }

            // Ni coincidió ni expiró → sigue esperando (no consume el registro).
            if (!matched && !expired) continue;

            // Consume la espera ANTES de reanudar (idempotencia: un mensaje = una reanudación).
            await redis.hdel(key, flowId).catch(() => {});

            const flow = flows.find(f => f.id === flowId && f.active && Array.isArray(f.nodes) && f.nodes.length);
            if (!flow) continue; // el flujo se borró/desactivó mientras esperaba → se descarta la espera

            const handle = matched ? 'si' : 'no'; // 'si' = coincidió · 'no' = timeout
            await runOneFlow(redis, flow, candidateId, { ...candidateSnapshot }, {
                resumeWait: { nodeId: st.nodeId, handle }
            });
            return true; // una reanudación por mensaje
        }
        return false;
    } catch (e) {
        console.error('[FLOW-ENGINE] resumeWaitingFlowIfMatch:', e?.message);
        return false;
    }
}

// Nodo "test" del editor: corre el flujo COMPLETO contra un candidato real (por
// teléfono), saltando el filtro `flow.active` (para poder probar un borrador antes de
// activarlo) y el claim de dedupe de producción (para poder repetir la prueba las veces
// que haga falta) y sin tocar los contadores reales. Las acciones (WhatsApp, etiquetas,
// recordatorio, proyecto) SÍ se ejecutan de verdad — es la manera de confirmar que el
// flujo hace lo que debe antes de activarlo.
export async function runFlowTest(flow, candidateSnapshot) {
    const redis = getRedisClient();
    if (!redis) throw new Error('Redis no disponible');
    if (!candidateSnapshot?.id || !candidateSnapshot?.whatsapp) throw new Error('Candidato inválido');

    const passed = await runOneFlow(redis, flow, candidateSnapshot.id, { ...candidateSnapshot }, { skipClaim: true, skipCounters: true });
    return Object.fromEntries(passed);
}

// Disparador del cron de INCOMPLETOS EN SILENCIO (api/cron/flow-incompletos.js): corre
// el flujo REAL para un candidato en modo ephemeral — sin dedupe permanente (la cadencia
// la controla el contador de pases del cron) pero con lock de concurrencia y contadores.
// El cron ya validó incompleto + silencio + tope de pases antes de llamar aquí.
export async function runFlowForIncompleteSilence(flow, candidateId, candidateSnapshot) {
    const redis = getRedisClient();
    if (!redis || !candidateSnapshot?.id || !candidateSnapshot?.whatsapp) return new Map();
    return runOneFlow(redis, flow, candidateId, { ...candidateSnapshot }, { ephemeral: true });
}

// Nodo "inicio_lista": corre el flujo REAL para un candidato de la lista filtrada,
// disparado por el botón Run del nodo (uno a la vez, desde api/flows.js). Respeta el
// dedupe/ledger de producción (opts={}), a propósito: el botón Run se puede apretar
// varias veces, o retomar tras cerrar la pestaña a media corrida, sin volver a mandarle
// nada a un candidato que ya se completó — y una corrida que quedó a medias se RETOMA
// desde donde se quedó (ver runOneFlow) en vez de re-enviar todo o saltárselo entero.
export async function runFlowForListCandidate(flow, candidateSnapshot, opts = {}) {
    const redis = getRedisClient();
    if (!redis) throw new Error('Redis no disponible');
    if (!candidateSnapshot?.id || !candidateSnapshot?.whatsapp) throw new Error('Candidato inválido');

    // force = acción MANUAL desde el chat: el reclutador mete a ESTE candidato a propósito,
    // aunque ya haya completado el flujo antes. Limpiamos el marcador permanente de "ya
    // completado" (flow:executed) y el ledger de avance para que corra fresco y vuelva a
    // ejecutar las acciones. El "run" masivo del editor NO pasa force, así respeta el dedupe.
    const force = !!opts.force;
    if (force) {
        await redis.pipeline()
            .srem(`${EXEC_SET_PREFIX}${flow.id}`, candidateSnapshot.id)
            .del(`${PROGRESS_PREFIX}${flow.id}:${candidateSnapshot.id}`)
            .exec();
    } else if (await redis.sismember(`${EXEC_SET_PREFIX}${flow.id}`, candidateSnapshot.id)) {
        return { alreadyExecuted: true, passed: {} };
    }

    const passed = await runOneFlow(redis, flow, candidateSnapshot.id, { ...candidateSnapshot }, {});
    // passed vacío aquí = otra invocación tomó el lock (corriendo en paralelo) o justo se
    // marcó completado — de cualquier modo no hubo trabajo nuevo que reportar en esta llamada.
    // Con force nunca reportamos "ya pasó" (acabamos de limpiarlo y corrió a propósito).
    return { alreadyExecuted: !force && passed.size === 0, passed: Object.fromEntries(passed) };
}
