import { getRedisClient, isProfileComplete, updateCandidate, saveMessage, withCrmProjectLinksLock } from './storage.js';
import { getCachedConfig } from './cache.js';
import { getUltraMsgConfig, sendUltraMsgMessage } from '../whatsapp/utils.js';
import { substituteVariables, splitBubbles } from './shortcuts.js';
import { getBotVacancies, vacancyMessageText } from './agent-ia.js';

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
export const EXEC_SET_PREFIX = 'flow:executed:v1:';
export const COUNTER_PREFIX = 'flow:counter:v1:';

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

export function resolveReminderSendAt(tpl) {
    const days = Number(tpl.dayOffset) || 0;
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

function topoSort(nodes, edges) {
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

function buildIncomingMap(edges) {
    const incoming = new Map();
    for (const e of edges) {
        if (!incoming.has(e.target)) incoming.set(e.target, []);
        incoming.get(e.target).push(e.source);
    }
    return incoming;
}

async function evaluateOrExecute(node, candidate, flowId, redis, opts = {}) {
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

        case 'etiqueta': {
            const mode = data.mode || 'todas';
            const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
            if (mode === 'todas') return true;
            if (mode === 'ninguna') return tags.length === 0;
            if (mode === 'especifica') {
                if (!data.tag) return true; // sin configurar aún → no bloquea
                return tags.includes(data.tag);
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
                    const locRes = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, qr.location.address || '', 'location', {
                        name: qr.location.name, address: qr.location.address, lat: qr.location.lat, lng: qr.location.lng
                    });
                    if (locRes?.success) {
                        await saveMessage(candidate.id, {
                            from: 'me', content: `[Ubicación: ${qr.location.name || 'Mapa'}]`, timestamp: new Date().toISOString(),
                            meta: { flow: true, flowId, nodeId: node.id }
                        }).catch(() => {});
                    }
                    return true;
                }

                if (qrType === 'audio' && qr.audioUrl) {
                    const audioRes = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, toAbsoluteMediaUrl(qr.audioUrl), 'audio', { voice: !!qr.voice });
                    if (audioRes?.success) {
                        await saveMessage(candidate.id, {
                            from: 'me', content: qr.voice ? '🎤 Nota de voz' : '🎵 Audio', type: 'audio', mediaUrl: qr.audioUrl,
                            timestamp: new Date().toISOString(), meta: { flow: true, flowId, nodeId: node.id }
                        }).catch(() => {});
                    }
                    return true;
                }

                if (qrType === 'document' && qr.documentUrl) {
                    const caption = qr.message ? substituteVariables(qr.message, candidate) : '';
                    const docRes = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, toAbsoluteMediaUrl(qr.documentUrl), 'document', {
                        filename: qr.documentName || 'documento.pdf', caption
                    });
                    if (docRes?.success) {
                        await saveMessage(candidate.id, {
                            from: 'me', content: caption, type: 'document', mediaUrl: qr.documentUrl, filename: qr.documentName || 'documento.pdf',
                            timestamp: new Date().toISOString(), meta: { flow: true, flowId, nodeId: node.id }
                        }).catch(() => {});
                    }
                    return true;
                }

                // type 'text' (default): texto (posiblemente partido en varias burbujas
                // por [burbuja]) + hasta 4 imágenes del banco.
                if (qr.message) {
                    const text = substituteVariables(qr.message, candidate);
                    for (const bubbleText of splitBubbles(text)) {
                        const textRes = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, bubbleText, 'chat', { priority: 1 });
                        if (textRes?.success) {
                            await saveMessage(candidate.id, {
                                from: 'me', content: bubbleText, timestamp: new Date().toISOString(),
                                meta: { flow: true, flowId, nodeId: node.id }
                            }).catch(() => {});
                        }
                    }
                }
                const bankImages = Array.isArray(qr.imageUrls) && qr.imageUrls.length ? qr.imageUrls : [qr.imageUrl].filter(Boolean);
                for (const imgUrl of bankImages) {
                    const imgRes = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, toAbsoluteMediaUrl(imgUrl), 'image', { priority: 1 });
                    if (imgRes?.success) {
                        await saveMessage(candidate.id, {
                            from: 'me', content: '', type: 'image', mediaUrl: imgUrl,
                            timestamp: new Date().toISOString(), meta: { flow: true, flowId, nodeId: node.id }
                        }).catch(() => {});
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
                const sendResult = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, text, 'chat', { priority: 1 });
                if (sendResult?.success) {
                    await saveMessage(candidate.id, {
                        from: 'me', content: text, timestamp: new Date().toISOString(),
                        meta: { flow: true, flowId, nodeId: node.id }
                    }).catch(() => {});
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

                const text = substituteVariables(data.message, candidate);
                for (const bubbleText of splitBubbles(text)) {
                    const sendResult = await sendUltraMsgMessage(config.instanceId, config.token, cleanTo, bubbleText, 'chat', { priority: 1 });
                    if (sendResult?.success) {
                        await saveMessage(candidate.id, {
                            from: 'me', content: bubbleText, timestamp: new Date().toISOString(),
                            meta: { flow: true, flowId, nodeId: node.id }
                        }).catch(() => {});
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
                const [[, added], [, count]] = await redis.pipeline()
                    .sadd(counterKey, candidate.id)
                    .scard(counterKey)
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

// opts.skipClaim: no reclama/consulta el dedupe de producción (modo test, para poder
// repetir la corrida). opts.skipCounters: no incrementa los nodos "contador" (modo
// test, para no inflar la métrica real con corridas manuales).
// Devuelve un Map<nodeId, boolean> con el resultado de cada nodo alcanzable —
// usado por el modo test para mostrarle al usuario hasta dónde llegó la corrida
// (los nodos fuera del Map nunca se evaluaron, ej. ciclo o desconectados de "inicio").
async function runOneFlow(redis, flow, candidateId, candidate, opts = {}) {
    const passed = new Map();

    if (!opts.skipClaim) {
        const claimed = await redis.sadd(`${EXEC_SET_PREFIX}${flow.id}`, candidateId);
        if (claimed === 0) return passed; // ya ejecutado para este candidato (webhook reintentado)
    }

    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    const edges = Array.isArray(flow.edges) ? flow.edges : [];
    if (!nodes.length) return passed;

    const order = topoSort(nodes, edges);
    const incoming = buildIncomingMap(edges);

    for (const node of order) {
        const preds = incoming.get(node.id) || [];
        const eligible = preds.length === 0 || preds.every(p => passed.get(p) === true);
        if (!eligible) {
            passed.set(node.id, false);
            continue;
        }
        passed.set(node.id, await evaluateOrExecute(node, candidate, flow.id, redis, opts));
    }

    return passed;
}

// Punto de entrada — llamado fire-and-forget desde api/ai/agent.js con el snapshot
// del candidato ya mergeado (para no releer Redis). Nunca lanza: todo error se traga.
export async function runFlowsForCandidate(candidateId, candidateSnapshot) {
    try {
        const redis = getRedisClient();
        if (!redis || !candidateSnapshot?.id || !candidateSnapshot?.whatsapp) return;

        const raw = await getCachedConfig(redis, FLOWS_KEY);
        const flows = raw ? JSON.parse(raw) : [];
        const active = flows.filter(f => f.active && Array.isArray(f.nodes) && f.nodes.length);
        if (!active.length) return;

        await Promise.allSettled(active.map(flow => runOneFlow(redis, flow, candidateId, { ...candidateSnapshot })));
    } catch (e) {
        console.error('[FLOW-ENGINE] runFlowsForCandidate:', e?.message);
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

// Nodo "inicio_lista": corre el flujo REAL para un candidato de la lista filtrada,
// disparado por el botón Run del nodo (uno a la vez, desde api/flows.js). A diferencia
// de runFlowTest, aquí SÍ se respeta el dedupe de producción (opts={} → runOneFlow
// reclama flow:executed:v1:{flowId}), a propósito: así el botón Run se puede apretar
// varias veces, o retomar tras cerrar la pestaña a la mitad, sin volver a mandarle nada
// a un candidato que ya se procesó. `passed.size === 0` tras un runOneFlow normal solo
// puede significar que el claim fue rechazado (ya estaba en el set) — cualquier corrida
// real evalúa al menos el nodo inicio_lista mismo, que siempre queda en el Map.
export async function runFlowForListCandidate(flow, candidateSnapshot) {
    const redis = getRedisClient();
    if (!redis) throw new Error('Redis no disponible');
    if (!candidateSnapshot?.id || !candidateSnapshot?.whatsapp) throw new Error('Candidato inválido');

    const passed = await runOneFlow(redis, flow, candidateSnapshot.id, { ...candidateSnapshot }, {});
    return { alreadyExecuted: passed.size === 0, passed: Object.fromEntries(passed) };
}
