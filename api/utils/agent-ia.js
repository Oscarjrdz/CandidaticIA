/**
 * Agent IA — infraestructura base del agente propio de Oscar (Claude nativo).
 *
 * Reutiliza la integración del SDK oficial de Anthropic (@anthropic-ai/sdk,
 * claude-opus-4-8, adaptive thinking, tool use). A diferencia del sistema anterior
 * de skills SKILL.md (eliminado), este agente se define con DOS documentos vivos que
 * viven en Redis (fuente de verdad del proyecto) y son editables desde la UI y por el
 * propio agente vía tool use:
 *
 *   - AGENTS.md  → la definición/comportamiento del agente (system prompt).
 *   - MEMORY.md  → aprendizajes y mejoras que el agente acumula; el agente PROPONE
 *                  entradas y el humano las aprueba antes de que entren a MEMORY.md.
 *
 * En Vercel el filesystem es de solo lectura en producción, así que estos documentos
 * NO pueden vivir como archivos de git editables en runtime — por eso Redis.
 *
 * REQUIERE la variable de entorno ANTHROPIC_API_KEY. Sin ella, getAnthropicClient()
 * devuelve null y los endpoints responden un aviso claro (no se rompen).
 */
import Anthropic from '@anthropic-ai/sdk';
import { getUsers, validateAdminSession, getRedisClient, getCandidateByPhone, getMessages, getCandidates } from './storage.js';

// Modelo del agente. Se eligió Haiku 4.5 por costo: ~5x más barato que Opus
// ($1/$5 vs $5/$25 por millón), suficiente para acciones repetidas (tool use +
// respuestas cortas). Nota: Haiku 4.5 NO soporta `effort` ni `adaptive thinking`
// (son de modelos 4.6+); por eso las llamadas en chat.js van SIN thinking ni
// output_config (menos tokens de salida = más barato). Para más razonamiento
// subir a 'claude-sonnet-5' o 'claude-opus-4-8' y reactivar thinking allá.
export const AGENT_MODEL = 'claude-haiku-4-5';

// ─── Llaves de Redis ─────────────────────────────────────────────────────────
const KEY_AGENTS_MD = 'agent-ia:agents_md';
const KEY_MEMORY_MD = 'agent-ia:memory_md';
const KEY_MEMORY_PENDING = 'agent-ia:memory_pending'; // JSON: [{id, text, createdAt}]
const KEY_SKILLS = 'agent-ia:skills'; // JSON: [{id, name, content, updatedAt}]

// ─── Auth: solo SuperAdmin (mismo patrón que el resto de la plataforma) ──────
export async function requireSuperAdmin(req, res) {
    const userId = await validateAdminSession(req);
    if (!userId) {
        res.status(401).json({ success: false, error: 'No autorizado' });
        return null;
    }
    const users = await getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user || user.role !== 'SuperAdmin') {
        res.status(403).json({ success: false, error: 'Solo SuperAdmin puede usar Agent IA' });
        return null;
    }
    return user;
}

// ─── Cliente Anthropic ───────────────────────────────────────────────────────
export function getAnthropicClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return new Anthropic({ apiKey });
}

export function hasAnthropicKey() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ─── Documento AGENTS.md (definición del agente) ─────────────────────────────
// Semilla mínima para "definir desde la base": el usuario la reescribe a su gusto,
// o el propio agente la ajusta con la herramienta editar_agents_md.
export const DEFAULT_AGENTS_MD = `# Agente

Eres el agente de Candidatic. Este documento (AGENTS.md) es tu definición: quién eres,
qué haces y cómo te comportas. Está vacío a propósito — se irá construyendo desde la base.

## Comportamiento

- Sé claro, directo y honesto. Si no sabes algo, dilo.
- Puedes EDITAR este mismo documento con la herramienta \`editar_agents_md\` cuando el
  usuario te pida cambiar tu definición o comportamiento.
- Cuando aprendas algo que valga la pena recordar entre conversaciones, PROPONLO con la
  herramienta \`proponer_memoria\`. No lo des por guardado: el usuario lo aprueba.

## Memoria

Tu memoria acumulada (MEMORY.md) se te entrega junto a este documento en cada
conversación. Úsala como contexto de lo aprendido.
`;

export async function getAgentsMd() {
    const redis = getRedisClient();
    if (!redis) return DEFAULT_AGENTS_MD;
    try {
        const raw = await redis.get(KEY_AGENTS_MD);
        return raw != null ? raw : DEFAULT_AGENTS_MD;
    } catch {
        return DEFAULT_AGENTS_MD;
    }
}

export async function setAgentsMd(content) {
    const redis = getRedisClient();
    if (!redis) return false;
    await redis.set(KEY_AGENTS_MD, String(content ?? ''));
    return true;
}

// ─── SKILL: datos de solo lectura de Candidatic (etiquetas + banco de respuestas) ──
// Lee las mismas llaves de Redis que usa la plataforma, así el agente ve lo real.

// Etiquetas CON su cantidad. BARATO: lee los contadores que la plataforma ya
// mantiene incrementalmente (candidatic:tag_counts = HASH, candidatic:untagged_count),
// NO escanea candidatos ni gasta tokens. Combina con candidatic:chat_tags para
// incluir también etiquetas definidas que tengan 0 candidatos.
export async function getTagCounts() {
    const redis = getRedisClient();
    if (!redis) return null;
    try {
        const [rawTags, rawCounts, rawUntagged] = await Promise.all([
            redis.get('candidatic:chat_tags'),
            redis.hgetall('candidatic:tag_counts'),
            redis.get('candidatic:untagged_count')
        ]);
        let defined = [];
        try {
            const l = rawTags ? JSON.parse(rawTags) : [];
            defined = (Array.isArray(l) ? l : [])
                .map((t) => (typeof t === 'string' ? t : t?.name))
                .map((n) => String(n || '').trim())
                .filter(Boolean);
        } catch { /* ignorar json malo */ }
        const countMap = rawCounts || {};
        const names = new Set(defined);
        Object.keys(countMap).forEach((k) => { if (k) names.add(k); });
        const tags = [...names]
            .map((name) => ({ name, count: parseInt(countMap[name], 10) || 0 }))
            .sort((a, b) => b.count - a.count);
        const untagged = Math.max(0, parseInt(rawUntagged, 10) || 0);
        return { tags, untagged };
    } catch {
        return null;
    }
}

// Conteo de candidatos completos vs incompletos vs no leídos. BARATO: cardinalidad de SETs
// que la plataforma ya mantiene (SCARD es O(1)), sin escanear ni tokens.
export async function getCandidateCounts() {
    const redis = getRedisClient();
    if (!redis) return null;
    try {
        const [complete, pending, unread] = await Promise.all([
            redis.scard('stats:list:complete'),
            redis.scard('stats:list:pending'),
            redis.scard('candidates:unread')
        ]);
        const completeN = Number(complete) || 0;
        const incompleteN = Number(pending) || 0;
        const unreadN = Number(unread) || 0;
        return { complete: completeN, incomplete: incompleteN, unread: unreadN, total: completeN + incompleteN };
    } catch {
        return null;
    }
}

// Consultas cruzadas de candidatos por intersección de SETs en Redis (SINTER = O(N)).
// BARATO: Cruza etiqueta (index:candidates:tag:<b64>), estado (stats:list:complete/pending)
// y lectura (candidates:unread) en una sola operación de Redis sin gastar tokens.
export async function getCrossedCandidateCounts({ etiqueta, estado, noLeidos } = {}) {
    const redis = getRedisClient();
    if (!redis) return null;
    try {
        let canonicalTag = null;
        if (etiqueta) {
            canonicalTag = await resolveTagName(etiqueta);
            if (!canonicalTag) {
                return { error: `No encontré una etiqueta que coincida con "${etiqueta}". Usa contar_etiquetas para ver los nombres reales.` };
            }
        }

        const setKeys = [];

        if (canonicalTag) {
            const tagB64 = Buffer.from(String(canonicalTag).trim().toLowerCase()).toString('base64url');
            setKeys.push(`index:candidates:tag:${tagB64}`);
        }

        const est = String(estado || '').toLowerCase().trim();
        if (est === 'completo' || est === 'completos') {
            setKeys.push('stats:list:complete');
        } else if (est === 'incompleto' || est === 'incompletos' || est === 'pendiente' || est === 'pendientes') {
            setKeys.push('stats:list:pending');
        }

        const isUnread = noLeidos === true || String(noLeidos).toLowerCase() === 'true' || String(noLeidos).toLowerCase() === 'si' || String(noLeidos).toLowerCase() === 'sí';
        if (isUnread) {
            setKeys.push('candidates:unread');
        }

        if (setKeys.length === 0) {
            return await getCandidateCounts();
        }

        let matchingIds = [];
        if (setKeys.length === 1) {
            matchingIds = await redis.smembers(setKeys[0]);
        } else {
            matchingIds = await redis.sinter(...setKeys);
        }

        const totalMatches = matchingIds ? matchingIds.length : 0;

        let sampleNames = [];
        if (totalMatches > 0) {
            const sampleIds = matchingIds.slice(0, 3);
            const pipe = redis.pipeline();
            // candidate:<id> es un JSON string (.set/.get), NO un hash: leer con GET + parse.
            sampleIds.forEach((id) => pipe.get(`candidate:${id}`));
            const results = await pipe.exec();
            sampleNames = (results || []).map(([, raw]) => {
                try {
                    const c = raw ? JSON.parse(raw) : null;
                    return c ? (c.nombreReal || c.nombre || null) : null;
                } catch {
                    return null;
                }
            }).filter(Boolean);
        }

        return {
            tag: canonicalTag,
            estadoFilter: est || 'todos',
            noLeidosFilter: isUnread,
            count: totalMatches,
            sample: sampleNames
        };
    } catch (err) {
        console.error('Error in getCrossedCandidateCounts:', err);
        return null;
    }
}

// Obtiene la plantilla del Banco de Respuestas por coincidencia exacta o parcial
export async function getQuickReplyByName(query) {
    const redis = getRedisClient();
    if (!redis || !query) return null;
    const q = String(query).trim().toLowerCase();
    try {
        const raw = await redis.get('candidatic:quick_replies');
        const list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) return null;
        return list.find((r) => String(r?.name || r?.title || '').trim().toLowerCase() === q)
            || list.find((r) => String(r?.name || r?.title || '').trim().toLowerCase().includes(q))
            || null;
    } catch {
        return null;
    }
}

// Busca UN candidato por su teléfono (reusa getCandidateByPhone de storage, que ya
// maneja variantes de prefijo de México: 10 dígitos, 52+10, 521+10). Devuelve un
// resumen legible para el agente. { candidate } | { notFound: true } | { error }.
export async function findCandidateByPhone(telefono) {
    const clean = String(telefono || '').replace(/\D/g, '');
    if (!clean) return { error: 'Teléfono vacío o inválido.' };
    try {
        const c = await getCandidateByPhone(clean);
        if (!c) return { notFound: true, telefono: clean };
        const cleanPhone = String(c.whatsapp || '').replace(/\D/g, '');
        const tags = Array.isArray(c.tags) ? c.tags : (Array.isArray(c.etiquetas) ? c.etiquetas : []);
        return {
            candidate: {
                id: c.id,
                name: c.nombreReal || c.nombre || `Candidato ${c.id}`,
                phone: cleanPhone ? `+${cleanPhone}` : 'Sin WhatsApp',
                municipio: c.municipio || null,
                escolaridad: c.escolaridad || null,
                categoria: c.categoria || null,
                edad: c.edad || null,
                colonia: c.colonia || null,
                completo: c.paso2Estado === 'completo',
                etiquetas: tags.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean)
            }
        };
    } catch (err) {
        console.error('Error in findCandidateByPhone:', err);
        return { error: 'No pude buscar el candidato en este momento.' };
    }
}

// Busca UN candidato por nombre (o parte del nombre) reusando el mismo search que ya
// usa el Chat Web (getCandidates con `search`) — sin índice nuevo, mismo comportamiento
// que ya conocen los reclutadores en la barra de búsqueda. Puede devolver 0, 1 o varios
// resultados: { notFound } | { candidate } (match único) | { multiple, candidates } (a
// desambiguar) | { error }.
export async function findCandidateByName(nombre) {
    const query = String(nombre || '').trim();
    if (!query) return { error: 'Nombre vacío.' };
    try {
        const { candidates } = await getCandidates(6, 0, query);
        if (!candidates || candidates.length === 0) return { notFound: true, query };

        const toSummary = (c) => {
            const cleanPhone = String(c.whatsapp || '').replace(/\D/g, '');
            const tags = Array.isArray(c.tags) ? c.tags : (Array.isArray(c.etiquetas) ? c.etiquetas : []);
            return {
                id: c.id,
                name: c.nombreReal || c.nombre || `Candidato ${c.id}`,
                phone: cleanPhone ? `+${cleanPhone}` : 'Sin WhatsApp',
                municipio: c.municipio || null,
                escolaridad: c.escolaridad || null,
                categoria: c.categoria || null,
                edad: c.edad || null,
                colonia: c.colonia || null,
                completo: c.paso2Estado === 'completo',
                etiquetas: tags.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean)
            };
        };

        if (candidates.length === 1) return { candidate: toSummary(candidates[0]) };
        return { multiple: true, candidates: candidates.map(toSummary) };
    } catch (err) {
        console.error('Error in findCandidateByName:', err);
        return { error: 'No pude buscar el candidato en este momento.' };
    }
}

// Busca UN candidato por teléfono O por nombre — detecta cuál es por la forma del
// texto (si tiene 8+ dígitos, es teléfono). Punto de entrada único para las tools que
// aceptan "telefono" o "nombre" (buscar_candidato, leer_chat_candidato).
export async function findCandidateByQuery({ telefono, nombre } = {}) {
    const tel = String(telefono || '').trim();
    if (tel) return findCandidateByPhone(tel);

    const nom = String(nombre || '').trim();
    if (nom) {
        const digitsOnly = nom.replace(/\D/g, '');
        if (digitsOnly.length >= 8) return findCandidateByPhone(digitsOnly);
        return findCandidateByName(nom);
    }

    return { error: 'Manda "telefono" o "nombre" para buscar al candidato.' };
}

// Arma la transcripción legible (orden cronológico, quién dijo qué) a partir de una
// lista de mensajes ya cargados — compartida por getCandidateChatTranscript (un
// candidato) y getMultipleCandidateChatTranscripts (varios a la vez).
function buildTranscript(messages, candidateName) {
    const sorted = [...messages].sort((a, b) => {
        const ta = new Date(a.timestamp || a.fecha || 0).getTime();
        const tb = new Date(b.timestamp || b.fecha || 0).getTime();
        return ta - tb;
    });

    const who = (m) => (m.from === 'me' ? 'Reclutador' : (m.from === 'bot' ? 'Brenda (bot)' : candidateName));
    const kindNote = (m) => {
        const kind = m.type || m.tipo || (m.mediaUrl ? 'image' : 'text');
        if (kind === 'image') return '[imagen]';
        if (kind === 'audio') return m.voice ? '[nota de voz]' : '[audio]';
        if (kind === 'location') return '[ubicación]';
        return '';
    };
    const transcript = sorted.map((m) => {
        const time = (m.timestamp || m.fecha || '').slice(0, 16).replace('T', ' ');
        const note = kindNote(m);
        const text = m.content ? m.content : (note || '(vacío)');
        return `[${time}] ${who(m)}: ${text}${m.content && note ? ` ${note}` : ''}`;
    }).join('\n');

    return { transcript, count: sorted.length };
}

// Transcripción legible de la conversación de WhatsApp de UN candidato (por teléfono
// o nombre). Reusa getMessages (mismo dato que ve /api/chat en el Chat Web) — así el
// agente puede leer qué se han dicho antes de responder preguntas o decidir una acción.
export async function getCandidateChatTranscript({ telefono, nombre } = {}, limite = 40) {
    const found = await findCandidateByQuery({ telefono, nombre });
    if (found?.error) return { error: found.error };
    if (found?.notFound) return { error: `No encontré ningún candidato con "${found.telefono || found.query || telefono || nombre}".` };
    if (found?.multiple) return { multiple: true, candidates: found.candidates };

    const c = found.candidate;
    const maxLimit = Math.min(100, Math.max(1, Number(limite) || 40));
    let messages;
    try {
        messages = await getMessages(c.id, maxLimit);
    } catch (err) {
        console.error('Error in getCandidateChatTranscript:', err);
        return { error: 'No pude leer el chat en este momento.' };
    }

    if (!Array.isArray(messages) || !messages.length) {
        return { candidate: c, transcript: '(sin mensajes)' };
    }

    const { transcript, count } = buildTranscript(messages, c.name);
    return { candidate: c, transcript, count };
}

// Trae la transcripción de VARIOS candidatos a la vez, filtrados por etiqueta/estado/
// no-leídos (mismo filtro que listar_candidatos) — para comparar/resumir patrones
// entre chats (ej. "qué preguntas hacen los de la etiqueta Yageo"). Cada candidato
// consume tokens, así que los límites son más chicos que leer_chat_candidato.
export async function getMultipleCandidateChatTranscripts({ etiqueta, estado, noLeidos, limiteCandidatos = 5, mensajesPorCandidato = 20 } = {}) {
    const maxCandidatos = Math.min(10, Math.max(1, Number(limiteCandidatos) || 5));
    const maxMensajes = Math.min(30, Math.max(5, Number(mensajesPorCandidato) || 20));

    const list = await getDetailedCandidatesList({ etiqueta, estado, noLeidos, limite: maxCandidatos });
    if (!list) return { error: 'No pude leer la lista de candidatos en este momento.' };
    if (list.error) return { error: list.error };
    if (!list.candidates.length) return { totalMatches: 0, transcripts: [] };

    const transcripts = [];
    for (const c of list.candidates) {
        try {
            const messages = await getMessages(c.id, maxMensajes);
            if (!Array.isArray(messages) || !messages.length) {
                transcripts.push({ name: c.name, phone: c.phone, transcript: '(sin mensajes)', count: 0 });
                continue;
            }
            const { transcript, count } = buildTranscript(messages, c.name);
            transcripts.push({ name: c.name, phone: c.phone, transcript, count });
        } catch (err) {
            console.error('Error building transcript for', c.id, err);
            transcripts.push({ name: c.name, phone: c.phone, transcript: '(error al leer este chat)', count: 0 });
        }
    }

    return { totalMatches: list.totalMatches, transcripts };
}

// Lista detallada (id, nombre completo, WhatsApp) de candidatos filtrados por etiqueta/estado/no-leídos
export async function getDetailedCandidatesList({ etiqueta, estado, noLeidos, limite = 20, candidatoIds } = {}) {
    const redis = getRedisClient();
    if (!redis) return null;
    try {
        let matchingIds = [];

        if (Array.isArray(candidatoIds) && candidatoIds.length > 0) {
            matchingIds = candidatoIds;
        } else {
            let canonicalTag = null;
            if (etiqueta) {
                canonicalTag = await resolveTagName(etiqueta);
                if (!canonicalTag) {
                    return { error: `No encontré una etiqueta que coincida con "${etiqueta}". Usa contar_etiquetas para ver las etiquetas reales.` };
                }
            }

            const setKeys = [];
            if (canonicalTag) {
                const tagB64 = Buffer.from(String(canonicalTag).trim().toLowerCase()).toString('base64url');
                setKeys.push(`index:candidates:tag:${tagB64}`);
            }

            const est = String(estado || '').toLowerCase().trim();
            if (est === 'completo' || est === 'completos') {
                setKeys.push('stats:list:complete');
            } else if (est === 'incompleto' || est === 'incompletos' || est === 'pendiente' || est === 'pendientes') {
                setKeys.push('stats:list:pending');
            }

            const isUnread = noLeidos === true || String(noLeidos).toLowerCase() === 'true' || String(noLeidos).toLowerCase() === 'si' || String(noLeidos).toLowerCase() === 'sí';
            if (isUnread) {
                setKeys.push('candidates:unread');
            }

            if (setKeys.length === 0) {
                matchingIds = await redis.smembers('stats:list:complete');
            } else if (setKeys.length === 1) {
                matchingIds = await redis.smembers(setKeys[0]);
            } else {
                matchingIds = await redis.sinter(...setKeys);
            }
        }

        const maxLimit = Math.min(50, Math.max(1, Number(limite) || 20));
        const targetIds = (matchingIds || []).slice(0, maxLimit);
        const totalMatches = matchingIds ? matchingIds.length : 0;

        if (targetIds.length === 0) {
            return {
                totalMatches: 0,
                candidates: []
            };
        }

        const pipe = redis.pipeline();
        // candidate:<id> es un JSON string (.set/.get), NO un hash: leer con GET + parse.
        targetIds.forEach((id) => pipe.get(`candidate:${id}`));
        const results = await pipe.exec();

        const candidates = targetIds.map((id, idx) => {
            const [, raw] = results[idx] || [];
            let c = null;
            try { c = raw ? JSON.parse(raw) : null; } catch { c = null; }
            if (!c) return { id, name: 'Candidato sin nombre', phone: 'Sin WhatsApp', rawPhone: '' };
            const cleanPhone = String(c.whatsapp || '').replace(/\D/g, '');
            const formattedPhone = cleanPhone ? `+${cleanPhone}` : 'Sin WhatsApp';
            return {
                id,
                name: c.nombreReal || c.nombre || `Candidato ${id}`,
                phone: formattedPhone,
                rawPhone: cleanPhone,
                municipio: c.municipio || null,
                escolaridad: c.escolaridad || null,
                categoria: c.categoria || null
            };
        });

        return {
            totalMatches,
            candidates
        };
    } catch (err) {
        console.error('Error in getDetailedCandidatesList:', err);
        return null;
    }
}

// Arma el payload de envío (mismo shape que consume agent-send.js) de UNA respuesta
// del banco: texto, imágenes, ubicación (maps) o audio, o una MEZCLA. Es una función
// PURA (sin Redis extra ni lista de candidatos) — la reusan tanto la propuesta masiva
// (proposeQuickReplyBulkSend) como el motor de Agent Candidatic (agent-attend.js), que
// envía directo sin pasar por una propuesta. { payload, mixSummary } | { error }.
export function buildBankSendPayload(qr, label) {
    const messageText = qr.message || qr.text || qr.content || '';
    const templateType = qr.type || 'text';
    const imageUrls = Array.isArray(qr.imageUrls)
        ? qr.imageUrls.filter(Boolean)
        : (qr.imageUrl ? [qr.imageUrl] : []);
    const location = (qr.location && qr.location.lat != null && qr.location.lng != null) ? qr.location : null;
    const audioUrl = qr.audioUrl || '';
    const voice = !!(qr.voice || qr.audioVoice);

    const hasPayload = Boolean(messageText || imageUrls.length || location || audioUrl);
    if (!hasPayload) {
        return { error: `La respuesta del banco "${qr.name || label || ''}" no tiene contenido para enviar.` };
    }

    const parts = [];
    if (messageText) parts.push('1 texto');
    if (imageUrls.length) parts.push(`${imageUrls.length} ${imageUrls.length === 1 ? 'imagen' : 'imágenes'}`);
    if (location) parts.push('ubicación (maps)');
    if (audioUrl) parts.push(voice ? 'nota de voz' : 'audio');
    const mixSummary = parts.join(' + ');

    return {
        payload: { templateType, messageText, imageUrls, location, audioUrl, voice },
        mixSummary
    };
}

// Crea la propuesta de envío masivo de una plantilla del Banco de Respuestas
export async function proposeQuickReplyBulkSend({ respuesta_banco, etiqueta, estado, noLeidos, limite = 20, candidatoIds }) {
    const redis = getRedisClient();
    if (!redis) return { error: 'Redis no disponible' };

    const qr = await getQuickReplyByName(respuesta_banco);
    if (!qr) {
        return { error: `No encontré la respuesta de banco "${respuesta_banco}". Usa listar_respuestas_banco para ver los nombres reales.` };
    }

    // Una respuesta del banco puede ser texto, imágenes, ubicación (maps) o audio,
    // o una MEZCLA (ej. texto + 2 imágenes = 3 mensajes). Cargamos TODAS las variantes
    // en la propuesta para que el envío las reproduzca igual que el envío manual.
    const built = buildBankSendPayload(qr, respuesta_banco);
    if (built.error) return built;

    return storeBulkProposal({
        templateName: qr.name || qr.title || respuesta_banco,
        ...built.payload,       // templateType, messageText, imageUrls, location, audioUrl, voice
        mixSummary: built.mixSummary
    }, { etiqueta, estado, noLeidos, limite, candidatoIds });
}

// Builder compartido: resuelve la lista de candidatos, arma la propuesta con el
// payload dado (mismo shape que consume bulk-send.js) y la guarda en Redis (TTL 1h).
async function storeBulkProposal(payload, { etiqueta, estado, noLeidos, limite = 20, candidatoIds } = {}) {
    const redis = getRedisClient();
    if (!redis) return { error: 'Redis no disponible' };

    const listData = await getDetailedCandidatesList({ etiqueta, estado, noLeidos, limite, candidatoIds });
    if (!listData || listData.error) {
        return { error: listData?.error || 'No se pudo generar la lista de candidatos.' };
    }
    if (!listData.candidates || listData.candidates.length === 0) {
        return { error: 'No se encontraron candidatos que coincidan con los criterios para realizar el envío.' };
    }

    const proposalId = `proposal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const proposal = {
        id: proposalId,
        templateType: 'text',
        imageUrls: [],
        location: null,
        audioUrl: '',
        voice: false,
        ...payload,
        candidateCount: listData.candidates.length,
        candidates: listData.candidates,
        createdAt: new Date().toISOString()
    };

    await redis.set(`bulk_proposal:${proposalId}`, JSON.stringify(proposal), 'EX', 3600);
    return { success: true, proposal };
}

// ─── VACANTES (el "maletín" del Chat Web) ────────────────────────────────────
// Viven en candidatic_vacancies (JSON array). Solo las que tienen "info para el
// bot" (active && messageDescription) se pueden enviar. El texto enviable replica
// el del chat manual: *<nombre>*\n\n<messageDescription>.
export async function getBotVacancies() {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
        const raw = await redis.get('candidatic_vacancies');
        const list = raw ? JSON.parse(raw) : [];
        return (Array.isArray(list) ? list : []).filter((v) => v && v.active && v.messageDescription);
    } catch {
        return [];
    }
}

export async function getVacancyNames() {
    const list = await getBotVacancies();
    return list.map((v) => String(v.name || '').trim()).filter(Boolean);
}

export async function getVacancyByName(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    const list = await getBotVacancies();
    return list.find((v) => String(v.name || '').trim().toLowerCase() === q)
        || list.find((v) => String(v.name || '').trim().toLowerCase().includes(q))
        || null;
}

// Texto enviable de una vacante (igual que el chat manual).
export function vacancyMessageText(v) {
    return `*${v.name}*\n\n${v.messageDescription}`;
}

export async function getVacancyContent(nombre) {
    const v = await getVacancyByName(nombre);
    if (!v) return null;
    const meta = [v.company ? `Empresa: ${v.company}` : null, v.category ? `Categoría: ${v.category}` : null].filter(Boolean).join(' · ');
    const summary = `Vacante: ${v.name}${meta ? `\n${meta}` : ''}\n\nMensaje que se enviaría al candidato:\n"""\n${vacancyMessageText(v)}\n"""`;
    return { vacancy: { id: v.id, name: v.name, company: v.company || null, category: v.category || null }, summary };
}

// Propone enviar UNA vacante (texto) a los candidatos filtrados (o a uno por id).
export async function proposeVacancyBulkSend({ vacante, etiqueta, estado, noLeidos, limite = 20, candidatoIds }) {
    const v = await getVacancyByName(vacante);
    if (!v) {
        return { error: `No encontré una vacante con "info para el bot" llamada "${vacante}". Usa listar_vacantes para ver las disponibles.` };
    }
    return storeBulkProposal({
        templateName: v.name,
        messageText: vacancyMessageText(v),
        mixSummary: '1 texto (vacante)'
    }, { etiqueta, estado, noLeidos, limite, candidatoIds });
}

// ─── Altas por fecha (contadores diarios, zona Monterrey) ────────────────────
// Todo es HMGET de hashes que la plataforma ya mantiene: barato, sin escanear.
const mtyDateKey = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });

// Traduce un rango ('hoy'/'ayer'/'semana'/'mes') o un rango explícito (desde/hasta,
// YYYY-MM-DD) a la lista de llaves de día. Devuelve {keys, label}.
export function buildDateKeys({ rango, desde, hasta } = {}) {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if ((desde && iso.test(desde)) || (hasta && iso.test(hasta))) {
        const start = iso.test(desde) ? desde : hasta;
        const end = iso.test(hasta) ? hasta : start;
        const lo = start <= end ? start : end;
        const hi = start <= end ? end : start;
        const keys = [];
        let cur = new Date(`${lo}T12:00:00Z`);
        const stop = new Date(`${hi}T12:00:00Z`);
        let guard = 0;
        while (cur <= stop && guard < 92) {
            keys.push(cur.toISOString().slice(0, 10));
            cur = new Date(cur.getTime() + 86400000);
            guard++;
        }
        return { keys, label: `del ${lo} al ${hi}` };
    }
    const now = new Date();
    const today = mtyDateKey(now);
    const shift = (n) => mtyDateKey(new Date(now.getTime() + n * 86400000));
    switch (rango) {
        case 'ayer': {
            const y = shift(-1);
            return { keys: [y], label: `ayer (${y})` };
        }
        case 'semana': {
            const keys = [];
            for (let i = 6; i >= 0; i--) keys.push(shift(-i));
            return { keys: [...new Set(keys)], label: 'los últimos 7 días' };
        }
        case 'mes': {
            const [y, m] = today.split('-');
            const day = parseInt(today.slice(8), 10) || 1;
            const keys = [];
            for (let d = 1; d <= day; d++) keys.push(`${y}-${m}-${String(d).padStart(2, '0')}`);
            return { keys, label: `este mes (${y}-${m})` };
        }
        default:
            return { keys: [today], label: `hoy (${today})` };
    }
}

// Total de altas (todos los candidatos) en esas fechas.
export async function getCapturesTotal(dateKeys) {
    const redis = getRedisClient();
    if (!redis || !dateKeys?.length) return 0;
    try {
        const vals = await redis.hmget('stats:daily:captures', ...dateKeys);
        return (vals || []).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
    } catch {
        return 0;
    }
}

// Altas de UNA etiqueta en esas fechas (contador que se registra desde que se
// activó esta función; fechas anteriores pueden salir en 0).
export async function getCapturesByTag(tagName, dateKeys) {
    const redis = getRedisClient();
    if (!redis || !dateKeys?.length) return 0;
    const key = `stats:daily:captures:tag:${String(tagName || '').trim()}`;
    try {
        const vals = await redis.hmget(key, ...dateKeys);
        return (vals || []).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
    } catch {
        return 0;
    }
}

// Desglose de altas por TODAS las etiquetas en esas fechas, en una sola pasada
// (un pipeline, no N llamadas). Usa los nombres definidos que ya expone
// getTagCounts (candidatic:chat_tags + contadores vivos), mismo criterio que
// contar_etiquetas — así que también salen etiquetas con 0 altas en el rango.
export async function getCapturesByAllTags(dateKeys) {
    const redis = getRedisClient();
    if (!redis || !dateKeys?.length) return [];
    const data = await getTagCounts();
    const names = (data?.tags || []).map((t) => t.name);
    if (!names.length) return [];
    try {
        const pipeline = redis.pipeline();
        names.forEach((name) => pipeline.hmget(`stats:daily:captures:tag:${name}`, ...dateKeys));
        const results = await pipeline.exec();
        return names
            .map((name, i) => {
                const vals = results[i]?.[1] || [];
                const total = vals.reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
                return { name, total };
            })
            .sort((a, b) => b.total - a.total);
    } catch {
        return [];
    }
}

// Candidatos ACTIVOS ahora mismo (completándose en vivo). BARATO: activity:tracker
// es un sorted-set por timestamp de última actividad; se lee por RANGO de score
// (acotado con LIMIT), se cruza con stats:list:pending (SISMEMBER, O(1)) para saber
// quién sigue incompleto, y solo se leen los nombres de la muestra a mostrar.
export async function getActiveCandidates(minutes = 30, limit = 10) {
    const redis = getRedisClient();
    if (!redis) return null;
    try {
        const now = Date.now();
        const since = now - Math.max(1, minutes) * 60000;
        // IDs activos en la ventana, más recientes primero, acotado a 500.
        const raw = await redis.zrevrangebyscore('activity:tracker', '+inf', since, 'WITHSCORES', 'LIMIT', 0, 500);
        const active = [];
        for (let i = 0; i < raw.length; i += 2) active.push({ id: raw[i], ts: Number(raw[i + 1]) || 0 });

        let incompleteActive = 0;
        const incompleteRecent = [];
        for (const a of active) {
            const isPending = await redis.sismember('stats:list:pending', a.id);
            if (!isPending) continue;
            incompleteActive++;
            if (incompleteRecent.length < limit) incompleteRecent.push(a);
        }

        const sample = [];
        for (const a of incompleteRecent) {
            let name = a.id;
            try {
                const rawC = await redis.get(`candidate:${a.id}`);
                if (rawC) {
                    const c = JSON.parse(rawC);
                    name = c.nombreReal || c.nombre || a.id;
                }
            } catch { /* usa el id */ }
            sample.push({ id: a.id, name, minsAgo: Math.max(0, Math.round((now - a.ts) / 60000)) });
        }

        return { windowMinutes: minutes, totalActive: active.length, incompleteActive, sample };
    } catch {
        return null;
    }
}

// Resuelve un nombre de etiqueta escrito por el usuario (ej. "Yageo") al nombre
// real (ej. "Anuncio Yageo") comparando contra las etiquetas existentes.
export async function resolveTagName(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    const data = await getTagCounts();
    if (!data) return null;
    const names = data.tags.map((t) => t.name);
    return names.find((n) => n.toLowerCase() === q)
        || names.find((n) => n.toLowerCase().includes(q))
        || null;
}

// Nombres de las respuestas del Banco de Respuestas (candidatic:quick_replies) —
// plantillas que los reclutadores mandan a los candidatos.
export async function getQuickReplyNames() {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
        const raw = await redis.get('candidatic:quick_replies');
        const list = raw ? JSON.parse(raw) : [];
        return (Array.isArray(list) ? list : [])
            .map((r) => String(r?.name || '').trim())
            .filter(Boolean);
    } catch {
        return [];
    }
}

// Contenido COMPLETO de una respuesta del banco (para que el agente lo lea).
// Devuelve un resumen estructurado + un texto legible. { reply, summary } | null.
export async function getQuickReplyContent(nombre) {
    const qr = await getQuickReplyByName(nombre);
    if (!qr) return null;
    const imageUrls = Array.isArray(qr.imageUrls) ? qr.imageUrls.filter(Boolean) : (qr.imageUrl ? [qr.imageUrl] : []);
    const hasLocation = !!(qr.location && qr.location.lat != null && qr.location.lng != null);
    const parts = [`Nombre: ${qr.name || qr.title || ''}`];
    parts.push(`Tipo: ${qr.type || 'text'}`);
    if (qr.message) parts.push(`Texto:\n"""\n${qr.message}\n"""`);
    else parts.push('Texto: (sin texto)');
    if (imageUrls.length) parts.push(`Imágenes: ${imageUrls.length}`);
    if (hasLocation) parts.push(`Ubicación (maps): ${qr.location.name || ''} [${qr.location.lat}, ${qr.location.lng}]`);
    if (qr.audioUrl) parts.push(`Audio: sí${qr.voice || qr.audioVoice ? ' (nota de voz)' : ''}`);
    return {
        reply: { id: qr.id, name: qr.name || qr.title || '', type: qr.type || 'text', message: qr.message || '', imageCount: imageUrls.length, hasLocation, hasAudio: !!qr.audioUrl },
        summary: parts.join('\n')
    };
}

// ─── Editar el TEXTO de una respuesta del banco (con aprobación humana) ───────
// El agente PROPONE un nuevo texto; se guarda una propuesta que el humano aprueba.
// Solo se edita el campo `message` (texto) — no imágenes/ubicación/audio.
const KEY_QR_EDIT_PREFIX = 'agent-ia:qr_edit:'; // + <id> → JSON {id, quickReplyId, name, before, after}

export async function proposeQuickReplyEdit({ nombre, nuevo_mensaje }) {
    const redis = getRedisClient();
    if (!redis) return { error: 'Redis no disponible' };
    const qr = await getQuickReplyByName(nombre);
    if (!qr) {
        return { error: `No encontré la respuesta de banco "${nombre}". Usa listar_respuestas_banco para ver los nombres reales.` };
    }
    const after = String(nuevo_mensaje ?? '');
    if (!after.trim()) {
        return { error: 'El nuevo texto llegó vacío. Manda el texto completo ya editado.' };
    }
    const before = String(qr.message || '');
    if (after === before) {
        return { error: 'El texto nuevo es idéntico al actual: no hay nada que cambiar.' };
    }
    const id = `qredit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const proposal = {
        id,
        quickReplyId: qr.id,
        name: qr.name || qr.title || nombre,
        field: 'message',
        before,
        after,
        createdAt: new Date().toISOString()
    };
    await redis.set(`${KEY_QR_EDIT_PREFIX}${id}`, JSON.stringify(proposal), 'EX', 3600);
    return { success: true, proposal };
}

// El humano APRUEBA → escribe el nuevo texto en la respuesta del banco real.
export async function applyQuickReplyEdit(id) {
    const redis = getRedisClient();
    if (!redis) return { success: false, error: 'Redis no disponible' };
    const raw = await redis.get(`${KEY_QR_EDIT_PREFIX}${id}`);
    if (!raw) return { success: false, error: 'La propuesta de edición expiró o no existe.' };
    let proposal;
    try { proposal = JSON.parse(raw); } catch { return { success: false, error: 'Propuesta corrupta.' }; }

    const listRaw = await redis.get('candidatic:quick_replies');
    let list;
    try { list = listRaw ? JSON.parse(listRaw) : []; } catch { list = []; }
    if (!Array.isArray(list)) list = [];

    // Buscar por id (preferente) o por nombre (respaldo si el id cambió).
    let idx = list.findIndex((r) => r?.id === proposal.quickReplyId);
    if (idx < 0) idx = list.findIndex((r) => String(r?.name || r?.title || '').trim().toLowerCase() === String(proposal.name).trim().toLowerCase());
    if (idx < 0) {
        await redis.del(`${KEY_QR_EDIT_PREFIX}${id}`);
        return { success: false, error: `Ya no encontré la respuesta "${proposal.name}" en el banco (¿la borraron o renombraron?).` };
    }

    list[idx] = { ...list[idx], message: proposal.after };
    await redis.set('candidatic:quick_replies', JSON.stringify(list));
    await redis.del(`${KEY_QR_EDIT_PREFIX}${id}`);
    return { success: true, name: list[idx].name || proposal.name };
}

// El humano RECHAZA → solo se descarta la propuesta.
export async function rejectQuickReplyEdit(id) {
    const redis = getRedisClient();
    if (!redis) return { success: false, error: 'Redis no disponible' };
    const existed = await redis.del(`${KEY_QR_EDIT_PREFIX}${id}`);
    return existed ? { success: true } : { success: false, error: 'Propuesta no encontrada.' };
}

// ─── SKILLS DE RECLUTAMIENTO (playbooks por cliente) ─────────────────────────
// Cada skill es un documento con nombre (ej. "Yageo", "Metalsa") y contenido
// markdown con las instrucciones de ese cliente: qué etiqueta usar, qué mensaje
// del banco enviar, cómo responder al candidato en cada caso. Es CONTENIDO (no
// código): el agente y el usuario las pueden ver, crear y editar sin desplegar.
export async function getSkills() {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
        const raw = await redis.get(KEY_SKILLS);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

async function setSkills(list) {
    const redis = getRedisClient();
    if (!redis) return false;
    await redis.set(KEY_SKILLS, JSON.stringify(Array.isArray(list) ? list : []));
    return true;
}

export async function getSkillByName(name) {
    const norm = String(name || '').trim().toLowerCase();
    if (!norm) return null;
    const list = await getSkills();
    return list.find((s) => String(s.name || '').trim().toLowerCase() === norm) || null;
}

// Crea o edita por nombre (o por id si se pasa, para permitir renombrar).
export async function upsertSkill(name, content, id = null) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return { success: false, error: 'Falta el nombre de la skill' };
    const list = await getSkills();
    let idx = -1;
    if (id) idx = list.findIndex((s) => s.id === id);
    if (idx < 0) idx = list.findIndex((s) => String(s.name || '').trim().toLowerCase() === cleanName.toLowerCase());
    const now = new Date().toISOString();
    if (idx >= 0) {
        list[idx] = { ...list[idx], name: cleanName, content: String(content ?? ''), updatedAt: now };
        await setSkills(list);
        return { success: true, skill: list[idx], created: false };
    }
    const skill = { id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: cleanName, content: String(content ?? ''), updatedAt: now };
    list.push(skill);
    await setSkills(list);
    return { success: true, skill, created: true };
}

export async function deleteSkill(id) {
    const list = await getSkills();
    if (!list.some((s) => s.id === id)) return { success: false, error: 'Skill no encontrada' };
    await setSkills(list.filter((s) => s.id !== id));
    return { success: true };
}

// ─── Documento MEMORY.md (aprendizajes aprobados) ────────────────────────────
export async function getMemoryMd() {
    const redis = getRedisClient();
    if (!redis) return '';
    try {
        return (await redis.get(KEY_MEMORY_MD)) || '';
    } catch {
        return '';
    }
}

export async function setMemoryMd(content) {
    const redis = getRedisClient();
    if (!redis) return false;
    await redis.set(KEY_MEMORY_MD, String(content ?? ''));
    return true;
}

// ─── Propuestas de memoria (pendientes de aprobación humana) ─────────────────
export async function getPendingMemory() {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
        const raw = await redis.get(KEY_MEMORY_PENDING);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

async function setPendingMemory(list) {
    const redis = getRedisClient();
    if (!redis) return false;
    await redis.set(KEY_MEMORY_PENDING, JSON.stringify(Array.isArray(list) ? list : []));
    return true;
}

// El agente PROPONE una entrada (no la guarda). Devuelve la propuesta creada.
export async function addMemoryProposal(text) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const list = await getPendingMemory();
    const proposal = {
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: clean,
        createdAt: new Date().toISOString()
    };
    list.push(proposal);
    await setPendingMemory(list);
    return proposal;
}

// El humano APRUEBA una propuesta → se anexa a MEMORY.md y se quita de pendientes.
export async function approveMemoryProposal(id) {
    const list = await getPendingMemory();
    const proposal = list.find((p) => p.id === id);
    if (!proposal) return { success: false, error: 'Propuesta no encontrada' };
    const current = await getMemoryMd();
    const stamp = new Date().toISOString().slice(0, 10);
    const entry = `- (${stamp}) ${proposal.text}`;
    const next = current.trim() ? `${current.trim()}\n${entry}\n` : `# Memoria\n\n${entry}\n`;
    await setMemoryMd(next);
    await setPendingMemory(list.filter((p) => p.id !== id));
    return { success: true, memoryMd: next };
}

// El humano RECHAZA una propuesta → solo se quita de pendientes.
export async function rejectMemoryProposal(id) {
    const list = await getPendingMemory();
    if (!list.some((p) => p.id === id)) return { success: false, error: 'Propuesta no encontrada' };
    await setPendingMemory(list.filter((p) => p.id !== id));
    return { success: true };
}

// ─── System prompt = AGENTS.md + MEMORY.md + contrato de herramientas ────────
export async function assembleSystemPrompt() {
    const [agentsMd, memoryMd, skills] = await Promise.all([getAgentsMd(), getMemoryMd(), getSkills()]);
    const parts = [agentsMd.trim() || DEFAULT_AGENTS_MD];
    parts.push(
        '\n\n# MEMORIA (MEMORY.md)\n' +
        'Este es el contenido EXACTO y ACTUAL de tu MEMORY.md. PUEDES LEERLO: si el usuario ' +
        'te pide un resumen de tu memoria, "el último punto", "qué recuerdas" o algo similar, ' +
        'respóndele con base en lo que ves aquí abajo (el último punto es la última línea de la lista).\n\n' +
        (memoryMd.trim() ? memoryMd.trim() : '(Aún no hay memoria acumulada.)')
    );
    parts.push(
        '\n\n# SKILLS DE RECLUTAMIENTO\n' +
        'Cada skill es el "playbook" de un cliente/campaña: qué etiqueta usar, qué mensaje del banco enviar, y cómo responderle al candidato en distintos casos.\n' +
        (skills.length
            ? `Skills disponibles: ${skills.map((s) => s.name).join(', ')}.\n`
            : 'Aún no hay skills creadas.\n') +
        'No tienes el contenido completo de las skills aquí (para no saturar el contexto): ábrela con `leer_skill` cuando la necesites. Crea una nueva (ej. "Metalsa") o edita una existente con `guardar_skill`. Con `listar_skills` ves los nombres. Al crear/editar, usa nombres reales de etiquetas y del banco (consúltalos con `contar_etiquetas` y `listar_respuestas_banco`), no los inventes.'
    );
    parts.push(
        '\n\n# HERRAMIENTAS\n' +
        '- `editar_agents_md`: reescribe tu documento de definición (AGENTS.md). Úsala SOLO cuando el usuario te pida cambiar quién eres o cómo te comportas. Envía el documento COMPLETO ya modificado, no un fragmento.\n' +
        '- `proponer_memoria`: propón un aprendizaje para guardar en MEMORY.md entre conversaciones. Antes de llamarla, PREGÚNTALE al usuario en tu respuesta si quiere que lo guardes (ej. "¿Quieres que lo recuerde?"). Al proponerla, en el chat aparece una tarjeta con botones Guardar/Descartar: el usuario decide ahí mismo. NO afirmes que ya quedó guardado — queda pendiente hasta que el usuario lo apruebe.\n' +
        '- `listar_skills`: nombres de las skills de reclutamiento existentes.\n' +
        '- `leer_skill`: abre el contenido completo de una skill por su nombre (ej. "Yageo").\n' +
        '- `guardar_skill`: crea o edita una skill (nombre + contenido markdown completo). Si el nombre ya existe, la reemplaza; si no, la crea. Se guarda al instante y se ve en el panel del usuario.\n' +
        '- `contar_candidatos`: consulta y filtra candidatos por estado (completos/incompletos), etiqueta (ej. "Yageo") y/o no leídos (burbujas sin responder). Permite consultas cruzadas como "cuántos completos con etiqueta Yageo están no leídos". Lectura barata de intersecciones de Sets en Redis (SINTER O(N)); no escanea ni gasta tokens.\n' +
        '- `listar_candidatos`: obtiene la lista detallada (nombre completo y WhatsApp) de los candidatos filtrados (etiqueta, estado, no leídos) hasta el límite indicado. Úsala cuando el usuario pida ver la lista de candidatos o sus teléfonos.\n' +
        '- `buscar_candidato`: busca UN candidato por teléfono/WhatsApp O por nombre y devuelve su nombre completo y datos de perfil. Úsala cuando el usuario diga "busca al candidato 8116038195" o "busca a Juan Pérez". Si el nombre da varios resultados, te los devuelve para que le preguntes al usuario cuál es — no adivines.\n' +
        '- `leer_chat_candidato`: lee la conversación real de WhatsApp de UN candidato (quién dijo qué, en orden), por teléfono o por nombre. Úsala cuando el usuario pida ver/resumir qué le dijo un candidato, o antes de decidir qué responderle.\n' +
        '- `leer_chats_filtrados`: lee la conversación de VARIOS candidatos a la vez (filtrados por etiqueta/estado/no leídos) para comparar o resumir patrones entre chats — ej. "los chats de la etiqueta Yageo, qué preguntas hacen" o "qué dudas comunes tienen los incompletos de Metalsa". Cada candidato adicional cuesta más tokens, así que no pidas más de los que necesitas.\n' +
        '- `proponer_envio_banco`: propón enviar un mensaje del Banco de Respuestas (ej. "Punto Yageo") a candidatos. NO envía de inmediato: genera una tarjeta de confirmación en el chat con los botones Confirmar Envíos / Cancelar. Para UN solo candidato, pasa su `telefono` (ej. después de buscarlo). Para una LISTA, usa los mismos filtros (etiqueta/estado/no_leidos) con los que la listaste. Úsala cuando el usuario pida enviar o mandar un mensaje del banco.\n' +
        '- `contar_etiquetas`: las etiquetas de Candidatic CON su cantidad de candidatos (y cuántos sin etiqueta). Sirve también para saber qué etiquetas existen. Lectura barata; NO inventes nombres ni números.\n' +
        '- `contar_altas`: cuántos candidatos LLEGARON (se dieron de alta) en una fecha/rango (hoy, ayer, esta semana, este mes, o fechas explícitas). Lectura barata de contadores diarios.\n' +
        '- `contar_altas_etiqueta`: altas en una fecha/rango, por etiqueta. Con `etiqueta` da el total de esa etiqueta (ej. "cuántos de Yageo llegaron hoy"). SIN `etiqueta` da el desglose de TODAS las etiquetas en una sola llamada — úsala así para "desglósame las altas de hoy por etiqueta", nunca la llames una vez por cada etiqueta. El conteo por etiqueta y día se registra desde que se activó esta función, así que fechas muy anteriores pueden salir en 0.\n' +
        '- `candidatos_activos`: quiénes están ACTIVOS ahora mismo (actividad reciente) y cuántos siguen INCOMPLETOS (completándose en vivo), con una muestra de nombres y hace cuánto. Úsala para "quién se está completando ahorita".\n' +
        '- `listar_respuestas_banco`: consulta los nombres reales de las respuestas del Banco de Respuestas (plantillas que los reclutadores mandan a los candidatos). Úsala cuando el usuario pregunte qué respuestas de banco hay. NO las inventes.\n' +
        '- `leer_respuesta_banco`: abre el CONTENIDO completo de una respuesta del banco por su nombre (su texto exacto, tipo, cuántas imágenes, si lleva ubicación o audio). Úsala cuando el usuario quiera ver qué dice una respuesta, o antes de proponer editarla.\n' +
        '- `proponer_edicion_banco`: propón editar el TEXTO de una respuesta del banco. NO guarda de inmediato: genera una tarjeta de aprobación con el antes/después y botones Aprobar / Descartar. Manda el texto COMPLETO ya editado. Solo edita texto (no imágenes/ubicación/audio). Lee primero con `leer_respuesta_banco`.\n' +
        '- `listar_vacantes`: los nombres de las vacantes del "maletín" del Chat Web que tienen info para enviar al candidato. Solo lectura.\n' +
        '- `leer_vacante`: abre el contenido de una vacante por su nombre (empresa, categoría y el mensaje exacto que se le enviaría al candidato). Úsala cuando el usuario pregunte por una vacante o antes de enviarla.\n' +
        '- `proponer_envio_vacante`: propón enviar la info de UNA vacante a candidatos. Igual que `proponer_envio_banco` pero con una vacante en vez de una respuesta del banco: NO envía de inmediato, genera la tarjeta de confirmación con Confirmar / Cancelar. Para UN candidato pasa su `telefono`; para una LISTA usa filtros (etiqueta/estado/no_leidos).\n' +
        '- `prender_agent_candidatic`: prende el modo de atención automática en vivo ("Agent Candidatic") para una o más etiquetas. Úsala cuando el usuario diga "me voy a comer, atiende a los de <etiqueta>" o "prende el agente para <etiqueta>". Activa el toggle del panel. Requiere al menos una etiqueta; si el usuario no la dio, PREGÚNTASELA.\n' +
        '- `apagar_agent_candidatic`: apaga ese modo ("ya volví", "apaga el agente").\n' +
        '- `ver_cola_agent_candidatic`: si está prendido/apagado, para qué etiqueta(s), la lista de candidatos en la cola con su status y sus métricas (atendidos, goles, tiempo atendiendo, tiempo despierto). Úsala cuando pregunten "quién está en la cola", "cómo va el agente en vivo" o "cuántos ha atendido".\n' +
        '- `listar_proyectos`: TODOS los proyectos del CRM con sus pasos y cuántos candidatos hay en cada paso. Solo lectura.\n' +
        '- `ver_proyecto`: el detalle de un proyecto (cada paso con los nombres de los candidatos dentro). Solo lectura.\n' +
        '- `mover_candidato_crm`: mete/mueve a UN candidato (por teléfono) a un proyecto y paso (ej. proyecto "Yageo", paso "Cita"). Acción directa (se aplica al momento; el tablero se actualiza en vivo). Un candidato vive en un solo proyecto.'
    );
    return parts.join('');
}
