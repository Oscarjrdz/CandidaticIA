// [PREMIUM ARCHITECTURE] V_FINAL_STABLE_V1 - Zero-Silence Infrastructure Active | Deploy: 2026-03-13
import {
    getRedisClient,
    getMessages,
    saveMessage,
    updateCandidate,
    getCandidateById,
    auditProfile,
    getVacancyById,
    recordAITelemetry,
    getActiveBypassRules,
    getProjects
} from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig, sendUltraMsgReaction, sendUltraMsgPresence } from '../whatsapp/utils.js';
// schema-registry import removed — getSchemaByField was unused
import { getCachedConfigBatch } from '../utils/cache.js';
import { getOpenAIResponse } from '../utils/openai.js';

import { inferGender } from '../utils/gender-helper.js';
import { maybeSendKatconOnComplete } from '../utils/agent-katcon.js';
import { runFlowsForCandidate, resumeWaitingFlowIfMatch, runReturningFlowsForCandidate } from '../utils/flow-engine.js';
import { runInBackground } from '../utils/background.js';
import { maybeEnqueueForLiveAgent } from '../utils/agent-candidatic.js';
import { attendLiveCandidate } from '../utils/agent-attend.js';
import { FEATURES } from '../utils/feature-flags.js';
import { AIGuard } from '../utils/ai-guard.js';
import { Orchestrator } from '../utils/orchestrator.js';
import { MediaEngine } from '../utils/media-engine.js';
import { cleanMunicipioWithAI, cleanCategoryWithAI, cleanEscolaridadWithAI } from '../utils/ai.js';
import { getMissingFields } from '../reengagement-queue.js';

// 🚀 TURBO MODE: Silence all synchronous Vercel console I/O unless actively debugging
if (process.env.DEBUG_MODE !== 'true') {
    console.log = function () { };
}

// ─────────────────────────────────────────────────────────────────────────────
// 📐 SHARED MESSAGE FORMATTER — applies to all recruiter/bot response texts
// ─────────────────────────────────────────────────────────────────────────────
const _DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const _MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const _NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

function isEmoji(str) {
    if (!str) return false;
    return /\p{Emoji}/u.test(str);
}

// 📅 HELPER: Translates "2026-03-10" to "Martes 10 de Marzo"
function humanizeDate(dateStr) {
    if (!dateStr || dateStr.includes('null') || dateStr.includes('N/A')) return dateStr;
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const dayMatch = _DAY_NAMES[date.getDay()];
        const monMatch = _MONTH_NAMES[date.getMonth()];
        if (dayMatch && monMatch) {
            return `${dayMatch} ${parseInt(parts[2])} de ${monMatch}`;
        }
    }
    return dateStr;
}

// ─── CITA_PENDING FLAG HELPERS (Redis-backed confirmation state) ───────────────
// When Brenda sends the scheduling CTA, we set a Redis TTL flag.
// On the candidate's NEXT message we check the flag to decide if the
// affirmative is a genuine cita confirmation or just ambient chatter.
const CITA_PENDING_TTL = 600; // 10 minutes
async function setCitaPendingFlag(redis, candidateId) {
    if (!redis || !candidateId) return;
    try { await redis.set(`cita_pending:${candidateId}`, '1', 'EX', CITA_PENDING_TTL); } catch (_) {}
}
// [PENDING-FLAG HELPERS RETIRADOS] getCitaPendingFlag/clearCitaPendingFlag y las familias
// pivot_pending / day_list_pending (get/set/clear/incr) se removieron junto con el cerebro
// de reclutador — eran sus únicos usuarios. setCitaPendingFlag se conserva (sigue en uso).
// [NO INTERESA GATE ELIMINADO] Los helpers del gate "no interesa" (ni_gate) se removieron
// junto con el cerebro de reclutador retirado — eran sus únicos llamadores.
// ─── CTA VARIANT COUNTER (sequential rotation per candidate) ─────────────────
// Single shared counter across ALL second-bubble categories so the candidate
// never sees the same closing question twice in a row.
const _CTA_VARIANTS = [
    '¿Te gustaría agendar tu entrevista? 😊',
    '¿Te agendo una cita de entrevista? 🌟',
    '¿Te aparto una cita para entrevista? ✨',
    '¿Quieres que programe tu entrevista? 🌸',
    '¿Te puedo agendar tu entrevista? 😊',
    '¿Avanzamos con tu cita de entrevista? 🚀',
    '¿Te confirmo tu cita de entrevista? 💼',
    '¿Procedo a agendar tu entrevista? 🙌',
    '¿Te reservo un lugar para la entrevista? ⭐',
    '¿Aseguro tu cita de entrevista? 🎯',
    '¿Quieres que te separe la entrevista? 🤩',
    '¿Te interesa que ya quede apartada tu cita? 🌺',
];
const _SINGLE_HOUR_CTAS = [
    "¿Te gustaría agendar tu entrevista? 😊",
    "¿Te parece que agendemos ya? ✨",
    "¿Comenzamos con tu proceso y reservamos? 🗓️",
    "¿Confirmamos tu cita para esta hora? ✅",
    "¿Agendamos tu entrevista de una vez? 😊",
    "¿Te anoto para esta hora? ✍️",
    "¿Deseas que te aparte este lugar? 🌟",
    "¿Cerramos tu cita en este horario? 🤝",
    "¿Te parece bien si agendamos tu entrevista? ⏰",
    "¿Quieres que confirme tu asistencia a esta hora? ✨"
];

const NEW_CANDIDATE_GREETING = '¡Hola! 😇 Soy Brenda Rodríguez, reclutadora de Candidatic.';
const NEW_CANDIDATE_NAME_ASK = '¿Me puedes compartir tu Nombre y Apellidos completos? 🌟';
const buildNewCandidateWelcome = () => `${NEW_CANDIDATE_GREETING}[MSG_SPLIT]${NEW_CANDIDATE_NAME_ASK}`;

const _AMBIGUITY_VARIANTS = [
    'Solo por confirmar, ¿te gustaría agendar tu entrevista? 😊',
    'Disculpa, ¿me confirmas si quieres que te agende la entrevista? 🌸',
    'Antes de avanzar, ¿quieres que agendemos tu cita de entrevista? ✨',
    'Solo para confirmar, ¿te agendo la cita de entrevista? 🌟',
    '¿Me confirmas que quieres agendar tu entrevista? 😊'
];
const _PIVOT_B2_VARIANTS = [
    '¿Te gustaría conocerla? 🌸',
    '¿Te la presento? 😊',
    '¿Quieres que te cuente de ella? ✨',
    '¿Te interesa conocer esta opción? 🌟',
    '¿Te gustaría saber más? 😊'
];
async function incrCTAIndex(redis, candidateId) {
    if (!redis || !candidateId) return;
    try { await redis.incr(`cta_idx:${candidateId}`); } catch (_) {}
}
// ─────────────────────────────────────────────────────────────────────────────

function formatRecruiterMessage(text, candidateData = null, stepContext = {}) {
    if (!text || typeof text !== 'string') return text;

    // 🧹 STEP 0: Strip markdown bold (**text**) — AI sometimes wraps dates in bold which breaks all downstream regex
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    // Also strip single-star italic (*text*) that may appear in dates
    text = text.replace(/\*([^*\n]+)\*/g, '$1');
    // 🔤 VOCABULARIO: Reemplaza 'resides'→'vives' determinísticamente
    text = text.replace(/\bresides\b/gi, 'vives').replace(/\breside\b/gi, 'vive');
    // 🧹 WHITESPACE CLEANUP: Collapse 3+ consecutive blank lines → max 1 blank line
    text = text.replace(/\n{3,}/g, '\n\n');

    // 🚫 OPEN-DOOR PHRASE STRIP: Remove any "si tienes más dudas aquí estoy" style endings.
    // Applied as multiple simple patterns — one per phrase family — so accented chars work correctly.
    const _OPEN_DOOR_PATTERNS = [
        /[,.]?\s*si\s+tienes?\s+(?:m[aá]s\s+)?(?:alguna\s+)?(?:dudas?|preguntas?|consultas?)[^.!?]*/gi,
        /[,.]?\s*(?:no\s+dudes?\s+en\s+(?:preguntar|escribirme?|avisarme?|contactarme?|decirme))[^.!?]*/gi,
        /[,.]?\s*estoy\s+aqu[íi]\s+(?:para|si)\s+(?:tienes?|necesitas?|surge)[^.!?]*/gi,
        /[,.]?\s*aqu[íi]\s+estoy\s+(?:para|si)[^.!?]*/gi,
        /[,.]?\s*(?:cualquier|para\s+cualquier)\s+(?:duda|pregunta|consulta)[^.!?]*(?:estoy|avísame|escríbeme)[^.!?]*/gi,
        /[,.]?\s*quedo\s+a\s+tu[s]?\s+(?:[oó]rdenes?|disposici[oó]n)[^.!?]*/gi,
        /[,.]?\s*con\s+gusto\s+(?:te\s+)?(?:atiendo|resuelvo|ayudo)\s+(?:m[aá]s\s+)?(?:dudas?|preguntas?)[^.!?]*/gi,
        /[,.]?\s*estamos?\s+(?:aqu[íi]|en\s+contacto)\s+para\s+(?:cualquier|lo\s+que\s+necesites?)[^.!?]*/gi,
        /[,.]?\s*para\s+(?:cualquier|m[aá]s)\s+(?:dudas?|preguntas?|informaci[oó]n)[^.!?]*(?:estoy|escríbeme|avísame|contacta)[^.!?]*/gi,
        /[,.]?\s*si\s+necesitas?\s+(?:algo\s+m[aá]s|m[aá]s\s+info|m[aá]s\s+informaci[oó]n)[^.!?]*/gi,
    ];
    for (const p of _OPEN_DOOR_PATTERNS) {
        text = text.replace(p, '');
    }
    // Fix: Only target horizontal whitespace to preserve the \n\n boundaries for formatting
    text = text.replace(/[ \t]{2,}/g, ' ').trim();

    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');

    // 📅 SINGLE-DATE QUESTION FIX: "¿Qué día te queda mejor?" only makes sense with multiple dates.
    // However, if we are presenting hours, we should NOT override the question, because GPT
    // might be asking "¿En cuál horario te queda mejor?".
    const hasMultipleDates = /2️⃣|3️⃣|4️⃣|5️⃣/.test(text);
    if (!hasMultipleDates && /¿Qué día te queda mejor\??/i.test(text)) {
        text = text.replace(/¿Qué día te queda mejor\??(?!\s*para\s*agendar)/gi, '¿Te queda bien ese día?');
    }

    // 😊 ORPHAN EMOJI CLEANUP: A line that contains ONLY emojis (no letters/digits)
    // gets merged onto the previous line. Handles both single (\n) and double (\n\n) gaps.
    text = text.replace(/\n{1,2}(\s*[\p{Emoji}\s]+\s*)\n{1,2}/gu, (match, emojiLine) => {
        const clean = emojiLine.trim();
        // Only merge if the line is purely emojis (no words)
        if (clean && !/[a-zA-ZÀ-ÿ0-9]/.test(clean)) return ` ${clean}\n\n`;
        return match;
    });
    // 😊 TRAILING ORPHAN EMOJI: emoji-only line at the very END of message → merge onto previous line
    text = text.replace(/\n{1,2}([\p{Emoji}\s]+)\s*$/gu, (match, emojiLine) => {
        const clean = emojiLine.trim();
        if (clean && !/[a-zA-ZÀ-ÿ0-9]/.test(clean)) return ` ${clean}`;
        return match;
    });

    // 📅 HUMANIZE raw YYYY-MM-DD dates that GPT leaked into the output
    text = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => humanizeDate(`${y}-${m}-${d}`));

    // 🚫 DESCONTEXTUALIZED PRAISE STRIP: Remove opener praises that GPT adds without context.
    // These phrases only make sense as a confirmation, not as a response to a data/vacancy question.
    // We strip them from the START of any segment (before the actual content).
    {
        const _PRAISE_RE = /^(?:¡(?:Vas\s+(?:excelente|muy\s+bien|genial|de\s+maravilla)|Lo\s+est[aá]s\s+haciendo\s+(?:genial|muy\s+bien|excelente)|Excelente\s+dato)\b[!.]?\s*)/i;
        text = text.split('[MSG_SPLIT]').map(seg => seg.replace(_PRAISE_RE, '')).join('[MSG_SPLIT]');
    }

    // 🔧 DATE-EXAMPLE GUARD: Strip "(ejemplo ...)" from segments NOT about birth date (per-segment).
    {
        const _DATE_EJ_RE = /\s*\((?:ej\.?|ejemplo)\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+de\s+\w+\s+de\s+\d{4})\)/gi;
        const _DATE_KEYWORDS = /fecha|nacimiento|cumplea|cu[aá]ndo naciste|nac[íi]|d[íi]a.*mes|cuantos a[nñ]os/i;
        text = text.split('[MSG_SPLIT]').map(seg => _DATE_KEYWORDS.test(seg) ? seg : seg.replace(_DATE_EJ_RE, '')).join('[MSG_SPLIT]');
    }

    // 🗓️ DATE FORMAT NORMALIZER: Convert any "(ej. DD/MM/YYYY)" GPT outputs → "(ejemplo DD de MES de YYYY)"
    {
        const _MONTH_NAMES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        text = text.replace(/\((?:ej\.?:?\s*|ejemplo\s*)(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{4})\)/gi, (_m, d, m, y) => {
            const mi = parseInt(m, 10) - 1;
            const monthName = _MONTH_NAMES[mi] || m;
            return `(ejemplo ${parseInt(d, 10)} de ${monthName} de ${y})`;
        });
    }

    // 📝 NOMBRE Y APELLIDOS GUARD: "Nombre completo" → "Nombre y Apellidos completos" everywhere.
    text = text.replace(/\btu\s+Nombre\s+completo\b(?!\s+y\s+Apellidos)/gi, 'tu Nombre y Apellidos completos');
    text = text.replace(/\bNombre\s+completo\b(?!\s+y\s+Apellidos)/g, 'Nombre y Apellidos completos');

    // 🏙️ MUNICIPIO WORDING GUARD: Multiple patterns → always "¿en qué municipio vives?"
    // Catches: "¿dónde vives?", "¿Podrías decírmelo?", "¿me lo dices?", "¿me lo compartes?" in isolation.
    text = text.replace(/¿[Dd][oó]nde\s+vives(\s+actualmente)?\s*\?/g, '¿En qué municipio vives$1?');
    text = text.replace(/¿[Pp]odr[íi]as?\s+dec[íi]rmelo\s*\?/g, '¿En qué municipio vives actualmente?');
    text = text.replace(/¿[Mm]e\s+lo\s+(dices?|compartes?|puedes?\s+decir)\s*\?/g, '¿En qué municipio vives actualmente?');
    // Strip vague catch-all questions when context is asking for municipio
    if (/municipio/i.test(text)) {
        text = text.replace(/¿[Mm]e\s+ayudas\s+con\s+eso\s*\?/g, '¿En qué municipio vives actualmente?');
        text = text.replace(/¿[Mm]e\s+puedes?\s+(?:ayudar|decir)(?:\s+con\s+eso)?\s*\?/g, '¿En qué municipio vives actualmente?');
    }
    // Strip parenthetical hints GPT adds to municipio questions, e.g. "(nombre del municipio)", "(ej. Monterrey)"
    text = text.replace(/(\bmunicipio\b[^?]*)\s*\([^)]{3,40}\)/gi, '$1');

    // 💼 VACANCY QUESTION WORDING GUARD: 'favorita' doesn't fit a job context — replace with professional phrasing.
    // Only apply when context is vacancy selection (✅ items), NOT time slot selection (⏰ items).
    if (/✅/.test(text) && !/⏰/.test(text)) {
        text = text.replace(/¿[Cc]u[aá]l\s+es\s+tu\s+favorita\s*\?/g, '¿En cuál te interesa trabajar?');
        text = text.replace(/¿[Cc]u[aá]l\s+(?:de\s+(?:ellas|ellos|estas|estas\s+opciones)\s+)?(?:es\s+tu\s+favorita|te\s+gusta\s+m[aá]s|prefieres)\s*\?/gi, '¿En cuál te interesa trabajar?');
    }

    // 🎓 ESCOLARIDAD EMOJIS NORMALIZER: Fix wrong emojis GPT uses for the education list.
    if (/Primaria|Secundaria|Preparatoria|Licenciatura|T[eé]cnica|Posgrado/i.test(text)) {
        text = text.replace(/^[^\w\n\r[]*Primaria\b/gm,     '🎒 Primaria');
        text = text.replace(/^[^\w\n\r[]*Secundaria\b/gm,   '🏫 Secundaria');
        text = text.replace(/^[^\w\n\r[]*Preparatoria\b/gm, '🎓 Preparatoria');
        text = text.replace(/^[^\w\n\r[]*Licenciatura\b/gm, '📚 Licenciatura');
        text = text.replace(/^[^\w\n\r[]*T[eé]cnica\b/gm,   '🛠️ Técnica');
        text = text.replace(/^[^\w\n\r[]*Posgrado\b/gm,     '🧠 Posgrado');
    }

    // 🔗 ESCOLARIDAD LIST CONSOLIDATOR: If GPT put [MSG_SPLIT] between list items, merge them back.
    // Runs BEFORE the split guard so the list is always one contiguous block for processing.
    {
        const _ESC_ITEM_RE = /((?:🎒|🏫|🎓|📚|🛠️|🧠)[^\n]*)[ \t]*\[MSG_SPLIT\][ \t]*((?:🎒|🏫|🎓|📚|🛠️|🧠))/g;
        // Run multiple passes until no more inter-item splits remain
        let _prev;
        do {
            _prev = text;
            text = text.replace(_ESC_ITEM_RE, '$1\n$2');
        } while (text !== _prev);
    }

    // 📚 ESCOLARIDAD SPLIT GUARD v3: Guarantees EXACTLY 3 bubbles for escolaridad.
    // Bubble 1 = intro, Bubble 2 = list, Bubble 3 = ONE question/nudge. No more, no less.
    {
        const _ESC_LIST_RE = /🎒\s*Primaria/;
        if (_ESC_LIST_RE.test(text)) {
            // Step 1: Ensure MSG_SPLIT before the list exists
            if (!text.includes('[MSG_SPLIT]')) {
                text = text.replace(/(🎒\s*Primaria)/, '[MSG_SPLIT]$1');
            }
            const _segs = text.split('[MSG_SPLIT]');
            const _listIdx = _segs.findIndex(s => _ESC_LIST_RE.test(s));
            if (_listIdx !== -1) {
                // Step 2: Clean trailing question from list itself
                const _lines = _segs[_listIdx].trimEnd().split('\n');
                const _lastLine = (_lines[_lines.length - 1] || '').trim();
                const _listEndsWithQ = (/[?？]$/.test(_lastLine) || /^¿/.test(_lastLine)) && _lines.length > 1;
                if (_listEndsWithQ) {
                    _segs[_listIdx] = _lines.slice(0, -1).join('\n').trimEnd();
                }
                // Step 3: Gather all segments after the list → keep exactly 1
                const _afterList = _segs.splice(_listIdx + 1);
                const _firstAfter = _afterList.find(s => s.trim().length > 0) || '';
                // If no useful segment after list, add a nudge
                const _finalNudge = _firstAfter.trim() || (
                    _listEndsWithQ ? _lastLine : '¿Cuál es la tuya? 🌟'
                );
                _segs.push(_finalNudge.trim());

                // Step 4: Rewrite Bubble 1 to standardized format — SOLO en la transición real
                // a escolaridad (primera vez). En repreguntas (la lista 🎒 ya salió en mensajes
                // recientes del bot) se conserva la burbuja de GPT, que reconoce lo que el
                // candidato dijo en vez de re-celebrar "Elegiste X" como evento viejo.
                const _escSentBefore = Array.isArray(stepContext?.recentBotTexts)
                    && /🎒/.test(stepContext.recentBotTexts.slice(-6).join('\n'));
                const _cat = stepContext?.extractedCategoria || (!_escSentBefore ? candidateData?.categoria : null);
                if (_cat) {
                    const _firstName = candidateData?.nombreReal ? getFirstName(candidateData.nombreReal) : null;
                    _segs[0] = _firstName
                        ? `¡Perfecto, ${_firstName}! Elegiste ${_cat}. Ahora solo me falta saber tu nivel de escolaridad. Mira las opciones:`
                        : `¡Perfecto! Elegiste ${_cat}. Ahora solo me falta saber tu nivel de escolaridad. Mira las opciones:`;
                }

                text = _segs.join('[MSG_SPLIT]');
            }
        }
    }

    // 📅 CALENDAR DAYS LINE GUARD v2: String-based to handle Unicode multi-codepoint emojis reliably.
    // Iterates over each numbered emoji and ensures it always starts on its own line.
    {
        const _numEmojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
        for (const _em of _numEmojis) {
            let _pos = 0;
            while (true) {
                const _idx = text.indexOf(_em, _pos);
                if (_idx === -1) break;
                // If something non-newline precedes this emoji, force a new line before it
                const _before = text.substring(0, _idx);
                if (_before.trim().length > 0 && !/\n\s*$/.test(_before)) {
                    text = _before.trimEnd() + '\n\n' + text.substring(_idx);
                    _pos = _before.trimEnd().length + 2 + _em.length;
                } else {
                    _pos = _idx + _em.length;
                }
            }
        }
    }

    // 🏢 VACANCY BUBBLE SPLIT GUARD: If GPT responds about vacantes/entrevistas OR a vacancy list (✅ items)
    // without [MSG_SPLIT], force a split before the final question so it arrives as 2 separate bubbles.
    if (!text.includes('[MSG_SPLIT]') && (/vacante|entrevista|oficina|ubicaci[oó]n|distintas\s+zonas/i.test(text) || (text.match(/✅/g) || []).length >= 3)) {
        // Use lastIndexOf to find the last ¿ — tolerates emojis/spaces after the closing ?
        const _lastBrk = text.lastIndexOf('¿');
        if (_lastBrk > 10) {
            const _before = text.substring(0, _lastBrk).trimEnd();
            const _question = text.substring(_lastBrk).trim();
            if (_before.length > 10) {
                text = _before + '[MSG_SPLIT]' + _question;
            }
        } else {
            // Fallback: split before imperative data requests
            const _imp = text.match(/([\s\S]*?)((?:dime|dame|comparte|necesito|me puedes dar)\s+tu\s+[\w\s]{3,50})/i);
            if (_imp && _imp[1].trim().length > 10) {
                text = _imp[1].trim() + '[MSG_SPLIT]' + _imp[2].trim() + text.substring((_imp.index || 0) + _imp[0].length);
            }
        }
    }

    // 😊 FIRST-SEGMENT EMOJI GUARD: If MSG_SPLIT exists and first segment lacks emoji, append one.
    if (text.includes('[MSG_SPLIT]')) {
        const _warmEmojis = ['😊', '✨', '🌸', '💖', '😉', '🌟', '🤭'];
        const _parts = text.split('[MSG_SPLIT]');
        const _hasEmoji = (s) => /\p{Emoji}/u.test(s.replace(/[#*0-9]\uFE0F?\u20E3/g, ''));
        if (_parts.length >= 2 && !_hasEmoji(_parts[0])) {
            _parts[0] = _parts[0].trimEnd() + ` ${_warmEmojis[Math.floor(Math.random() * _warmEmojis.length)]}`;
        }
        text = _parts.join('[MSG_SPLIT]');
    }

    // 📋 COMBINED DAYS+HORARIO: If GPT merged PASO 1 (days list) and PASO 2 (horarios)
    // into one message, STRIP the horario part — user must pick a day first.
    {
        const hasDayList = /(?:📅|1️⃣|2️⃣).{0,30}(?:Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado|Domingo)/i.test(text);
        const hasHorario = /tengo entrevistas? a las|estas opciones de horario/i.test(text);
        if (hasDayList && hasHorario) {
            // Find where the horario section starts and cut everything after it
            const cutIdx = text.search(/(?:\n|.{0,5})(?:Perfecto|Para el)[^\n]*(?:tengo entrevistas? a las|estas opciones de horario)/im);
            if (cutIdx > 20) {
                text = text.substring(0, cutIdx).trim();
            }
        }
    }

    // 🛡️ FAQ+DUPLICATE-SLOT GUARD: When GPT correctly answered an FAQ and asked
    // "¿Te parece bien ese horario?" but then also appended a redundant slot listing
    // (e.g. "Perfecto, para el Jueves 12... tengo estas opciones de horario: 1️⃣ 12:00 PM...")
    // → strip everything from the duplicate block onwards.
    {
        const hasConfirmQuestion = /Te parece bien ese horario|¿Te parece bien.*horario/i.test(text);
        const dupSlotIdx = text.search(/(?:\n|^)\s*(?:Perfecto[,.]?\s+)?[Pp]ara el\s+.{5,40}\s+tengo estas opciones de horario/im);
        if (hasConfirmQuestion && dupSlotIdx > 20) {
            text = text.substring(0, dupSlotIdx).trim();
        }
    }


    // 🎓 ESCOLARIDAD LIST: Force vertical format OR inject if GPT forgot the list entirely
    const ESC_LIST = '\n🎒 Primaria\n🏫 Secundaria\n🎓 Preparatoria\n📚 Licenciatura\n🛠️ Técnica\n🧠 Posgrado';
    const hasAnyEscEmoji = /(?:🎒|🏫|📚|🛠|🧠)/.test(text);
    const asksAboutEsc   = /(?:nivel de estudios|escolaridad|nivel escolar)/i.test(text);

    if (hasAnyEscEmoji) {
        // GPT included options but possibly inline — force vertical spacing
        text = text
            .replace(/\s*🎒\s*Primaria/gi,      '\n🎒 Primaria')
            .replace(/\s*🏫\s*Secundaria/gi,     '\n🏫 Secundaria')
            .replace(/\s*🎓\s*Preparatoria/gi,   '\n🎓 Preparatoria')
            .replace(/\s*📚\s*Licenciatura/gi,   '\n📚 Licenciatura')
            .replace(/\s*🛠️?\s*T[eé]cnica/gi,   '\n🛠️ Técnica')
            .replace(/\s*🧠\s*Posgrado/gi,       '\n🧠 Posgrado')
            .replace(/\n{2,}/g, '\n')
            .trim();

        // Single newline before the FIRST escolaridad emoji (header already ends with ":")
        text = text.replace(/([^\n])\n(🎒|🏫|🎓|📚|🛠|🧠)/, '$1\n$2');

        // Detach any question stuck to the last escolaridad item on the same line
        // e.g. "🧠 Posgrado ¿Cuál es tu escolaridad?" → "🧠 Posgrado\n¿Cuál es tu escolaridad?"
        text = text.replace(/((?:🎒|🏫|🎓|📚|🛠️?|🧠)\s*[^\n?¿]+?)\s+(¿[^\n?]+\?)/g, '$1\n$2');

        // Split the escolaridad closing question into a 2nd bubble + inject candidate name
        const lastEscIdx = Math.max(
            text.lastIndexOf('🧠'), text.lastIndexOf('📚'),
            text.lastIndexOf('🛠'), text.lastIndexOf('🎓'),
            text.lastIndexOf('🏫'), text.lastIndexOf('🎒')
        );
        if (lastEscIdx !== -1) {
            const afterEsc = text.substring(lastEscIdx);
            const escQMatch = afterEsc.match(/(\n+|\s{1,})((?:¿)[^?!]*(?:escolaridad|nivel de estudios|nivel escolar|estudios)[^?!]*\?)/i);
            if (escQMatch) {
                const globalIdx = lastEscIdx + escQMatch.index + escQMatch[1].length;
                const beforeQ = text.substring(0, globalIdx).trimEnd();
                let question = text.substring(globalIdx).trim();
                // Inject first name before the closing ? (solo si GPT no lo puso ya — evita "Oscar Oscar")
                if (candidateData?.nombreReal) {
                    const firstName = candidateData.nombreReal.trim().split(/\s+/)[0];
                    if (firstName && firstName.length > 1 && !question.toLowerCase().includes(firstName.toLowerCase())) {
                        question = question.replace(/(\?)([\s\p{Emoji}\s]*)$/u, (_, q, trail) => ` ${firstName}${q}${trail || ''}`);
                    }
                }
                text = `${beforeQ}[MSG_SPLIT]${question}`;
            }
        }
    } else if (asksAboutEsc && !text.includes('👆')) {
        // GPT asked but forgot the list — inject it before the closing question.
        // (Si el texto ya refiere la lista de arriba con 👆, NO inyectar: es una repregunta
        // que el dedup ya procesó — este formateador puede correr dos veces sobre el mismo texto.)
        const lastQ = text.lastIndexOf('\xbf');        // last ¿
        if (lastQ > 0) {
            text = text.substring(0, lastQ).trimEnd() + ESC_LIST + '\n' + text.substring(lastQ).trim();
        } else {
            // no closing question found — just append the list
            text = text.trimEnd() + ESC_LIST;
        }
    }

    // 📋 CATEGORY LIST: Force vertical format — each ✅ item on its own line
    // GPT sometimes writes all categories inline: "✅ A ✅ B ✅ C"
    // We split every ✅ onto a new line so WhatsApp shows them vertically.
    // ⚠️ SKIP if ✅ is part of a cita confirmation — not a category list.
    const _isCitaConfirmation = /cita queda agendada|agendada para el|te esperamos el|tu entrevista para el|cita de entrevista para el/i.test(text);
    if (/✅/.test(text) && !_isCitaConfirmation) {
        // 1️⃣ Double newline after the header line ending with ":"
        // e.g. "Aquí te muestro las opciones disponibles:✨\n✅ A" → "disponibles:✨\n\n✅ A"
        text = text.replace(/(disponibles?[^:\n]*:|opciones?[^:\n]*:|opciones[^:\n]*💖)\s*\n/gi, '$1\n\n');

        // 2️⃣ Insert newline before every ✅ that is NOT already at the start of a line
        text = text.replace(/([^\n])✅/g, '$1\n✅');

        // 2b️⃣ Ensure double newline before the FIRST ✅ (= space between header and list)
        // Works regardless of what GPT wrote as the header.
        text = text.replace(/([^\n])\n(✅)/, '$1\n\n$2');

        // 3️⃣ Detach any text/question AFTER the last category name on the same line
        // e.g. "✅ Montacarguistas ¿Cuál eliges?" → "✅ Montacarguistas\n¿Cuál eliges?"
        text = text.replace(/(✅\s*[^\n✅?¿]+?)\s+(¿[^\n?]+\?)/g, '$1\n$2');

        // 4️⃣ Collapse double newlines BETWEEN consecutive ✅ items → single newline
        // (keeps the double newline before the FIRST ✅ for visual separation from header)
        text = text.replace(/(✅[^\n]*)\n{2,}(?=✅)/g, '$1\n');
        // Collapse triple+ newlines everywhere else
        text = text.replace(/\n{3,}/g, '\n\n').trim();

        // 💬 CATEGORY QUESTION SPLIT: Move the closing choice question to a 2nd bubble.
        // Works whether the question is on its own line OR inline after the last item (fixed above).
        const lastCheckIdx = text.lastIndexOf('✅');
        if (lastCheckIdx !== -1) {
            const afterList = text.substring(lastCheckIdx);
            // Match newline(s) OR just whitespace before the question
            const catQMatch = afterList.match(/(\n+|\s{1,})((?:¿|¡)[^?!]*(?:elegir|eliges?|gustar[ií]a elegir|prefieres?|interesa|llama la atenci[oó]n|quedas?|va m[aá]s|apunta|te va|escoges?|escoge)[^?!]*[?!])/i);
            if (catQMatch) {
                const globalIdx = lastCheckIdx + catQMatch.index + catQMatch[1].length;
                const beforeQ = text.substring(0, globalIdx).trimEnd();
                let question = text.substring(globalIdx).trim();

                // 5️⃣ Inject candidate first name into the question if available
                // (solo si GPT no lo puso ya — evita "Oscar Oscar")
                if (candidateData?.nombreReal) {
                    const firstName = candidateData.nombreReal.trim().split(/\s+/)[0];
                    if (firstName && firstName.length > 1 && !question.toLowerCase().includes(firstName.toLowerCase())) {
                        // "¿Cuál eliges?" → "¿Cuál eliges, Oscar?"
                        // Insert name before the `?` (preserving trailing emojis/spaces after it)
                        // "¿Cuál eliges? 🤭" → "¿Cuál eliges Oscar? 🤭"
                        question = question.replace(/(\?)(\s*[\p{Emoji}\s]*)?$/u, (_, q, trail) => ` ${firstName}${q}${trail || ''}`);
                    }
                }

                text = `${beforeQ}[MSG_SPLIT]${question}`;
            }
        }

        // 🔚 CLOSING QUESTION FALLBACK: If ✅ list has no closing question after the last item, inject one.
        // This fires only when GPT forgot to include the question (catQMatch was null).
        if (lastCheckIdx !== -1) {
            const _afterLast = text.substring(lastCheckIdx);
            if (!/(\?|¿)/.test(_afterLast) && !_afterLast.includes('[MSG_SPLIT]')) {
                const _fnFb = candidateData?.nombreReal?.trim().split(/\s+/)[0] || '';
                text = text.trimEnd() + `\n\n[MSG_SPLIT]¿Cu\u00e1l de estas opciones te interesa${_fnFb ? `, ${_fnFb}` : ''}? \ud83d\ude0a`;
            }
        }
    }

    // 🔁 NO-BOT LIST DEDUP: Si la lista (categorías ✅ / escolaridad 🎒..🧠) ya se envió en los
    // últimos mensajes del bot, NO re-pegarla — un humano no re-manda el menú completo, lo
    // referencia ("de las opciones de arriba 👆"). GPT tiene la regla en el prompt pero la
    // ignora seguido; esta es la red determinista.
    {
        const _recentBot = Array.isArray(stepContext?.recentBotTexts)
            ? stepContext.recentBotTexts.slice(-6).join('\n')
            : '';
        if (_recentBot) {
            const _fnDd = candidateData?.nombreReal ? candidateData.nombreReal.trim().split(/\s+/)[0] : '';
            const _pickDd = (arr) => arr[Math.floor(Math.random() * arr.length)];

            // — CATEGORÍAS (✅) — solo en repreguntas (sin categoría extraída este turno)
            const _catInText = (text.match(/✅/g) || []).length >= 3;
            const _catInRecent = (_recentBot.match(/✅/g) || []).length >= 3;
            if (_catInText && _catInRecent && !stepContext?.extractedCategoria && !_isCitaConfirmation) {
                let _segs = text.split('[MSG_SPLIT]').map(s => s
                    .split('\n').filter(l => !l.trim().startsWith('✅') && !/(?:opciones|categor[ií]as)[^\n]*:\s*$/i.test(l.trim())).join('\n')
                    .replace(/(?:aqu[ií])\s+(?:tienes|est[aá]n|te dejo|te muestro|te comparto)[^:\n]*[::]?\s*/gi, '')
                    .replace(/(?:estas son|mira)\s+las opciones[^:\n]*[::]?\s*/gi, '')
                    .replace(/¿qu[eé] categor[ií]a te interesa\??\s*/gi, '')
                    // Pregunta de cierre vieja incrustada dentro de la burbuja (la nueva la ponemos nosotros)
                    .replace(/¿[^?\n]*(?:opciones|eliges?|elegir|escoges?|categor[ií]a|te interesa|te animas)[^?\n]*\?\s*/gi, '')
                    // Líneas sin letras (solo emojis/residuos que dejó la limpieza)
                    .split('\n').filter(l => !l.trim() || /[a-zà-ÿ0-9¿]/i.test(l)).join('\n')
                    .replace(/\n{2,}/g, '\n').trim()
                ).filter(s => s.replace(/[^a-zà-ÿ]/gi, '').length >= 3 && !(s.length < 16 && /\?\s*$/.test(s)));
                // Quitar preguntas de cierre viejas (referencian "estas opciones" que ya no están)
                _segs = _segs.filter(s => !(/^[¡¿]/.test(s.trim()) && /(?:opciones|eliges?|elegir|escoges?|te interesa|te animas)/i.test(s) && s.length < 120));
                _segs.push(_pickDd([
                    '¿Cuál te late de las opciones que te mandé aquí arriba? 👆😊',
                    'Échale un ojito a la lista de arriba 👆 y dime cuál va más contigo 😊',
                    `De las opciones que te pasé arriba 👆 ¿cuál te llama la atención${_fnDd ? `, ${_fnDd}` : ''}?`
                ]));
                text = _segs.join('[MSG_SPLIT]');
            }

            // — ESCOLARIDAD (🎒..🧠) — la primera vez la lista no está en el historial reciente
            const _escInText = /🎒/.test(text);
            const _escInRecent = /🎒/.test(_recentBot);
            if (_escInText && _escInRecent) {
                let _segs = text.split('[MSG_SPLIT]').map(s => s
                    .split('\n').filter(l => !/^\s*(?:🎒|🏫|🎓|📚|🛠|🧠)/.test(l.trim()) && !/(?:opciones|escolaridad)[^\n]*:\s*$/i.test(l.trim())).join('\n')
                    // Corrida inline de emojis de lista ("...perfil. 😊 🎒🏫🎓📚🛠️🧠")
                    .replace(/(?:\s*(?:🎒|🏫|🎓|📚|🛠️|🛠|🧠)){3,}\s*/g, ' ')
                    // Emoji de lista huérfano al final del segmento ("Pero cuéntame, 🎒")
                    .replace(/(?:🎒|🏫|🎓|📚|🛠️|🛠|🧠|✅)\s*$/g, '')
                    .replace(/mira las opciones[^:\n]*[::]?\s*/gi, '')
                    // Pregunta de cierre vieja incrustada dentro de la burbuja (la nueva la ponemos nosotros)
                    .replace(/¿[^?\n]*(?:escolaridad|nivel de estudios|nivel escolar|la tuya)[^?\n]*\?\s*/gi, '')
                    // Líneas sin letras (solo emojis/residuos que dejó la limpieza)
                    .split('\n').filter(l => !l.trim() || /[a-zà-ÿ0-9¿]/i.test(l)).join('\n')
                    .replace(/\n{2,}/g, '\n').trim()
                ).filter(s => s.replace(/[^a-zà-ÿ]/gi, '').length >= 3 && !(s.length < 16 && /\?\s*$/.test(s)));
                // Quitar la confirmación de categoría (evento viejo) y preguntas de cierre viejas
                _segs = _segs.filter(s => !/elegiste/i.test(s) && !(/^[¡¿]/.test(s.trim()) && /(?:escolaridad|nivel de estudios|nivel escolar|la tuya)/i.test(s) && s.length < 120));
                _segs.push(_pickDd([
                    '¿Cuál es tu escolaridad? Ahí arriba te dejé las opciones 👆😊',
                    'Checa la lista que te mandé arriba 👆 ¿cuál es la tuya?',
                    `De las opciones de arriba 👆 dime cuál es tu nivel de estudios${_fnDd ? `, ${_fnDd}` : ''} 😊`
                ]));
                text = _segs.join('[MSG_SPLIT]');
            }
        }
    }

    // 🎂 FECHA DE NACIMIENTO: Inject example format if GPT forgot it
    // Only inject when ASKING for the date, not when confirming it was saved.
    {
        const _DATE_Q_RE = /fecha de nacimiento|cu[aá]ndo naciste|d[ií]a de nacimiento/i;
        const _HAS_EX_RE = /(?:ej\.|ejemplo|DD\/|por ejemplo|\d{2}\/\d{2}\/\d{4}|\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i;
        const _IS_CONFIRM_RE = /ya tengo|tengo tu|registr|anot[eéaó]|captur|guard[aáe]/i;

        let parts = text.includes('[MSG_SPLIT]') ? text.split('[MSG_SPLIT]') : [text];
        for (let i = 0; i < parts.length; i++) {
            if (_DATE_Q_RE.test(parts[i]) && !_HAS_EX_RE.test(parts[i]) && !_IS_CONFIRM_RE.test(parts[i]) && parts[i].includes('?')) {
                parts[i] = parts[i].trimEnd() + '\n(ejemplo 19 de mayo de 1988)';
            }
        }
        text = parts.join('[MSG_SPLIT]');
    }


    // 📅 DATE LIST: Remove LEADING 📅 (before number emoji), KEEP/ADD TRAILING 📅 (after date)
    // Target format: "1️⃣ Miércoles 11 de Marzo 📅"
    // Step 1: strip any 📅 that appears right before a number emoji
    text = text.replace(/📅\s*(1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣)/g, '$1');
    // Step 2: for each date line that has a number emoji but no trailing 📅, add one
    text = text.replace(
        /^((1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣)\s+(?:Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado|Domingo)[^\n📅]*?)(?!\s*📅)\s*$/gmu,
        '$1 📅'
    );
    // Strip stray 'o' connector words GPT inserts between date items
    // e.g. "Martes 10 de Marzo o\n" or a lone "o" line → removed
    text = text.replace(/[^\S\n]*\bo\b\s*(?=\n|$)/gm, '');   // "o" at end of line
    text = text.replace(/^\s*o\s*$/gm, '');                    // "o" alone on its own line
    // Normalize ALL header variants GPT uses → canonical "Tengo entrevistas los días:"
    // KEY FIX: "los?" and "siguientes?" are OUTSIDE the "para" group so they're consumed
    // whether or not GPT included "para":
    //   "disponibles los días:"          → "los días:" ✓
    //   "disponibles para los días:"     → "los días:" ✓
    //   "disponibles para los siguientes días:" → "los días:" ✓
    //   "para el:" / "el:"              → "los días:" ✓
    text = text.replace(
        /Tengo entrevistas?\s+(?:disponibles?\s+)?(?:(?:para|de)\s+)?(?:la\s+semana\s+de\s+)?(?:los?\s+)?(?:siguientes?\s+)?(?:d[ií]as?|el)\s*:/gi,
        'Tengo entrevistas los días:'
    );
    // Post-strip: remove any leftover "para los [siguientes] [días]:" after canonical header
    text = text.replace(/(Tengo entrevistas los d[ií]as:)\s*para\s+(?:los?\s+)?(?:siguientes?\s+)?(?:d[ií]as?|el)?\s*:?/gi, '$1');

    // 🗓️ INLINE DATES → NUMBERED LIST (UNIVERSAL): If dates follow the canonical header as prose
    // (e.g. "Tengo entrevistas los días: Martes 12 de Marzo, Jueves 14 de Marzo"),
    // or AI wrote "disponibles para el Martes..." without a header,
    // convert to 1️⃣ Martes 12 de Marzo 📅 format.
    {
        const NUM_UNI = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];
        const DAY_RE = /(?:Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado|Domingo)/i;

        // Case A: after canonical header on same line or next line
        text = text.replace(
            /(Tengo entrevistas los d[ií]as:)\s*\n?((?:(?!1️⃣|2️⃣)[^\n?¿⏬])+)/i,
            (match, header, datesStr) => {
                if (/1️⃣|2️⃣/.test(datesStr)) return match; // already a numbered list
                const dates = datesStr.split(/,\s*|\s+y\s+/)
                    .map(d => d.trim())
                    .filter(d => DAY_RE.test(d));
                if (dates.length === 0) return match;
                return header + '\n' + dates.map((d, i) => `${NUM_UNI[i] || `${i+1}.`} ${d} 📅`).join('\n');
            }
        );

        // Case B: AI wrote "disponibles para el [Day Date]" without the header word
        // e.g. "Tengo entrevistas disponibles para el Martes 12 de Marzo"
        text = text.replace(
            /Tengo entrevistas?\s+(?:disponibles?\s+)?para\s+el\s+((?:Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado|Domingo)[^.\n?¿]+)/gi,
            (match, dateStr) => {
                // Split in case there are multiple dates comma-separated
                const dates = dateStr.split(/,\s*|\s+y\s+/)
                    .map(d => d.trim())
                    .filter(d => DAY_RE.test(d));
                if (dates.length === 0) return match;
                return 'Tengo entrevistas los días:\n' + dates.map((d, i) => `${NUM_UNI[i] || `${i+1}.`} ${d} 📅`).join('\n');
            }
        );
    }

    // ⏰ HOURS MESSAGE: detect when GPT lists time slots (may use 🔹 or number emojis)
    // Trigger is broader: GPT humanizes dates so outputs no YYYY-MM-DD.
    const hasTimeSlots = /(?:🔹\s*Opci[oó]n\s*\d+|\btengo entrevistas? a las\b|estas opciones de horario)/i.test(text)
        || (/\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(text) && /(?:1️⃣|2️⃣|🔹)/i.test(text));
    if (hasTimeSlots) {
        let slotIdx = 0;
        // 🔹 Opción N: → 1️⃣, 2️⃣...
        text = text.replace(/🔹\s*Opci[oó]n\s*\d+:\s*/gi, () => `${_NUM_EMOJIS[slotIdx++] || `${slotIdx}.`} `);
        // 🕐🕑🕒... clock variants → ⏰
        text = text.replace(/🕐|🕑|🕒|🕓|🕔|🕕|🕖|🕗|🕘|🕙|🕚|🕛/g, '⏰');
        // ⏰ after every time if missing
        text = text.replace(/(\d{1,2}:\d{2}\s*(?:AM|PM))(?!\s*⏰)/gi, '$1 ⏰');
        // 🔧 INLINE SLOT SPLITTER: If multiple slots are on the same line (GPT squishes them),
        // split so each gets its own line: "1️⃣ 03:00 PM ⏰ 2️⃣ ..." → separate lines with spacing
        text = text.replace(/(⏰)\s+([1-9]️⃣)/g, '⏰\n\n$2');
        // Single slot → fix header + closing question
        const timeCount = (text.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/gi) || []).length;
        if (timeCount === 1) {
            text = text.replace(
                /(?:Perfecto,?\s+)?[Pp]ara el\s+(.+?)\s+tengo estas opciones de horario(?:\s+para ti)?:/gi,
                'Para el $1 tengo entrevista a las:'
            );
            text = text.replace(/¿Cu[aá]l prefieres?\??\s*/gi, '¿Te parece bien ese horario?');
        }
        // Split closing question as separate bubble
        const _qIdx = text.lastIndexOf('\xbf');
        if (_qIdx > 0) {
            text = text.substring(0, _qIdx).trim() + '[MSG_SPLIT]' + text.substring(_qIdx).trim();
        }
    }
    // 🗓️ CONFIRMATION MESSAGE: "Ok [name], entonces agendamos..."
    if (/(?:Ok|Bien|Perfecto)[,\s]+\w+[,\s]+entonces agendamos|agendamos tu cita|confirmamos tu cita|apartamos tu cita|reserve tu lugar|entonces agendamos tu entrevista para el/i.test(text)) {
        // If there's FAQ text BEFORE "Ok [name], entonces agendamos..." → split it off as msg 1
        let confirmStart = text.search(/(?:Ok|Bien|Perfecto)[,\s]+\w+[,\s]+entonces agendamos/i);
        if (confirmStart === -1) confirmStart = text.search(/entonces agendamos tu entrevista para el/i);
        
        let faqPart = '';
        if (confirmStart > 0) {
            faqPart = text.substring(0, confirmStart).trim();
            text = text.substring(confirmStart).trim();
        }

        // Apply strict visual formatting required by the candidate
        // Extracts the dynamic Date and Time to rebuild the string
        let extractedDate = '';
        let extractedTime = '';
        
        // Match existing date span logic
        const dateMatch = text.match(/(?:para el\s+|el d[ií]a\s+)([a-záéíóúüñ]+\s+\d{1,2}\s+de\s+[a-záéíóúüñ]+)/i) || text.match(/(?:para el\s+)([\w\s]+?)(?=\s+a las)/i);
        if (dateMatch && dateMatch[1]) extractedDate = dateMatch[1].trim();
        
        const timeMatch = text.match(/(?:a las\s+)(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
        if (timeMatch && timeMatch[1]) extractedTime = timeMatch[1].trim();

        // Strip out duplicated splits and emojis completely before rebuilding
        text = text.replace(/\[MSG_SPLIT\]/g, ' ').replace(/🤝✨/g, '');
        // Wipe duplicate "¿estamos de acuerdo?" if GPT wrote it itself
        text = text.replace(/¿estamos de acuerdo\??/gi, '').trim();

        // If we successfully extracted the core components, overwrite the bot's raw text 
        // with the deterministic perfect format requested by the user
        if (extractedDate && extractedTime) {
            const firstNameMatch = text.match(/^(?:Ok|Bien|Perfecto)[,\s]+(\w+)[,\s]+/i);
            const firstName = firstNameMatch ? firstNameMatch[1] : (candidateData ? (candidateData.nombreReal || candidateData.nombre) : '');
            
            // Reconstruct the exact format
            text = `Ok${firstName ? ` ${firstName}` : ''}, entonces agendamos tu entrevista para el:\n✅ ${extractedDate.charAt(0).toUpperCase() + extractedDate.slice(1)}\n✅ a las ⏰ ${extractedTime}.\n\n[MSG_SPLIT]¿estamos de acuerdo? 🤝✨`;
        } else {
            // Fallback to basic string modification if regex fails
            if (text.endsWith(',') || text.endsWith('.')) text = text.substring(0, text.length - 1);
            text = text + '.\n\n[MSG_SPLIT]¿estamos de acuerdo? 🤝✨';
        }
        
        // Prepend the FAQ text if it existed
        if (faqPart) {
            text = faqPart + '[MSG_SPLIT]' + text;
        }
    }
    // 🎯 INICIO PASO CTA GUARANTEE (Capa 1 — Más amplia que el Safety Net)
    // In Inicio/Filtro steps, EVERY substantive response must end with the
    // scheduling CTA in a SEPARATE BUBBLE — regardless of topic.
    // This is the broadest net: no topic keywords required.
    if (stepContext.isInicio && !text.includes('[MSG_SPLIT]')) {
        const _alreadyHasCta  = /¿Te gustar[ií]a agendar|¿te gustar[ií]a que te agende|¿te puedo agendar|¿procedo a agendar|¿avanzamos con|¿autorizas que agende|¿deseas que programe|¿quieres que reserve/i.test(text);
        const _isDataCapture  = /escolaridad|nivel de estudios|en qu[eé]\s+(?:municipio|ciudad|lugar)|c[oó]mo te llamas|cu[aá]l es tu nombre|cu[aá]ntos a[nñ]os|fecha de nacimiento/i.test(text);
        const _isVacancyIntro = /ESTAMOS CONTRATANDO|vacante que encontr[eé]|comparto la vacante|te interesa la vacante|una vacante disponible/i.test(text);
        const _isDateList     = /Tengo entrevistas los d[ií]as|1️⃣.*📅|tengo entrevistas? a las|\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(text);
        const _isConfirmation = /tu cita queda agendada|estamos de acuerdo|cita agendada/i.test(text);
        const _isFallback     = /excelente pregunta|déjame consultarlo|darte el dato exacto/i.test(text);

        if (!_alreadyHasCta && !_isDataCapture && !_isVacancyIntro && !_isDateList && !_isConfirmation && text.length > 5) {
            let _ctaText = _CTA_VARIANTS[(stepContext.ctaVariantIdx || 0) % _CTA_VARIANTS.length];
            // Inject first name before the closing ? for a personal touch
            if (candidateData?.nombreReal) {
                const _fn = candidateData.nombreReal.trim().split(/\s+/)[0];
                if (_fn && _fn.length > 1) {
                    _ctaText = _ctaText.replace(/(\?)([\s\p{Emoji}\s]*)$/u, (_, q, trail) => ` ${_fn}${q}${trail || ''}`);
                }
            }
            text = text.trimEnd() + `[MSG_SPLIT]${_ctaText}`;
        }
    }

    // 🎯 FAQ CLOSING QUESTION SAFETY NET (Capa 1b — Backup for non-Inicio steps)
    // Only fires for non-Inicio steps when FAQ topic keywords are detected.
    if (!stepContext.isInicio && !stepContext.isCitados && !text.includes('[MSG_SPLIT]') && !text.includes('\xbf')) {
        const hasCompleteProfile = !!(
            candidateData &&
            (candidateData.nombreReal || candidateData.nombre) &&
            candidateData.municipio &&
            candidateData.escolaridad
        );

        const isJobFaqAnswer = hasCompleteProfile
            && text.length > 80
            && /(?:sueldo|salario|pago semanal|pago quincenal|\$\s*\d|💰|prestaciones|seguro\s+(?:médico|social|imss)|vacaciones|aguinaldo|comedor|transporte|bono|vales|uniforme|fondo de ahorro|caja de ahorro|turno|horario|jornada|hrs\b|horas de trabajo|lunes a viernes|lunes a jueves|ubicaci[oó]n|direcci[oó]n|zona\b|calzada|calle\s+\w|colonia\s+\w|planta\b|plantar|documentos|papeler[ií]a|requisitos|experiencia\s+(?:requerida|necesaria|mínima)|entrevista inmediata)/i.test(text)
            && !/(?:agendar|te\s+gustar[ií]a|entrevista\s*\?)/i.test(text)
            && !/(?:📅\s*1️⃣|tengo entrevistas los d[ií]as|\d{1,2}:\d{2}\s*(?:AM|PM))/i.test(text)
            && !/(?:ESTAMOS CONTRATANDO|vacante que encontré|comparto la vacante|tu cita queda agendada)/i.test(text);

        if (isJobFaqAnswer) {
            const _faqClosings = [
                '🙋‍♀️ ¿Te gustaría que te agende una cita para entrevista? 🗓️✨',
                '😊 ¿Te apunto para una entrevista? ¡Solo toma un momento! 🚀',
                '🙋‍♀️ ¿Quieres que reserve tu lugar para la entrevista? 🎯💼',
                '😄 ¿Avanzamos con tu cita de entrevista? ¡Estás muy cerca! 🌟🙌',
                '🙋‍♀️ ¿Te confirmo tu cita para entrevista? ¡No pierdas tu oportunidad! 💪✅',
                '😊 ¿Procedo a agendar tu entrevista? Es el siguiente paso 🏆',
                '🙋‍♀️ ¿Te aparto una cita para que conozcas el equipo? 🤝✨',
                '😄 ¿Quieres que te programe la entrevista hoy mismo? 📅🔥',
                '🙋‍♀️ ¿Listo para dar el siguiente paso? Te agendo la entrevista ahora 💥',
                '😊 ¿Te interesa que asegure tu cita de entrevista? ¡Hay lugares disponibles! 🎉',
            ];
            const _closing = _faqClosings[Math.floor(Math.random() * _faqClosings.length)];
            text = text.trimEnd() + '[MSG_SPLIT]' + _closing;
        }
    }

    // 📩 GENERIC LAST-QUESTION SPLIT: If substantial FAQ answer (>60 chars) precedes a closing ¿...? question,
    // split them into separate bubbles — covers all Cita return questions (¿Qué día?, ¿Cuál horario?, etc.)
    if (!text.includes('[MSG_SPLIT]')) {
        const lastQ = text.lastIndexOf('\xbf');
        if (lastQ > 50) {
            const beforeQ = text.substring(0, lastQ);
            // Find last natural sentence end (! or .) before the ¿
            const lastBang = beforeQ.lastIndexOf('!');
            const lastDot = beforeQ.lastIndexOf('.');
            const naturalEnd = Math.max(lastBang, lastDot);

            if (naturalEnd > 25) {
                // Advance past any trailing emojis and spaces (they belong with msg1)
                let splitAt = naturalEnd + 1;
                while (splitAt < beforeQ.length &&
                    (isEmoji(beforeQ[splitAt]) || beforeQ[splitAt] === ' ')) {
                    splitAt++;
                }
                const bodyPart = text.substring(0, splitAt).trim();
                // Strip any orphan emojis/whitespace the AI placed between the answer and the ¿ question
                let questionPart = text.substring(splitAt).replace(/^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\s]+(?=[¿¡])/gu, '').trim();
                if (bodyPart.length > 20 && questionPart.length > 20) {
                    // Don't split very short polite connectors (¿Me lo compartes? ¿Me ayudas? etc.)
                    const isShortConnector = /^¿(Me|Te|Nos|Puedes|Podrías|Me lo|Te lo)[\s\w]{0,25}\?/.test(questionPart);
                    if (!isShortConnector) {
                        text = bodyPart + '[MSG_SPLIT]' + questionPart;
                    }
                }
            }
        }
    }

    // 🧹 DANGLING CONNECTOR CLEANUP: burbujas que quedan rotas en un conector se ven
    // claramente de bot ("...🌟 Ahora," / "Así que," sola / "Entonces,\n🎒 Primaria...").
    if (text.includes('[MSG_SPLIT]')) {
        let _bubbles = text.split('[MSG_SPLIT]').map(b => b.trim()).filter(Boolean);
        // 1) Burbuja que ES solo un conector → fuera
        _bubbles = _bubbles.filter(b => !/^(?:Ahora|Entonces|As[ií] que|Bueno|Pues|Pero)\s*[,.:…]*$/i.test(b));
        // 2) Burbuja que termina en coma (frase rota: "...🌟 Ahora, dime,") → recortar
        //    hasta el último cierre de oración; si no hay, quitar la cláusula conectora final.
        _bubbles = _bubbles.map(b => {
            // "Pero cuéntame," / "Ahora, dime," al final (con o sin emoji después de la coma)
            b = b.replace(/\s(?:pero\s+|ahora\s*,?\s*|y\s+)?(?:cu[eé]ntame|dime|oye|a ver)\s*,\s*[\p{Emoji}️\s]*$/iu, '').trimEnd();
            if (!/,\s*$/.test(b)) return b;
            const _cut = Math.max(b.lastIndexOf('.'), b.lastIndexOf('!'), b.lastIndexOf('?'));
            if (_cut > 10) return b.substring(0, _cut + 1);
            return b.replace(/\s(?:Ahora|Entonces|As[ií] que|Bueno|Pues)\b[^.!?¿\n]{0,30},\s*$/i, '').trimEnd();
        });
        // 3) Conector huérfano al INICIO de una burbuja seguido de una lista → recortarlo
        _bubbles = _bubbles.map(b => b.replace(/^(?:Ahora|Entonces|As[ií] que|Bueno)\s*[,:]?\s*\n(?=\s*(?:✅|🎒|🏫|🎓|📚|🛠|🧠|1️⃣))/i, ''));
        text = _bubbles.filter(b => b.length > 0).join('[MSG_SPLIT]');
    }

    return text;
}
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_EXTRACTION_RULES = `
[EXTRAER]: nombreReal, genero, fechaNacimiento, edad, municipio, categoria, escolaridad.
1. REFINAR: Si el dato en [ESTADO] ya existe y es válido, mantenlo. Si el candidato da info nueva, actualiza.
2. FORMATO: Nombres en Title Case. Fecha DD/MM/YYYY (Si el usuario te da números amontonados como "191274" o "190590", INTUYE LA FECHA y guárdala formateada como "19/12/1974". No se la rechaces si puedes deducirla).
3. MUNICIPIO: Extrae el nombre OFICIAL COMPLETO del municipio (ej: "Monterrey", "Apodaca", "Benito Juárez", "General Escobedo", "Cadereyta Jiménez", "San Nicolás de los Garza", "San Pedro Garza García", "General Zuazua", "Salinas Victoria", "Sabinas Hidalgo", "El Carmen", "Los Aldamas", "Los Herreras", "Los Ramones", "Lampazos de Naranjo", "Ciénega de Flores"). Si el usuario incluye su colonia o fraccionamiento (ej: "Centro Apodaca", "Valle del roble Cadereyta"), IGNORA la colonia y extrae SÓLO el municipio con su nombre oficial. Si el usuario dice solo "Escobedo" → guarda "General Escobedo"; "San Nicolás" → "San Nicolás de los Garza"; "San Pedro" → "San Pedro Garza García"; "Juárez" → "Benito Juárez"; "Zuazua" → "General Zuazua"; "Cadereyta" → "Cadereyta Jiménez"; "Sabinas" → "Sabinas Hidalgo"; "Salinas" → "Salinas Victoria". Si ya está en [ESTADO], mantenlo intacto. CONTEXTO TEMPORAL (CRÍTICO): extrae el municipio SÓLO si el candidato indica que vive AHÍ ACTUALMENTE. Si lo menciona en pasado o con negación ("antes vivía en X", "vivía en X", "ya no vivo en X", "me mudé de X", "antes estaba en X", "viví en X"), NO lo extraigas (deja municipio vacío): te está diciendo dónde vivía ANTES, no dónde vive hoy. En ese caso, en tu respuesta reconoce lo que dijo y pregúntale explícitamente en qué municipio vive ACTUALMENTE (ej: "Entendido, ¿y en qué municipio vives actualmente? 😊").
4. ESCOLARIDAD: Primaria, Secundaria, Preparatoria, Licenciatura, Técnica, Posgrado.
5. CATEGORÍA: Solo de: {{categorias}}.
`;

export const DEFAULT_CEREBRO1_RULES = `
[FASE 1: TU MISIÓN PRINCIPAL - FLUJO DE CAPTURA]
Tu objetivo técnico es obtener: {{faltantes}}.

 REGLAS DE MISIÓN:
 1. CORTESÍA PROFESIONAL: Si el usuario dice "Sí", "Claro", "Te ayudo" o saluda, responde siempre de manera amable pero PROFESIONAL. Tienes ESTRICTAMENTE PROHIBIDO usar lenguaje coqueto o informal como "me chiveas" o "qué lindo". Eres una Licenciada en Recursos Humanos y debes mantener el respeto.
 2. NOMBRE COMPLETO: Si solo te da el nombre de pila sin apellidos, agradécele y pídele sus apellidos con amabilidad profesional para avanzar en su registro.
 3. CATEGORÍA: Si AÚN NO has mostrado la lista de categorías en este historial, muéstrala en formato vertical con ✅ y un SOLO salto de línea (\n) entre cada opción — NUNCA doble salto. Si YA la mostraste (revisa el historial), TIENES PROHIBIDO repetirla completa — solo pregunta: "¿Cuál de las opciones que te compartí te interesa más?".
     ESTRUCTURA al mostrar por PRIMERA VEZ:
     "¡Perfecto! Mira, estas son las opciones que tengo para ti: 

     {{categorias}}

     ¿Cuál de estas opciones te interesa?"
 4. FORMATO ESCOLARIDAD: La PRIMERA vez que preguntes por el nivel de escolaridad usa EXACTAMENTE 3 burbujas separadas por [MSG_SPLIT]. Burbuja 1: confirma la categoría elegida por el candidato y anuncia que necesitas su escolaridad (ej: "¡Perfecto, [Nombre]! Elegiste [Categoría]. Ahora solo me falta saber tu nivel de escolaridad. Mira las opciones:"). Burbuja 2: la lista vertical con UN solo salto de línea entre cada opción, PROHIBIDO doble salto (\n\n) entre opciones. Burbuja 3: una pregunta corta de cierre (ej: "¿Cuál es la tuya? 🌟"). PROHIBIDO poner las opciones en el mismo renglón separadas por comas. Si estás REPREGUNTANDO porque el candidato evadió o preguntó otra cosa: PROHIBIDO repetir "Elegiste [Categoría]" y PROHIBIDO re-enviar la lista — reconoce con gracia lo que dijo y repregunta refiriendo la lista de arriba (ej: "¿Cuál es tu escolaridad? Ahí arriba te dejé las opciones 👆😊").
 5. FECHA DE NACIMIENTO: Pídela SIEMPRE dando el ejemplo exacto: "(ejemplo 19 de mayo de 1988)". No lo olvides.
 5. DINÁMICA: Si responde algo que no sea el dato (ej: "No vivo ahí", "No sé"), SIEMPRE sé empática primero ("Entiendo perfectamente") y luego re-enfoca pidiendo el dato que falta o el siguiente.
 6. PERSUASIÓN (PREGUNTAS DE VACANTES/SUELDO/LUGAR/ENTREVISTAS): Cuando el candidato pregunta algo sobre vacantes, entrevistas o sueldos, DEBES: (a) Responder BREVEMENTE con una PROMESA concreta: en cuanto termine su registro le compartes todos los detalles (ubicación, sueldo, horarios, fechas). ESTRICTAMENTE PROHIBIDO inventar respuestas de la vacante, y (b) Redirigir amablemente preguntando el dato faltante: {{faltantes}}. Ejemplo: "😊 Claro que sí, terminando tu registro te paso todos los detalles de ubicación y fechas. Solo me falta un dato, ¿me ayudas?"
 7. ORDEN ESTRICTO: Siempre debes pedir el PRIMER dato de la lista de {{faltantes}}. ¡PROHIBIDO saltarte al segundo dato si el candidato evadió la pregunta o no respondió con el primero!
 8. LENGUAJE: PROHIBIDO decir "base de datos" o "robot". Di "nuestro sistema" o "tu registro en la plataforma".
 9. CORTESÍA INICIAL: Si te saluda, salúdalo de vuelta amablemente antes de pedir el dato.
 10. PREGUNTAS PERSONALES: Eres Brenda Rodríguez de Monterrey. Mantén siempre el perfil estrictamente profesional si preguntan cosas personales y regresa al tema de reclutamiento. PROHIBIDO DECIR QUE ERES UN BOT.
 11. OMITIR REPETICIONES Y DOBLES MENÚS: Si el candidato acaba de responder correctamente a la pregunta previa dando el dato (ej. te dio su escolaridad, fecha, ciudad), CONFIRMA SU INGRESO y PASA DE INMEDIATO AL SIGUIENTE DATO. TIENES ESTRICTAMENTE PROHIBIDO repetir la pregunta del dato que acaba de dar o mostrar sus listas de opciones asociadas (ej. la lista de escolaridad).`;

export const DEFAULT_SYSTEM_PROMPT = `
[PERSONALIDAD]:
Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. 
Eres carismática, profesional, coqueta y muy divertida. 
Hablas como una joven de oficina que usa su encanto para que los candidatos se sientan en confianza.
Usa emojis para hacerlo agradable y tierno, no uses los mismos siempre. No uses asteriscos (*).

[REGLAS DE ORO]:
- NUNCA REPITAS MENSAJES. Sé creativa, varía tus palabras.
- PERSUASIÓN (vacantes/entrevistas/empleo): Si el candidato pregunta por vacantes, sueldos, entrevistas o información de empleo Y el perfil está incompleto: PROHIBIDO inventar o alucinar datos. Responde BREVE (máximo 2 líneas) con una PROMESA concreta: en cuanto termine su registro le compartes todos los detalles (ubicación, sueldo, horarios, fechas). Luego redirige a la extracción. Ejemplo: "😊 Claro, terminando tu registro te paso ubicación, horarios y todos los detalles. ¿Me ayudas con el dato que falta?"
- Si te ligan o halagan: OBLIGATORIO responder PRIMERO con picardía, gracia y mucha dulzura (ej: "¡Ay, qué lindo! 🤭✨ me chiveas", "Jaja me sonrojas 🙈🌸"). PROHIBIDO ignorar el piropo. Después de reconocerlo, re-enfoca a la extracción con naturalidad (ej: "pero oye, todavía necesito tu municipio. ¿Me lo dices? 😊").
- CURIOSIDAD DEL USUARIO: Si te preguntan si eres un bot, di que eres una persona real (reclutadora de 25 años viviendo en Monterrey). NUNCA admitas ser IA.
- MENSAJES CORTOS: Máximo 4 líneas.

[PROTOCOLO DE SALUDO (ALEATORIO)]:
Usa frases como: "¡Hola! 👋 Qué gusto saludarte", "¡Hola, hola! 👋 Soy la Lic. Brenda", "¡Qué tal! Por aquí la Lic. Brenda", "¡Mucho gusto! ✨". Varía siempre.

[REGLAS DE FORMATO]:
- PROHIBIDO USAR ASTERISCOS (*).
- No uses "Hola" en segundos mensajes, solo en el inicial.
- No hagas halagos personales (guapo, lindo, etc.).
- LISTAS VERTICALES: Categorías siempre una por renglón con ✅.
- FECHAS: Siempre usa el ejemplo (ejemplo 19 de mayo de 1988).
- NO digas "base de datos", di "tu registro" o "nuestro sistema".

- NOMBRES: NUNCA uses el municipio, ciudad, colonia o cualquier dato diferente al nombre como forma de dirigirte al candidato. Siempre usa su nombre real del [ESTADO]. Si aún no tienes su nombre, no uses ningún dato de reemplazo.
- CONFIRMACIÓN DE DATOS: Cuando el candidato te da un municipio/ciudad, confirma el dato con frases como "¡Perfecto, registrado! 🌟" o "Listo, anotado 😊" — NUNCA repitas como saludo el nombre de la ciudad.
- BURBUJAS DE CONFIRMACIÓN: Cuando confirmas un dato y luego haces la siguiente pregunta, OBLIGATORIO separar con [MSG_SPLIT]. Burbuja 1: SOLO la confirmación corta (ej: "¡Perfecto, registrado! 🌟"). Burbuja 2: empieza con "Ahora, [Nombre]..." y contiene la siguiente pregunta. NUNCA pongas "Ahora" ni la siguiente pregunta en la misma burbuja que la confirmación.
- VOCABULARIO: NUNCA uses la palabra "resides" — usa "vives" en su lugar. Di "¿en qué municipio vives?" nunca "¿en qué municipio resides?".
`;

export const DEFAULT_ASSISTANT_PROMPT = `
Eres la Lic. Brenda Rodríguez de Candidatic. 
Puntualmente asistes a los reclutadores para resolver dudas de candidatos.
Sé amable, eficiente y profesional.
`;

/**
 * 📅 DATE NORMALIZATION UTILITY
 * Normalizes various birth date formats to DD/MM/YYYY
 * Handles: 10/2/88, 19/5/83, 19/05/1983, etc.
 */
function normalizeBirthDate(input) {
    if (!input || typeof input !== 'string') {
        return { isValid: false, date: null };
    }

    const cleaned = input.trim();

    // Try to parse various formats
    const patterns = [
        // DD/MM/YYYY (already correct)
        /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/,
        // DD/MM/YY (2-digit year)
        /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/,
    ];

    let day, month, year;
    let matched = false;

    // 0. Try YYYY-MM-DD or YYYY/MM/DD (ISO/GPT format)
    const isoPattern = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/;
    const isoMatch = cleaned.match(isoPattern);
    if (isoMatch) {
        year = isoMatch[1];
        month = isoMatch[2];
        day = isoMatch[3];
        matched = true;
    }

    // 1. Try Natural Spanish Date (e.g. "19 de mayo de 1988" or "19 mayo 88")
    const textPattern = /^(\d{1,2})\s*(?:de\s+)?([a-zA-Z]+)\s*(?:de\s+)?(\d{2,4})$/i;
    const textMatch = cleaned.match(textPattern);

    if (textMatch) {
        const meses = {
            'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
            'julio': '07', 'agosto': '08', 'septiembre': '09', 'setiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
        };
        const mText = textMatch[2].toLowerCase();
        if (meses[mText]) {
            day = textMatch[1];
            month = meses[mText];
            year = textMatch[3];
            matched = true;
        }
    }

    // 2. Try Solid Digit Blocks (no separators): DDMMYYYY or DDMMYY
    if (!matched) {
        const solid8 = cleaned.match(/^(\d{2})(\d{2})(\d{4})$/);
        if (solid8) { day = solid8[1]; month = solid8[2]; year = solid8[3]; matched = true; }
    }
    if (!matched) {
        const solid6 = cleaned.match(/^(\d{2})(\d{2})(\d{2})$/);
        if (solid6) { day = solid6[1]; month = solid6[2]; year = solid6[3]; matched = true; }
    }

    // 3. Try Numeric Patterns (with separators)
    if (!matched) {
        for (const pattern of patterns) {
            const match = cleaned.match(pattern);
            if (match) {
                [, day, month, year] = match;
                matched = true;
                break;
            }
        }
    }

    if (matched) {
        // Convert 2-digit year to 4-digit
        if (year.length === 2) {
            const yy = parseInt(year);
            year = yy >= 40 ? `19${year}` : `20${year}`;
        }

        // Pad day and month with leading zeros
        day = day.padStart(2, '0');
        month = month.padStart(2, '0');

        const d = parseInt(day);
        const m = parseInt(month);
        const y = parseInt(year);

        // Basic Range Validation
        if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > new Date().getFullYear()) {
            return { isValid: false, date: null };
        }

        // Correctness check (Leap Year/Days in month)
        const testDate = new Date(y, m - 1, d);
        if (testDate.getDate() !== d || testDate.getMonth() !== m - 1) {
            return { isValid: false, date: null };
        }

        return { isValid: true, date: `${day}/${month}/${year}` };
    }

    return { isValid: false, date: null };
}

/**
 * 🧬 COALESCENCE HELPERS (Zuckerberg Standard)
 * Merges partial data fragments into a complete state.
 */
function coalesceName(existing, incoming) {
    if (!incoming) return existing;
    if (!existing || /proporcionado|desconocido|luego|privado|\+/i.test(existing)) return incoming;

    const e = String(existing).trim();
    const i = String(incoming).trim();

    // If incoming is already contained or is a better version of existing
    if (e.toLowerCase().includes(i.toLowerCase())) return existing;
    if (i.toLowerCase().includes(e.toLowerCase())) return incoming;

    // 🧬 SMART REPLACEMENT: If the user provides a completely new full name (2+ words)
    // and it shares at least one significant word with the old name (e.g., "Oscar"), 
    // it's a correction, not an addition. Overwrite it.
    const eWords = e.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const iWords = i.toLowerCase().split(/\s+/).filter(w => w.length > 0);

    if (iWords.length >= 2) {
        // Did they share a word? (e.g. "oscar rodriguez" vs "oscar martinez")
        const sharedWord = eWords.some(ew => i.toLowerCase().includes(ew));
        if (sharedWord || iWords.length > eWords.length) {
            return incoming;
        }
    }

    // Fallback: Join with space if they seem to be disjoint parts (e.g. "Oscar" + "Rodriguez")
    return `${e} ${i}`;
}

function coalesceDate(existing, incoming) {
    if (!incoming) return existing;
    if (incoming.length < 4 || incoming.toLowerCase().includes('null')) return existing;
    
    const normalizedIn = normalizeBirthDate(incoming);
    if (normalizedIn.isValid) return normalizedIn.date;

    // If existing part exists and new part arrives (e.g. "25" then "Mayo")
    // For now, satisfy with normalization, but if it lacks a year, reject it to avoid corrupting DB
    return existing;
}

function getFirstName(fullName) {
    if (!fullName || typeof fullName !== 'string') return null;
    const parts = fullName.trim().split(/\s+/);
    return parts[0] || null;
}

const getIdentityLayer = (customPrompt = null) => {
    return customPrompt || DEFAULT_SYSTEM_PROMPT;
};

/**
 * 🔄 RE-ENGAGEMENT: Find all vacancies from bypass projects the candidate qualifies for RIGHT NOW.
 * Uses the same matching engine as Orchestrator.executeHandover but collects ALL matches.
 */
const getReengageVacancies = async (candidateData) => {
    try {
        const normalizeStr = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const rules = await getActiveBypassRules();
        const projects = await getProjects();

        const qualifyingVacancyIds = new Set();

        for (const rule of rules) {
            // Excluded tags check
            if (rule.excludedTags && rule.excludedTags.length > 0 && candidateData.tags && Array.isArray(candidateData.tags)) {
                if (candidateData.tags.some(tag => rule.excludedTags.includes(tag))) continue;
            }
            // Age Check
            const cAge = parseInt(candidateData.edad);
            if (!isNaN(cAge)) {
                if (rule.minAge && cAge < parseInt(rule.minAge)) continue;
                if (rule.maxAge && cAge > parseInt(rule.maxAge)) continue;
            }
            // Gender Check
            const cGender = normalizeStr(candidateData.genero);
            const rGender = normalizeStr(rule.gender || 'Cualquiera');
            if (rGender !== 'cualquiera' && cGender !== rGender) continue;
            // Category Check
            const cCat = normalizeStr(candidateData.categoria);
            if (rule.categories && rule.categories.length > 0) {
                const ok = rule.categories.some(rc => {
                    const rCat = normalizeStr(rc);
                    return rCat.includes(cCat) || cCat.includes(rCat);
                });
                if (!ok) continue;
            }
            // Municipio Check
            const cMun = normalizeStr(candidateData.municipio);
            if (rule.municipios && rule.municipios.length > 0) {
                const ok = rule.municipios.some(rm => {
                    const rMun = normalizeStr(rm);
                    return rMun.includes(cMun) || cMun.includes(rMun);
                });
                if (!ok) continue;
            }
            // Escolaridad Check
            const cEsc = normalizeStr(candidateData.escolaridad);
            if (rule.escolaridades && rule.escolaridades.length > 0) {
                const ok = rule.escolaridades.some(re => {
                    const rEsc = normalizeStr(re);
                    return rEsc.includes(cEsc) || cEsc.includes(rEsc);
                });
                if (!ok) continue;
            }
            // MATCH: collect ALL vacancyIds from matching project
            const matchedProject = projects.find(p => p.id === rule.projectId);
            if (matchedProject) {
                const vIds = Array.isArray(matchedProject.vacancyIds) ? matchedProject.vacancyIds : (matchedProject.vacancyId ? [matchedProject.vacancyId] : []);
                vIds.forEach(id => qualifyingVacancyIds.add(id));
            }
        }

        // Resolve vacancy details
        const resolved = await Promise.all(
            [...qualifyingVacancyIds].map(id => getVacancyById(id).catch(() => null))
        );
        return resolved.filter(Boolean);
    } catch (e) {
        console.error('[REENGAGE] getReengageVacancies error:', e);
        return [];
    }
};



export const processMessage = async (candidateId, incomingMessage, msgId = null) => {
    const startTime = Date.now();
    let candidateData = null;
    try {
        const redis = getRedisClient();

        // 0. Fetch candidate first to get instance context
        candidateData = await getCandidateById(candidateId);
        if (!candidateData) return 'ERROR: No se encontró al candidato';

        // 🔄 REAL-TIME INSTANCE RESOLUTION: Use the Redis key set by the webhook
        // (always points to the number the candidate JUST wrote to), with fallback
        // to candidate object's instanceId for backward compatibility.
        const phone = candidateData.whatsapp?.replace(/\D/g, '');
        // incomingPhoneNumberId (set per-message in webhook) always wins — it's the number
        // the candidate JUST wrote to. Only fall back to candidate_instance if it's a valid
        // numeric Meta phone ID (not a legacy UltraMSG alphanumeric instanceId).
        const isValidMetaPhoneId = (id) => id && /^\d{10,}$/.test(String(id));
        let resolvedInstanceId = candidateData.incomingPhoneNumberId || candidateData.instanceId;
        try {
            const freshInstanceId = await redis?.get(`candidate_instance:${phone}`);
            if (freshInstanceId && isValidMetaPhoneId(freshInstanceId)) resolvedInstanceId = freshInstanceId;
        } catch (e) { /* fallback to incomingPhoneNumberId */ }

        // 1. High-Speed Parallel Acquisition (Memory Boost: 40 messages)
        const configKeys = [
            'custom_fields',
            'bot_ia_prompt',
            'assistant_ia_prompt',
            'ai_config',
            'candidatic_categories',
            'bot_extraction_rules',
            'bot_cerebro1_rules',
            'bypass_enabled',
            'bot_ia_model',
            'bot_ia_prompt_avanzado',
            'bot_ia_model_avanzado'
        ];

        const [config, allMessages, batchConfig] = await Promise.all([
            getUltraMsgConfig(resolvedInstanceId),
            getMessages(candidateId, 40),
            FEATURES.USE_BACKEND_CACHE
                ? getCachedConfigBatch(redis, configKeys)
                : (async () => {
                    const values = await redis?.mget(configKeys);
                    const obj = {};
                    configKeys.forEach((key, i) => obj[key] = values ? values[i] : null);
                    return obj;
                })()
        ]);

        // 0. Initialize Candidate Updates accumulator
        const candidateUpdates = {
            lastBotMessageAt: new Date().toISOString(),
            ultimoMensaje: new Date().toISOString(),
            // ⚠️ Do NOT reset unreadMsgCount here — only recruiter actions clear the badge
            esNuevo: candidateData.esNuevo === 'SI' ? 'NO' : candidateData.esNuevo
        };

        let intent = 'UNKNOWN';
        let isNowComplete = false;

        // 🛡️ [BLOCK SHIELD]: Force silence if candidate is blocked
        if (candidateData.blocked === true) {
            // 👂 NODO "ESPERANDO RESPUESTA": si este candidato tiene un flujo pausado esperando
            // una frase (siempre precedido por un nodo "Desactivar Bot", por eso está blocked),
            // aquí atrapamos su mensaje y reanudamos el flujo si coincide. Brenda sigue muda —
            // por eso NO hay doble respuesta. Si no espera nada o no coincide, return null igual
            // que siempre. Se hace await (necesitamos que responda antes de cerrar la función),
            // pero está blindado para nunca lanzar ni bloquear el silencio.
            await resumeWaitingFlowIfMatch(candidateId, candidateData, incomingMessage).catch(() => {});
            return null;
        }

        // 🔄 [RE-ENGAGEMENT FLOW]: Intercept candidates who said NO INTERESA and message again
        {
            const reengageKey = `reengagement:${candidateId}`;
            const reengageState = await redis?.get(reengageKey);
            // [NO-INTERESA RETIRADO] Se eliminó la detección del estatus/marcador "no interesa"
            // (era del cerebro de reclutador retirado, que ya no existe). El re-engagement ahora
            // solo lo dispara el cron (que fija reengageState). La rama "Phase 1" que dependía de
            // isNoInteresa queda inalcanzable (isNoInteresa siempre false) — sin efecto.
            const isNoInteresa = false;

            const msgText = (typeof incomingMessage === 'string' ? incomingMessage : '').toLowerCase().trim();
            const saidYes = /\b(si|sí|yes|claro|dale|quiero|me interesa|por favor|ándale|andale|sip|órale|orale)\b/.test(msgText);
            const saidNo = /\b(no|nel|nope|paso|no gracias|no quiero|ahorita no|todavía no)\b/.test(msgText) && !saidYes;

            if (isNoInteresa || reengageState) {
                const firstName = getFirstName(candidateData.nombreReal) || 'candidato';

                if (reengageState === 'ASKED') {
                    if (saidYes) {
                        // ── Phase 2: Candidate said YES ──────────────────────────────────────
                        const vacancies = await getReengageVacancies(candidateData);
                        const config = await getUltraMsgConfig(resolvedInstanceId);
                        const phone = candidateData.whatsapp;

                        if (vacancies.length === 0) {
                            // No qualifying vacancies → show profile summary and ask to confirm
                            const profileLines = [
                                candidateData.nombreReal ? `📛 Nombre: ${candidateData.nombreReal}` : null,
                                candidateData.municipio   ? `📍 Municipio: ${candidateData.municipio}` : null,
                                candidateData.escolaridad ? `🎓 Escolaridad: ${candidateData.escolaridad}` : null,
                                candidateData.categoria   ? `💼 Categoría: ${candidateData.categoria}` : null,
                                candidateData.edad        ? `🎂 Edad: ${candidateData.edad} años` : null,
                                candidateData.genero      ? `🧑 Género: ${candidateData.genero}` : null,
                            ].filter(Boolean).join('\n');

                            const noVacMsg = `¡${firstName}, quiero ayudarte! Pero revisé nuestras opciones y no encontré una vacante que encaje con tu perfil actual. 🤔`;
                            const profileMsg = `Déjame confirmar que tenemos tus datos bien guardados:\n\n${profileLines}\n\n¿Todo está correcto? ✅`;

                            await sendUltraMsgMessage(config.instanceId, config.token, phone, noVacMsg, 'chat', { priority: 0 });
                            await saveMessage(candidateId, { from: 'bot', content: noVacMsg, timestamp: new Date().toISOString() });
                            await sendUltraMsgMessage(config.instanceId, config.token, phone, profileMsg, 'chat', { priority: 1 });
                            await saveMessage(candidateId, { from: 'bot', content: profileMsg, timestamp: new Date().toISOString() });

                            await redis?.set(reengageKey, 'CONFIRMING_PROFILE', 'EX', 604800);
                            return noVacMsg;
                        }

                        // Build list bubble
                        const _NUM_EMOJIS_RE = _NUM_EMOJIS;
                        const listLines = vacancies.map((v, i) => {
                            const num = _NUM_EMOJIS_RE[i] || `${i+1}.`;
                            const company = v.company ? ` – ${v.company}` : '';
                            return `${num} ${v.name}${company}`;
                        }).join('\n');
                        const listMsg = `¡Claro que sí! Actualmente tenemos estas opciones disponibles:\n\n${listLines}`;
                        const ctaMsg = `¿Cuál te interesa ${firstName}?`;

                        await sendUltraMsgMessage(config.instanceId, config.token, phone, listMsg, 'chat', { priority: 0 });
                        await saveMessage(candidateId, { from: 'bot', content: listMsg, timestamp: new Date().toISOString() });
                        await sendUltraMsgMessage(config.instanceId, config.token, phone, ctaMsg, 'chat', { priority: 1 });
                        await saveMessage(candidateId, { from: 'bot', content: ctaMsg, timestamp: new Date().toISOString() });

                        await redis?.set(reengageKey, 'SHOWING', 'EX', 604800);
                        return listMsg;

                    } else if (saidNo) {
                        // ── Phase 2b: Candidate said NO ─────────────────────────────────────
                        const config = await getUltraMsgConfig(resolvedInstanceId);
                        const closeMsg = `¡Perfecto! No hay problema, ${firstName}. 😊 Aquí estaré cuando necesites algo. ¡Mucho éxito! 🍀`;
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, closeMsg, 'chat');
                        await saveMessage(candidateId, { from: 'bot', content: closeMsg, timestamp: new Date().toISOString() });
                        await redis?.del(reengageKey);
                        return closeMsg;
                    }
                    // If not clearly yes/no, fall through to normal GPT response (ambiguous)

                } else if (reengageState === 'CONFIRMING_PROFILE') {
                    // ── Phase 3a: Profile confirmation response ──────────────────────────
                    if (saidYes) {
                        // Candidate confirmed profile is correct → friendly close
                        const config = await getUltraMsgConfig(resolvedInstanceId);
                        const closeMsg = `¡Perfecto ${firstName}! En cuanto llegue algo que se ajuste a tu perfil, ¡serás el primero en saberlo! 🌟 ¡Mucho éxito! 🍀`;
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, closeMsg, 'chat');
                        await saveMessage(candidateId, { from: 'bot', content: closeMsg, timestamp: new Date().toISOString() });
                        await redis?.del(reengageKey);
                        return closeMsg;
                    } else {
                        // Candidate wants to correct something → ask them explicitly to avoid GPT fallback to farewell
                        await redis?.set(reengageKey, 'RECHECK_VACANCIES', 'EX', 604800);
                        const correctionMsg = `¡Claro ${firstName}! ¿Qué dato necesitas que corrijamos? 📝 Dime cuál es el correcto y lo actualizo al momento.`;
                        const config = await getUltraMsgConfig(resolvedInstanceId);
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, correctionMsg, 'chat');
                        await saveMessage(candidateId, { from: 'bot', content: correctionMsg, timestamp: new Date().toISOString() });
                        return correctionMsg;
                    }

                } else if (reengageState === 'RECHECK_VACANCIES') {
                    // ── Phase 3b: After data was corrected, re-evaluate vacancies ────────
                    // candidateData is fresh (already updated by GPT in previous turn)
                    const vacancies = await getReengageVacancies(candidateData);
                    const config = await getUltraMsgConfig(resolvedInstanceId);
                    const phone = candidateData.whatsapp;

                    if (vacancies.length > 0) {
                        const _NUM_EMOJIS_R2 = _NUM_EMOJIS;
                        const listLines2 = vacancies.map((v, i) => {
                            const num = _NUM_EMOJIS_R2[i] || `${i+1}.`;
                            const company = v.company ? ` – ${v.company}` : '';
                            return `${num} ${v.name}${company}`;
                        }).join('\n');
                        const goodNewsMsg = `¡Tengo buenas noticias ${firstName}! Con tus datos actualizados encontré estas opciones para ti:\n\n${listLines2}`;
                        const ctaMsg2 = `¿Cuál te interesa ${firstName}?`;

                        await sendUltraMsgMessage(config.instanceId, config.token, phone, goodNewsMsg, 'chat', { priority: 0 });
                        await saveMessage(candidateId, { from: 'bot', content: goodNewsMsg, timestamp: new Date().toISOString() });
                        await sendUltraMsgMessage(config.instanceId, config.token, phone, ctaMsg2, 'chat', { priority: 1 });
                        await saveMessage(candidateId, { from: 'bot', content: ctaMsg2, timestamp: new Date().toISOString() });

                        await redis?.set(reengageKey, 'SHOWING', 'EX', 604800);
                        return goodNewsMsg;
                    } else {
                        // Still no match after correction
                        const stillNoMsg = `Gracias por actualizarlo, ${firstName}. Por ahora no tenemos vacantes para ese perfil en tu zona, pero en cuanto llegue algo ¡serás el primero en saberlo! 🍀`;
                        await sendUltraMsgMessage(config.instanceId, config.token, phone, stillNoMsg, 'chat');
                        await saveMessage(candidateId, { from: 'bot', content: stillNoMsg, timestamp: new Date().toISOString() });
                        await redis?.del(reengageKey);
                        return stillNoMsg;
                    }

                } else if (!reengageState && isNoInteresa) {
                    // ── Phase 1: First message after NO INTERESA ─────────────────────────
                    // Let GPT handle the greeting naturally, then send deterministic CTA bubble
                    const greetInstruction = `
Eres Lic. Brenda Rodríguez, reclutadora. El candidato ${firstName} estuvo interesado antes pero dijo que no le interesaba una vacante.
Ahora te acaba de escribir. RESPONDE brevemente y con calidez a lo que te dice (saludo, pregunta, lo que sea).
SOLO responde al mensaje actual, de forma corta (máximo 2 oraciones). NO menciones vacantes, NO pidas datos. Solo sé amable y humana.
    `.trim();

                    const greetMessages = [
                        { role: 'user', content: typeof incomingMessage === 'string' ? incomingMessage : 'Hola' }
                    ];

                    let greetText = `¡Hola ${firstName}! ✨ ¡Qué gusto saber de ti! 😊`;
                    try {
                        // signature: getOpenAIResponse(messages, systemPrompt, model, apiKey, responseFormat, multimodal, maxTokens)
                        const greetResponse = await getOpenAIResponse(
                            greetMessages,      // messages array
                            greetInstruction,   // system prompt
                            'gpt-4o-mini',      // fast model
                            null, null, null,
                            120                 // maxTokens
                        );
                        if (greetResponse?.content) greetText = greetResponse.content.trim();
                    } catch (e) {
                        console.error('[RE-ENGAGE] Greeting GPT error, using fallback:', e.message);
                    }

                    const config = await getUltraMsgConfig(resolvedInstanceId);
                    const phone = candidateData.whatsapp;
                    const ctaBubble = `¿Te gustaría conocer las vacantes que tenemos disponibles para ti?`;

                    await sendUltraMsgMessage(config.instanceId, config.token, phone, greetText, 'chat', { priority: 0 });
                    await saveMessage(candidateId, { from: 'bot', content: greetText, timestamp: new Date().toISOString() });
                    await sendUltraMsgMessage(config.instanceId, config.token, phone, ctaBubble, 'chat', { priority: 1 });
                    await saveMessage(candidateId, { from: 'bot', content: ctaBubble, timestamp: new Date().toISOString() });

                    await redis?.set(reengageKey, 'ASKED', 'EX', 604800);
                    await updateCandidate(candidateId, { ultimoMensaje: new Date().toISOString() });
                    return greetText;
                }
                // 🎯 SHOWING STATE: Candidate picks a vacancy by number or name from the re-engagement list
                // Parse the selection, inject vacancy context into candidateData, clear key, then fall through.
                } else if (reengageState === 'SHOWING') {
                    const vacancies = await getReengageVacancies(candidateData);
                    if (vacancies.length > 0) {
                        // Try to parse which vacancy they picked: "la 1", "1", "primera", name, etc.
                        const txt = msgText;
                        let pickedIdx = -1;
                        const numMatch = txt.match(/\b([1-9])\b/);
                        if (/\bprimera?\b/i.test(txt) || /\b1\b/.test(txt))  pickedIdx = 0;
                        else if (/\bsegunda?\b/i.test(txt) || /\b2\b/.test(txt)) pickedIdx = 1;
                        else if (/\btercera?\b/i.test(txt) || /\b3\b/.test(txt)) pickedIdx = 2;
                        else if (numMatch) pickedIdx = parseInt(numMatch[1]) - 1;
                        else {
                            // Try name match
                            pickedIdx = vacancies.findIndex(v =>
                                txt.includes((v.name || '').toLowerCase().substring(0, 5))
                            );
                        }

                        if (pickedIdx >= 0 && pickedIdx < vacancies.length) {
                            const pickedVacancy = vacancies[pickedIdx];
                            // Inject into candidateData so recruiter sees it
                            candidateData.currentVacancyIndex = pickedIdx;
                            candidateData.currentVacancyName = pickedVacancy.name;
                            if (candidateData.projectMetadata) {
                                candidateData.projectMetadata.currentVacancyIndex = pickedIdx;
                                candidateData.projectMetadata.currentVacancyName = pickedVacancy.name;
                            }
                            // Persist to Redis so recruiter can read it
                            await updateCandidate(candidateId, {
                                currentVacancyIndex: pickedIdx,
                                currentVacancyName: pickedVacancy.name,
                            });
                            // Clear SHOWING → recruiter flow takes over with correct vacancy context
                            await redis?.del(reengageKey);
                            console.log(`[REENGAGE SHOWING] Candidate picked vacancy ${pickedIdx}: ${pickedVacancy.name}`);
                        }
                    }
                    // Fall through to normal recruiter flow regardless (recruiter may handle name clarification)
                // If RECHECK_VACANCIES → fall through to normal flow
            }
        }

        const validMessages = allMessages.filter(m => m.content && (m.from === 'user' || m.from === 'bot' || m.from === 'me'));

        // 2. Text Extraction (Unified Loop)
        let userParts = [];
        let aggregatedText = "";

        // 🧪 TELEMETRY & AGGREGATION
        const messagesToProcess = (typeof incomingMessage === 'string' && (incomingMessage.includes(' | ') || incomingMessage.includes('\n')))
            ? incomingMessage.split(/ \| |\n/)
            : [incomingMessage];



        for (const msg of messagesToProcess) {
            let parsed = msg;
            let isJson = false;
            try {
                if (typeof msg === 'string' && (msg.trim().startsWith('{') || msg.trim().startsWith('['))) {
                    parsed = JSON.parse(msg);
                    isJson = true;
                }
            } catch (e) { }

            // 🛡️ [FEEDBACK LOOP SHIELD v2]: Skip any text that looks like a transcription or internal tag
            const textVal = (isJson || typeof parsed === 'object') ? (parsed.body || parsed.content || JSON.stringify(parsed)) : String(parsed || '').trim();

            const isInternalJson = isJson && (parsed.extracted_data || parsed.thought_process);

            // 🔥 AUDIO FIX: We MUST ALLOW transcriptions through! Previously `!isTranscriptionPrefix` was destroying audio inputs.
            if (textVal && textVal !== '{}' && !isInternalJson) {
                userParts.push({ text: textVal });
                aggregatedText += (aggregatedText ? " | " : "") + textVal;
            }
        }

        // 📚 ESCOLARIDAD ABBREVIATION NORMALIZER
        // Expands common Mexican Spanish shorthand BEFORE GPT sees it.
        // Fixes: GPT correctly extracts the canonical value into extracted_data,
        // but generates a "please clarify" response because the raw abbreviation
        // is ambiguous. By expanding upfront, both extraction AND response are correct.
        const _ESC_ABBREV_MAP = [
            { pattern: /^sec(?:u(?:nda(?:ria)?)?)?$/i,           canonical: 'Secundaria' },
            { pattern: /^prepa(?:ratoria)?$/i,                    canonical: 'Preparatoria' },
            { pattern: /^prim(?:aria)?$/i,                        canonical: 'Primaria' },
            { pattern: /^lic(?:enciatura)?$/i,                    canonical: 'Licenciatura' },
            { pattern: /^t[eé]c(?:nica)?$/i,                      canonical: 'Técnica' },
            { pattern: /^posg(?:rado)?$|^maestr[ií]a$|^doctorado$/i, canonical: 'Posgrado' },
            { pattern: /^uni(?:versidad)?$/i,                     canonical: 'Licenciatura' },
            { pattern: /^bachi(?:llerato)?$/i,                    canonical: 'Preparatoria' },
        ];
        const _trimmedAgg = aggregatedText.trim();
        for (const { pattern, canonical } of _ESC_ABBREV_MAP) {
            if (pattern.test(_trimmedAgg)) {
                console.log(`[ESC NORMALIZER] "${_trimmedAgg}" → "${canonical}"`);
                aggregatedText = canonical;
                // Also patch userParts so GPT history is clean
                if (userParts.length > 0) userParts[userParts.length - 1] = { text: canonical };
                break;
            }
        }

        if (userParts.length === 0) userParts.push({ text: 'Hola' });

        let recentHistory = validMessages
            .slice(-6) // Token Saver 🚀: 6 messages of history (Optimized for Extraction)
            .filter(m => {
                const ghostKeywords = ['focusada', 'procesa su perfil'];
                if ((m.from === 'bot' || m.from === 'me') && ghostKeywords.some(kw => m.content.toLowerCase().includes(kw))) {
                    return false;
                }
                return true;
            })
            .map(m => {
                let role = (m.from === 'user') ? 'user' : 'model';
                let content = m.content;

                // Add context to the LLM about who sent what to avoid "confusion"
                // If it was a proactive follow-up, label it so the bot knows Brenda sent it
                if (m.meta?.proactiveLevel) {
                    content = `[Mensaje de Lic.Brenda - Seguimiento Automático]: ${content} `;
                }

                return {
                    role: role === 'model' ? 'assistant' : 'user',
                    content: content
                };
            });

        // 📋 [MISSION: Profile Complete?]
        // If history starts with 'model', remove leading model messages
        while (recentHistory.length > 0 && (recentHistory[0].role === 'model' || recentHistory[0].role === 'assistant')) {
            recentHistory.shift();
        }

        const lastUserMessages = validMessages.filter(m => m.from === 'user').slice(-5).map(m => m.content);
        const themes = lastUserMessages.length > 0 ? lastUserMessages.join(' | ') : 'Nuevo contacto';

        // Continuity & Session Logic
        const lastBotMsgAt = candidateData.lastBotMessageAt ? new Date(candidateData.lastBotMessageAt) : new Date(0);
        const minSinceLastBot = Math.floor((new Date() - lastBotMsgAt) / 60000);
        const _secSinceLastBot = Math.floor((new Date() - lastBotMsgAt) / 1000);

        // 4. Layered System Instruction Build
        // Simplest check: Does Redis list have any bot/me message?
        const botHasSpoken = validMessages.some(m => m.from === 'bot' || m.from === 'me');
        const isNewFlag = candidateData.esNuevo !== 'NO' && !botHasSpoken;

        // Identity Protection (Titan Shield Pass) - System context for safety
        const realName = candidateData.nombreReal;
        let displayName = getFirstName(realName);

        if (!displayName || displayName === 'Desconocido' || /^\+?\d+$/.test(displayName)) {
            displayName = null;
        }
        const isNameBoilerplate = !displayName || /proporcionado|desconocido|luego|después|privado|hola|buenos|\+/i.test(String(displayName));


        const customFields = batchConfig.custom_fields ? JSON.parse(batchConfig.custom_fields) : [];

        // 🧬 [AUTO-GENDER PRE-PASS]: Infer gender from name before audit
        if (candidateData.nombreReal && !candidateData.genero) {
            const inferred = inferGender(candidateData.nombreReal);
            if (inferred) {
                candidateData.genero = inferred;
                candidateUpdates.genero = inferred;
            }
        }

        // Single audit pass after gender inference
        const finalAudit = auditProfile(candidateData, customFields);
        // 🛡️ [GENDER SUPPRESSION]: Filter Gender from missing fields list
        let audit = {
            ...finalAudit,
            missingLabels: finalAudit.missingLabels.filter(l => l !== 'Género' && l !== 'genero'),
            missingValues: finalAudit.missingValues.filter(v => v !== 'genero')
        };
        audit.paso1Status = audit.missingLabels.length === 0 ? 'COMPLETO' : 'INCOMPLETO';
        const auditForMode = audit;

        const customPrompt = batchConfig.bot_ia_prompt || '';
        let systemInstruction = getIdentityLayer(customPrompt);

        // --- GRACE & SILENCE ARCHITECTURE ---
        const isProfileComplete = audit.paso1Status === 'COMPLETO';
        const hasGratitude = candidateData.gratitudAlcanzada === true || candidateData.gratitudAlcanzada === 'true';
        const _isLongSilence = minSinceLastBot >= 5;
        const currentIsSilenced = candidateData.silencioActivo === true || candidateData.silencioActivo === 'true';
        const isSimulatorPhone = candidateData.whatsapp.startsWith('sim_') || ['1234567890', '5211234567890'].includes(candidateData.whatsapp);

        systemInstruction += `\n[ESTADO DE MISIÓN]:
- PERFIL COMPLETADO: ${isProfileComplete ? 'SÍ (SKIP EXTRACTION)' : 'NO (DATA REQUIRED)'}
- ¿Es Primer Contacto?: ${isNewFlag && !botHasSpoken ? 'SÍ (Presentarse)' : 'NO (Ya saludaste)'}
- [CHARLA_ACTIVA]: ${botHasSpoken ? 'TRUE (Omitir presentaciones formales)' : 'FALSE'}
- Gratitud Alcanzada: ${hasGratitude ? 'SÍ (Ya te dio las gracias)' : 'NO (Aún no te agradece)'}
- Silencio Operativo: ${currentIsSilenced ? 'SÍ (La charla estaba cerrada)' : 'NO (Charla activa)'}
\n[REGLA CRÍTICA]: SI [PERFIL COMPLETADO] ES SÍ, NO pidas datos proactivamente. Sin embargo, SI el usuario provee información nueva o corrige un dato (ej. "quiero cambiar mi nombre"), PROCÉSALO en extracted_data y confirma el cambio amablemente.`;

        // 🛡️ [PROMPT PRIORITY]: Only append hardcoded courtesy/logic rules if NO custom prompt is present
        // This avoids instructions redundancy (e.g. user prompt already handles greetings)
        if (!customPrompt) {
            systemInstruction += `\n[REGLA DE CORTESÍA]: Si el usuario te saluda ("Hola", "Buen día", etc.), DEBES devolver el saludo brevemente antes de pedir el dato faltante.
[SUFICIENCIA DE DATOS]: Si en [ESTADO DEL CANDIDATO] ya aparece su Nombre Real, ESTRICTAMENTE PROHIBIDO volver a pedir su nombre. Si pide más información, explícale que para darle opciones necesitas completar su registro y ve al grano pidiendo el siguiente dato faltante.`;
        }

        const identityContext = !isNameBoilerplate ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún. Pídelo amablemente.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos.SI NO SABES EL NOMBRE REAL(Persona), NO LO INVENTES Y PREGÚNTALO.\n`;
        const currentMessageForGpt = {
            role: 'user',
            content: aggregatedText
        };

        // 🐛 DEBUG LOG: Write aggregatedText to Redis (only in debug mode)
        if (process.env.DEBUG_MODE === 'true') {
            try {
                const redisDbg = getRedisClient();
                if (redisDbg) await redisDbg.set(`DEBUG_AI_AGGREGATED:${candidateId}`, aggregatedText, 'EX', 3600);
            } catch(e) {}
        }

        const lastBotMessages = validMessages
            .filter(m => (m.from === 'bot' || m.from === 'me') && !m.meta?.proactiveLevel)
            .slice(-20) // Extended unique history
            .map(m => m.content.trim());

        let categoriesList = "";
        const categoriesData = batchConfig.candidatic_categories || batchConfig.bot_categories || "General";
        try {
            const rawCats = typeof categoriesData === 'string' ? (categoriesData.includes('[') ? JSON.parse(categoriesData) : categoriesData.split(',').map(c => c.trim())) : categoriesData;
            const cats = Array.isArray(rawCats) ? rawCats : [rawCats];
            categoriesList = cats.map(c => `✅ ${typeof c === 'string' ? c : (c.name || c.value || JSON.stringify(c))}`).join('\n\n');
        } catch (e) {
            categoriesList = String(categoriesData).split(',').map(c => `✅ ${c.trim()}`).join('\n\n');
        }

        const customExtractionRules = batchConfig.bot_extraction_rules;
        const extractionRules = (customExtractionRules || DEFAULT_EXTRACTION_RULES)
            .replace('{{categorias}}', categoriesList)
            .replace('CATEGORÍAS VÁLIDAS: ', `CATEGORÍAS VÁLIDAS: ${categoriesList} `);

        const safeDnaLines = audit.dnaLines.split('\n').filter(l => !l.toLowerCase().includes('género') && !l.toLowerCase().includes('genero')).join('\n');

        systemInstruction += `\n[ESTADO DEL CANDIDATO]:
- Perfil Completo: ${audit.paso1Status === 'COMPLETO' ? 'SÍ' : 'NO'}
- Nombre Real: ${candidateData.nombreReal || 'No proporcionado'}
- WhatsApp: ${candidateData.whatsapp}
- Municipio: ${candidateData.municipio || 'No proporcionado'}
- Categoría: ${candidateData.categoria || 'No proporcionado'}
${safeDnaLines}
- Temas recientes: ${themes || 'Nuevo contacto'}
\n[CATEGORÍAS VÁLIDAS EN EL SISTEMA]: ${categoriesList} \n
\n${extractionRules} `;

        let activeProjectId = candidateData.projectId || candidateData.projectMetadata?.projectId;
        let activeStepId = candidateData.stepId || candidateData.projectMetadata?.stepId || 'step_new';

        if (!activeProjectId) {
            const client = getRedisClient();
            activeProjectId = await client.hget('index:cand_project', candidateId);
            if (activeProjectId) {
                const rawMeta = await client.hget(`project: cand_meta:${activeProjectId} `, candidateId);
                const meta = rawMeta ? JSON.parse(rawMeta) : {};
                activeStepId = meta.stepId || 'step_new';
            }
        }

        let aiResult = null;
        let isRecruiterMode = false;
        let responseTextVal = null;
        let _responseWithSplit = null; // preserva [MSG_SPLIT] para guardar en DB con burbujas
        let recruiterTriggeredMove = false; // hoisted — used in final delivery safeguard (lines ~2789)
        let isHandlingPivot = false; // hoisted — true when pivot guard did a direct vacancy send
        let historyForGpt = [...recentHistory, currentMessageForGpt];

        // [CEREBRO DE RECLUTADOR ELIMINADO] El modo "recruiter" (pasos CRM con aiConfig,
        // pivotes de vacantes, move/exit/no-interesa y despedidas) quedó retirado: ningún paso
        // tiene aiConfig.enabled, así que isRecruiterMode nunca se activaba. Se removió el bloque
        // completo (antes ~2450 líneas). La Sala de Espera y el Capturista siguen intactos.

        // --- BIFURCATION POINT: Recruiter / Sala de Espera / Capturista Brain ---
        let isBridgeActive = false;
        let isHostMode = false;

        const bridgeCounter = (typeof candidateData.bridge_counter === 'number') ? parseInt(candidateData.bridge_counter || 0) : 0;
        candidateUpdates.bridge_counter = bridgeCounter + 1; // Now correctly persisted in candidateUpdates

        // 2. SALA DE ESPERA — Always active when profile is complete
        // Brenda responds briefly, redirects to "estoy buscando tu vacante", never invents data
        const aiConfigJson = batchConfig.ai_config;
        const activeAiConfig = aiConfigJson ? (typeof aiConfigJson === 'string' ? JSON.parse(aiConfigJson) : aiConfigJson) : {};

        // 🧼 Token Saver: Clean ADN to prevent massive JSON stringification of telemetry logs
        const cleanAdnBase = {
            nombreReal: candidateData.nombreReal || null,
            fechaNacimiento: candidateData.fechaNacimiento || null,
            edad: candidateData.edad || null,
            municipio: candidateData.municipio || null,
            categoria: candidateData.categoria || null,
            escolaridad: candidateData.escolaridad || null,
            citaFecha: candidateData.citaFecha || null,
            citaHora: candidateData.citaHora || null
        };

        // ── PASO 2 AVANZADO ───────────────────────────────────────────────────────
        // Runs after paso 1 is complete but before sala de espera.
        // State machine: pendiente → esperando_colonia → esperando_experiencia → completo
        if (!isRecruiterMode && !isBridgeActive && isProfileComplete) {
            const p2Estado = candidateData.paso2Estado;
            const promptAvanzado = batchConfig.bot_ia_prompt_avanzado || '';
            const modelAvanzado = batchConfig.bot_ia_model_avanzado || 'gpt-4o-mini';
            const p2FirstName = (candidateUpdates.nombreReal || candidateData.nombreReal || '').split(' ')[0] || '';

            if (p2Estado === 'esperando_colonia') {
                isHostMode = true;
                // Extract colonia from candidate's message using GPT mini
                const coloniaExtractionPrompt = `Eres un extractor de colonias/barrios/fraccionamientos de México. El candidato acaba de responder a la pregunta "¿cómo se llama tu colonia?". Extrae el nombre de su colonia del mensaje.

REGLAS:
- Los candidatos frecuentemente responden SÓLO con el nombre sin decir la palabra "colonia" (ej: "Las Nubes", "Valle Verde", "Centro", "La Fe", "Mitras", "Cumbres").
- Si el mensaje contiene 1 a 4 palabras que suenan como nombre de lugar, barrio o fraccionamiento → extráelo aunque no diga "colonia".
- CRÍTICO: Muchas colonias en México llevan nombres de personas, santos o apellidos. Si el candidato responde con algo que parece nombre propio (ej: "Gloria Mendiola", "Francisco Villa", "Benito Juárez", "Linda Vista", "San Bernabé", "Valle de Lincoln") → trátalo como nombre de colonia y extráelo. En este contexto la respuesta SIEMPRE es una colonia, no el nombre de una persona.
- Devuelve ÚNICAMENTE el nombre en Title Case (primera letra de cada palabra en mayúscula).
- Solo devuelve null si el candidato claramente evade, cambia de tema, hace una pregunta, o manda algo que definitivamente no es un nombre de lugar (ej: "jaja", "no sé", "¿por qué?", "ok", stickers, audios sin texto).`;

                try {
                    const coloniaGpt = await getOpenAIResponse(
                        [{ from: 'user', content: aggregatedText }],
                        coloniaExtractionPrompt,
                        modelAvanzado,
                        activeAiConfig.openaiApiKey
                    );
                    const coloniaRaw = (coloniaGpt?.content || '').trim();
                    if (coloniaRaw && coloniaRaw.toLowerCase() !== 'null') {
                        // Colonia captured — save and ask experiencia
                        candidateUpdates.colonia = coloniaRaw;
                        candidateUpdates.paso2Estado = 'esperando_experiencia';
                        const _expName = p2FirstName ? `Oye ${p2FirstName}, ya` : 'Ya';
                        responseTextVal = `A sí 😊, colonia ${coloniaRaw} la conozco bien 😊[MSG_SPLIT]${_expName} solo me faltaría saber si tienes experiencia en fábrica 🏭 ¿sí o no?`;
                    } else {
                        // Evasion — persuade using promptAvanzado + ADN
                        const evasionSys = `${promptAvanzado ? promptAvanzado + '\n\n' : ''}Eres Brenda Rodríguez, reclutadora de Candidatic. El candidato no dio claramente el nombre de su colonia. Tu misión es pedirle amablemente que comparta su colonia. REGLA CRÍTICA: NUNCA digas que ya tienes la colonia ni confirmes haberla recibido — aún no la tienes. Genera 2 burbujas separadas con [MSG_SPLIT]: la primera reconoce su respuesta con calidez, la segunda pide la colonia con una razón concreta (validar transporte). Máximo 2 líneas cada una. Sin markdown.\n[ADN]: ${JSON.stringify(cleanAdnBase)}`;
                        const evasionGpt = await getOpenAIResponse(
                            allMessages.slice(-4),
                            evasionSys,
                            modelAvanzado,
                            activeAiConfig.openaiApiKey
                        );
                        if (evasionGpt?.content) {
                            responseTextVal = evasionGpt.content.replace(/\*/g, '');
                        } else {
                            responseTextVal = `Entiendo 😊[MSG_SPLIT]¿Me puedes decir en qué colonia vives? Es para validar que te llegue la ruta de transporte 🚌🏘️`;
                        }
                    }
                } catch (_e) {
                    responseTextVal = `¿Me puedes decir en qué colonia vives? 🏘️`;
                }

            } else if (p2Estado === 'esperando_meses_experiencia') {
                isHostMode = true;
                // Extraer duración y convertir a meses con GPT mini
                let mesesResult = null;
                try {
                    const mesesGpt = await getOpenAIResponse(
                        [{ from: 'user', content: aggregatedText }],
                        `El candidato respondió cuánto tiempo lleva trabajando en fábrica. Convierte su respuesta a número de meses enteros.
Ejemplos: "2 años" → 24, "6 meses" → 6, "año y medio" → 18, "3 semanas" → 1, "10 días" → 1, "un año" → 12, "poco más de un año" → 14, "5 años" → 60.
Responde ÚNICAMENTE con el número entero de meses. Si evade o no menciona ningún tiempo, responde null.`,
                        modelAvanzado,
                        activeAiConfig.openaiApiKey
                    );
                    const mesesRaw = (mesesGpt?.content || '').trim();
                    const parsed = parseInt(mesesRaw, 10);
                    if (!isNaN(parsed) && parsed > 0) mesesResult = parsed;
                } catch (_e) { /* fall through to evasion */ }

                if (mesesResult !== null) {
                    candidateUpdates.meses = mesesResult;
                    candidateUpdates.paso2Estado = 'completo';
                    await redis?.srem('paso2_waiting', candidateId);
                    const p2CloseName = p2FirstName ? `, ${p2FirstName}` : '';
                    responseTextVal = `¡Listo${p2CloseName}! 🌟 Ya tengo todo lo que necesitaba.[MSG_SPLIT]Deja termino de subir tu información al sistema y te contacto para darte más info de la vacante 🌸✨[MSG_SPLIT]🙏 porfi no desesperes si tardo un poquito en contactarte, ok cuídate y platicamos pronto 😊`;
                    await MediaEngine.sendCongratsPack(config, candidateData.whatsapp, 'bot_paso2_sticker', candidateId);
                } else {
                    // Evasión — GPT reconoce con gracia (sin seguir la corriente); la repregunta
                    // la agrega el código SIEMPRE para garantizar que se reconduce la plática.
                    const _mName = p2FirstName ? `${p2FirstName}, ` : '';
                    const fallbackEvasion = `${_mName}no te preocupes, solo dime un aproximado 😊[MSG_SPLIT]¿Cuántos meses o años llevas trabajando en fábrica? 🏭`;
                    const evasionSys = `${promptAvanzado ? promptAvanzado + '\n\n' : ''}Eres Brenda Rodríguez, reclutadora de Candidatic. Ya le preguntaste al candidato cuánto tiempo de experiencia tiene en fábrica y en vez de responder evadió (broma, coqueteo, pregunta, tema distinto). Genera UNA sola línea MUY corta (máximo 15 palabras) que reconozca con gracia y calidez lo que acaba de decir. REGLAS CRÍTICAS: NUNCA le sigas la corriente (no coquetees, no respondas su juego, no desarrolles su tema) — solo reconócelo con simpatía y deja claro que estás trabajando. PROHIBIDO hacer preguntas o mencionar la pregunta de experiencia — esa la agrega el sistema después de tu línea. NUNCA digas que ya tienes el dato ni inventes información. Sin markdown.\n[ADN]: ${JSON.stringify(cleanAdnBase)}`;
                    const EVASION_QUESTION_VARIANTS = [
                        '¿Cuántos meses o años llevas trabajando en fábrica? 🏭 Un aproximado basta 😊',
                        'Dime, ¿como cuánto tiempo llevas trabajando en fábrica? 🏭 No tiene que ser exacto 😊',
                        '¿Cuántos meses o años de experiencia tienes en fábrica? 🏭 Un aproximado me sirve 😊'
                    ];
                    try {
                        const evasionGpt = await getOpenAIResponse(
                            [{ from: 'user', content: aggregatedText }],
                            evasionSys,
                            modelAvanzado,
                            activeAiConfig.openaiApiKey
                        );
                        let ack = (evasionGpt?.content || '').replace(/\*/g, '').split(/\[MSG_SPLIT\]/)[0].trim();
                        // Guardas: el ack nunca trae preguntas (la repregunta la ponemos nosotros)
                        // ni se alarga de más.
                        if (ack.includes('¿')) ack = ack.split('¿')[0].trim();
                        if (ack.length > 150) ack = '';
                        const evasionQ = EVASION_QUESTION_VARIANTS[Math.floor(Math.random() * EVASION_QUESTION_VARIANTS.length)];
                        responseTextVal = ack ? `${ack}[MSG_SPLIT]${evasionQ}` : fallbackEvasion;
                    } catch (_e) {
                        responseTextVal = fallbackEvasion;
                    }
                }

            } else if (p2Estado === 'esperando_experiencia') {
                isHostMode = true;
                // Regex-first detection: No primero para evitar falsos positivos cuando dicen "no en maquiladora"
                const SI_RE = /\b(s[ií]|claro|sim[oó]n|simons|ya\b|yep|aj[aá]|as[ií]\s+es|por\s+supuesto|sale\b|orale\b|andale\b|va\b|pos\s+s[ií]|pues\s+s[ií]|de\s+una\b|sí\s+tuve|s[ií]\s+tengo|algo\b|un\s+poco|poca?\b|poquita?\b|algo\s+de|un\s+ratito?\b|trabaj[eé]\s+(en\s+)?(f[aá]brica|maquila|producci[oó]n|planta|manufactura)|tuve?\s+experiencia|con\s+experiencia|he\s+trabajado\s+en|en\s+(ensamble|maquiladora|maquila|manufactura|f[aá]brica|producci[oó]n|planta|armado)|ensamble|maquiladora|maquila|manufactura|f[aá]brica|producci[oó]n|planta|armado|operadora?)\b/i;
                const NO_RE = /\b(no\b|nop|nope|tampoco|nunca|jam[aá]s|sin\s+experiencia|no\s+tengo|no\s+tuve|no\s+he\s+trabajado)\b/i;

                // Pre-chequeo para acentuados que \b no detecta bien en JS
                const ACCENTED_SI = /(?:^|\s)(ajá|sí|así\s+es|ándale|órale)(?:\s|$)/i;
                let expResult = null;
                if (NO_RE.test(aggregatedText)) expResult = 'No';
                else if (ACCENTED_SI.test(aggregatedText) || SI_RE.test(aggregatedText)) expResult = 'Sí';

                if (!expResult) {
                    // Ambiguous — ask GPT mini to interpret
                    try {
                        const expGpt = await getOpenAIResponse(
                            [{ from: 'user', content: aggregatedText }],
                            `El candidato respondió a la pregunta "¿tienes experiencia en fábrica o maquiladora?". Responde ÚNICAMENTE con: Sí, No, o null (si evade completamente sin responder sobre experiencia laboral).`,
                            modelAvanzado,
                            activeAiConfig.openaiApiKey
                        );
                        const expRaw = (expGpt?.content || '').trim();
                        if (expRaw === 'Sí' || expRaw === 'Si') expResult = 'Sí';
                        else if (expRaw === 'No') expResult = 'No';
                    } catch (_e) { /* fall through to evasion */ }
                }

                if (expResult === 'No') {
                    // Sin experiencia — cerrar paso 2
                    candidateUpdates.experiencia = 'No';
                    candidateUpdates.meses = 0;
                    candidateUpdates.paso2Estado = 'completo';
                    await redis?.srem('paso2_waiting', candidateId);
                    const p2CloseName = p2FirstName ? `, ${p2FirstName}` : '';
                    responseTextVal = `¡Listo${p2CloseName}! 🌟 Ya tengo todo lo que necesitaba.[MSG_SPLIT]Deja termino de subir tu información al sistema y te contacto para darte más info de la vacante 🌸✨[MSG_SPLIT]🙏 porfi no desesperes si tardo un poquito en contactarte, ok cuídate y platicamos pronto 😊`;
                    await MediaEngine.sendCongratsPack(config, candidateData.whatsapp, 'bot_paso2_sticker', candidateId);
                } else if (expResult === 'Sí') {
                    candidateUpdates.experiencia = 'Sí';

                    // Intentar extraer duración del mismo mensaje antes de preguntar
                    const DURATION_INLINE_RE = /\b(\d+)\s*(a[ñn]os?|meses?|semanas?|d[ií]as?)\b|\b(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte)\s+(a[ñn]os?|meses?|semanas?)\b|a[ñn]o\s+y\s+medio/i;
                    let mesesInline = null;
                    if (DURATION_INLINE_RE.test(aggregatedText)) {
                        try {
                            const mesesGpt = await getOpenAIResponse(
                                [{ from: 'user', content: aggregatedText }],
                                `El candidato respondió cuánto tiempo lleva trabajando en fábrica. Convierte su respuesta a número de meses enteros.\nEjemplos: "2 años" → 24, "6 meses" → 6, "año y medio" → 18, "3 semanas" → 1, "10 días" → 1, "un año" → 12, "poco más de un año" → 14, "5 años" → 60.\nResponde ÚNICAMENTE con el número entero de meses. Si evade o no menciona ningún tiempo, responde null.`,
                                modelAvanzado,
                                activeAiConfig.openaiApiKey
                            );
                            const mesesRaw = (mesesGpt?.content || '').trim();
                            const parsed = parseInt(mesesRaw, 10);
                            if (!isNaN(parsed) && parsed > 0) mesesInline = parsed;
                        } catch (_e) { /* fall through to ask */ }
                    }

                    if (mesesInline !== null) {
                        // Duración capturada en el mismo mensaje — cerrar paso 2 sin preguntar
                        candidateUpdates.meses = mesesInline;
                        candidateUpdates.paso2Estado = 'completo';
                        await redis?.srem('paso2_waiting', candidateId);
                        const p2CloseName = p2FirstName ? `, ${p2FirstName}` : '';
                        responseTextVal = `¡Listo${p2CloseName}! 🌟 Ya tengo todo lo que necesitaba.[MSG_SPLIT]Deja termino de subir tu información al sistema y te contacto para darte más info de la vacante 🌸✨[MSG_SPLIT]🙏 porfi no desesperes si tardo un poquito en contactarte, ok cuídate y platicamos pronto 😊`;
                        await MediaEngine.sendCongratsPack(config, candidateData.whatsapp, 'bot_paso2_sticker', candidateId);
                    } else {
                        // Duración no detectada — preguntar
                        candidateUpdates.paso2Estado = 'esperando_meses_experiencia';
                        const _expQ = p2FirstName
                            ? `Perfecto ${p2FirstName} 🌟 ¿y cuánto tiempo más o menos tienes de experiencia en fábrica? 😮[MSG_SPLIT]Un aproximado ${p2FirstName} no tiene que ser tan exacto 😅`
                            : `Perfecto 🌟 ¿y cuánto tiempo más o menos tienes de experiencia en fábrica? 😮[MSG_SPLIT]Un aproximado, no tiene que ser tan exacto 😅`;
                        responseTextVal = _expQ;
                    }
                } else {
                    // Evasion — persuade
                    const evasionSys = `${promptAvanzado ? promptAvanzado + '\n\n' : ''}Eres Brenda Rodríguez, reclutadora de Candidatic. El candidato evadió la pregunta sobre experiencia en fábrica. Tu misión es reconocer lo que dijo con calidez y redirigirlo con mucha persuasión a responder si tiene o no experiencia en fábrica/maquiladora. Genera 2 burbujas con [MSG_SPLIT]. Sin markdown. Sin inventar datos.\n[ADN]: ${JSON.stringify(cleanAdnBase)}`;
                    try {
                        const evasionGpt = await getOpenAIResponse(
                            allMessages.slice(-4),
                            evasionSys,
                            modelAvanzado,
                            activeAiConfig.openaiApiKey
                        );
                        responseTextVal = evasionGpt?.content
                            ? evasionGpt.content.replace(/\*/g, '')
                            : `Entiendo 😊[MSG_SPLIT]¿Tienes o has tenido experiencia trabajando en fábrica o maquiladora? Solo dime sí o no 🏭`;
                    } catch (_e) {
                        responseTextVal = `¿Tienes experiencia en fábrica o maquiladora? 🏭 Solo dime sí o no 😊`;
                    }
                }
            }
        }

        const _paso2EnProceso = ['esperando_colonia', 'esperando_experiencia', 'esperando_meses_experiencia'].includes(candidateData.paso2Estado);
        const _paso2Listo = !_paso2EnProceso && (!candidateData.paso2Requerido || candidateData.paso2Estado === 'completo');

        // 🔁 CANDIDATO QUE REGRESA: si un COMPLETO vuelve (click de anuncio o frase) y hay un
        // flujo con Inicio "al regresar" que aplica, ese flujo le manda la info de su ÚLTIMA
        // vacante (el ruteo lo hace el nodo Etiqueta modo "actual" contra vacanteActual). Corre
        // ANTES de la Sala de Espera: si dispara, Brenda-extractora CALLA — que hable el flujo,
        // no el "estoy buscando algo para ti" que nunca entrega nada. El envío real corre en
        // segundo plano dentro del despachador; aquí solo sabemos si aplicó, para decidir el silencio.
        let _returnHandled = false;
        if (!isRecruiterMode && !isBridgeActive && isProfileComplete && _paso2Listo && !responseTextVal) {
            const _returnFired = await runReturningFlowsForCandidate(
                candidateId,
                { ...candidateData, ...candidateUpdates },
                { incomingText: aggregatedText }
            ).catch(() => 0);
            if (_returnFired > 0) {
                _returnHandled = true;
                isHostMode = true; // el flujo de regreso ya está enviando; el extractor guarda silencio
            }
        }

        if (!isRecruiterMode && !isBridgeActive && isProfileComplete && _paso2Listo && !_returnHandled && activeAiConfig.gptHostEnabled && !responseTextVal) {
            isHostMode = true;
            try {
                const candFirstName = (candidateData.nombreReal || '').split(' ')[0] || 'amig@';
                const customSalaPrompt = activeAiConfig.gptHostPrompt || '';

                const salaDeEsperaPrompt = `Eres Brenda Rodríguez, reclutadora profesional de Candidatic. El candidato se llama ${candFirstName} y ya completó su registro exitosamente. Tu misión de extracción de datos TERMINÓ.

${customSalaPrompt ? `[CONTEXTO ADICIONAL]: ${customSalaPrompt}\n` : ''}
REGLAS DE SALA DE ESPERA (OBLIGATORIAS - NO NEGOCIABLES):
1. VACANTES/ENTREVISTAS/EMPLEO: Si preguntan por vacantes, entrevistas, sueldos, horarios o cualquier tema laboral: Responde amable usando su nombre, reconoce su interés, y dile que estás trabajando en encontrarle la mejor vacante. Te agradecería tengas paciencia. ESTRICTAMENTE PROHIBIDO inventar datos de vacantes, sueldos, direcciones o ubicaciones.
2. PLÁTICA SOCIAL/PIROPOS/CUMPLIDOS: Puedes reírte, sonrojarte, agradecer con picardía y carisma — mantén tu personalidad encantadora. Pero SIEMPRE cierra diciendo que estás muy atareada/ocupada buscando la mejor vacante para ellos. NO te enganches en conversación extendida.
3. DESPEDIDA: Si se despiden, despídete amablemente deseándole éxito y que pronto le contactarás.
4. BREVEDAD: Máximo 2-3 líneas. Sé breve y encantadora.
5. SIEMPRE redirige mencionando que estás buscando/trabajando en encontrarle la mejor opción laboral.
6. PROHIBIDO pedir datos nuevos — ya los tienes todos.
7. Usa emojis con moderación (1-2 por mensaje), estilo Brenda: 😊 🌸 ✨ 🌟
8. Usa el nombre "${candFirstName}" naturalmente en tu respuesta.
9. NO uses asteriscos ni markdown. Texto plano solamente.
10. Responde SOLO en español.`;

                const salaHistory = allMessages.slice(-6); // Solo últimos mensajes para eficiencia
                const gptResponse = await getOpenAIResponse(
                    salaHistory,
                    salaDeEsperaPrompt,
                    activeAiConfig.openaiModel || 'gpt-4o-mini',
                    activeAiConfig.openaiApiKey
                );

                if (gptResponse?.content) {
                    const textContent = gptResponse.content.replace(/\*/g, '');
                    aiResult = {
                        response_text: textContent,
                        thought_process: "Sala de Espera Response",
                        reaction: (/\b(gracias|ti)\b/i.test(aggregatedText)) ? '👍' : null,
                        gratitude_reached: false,
                        close_conversation: false
                    };
                    responseTextVal = textContent;
                }
            } catch (e) {
                console.error('[Sala de Espera] error:', e);
                isHostMode = false; // Fallback to Capturista if OpenAI fails
            }
        }

        // 🔇 SILENCIO POST-EXTRACCIÓN: Si el perfil está completo pero Sala de Espera está OFF,
        // Brenda NO debe responder. Bloqueamos el Capturista Brain también.
        if (!isRecruiterMode && !isBridgeActive && isProfileComplete && _paso2Listo && !activeAiConfig.gptHostEnabled) {
            isHostMode = true; // Block Capturista Brain — total silence
            console.log('[Sala de Espera] Toggle OFF — silencio post-extracción');
        }
        let handoverTriggered = false;
        // 3. CAPTURISTA BRAIN (GPT-4o-mini consolidated)
        if (!isRecruiterMode && !isBridgeActive && !isHostMode) {
            try {
                const gptStartTime = Date.now();

                // 🏎️ [FORCE STATUS]: If speaking now, they are no longer NEW.
                if (isNewFlag) {
                    candidateUpdates.esNuevo = 'NO';
                    await updateCandidate(candidateId, { esNuevo: 'NO' });
                }
                // Build Instructions — extraction rules only injected when there is NO custom prompt
                // (custom prompt owns all behavioral rules; we only add the technical JSON schema + data)
                
                // 🧼 Token Saver: Only show categories to GPT if we are actively asking for them!
                const isAskingCategoria = auditForMode.missingLabels && auditForMode.missingLabels.length > 0 && auditForMode.missingLabels[0].toLowerCase().includes('categor');
                const maskedCategoriesList = isAskingCategoria ? categoriesList : "✅ [Ocultas por sistema hasta el paso de Categoría]";

                if (!customPrompt) {
                    const extractionRules = batchConfig.bot_extraction_rules || DEFAULT_EXTRACTION_RULES;
                    systemInstruction += `\n[REGLAS DE EXTRACCIÓN (VIPER-GPT)]: ${extractionRules.replace(/{{categorias}}/g, maskedCategoriesList)}`;
                }

                // JSON format schema — always required so the code can parse the response
                systemInstruction += `\n[FORMATO OBLIGATORIO]: Responde SIEMPRE en JSON puro con este esquema:
{
  "response_text": "Texto para el usuario",
  "extracted_data": { 
    "nombreReal": "Nombre en Title Case o null si no lo dio", 
    "genero": "Hombre | Mujer | Desconocido",
    "fechaNacimiento": "DD/MM/YYYY o null",
    "municipio": "Nombre oficial o null",
    "categoria": "Opción elegida o null",
    "escolaridad": "Primaria | Secundaria | Preparatoria | Licenciatura | Técnica | Posgrado o null",
    "citaFecha": "YYYY-MM-DD o null",
    "citaHora": "string (ej. 08:00 AM) o null"
  },
  "reaction": "Emoji o null",
  "thought_process": "Breve nota interna"
}
SEPARADOR DE BURBUJAS [MSG_SPLIT]: Cuando se te indique enviar DOS mensajes, escribe el texto literal [MSG_SPLIT] dentro de response_text como separador. Ej: "Primera burbuja.[MSG_SPLIT]Segunda burbuja." El sistema lo divide y envía por separado.`;

                // 🧬 CRITICAL EXTRACTION RULES — Always injected (even with custom prompts)
                // These are technical data-capture rules, NOT behavioral — they must always be present
                // so the JSON extraction works correctly regardless of the prompt personality.
                systemInstruction += `
[REGLAS DE EXTRACCIÓN TÉCNICA (SIEMPRE ACTIVAS)]:
- Si el usuario provee su nombre o apellidos, extráelo en "extracted_data.nombreReal" formateando a Title Case (Ej: "juan perez" -> "Juan Perez").
- ⚠️ REGLA DE COMBINACIÓN DE NOMBRES: Si el candidato YA tiene un nombre guardado en su [ADN] (ej: "Oscar") y ahora te da sus apellidos ("Rodriguez"), DEBES combinarlos y devolver el nombre COMPLETO (Ej: "Oscar Rodriguez"). NUNCA devuelvas solo el apellido si ya tenías el nombre, porque reemplazará sus datos y causará un error.
- REGLA ESTRICTA DE NOMBRES: NUNCA extraigas apodos, frases de cortesía o afirmaciones como "Si", "Claro", "sin problema", "buenas noches" como nombre. Si el texto no es un nombre real válido, NO LO EXTRAIGAS.
- Si el usuario sólo te da un nombre sin apellidos (ej: "Oscar"), extráelo y PREGUNTA POR SUS APELLIDOS.
- CRÍTICO: Tú eres la Licenciada Brenda Rodríguez. EL USUARIO ES OTRA PERSONA. NUNCA extraigas "Brenda" o "Brenda Rodríguez" como nombre del usuario.
- GÉNERO (OBLIGATORIO Y SILENCIOSO): Está estrictamente prohibido preguntarle al candidato por su género. Sin embargo, SIEMPRE debes deducirlo del nombre del candidato o contexto del chat.
- 🕒 REGLA DE RETENCIÓN DE AGENDA: Si el candidato YA tiene "citaFecha" o "citaHora" en su [ADN], OBLIGATORIAMENTE debes re-escribir ese mismo valor en tu "extracted_data" a menos que el candidato pida explícitamente cambiar la fecha/hora.
- FECHAS CRÍTICAS: "citaFecha" DEBE ser estrictamente formato "YYYY-MM-DD". Transforma menciones como "el lunes" a la fecha exacta correspondiente.
- 🛑 AÑO DE NACIMIENTO OBLIGATORIO: Si el candidato te da el día y mes pero NO incluye el AÑO (ej. "19 de junio"), TIENES ESTRICTAMENTE PROHIBIDO extraerlo. En su lugar, usa el \`response_text\` para preguntarle de forma amable: "¿En qué año naciste?".

[REGLA ANTI-REDUNDANCIA OBLIGATORIA]:
- NUNCA preguntes al candidato por un dato que acabas de extraer exitosamente en el campo "extracted_data" de este mismo JSON.\n`;

                if (!customPrompt) {
                    // Extended behavior/formatting rules — only for bots without a custom prompt
                    // (custom prompts define their own UX behavior, these rules would conflict)
                    systemInstruction += `
[REGLAS DE HOMOGENEIZACIÓN (ESTRICTAS)]:
- **Municipio**: Devuelve el nombre OFICIAL COMPLETO del municipio de Nuevo León (ej: "Cadereyta Jiménez" NO "Cadereyta"; "General Escobedo" NO "Escobedo"; "San Nicolás de los Garza" NO "San Nicolás"; "San Pedro Garza García" NO "San Pedro"; "Benito Juárez" NO "Juárez"; "General Zuazua" NO "Zuazua"; "Sabinas Hidalgo" NO "Sabinas"; "Salinas Victoria" NO "Salinas"; "El Carmen" NO "Carmen"; "Los Aldamas" NO "Aldama"; "Lampazos de Naranjo" NO "Lampazos"; "Ciénega de Flores" NO "Ciénega") sin direcciones ni calles.
- **Escolaridad**: Clasifica en una sola palabra: Primaria, Secundaria, Preparatoria, Licenciatura, Técnica, o Posgrado.
- ESCOLARIDAD (FORMATO OBLIGATORIO): Cuando preguntes por escolaridad, muestra opciones en lista VERTICAL con emojis.
- **Categoría**: Si el candidato escribe "Ayudante", extrae estrictamente "Ayudante General" u otra categoría que haga *match exacto* a la lista. Si opera maquinaria -> "Montacarguista".\n`;
                }
                // When customPrompt is active: behavioral rules stay in the prompt, but extraction rules above are always present.




                const isGenericStart = isNewFlag && /^(hola|buen[oa]s|info|vacantes?|empleos?|trabajos?|ola|q tal|que tal|\s*)$/i.test(aggregatedText.trim());
                let bypassGpt = false;

                if (isNewFlag) {
                    if (isGenericStart && auditForMode.missingLabels.length > 0) {
                        // Bypass works with or without customPrompt — faster (no GPT call) + 2 bubbles
                        bypassGpt = true;
                    } else {
                        const _welcomeName = 'Brenda Rodríguez';
                        // If it's a specific question (not just "hola"), inject full CEREBRO1 rules
                        // so the PERSUASIÓN rule applies and the question is answered before asking for name
                        const isSpecificQuestion = !isGenericStart && /\?|vacante|empleo|trabajo|sueldo|horario|turno|beneficio|pagan|salar/i.test(aggregatedText);
                        if (isSpecificQuestion && !customPrompt && auditForMode.missingLabels.length > 0) {
                            let baseRules = batchConfig.bot_cerebro1_rules || DEFAULT_CEREBRO1_RULES;
                            const cerebro1Rules = baseRules
                                .replace('{{faltantes}}', auditForMode.missingLabels.join(', '))
                                .replace(/{{categorias}}/g, maskedCategoriesList)
                                .replace(/\[LISTA DE CATEGORÍAS\]/g, maskedCategoriesList);
                            // [MSG_SPLIT] obligatorio: burbuja 1 = saludo + respuesta, burbuja 2 = pregunta del dato faltante
                            systemInstruction += `\n[MISION: BIENVENIDA CON PREGUNTA]: Es el primer mensaje. OBLIGATORIO usar [MSG_SPLIT] para dividir en DOS burbujas: Burbuja 1 = preséntate en UNA SOLA ORACIÓN como Brenda Rodríguez de Candidatic (NO termines en "Lic.") + responde brevemente la pregunta con info real. Burbuja 2 = pide ÚNICAMENTE el dato faltante: ${auditForMode.missingLabels[0]} — con emoji. Ejemplo de formato: "¡Hola! Soy Brenda Rodríguez... [respuesta breve].[MSG_SPLIT]¿Me compartes tu Nombre y Apellidos completos? 😊"\n${cerebro1Rules}\n`;
                        } else {
                            systemInstruction += `\n[MISION: BIENVENIDA]: Es el inicio. Preséntate en UNA SOLA ORACIÓN como Brenda Rodríguez de Candidatic (NO termines la frase en "Lic."). Luego en otra línea pide el Nombre Y Apellidos completos del candidato — siempre incluye al menos un emoji en esa segunda línea. ✨🌸\n`;
                        }
                    }
                } else if (auditForMode.paso1Status !== 'COMPLETO') {
                    candidateUpdates.esNuevo = 'NO';

                    if (customPrompt) {
                        // Custom prompt already has all behavior rules — only inject the dynamic context
                        const missingList = auditForMode.missingLabels.join(', ');
                        systemInstruction += `\n[CONTEXTO DE MISIÓN]: Datos aún faltantes del candidato: ${missingList}. Categorías disponibles:\n${maskedCategoriesList}\n`;
                    } else {
                        let baseRules = batchConfig.bot_cerebro1_rules || DEFAULT_CEREBRO1_RULES;
                        const cerebro1Rules = baseRules
                            .replace('{{faltantes}}', auditForMode.missingLabels.join(', '))
                            .replace(/{{categorias}}/g, maskedCategoriesList)
                            .replace(/\[LISTA DE CATEGORÍAS\]/g, maskedCategoriesList);
                        systemInstruction += `\n${cerebro1Rules}\n`;
                    }

                    if (auditForMode.missingLabels.length > 0) {
                        if (customPrompt) {
                            // 🛑 SOFT NOTE for custom prompt bots: Let the prompt handle how to address
                            // the topic (vacancies, interviews, etc.), just remind to end with the missing field.
                            const isVacancyQ = /vacante|empleo|trabajo|sueldo|salario|horario|entrevista/i.test(aggregatedText);
                            const isPersonalQ = /cu[aá]ntos a[nñ]os tienes?|qu[eé] edad tienes?|eres casada?|tienes novio?|d[oó]nde vives?|eres de aqu[íi]?|de d[oó]nde eres?|c[oó]mo te llamas?|cu[aá]l es tu nombre?|tienes hijos?|qu[eé] haces cuando|qu[eé] te gusta|cu[aá]nto ganas?|eres bonita?|eres guapa?/i.test(aggregatedText);
                            if (isVacancyQ) {
                                const _nextLabel = auditForMode.missingLabels[0];
                                const _fechaHint = /fecha|nacimiento/i.test(_nextLabel) ? ` (ejemplo 19 de mayo de 1988)` : '';
                                systemInstruction += `\n[NOTA DE CONTEXTO]: El candidato preguntó sobre vacantes/entrevistas. Responde en DOS burbujas con [MSG_SPLIT]: Burbuja 1 = MÁXIMO 2 líneas, cálida con emoji, dile que necesitas su información completa para que el sistema encuentre la mejor opción — ESTRICTAMENTE PROHIBIDO inventar sueldos, horarios o domicilios de la vacante. Burbuja 2 = Pregunta DIRECTA y ESPECÍFICA (NO genérica) por: "${_nextLabel}"${_fechaHint} — con emoji. PROHIBIDO usar frases vagas como "¿me ayudas con tus datos?".\n`;
                            } else if (isPersonalQ) {
                                systemInstruction += `\n[NOTA DE CONTEXTO - PREGUNTA PERSONAL/LIGUE]: El candidato hizo una pregunta personal o de ligue. Usa [MSG_SPLIT] para DOS burbujas: Burbuja 1 = respuesta BREVE y coqueta en personaje (con picardía/humor), PROHIBIDO usar halagos descontextualizados como "¡Vas excelente!", "¡Genial!", "¡Perfecto!" — solo evasión divertida. Burbuja 2 = pregunta DIRECTA por el dato faltante: ${auditForMode.missingLabels[0]} — con emoji. PROHIBIDO mezclar ambas en una sola burbuja.\n`;
                            } else {
                                const nextField = auditForMode.missingLabels[0];
                                const isEscolaridad = /escolaridad/i.test(nextField);
                                const splitHint = isEscolaridad
                                    ? ` Usa solo UN separador [MSG_SPLIT] exactamente ANTES de empezar la lista de escolaridad. La lista completa (con sus emojis, hasta Posgrado) y la pregunta final motivadora (ej: "¿Cuál es tu último nivel de estudios? 🌟") DEBEN IR TODAS JUNTAS en el bloque después del separador.`
                                    : '';
                                const isMunicipio = /municipio/i.test(nextField);
                                const municipioHint = isMunicipio
                                    ? ` Al preguntar el municipio usa SIEMPRE la frase "¿en qué municipio vives?" — NUNCA "¿dónde vives?" para evitar que el candidato dé su dirección completa.`
                                    : '';
                                const _allMissing = auditForMode.missingLabels;
                                const _remainingNote = _allMissing.length > 1
                                    ? ` Datos AÚN faltantes en total: ${_allMissing.join(', ')}. Si capturas "${nextField}" en este turno, debes pedir inmediatamente el siguiente: ${_allMissing[1]}. PROHIBIDO cerrar o despedirte.`
                                    : '';
                                systemInstruction += `\n[INSTRUCCIÓN CRÍTICA]: El perfil NO está completo. PROHIBIDO usar mensajes de cierre ("estoy procesando", "te aviso pronto", "perfil listo", "te contactaré", etc.). Dato a obtener ahora: ${nextField}. Tu mensaje DEBE terminar con la pregunta para obtenerlo.${_remainingNote}${splitHint}${municipioHint}\n`;
                            }
                        } else {
                            systemInstruction += `\n[INSTRUCCIÓN CRÍTICA FINAL]: El perfil está INCOMPLETO. Aún necesitas obtener: ${auditForMode.missingLabels.join(', ')}. TIENES PROHIBIDO despedirte o cerrar la conversación. OBLIGATORIAMENTE tu mensaje debe terminar con una pregunta para obtener el dato principal: ${auditForMode.missingLabels[0]}.\n`;
                        }
                    }
                }

                // Call Magic GPT (Force 4o-mini for max speed on basic extractions)
                const selectedModel = 'gpt-4o-mini';
                let gptResult = null;

                if (bypassGpt) {
                    gptResult = {
                        content: JSON.stringify({
                            response_text: buildNewCandidateWelcome(),
                            extracted_data: {},
                            reaction: '✨',
                            thought_process: "AUTO_GREETING_BYPASS: Deterministic new-candidate welcome."
                        }),
                        usage: { total_tokens: 0 }
                    };
                } else {
                    gptResult = await getOpenAIResponse(historyForGpt, `${systemInstruction}\n[ADN]: ${JSON.stringify(cleanAdnBase)}`, selectedModel, activeAiConfig.openaiApiKey, { type: "json_object" }, null, 500);
                }

                if (gptResult?.content) {
                    try {
                        let jsonMatch = gptResult.content.match(/\{[\s\S]*\}/);
                        const cleanJson = jsonMatch ? jsonMatch[0] : gptResult.content;
                        aiResult = JSON.parse(cleanJson);
                        if (!bypassGpt) {
                            recordAITelemetry(candidateId, 'consolidated_brain', {
                                model: selectedModel,
                                latency: Date.now() - gptStartTime,
                                tokens: gptResult.usage?.total_tokens || 0
                            });
                        }
                        responseTextVal = formatRecruiterMessage(aiResult.response_text, candidateData, { extractedCategoria: aiResult.extracted_data?.categoria, recentBotTexts: lastBotMessages });

                        // Nuevo candidato: la primera respuesta debe ser fija y predecible.
                        // Si viene de Ads, la burbuja de empresa se inserta abajo entre estas dos.
                        if (isNewFlag) {
                            responseTextVal = buildNewCandidateWelcome();
                            aiResult.response_text = responseTextVal;
                        }

                        // ── NUEVO CANDIDATO: forzar 2 burbujas si GPT no usó [MSG_SPLIT] ──
                        // La pregunta del dato faltante siempre va sola en la segunda burbuja.
                        if (isNewFlag && responseTextVal && !responseTextVal.includes('[MSG_SPLIT]')) {
                            const _nameQRe = /(¿[Mm]e\s+(?:puedes?\s+)?(?:compartir|dar|decir)|¿[Cc]u[aá]l\s+es\s+tu\s+nombre|¿[Cc][oó]mo\s+te\s+llamas|¿[Mm]e\s+(?:dices?|dices?\s+tu)|¿[Pp]uedes?\s+(?:decirme|compartir)|¿[Mm]e\s+lo\s+compartes?|dime\s+tu\s+nombre|comparte\s+tu\s+nombre)/i;
                            const _qMatch = responseTextVal.match(_nameQRe);
                            if (_qMatch && _qMatch.index > 15) {
                                const _p1 = responseTextVal.substring(0, _qMatch.index).trim().replace(/[,\s]+$/, '.');
                                const _p2 = responseTextVal.substring(_qMatch.index).trim();
                                if (_p1 && _p2) responseTextVal = `${_p1}[MSG_SPLIT]${_p2}`;
                            }
                        }

                        // ── BURBUJA DE EMPRESA (solo candidatos nuevos de Ads con empresa configurada) ──
                        if (isNewFlag && candidateData.adId && responseTextVal) {
                            try {
                                const _adRedis = getRedisClient();
                                const _adLabelsRaw = await _adRedis.get('candidatic:ad_labels');
                                const _adLabels = _adLabelsRaw ? JSON.parse(_adLabelsRaw) : [];
                                const _adIdStr = String(candidateData.adId);
                                const _matchLabel = _adLabels.find(l =>
                                    (l.adIds || (l.adId ? [l.adId] : [])).map(String).includes(_adIdStr)
                                );
                                if (_matchLabel?.company?.trim()) {
                                    const _companyMsg = `Para comenzar con tu proceso de reclutamiento para la vacante de *${_matchLabel.company.trim()}* 🏭`;
                                    const _splitParts = responseTextVal.includes('[MSG_SPLIT]')
                                        ? responseTextVal.split('[MSG_SPLIT]').filter(Boolean)
                                        : [responseTextVal.trim()].filter(Boolean);
                                    // Insertar después del saludo; si GPT mandó una sola burbuja, crear la segunda.
                                    _splitParts.splice(1, 0, _companyMsg);
                                    responseTextVal = _splitParts.join('[MSG_SPLIT]');
                                }
                            } catch (_e) { /* no interrumpir si falla */ }
                        }
                    } catch (err) {
                        console.error('[GPT BRAIN] JSON Parse Fail:', err.message);
                        throw new Error('GPT returned invalid JSON');
                    }
                }

                // Merge Extracted Data
                if (aiResult?.extracted_data && Object.keys(aiResult.extracted_data).length > 0) {
                    const ext = aiResult.extracted_data;
                    
                    if (process.env.DEBUG_MODE === 'true') {
                        try {
                            const redisDbg = getRedisClient();
                            if (redisDbg) await redisDbg.set(`DEBUG_AI_EXTRACTED:${candidateId}`, JSON.stringify(ext), 'EX', 3600);
                        } catch(e) {}
                    }


                    if (ext.nombreReal && ext.nombreReal.trim().length > 1) {
                        const _previousName = candidateData.nombreReal || '';

                        // We trust the AI validation from the prompt above
                        ext.nombreReal = coalesceName(candidateData.nombreReal, ext.nombreReal);

                        // Keep inferred gender if candidate has none or has "Desconocido"
                        if ((!candidateData.genero || candidateData.genero === 'Desconocido') && ext.genero && ext.genero !== 'Desconocido') {
                            // Keep inferred gender
                        } else {
                            delete ext.genero; // Don't override a known gender or save 'Desconocido'
                        }
                    } else if (ext.nombreReal !== undefined) {
                        // Name was null, rejected by validation, or too short. Do not save.
                        delete ext.nombreReal;
                    }

                    if (ext.fechaNacimiento) {
                        ext.fechaNacimiento = coalesceDate(candidateData.fechaNacimiento, ext.fechaNacimiento);
                        // 🎂 AUTO-EDAD: Calculate age from valid birth date
                        const _dateParts = (ext.fechaNacimiento || '').split('/');
                        if (_dateParts.length === 3) {
                            const _bd = new Date(+_dateParts[2], +_dateParts[1] - 1, +_dateParts[0]);
                            const _ageDiff = Date.now() - _bd.getTime();
                            const _ageDate = new Date(_ageDiff);
                            const _calcAge = Math.abs(_ageDate.getUTCFullYear() - 1970);
                            if (_calcAge >= 15 && _calcAge <= 80) ext.edad = _calcAge;
                        }
                    }
                    // 🧹 CLEANER PIPELINE: Normalize extracted values through dictionary before saving
                    // These are instant for known values (local Map lookup), AI fallback only for unknowns
                    // 🏎️ PARALLEL EXECUTION: All 3 cleaners run simultaneously to save 2-4s latency
                    try {
                        const cleanerPromises = [];
                        const cleanerKeys = [];

                        if (ext.municipio && typeof ext.municipio === 'string') {
                            cleanerKeys.push('municipio');
                            cleanerPromises.push(cleanMunicipioWithAI(ext.municipio));
                        }
                        if (ext.escolaridad && typeof ext.escolaridad === 'string') {
                            cleanerKeys.push('escolaridad');
                            cleanerPromises.push(cleanEscolaridadWithAI(ext.escolaridad));
                        }
                        if (ext.categoria && typeof ext.categoria === 'string') {
                            cleanerKeys.push('categoria');
                            cleanerPromises.push(cleanCategoryWithAI(ext.categoria));
                        }

                        if (cleanerPromises.length > 0) {
                            const results = await Promise.allSettled(cleanerPromises);
                            results.forEach((r, i) => {
                                if (r.status === 'fulfilled' && r.value) {
                                    ext[cleanerKeys[i]] = r.value;
                                }
                                // If rejected, keep raw GPT value (same as before)
                            });
                        }
                    } catch (_cleanErr) {
                        // Cleaning failed — keep raw GPT values (same behavior as before)
                    }
                    Object.assign(candidateUpdates, Object.fromEntries(
                        Object.entries(ext).filter(([k, v]) => {
                            if (v === null || v === undefined) return false;
                            const str = String(v).trim();
                            if (str === '' || str === 'null' || str === 'N/A' || str === 'proporcionado' || str.length < 2) return false;
                            // 🛡️ PROFILE GUARD: Never blank out a field the candidate already filled.
                            // Only overwrite if the candidate doesn't have the value yet.
                            const profileFields = ['categoria', 'municipio', 'escolaridad', 'fechaNacimiento', 'nombreReal'];
                            if (profileFields.includes(k) && candidateData[k] && String(candidateData[k]).trim().length > 2) {
                                // Allow update only if new value is substantively different (not empty/junk)
                                const oldVal = String(candidateData[k]).trim();
                                const newVal = str;
                                const normText = aggregatedText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                                const normNew = newVal.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                                const normOld = oldVal.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                                
                                // Solo permitir si el candidato MENCIONÓ el nuevo valor, el viejo, O si el bot combinó lo que el usuario escribió (ej. "Oscar" + "Rodriguez")
                                const candidateMentionedIt = 
                                    normText.includes(normNew) || 
                                    normText.includes(normOld) ||
                                    (normText.length > 2 && normNew.includes(normText)) || // Candidate typed "Rodriguez", bot output "Oscar Rodriguez"
                                    (k === 'nombreReal' && normNew.includes(normOld)); // It's appending to existing name
                                    
                                if (!candidateMentionedIt) return false; // Bloquear overwrite silencioso/alucinado
                                return str.length >= 3;
                            }
                            return true;
                        }).map(([k, v]) => [k, v])
                    ));

                    // 🧬 NEW: Programmatic Name Combination Fallback
                    // If the AI spits out a single word (like "Rodriguez") but we already had a single word ("Oscar"),
                    // the AI failed the prompt instruction. We programmatically combine them here before saving.
                    if (candidateUpdates.nombreReal) {
                        const newName = candidateUpdates.nombreReal.trim();
                        const oldName = candidateData.nombreReal ? candidateData.nombreReal.trim() : '';

                        const newWords = newName.split(/\s+/).filter(w => w.length > 0);
                        const oldWords = oldName.split(/\s+/).filter(w => w.length > 0);

                        // If AI gave 1 word, and we had 1 word, and they are different -> combine them.
                        if (newWords.length === 1 && oldWords.length === 1 && newName.toLowerCase() !== oldName.toLowerCase()) {
                            candidateUpdates.nombreReal = `${oldName} ${newName}`;
                        }
                    }
                }

                // ── ESCOLARIDAD SAFETY NET (early, before finalAudit) ─────────────
                // If GPT failed to extract escolaridad but the user's message contains a
                // known keyword, save it now so finalAudit / paso 2 see the correct state.
                if (!candidateUpdates.escolaridad && !candidateData.escolaridad) {
                    const _ESC_EARLY = [
                        [/\b(primaria|prima|prim)\b/i, 'Primaria'],
                        [/\b(secundaria|secund|secu|sec)\b/i, 'Secundaria'],
                        [/\b(preparatoria|bachillerato|prepa|prep|cbetis|cbtis|conalep|cecyte|cetis)\b/i, 'Preparatoria'],
                        [/\b(licenciatura|licenc|lic|ingenier[ií]a)\b/i, 'Licenciatura'],
                        [/\b(universidad|uni|itesm|tec de monterrey|uanl|udem)\b/i, 'Licenciatura'],
                        [/\b(t[eé]cnic[ao]|tecnica|tecnico|carrera t[eé]cnica)\b/i, 'Técnica'],
                        [/\b(posgrado|maestr[ií]a|maestria|doctorado|mba)\b/i, 'Posgrado']
                    ];
                    const _msgLower = aggregatedText.toLowerCase();
                    for (const [_pat, _nivel] of _ESC_EARLY) {
                        if (_pat.test(_msgLower)) { candidateUpdates.escolaridad = _nivel; break; }
                    }
                }

                // Guardrail Pass
                const freshAudit = auditProfile({ ...candidateData, ...candidateUpdates }, customFields);
                const guardContext = {
                    isProfileComplete: freshAudit.paso1Status === 'COMPLETO',
                    missingFields: freshAudit.missingLabels,
                    lastInput: aggregatedText,
                    isNewFlag: isNewFlag,
                    candidateName: candidateUpdates.nombreReal || candidateData.nombreReal || displayName, // Updated to prioritize candidateUpdates.nombreReal
                    lastBotMessages,
                    categoriesList
                };
                const validation = await AIGuard.validate(aiResult, guardContext, allMessages);
                if (validation && validation.recovery_active) {
                    aiResult = validation;
                    responseTextVal = aiResult.response_text;
                    if (aiResult.extracted_data) Object.assign(candidateUpdates, Object.fromEntries(
                        Object.entries(aiResult.extracted_data).filter(([_, v]) => v !== null && v !== undefined && v !== 'null' && v !== 'N/A')
                    ));

                    // 📊 TELEMETRÍA (fire-and-forget): cuenta cierres prematuros atrapados por día
                    // (zona Monterrey). Contador = total de eventos; set = candidatos únicos afectados.
                    // Se consulta bajo demanda: guard:premature_closure:YYYY-MM-DD (INCR) y
                    // guard:premature_closure:list:YYYY-MM-DD (SET de candidateId). Expiran a 90 días.
                    if (validation.thought_process?.includes('FALLBACK_PREMATURE_CLOSURE')) {
                        try {
                            const _rGuard = getRedisClient();
                            const _dayGuard = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
                            const _kCount = `guard:premature_closure:${_dayGuard}`;
                            const _kList = `guard:premature_closure:list:${_dayGuard}`;
                            _rGuard?.incr(_kCount).then(() => _rGuard.expire(_kCount, 60 * 60 * 24 * 90)).catch(() => {});
                            _rGuard?.sadd(_kList, candidateId).then(() => _rGuard.expire(_kList, 60 * 60 * 24 * 90)).catch(() => {});
                        } catch (_e) { /* no interrumpir el flujo por telemetría */ }
                    }
                }

                // 🔍 JOB INQUIRY INTERCEPT: If candidate asked about vacancies/interviews before
                // completing profile, always reply with the inquiry-aware response (even if AI was silent).
                // 🛑 BUT ONLY if there's no custom prompt, otherwise we let the custom prompt handle the inquiry.
                if (freshAudit.paso1Status !== 'COMPLETO' && !customPrompt) {
                    const isJobInquiry = /(?:[?¿]|\b)(vacantes?|entrevistas?|sueldo|salario|pagan|horario|turnos|d[oó]nde|ubicaci[oó]n|tienes\s+trabajo|hay\s+trabajo|ofrecen|qu[eé]\s+ofrecen)/i.test(aggregatedText || '');
                    if (isJobInquiry) {
                        const firstMissing = freshAudit.missingLabels?.[0] || 'nombre completo';
                        const isInterviewQ = /entrevistas?|d[oó]nde|ubicaci[oó]n/i.test(aggregatedText || '');
                        responseTextVal = isInterviewQ
                            ? `Para darte información de las entrevistas primero debo tener tu ${firstMissing}, ¿me lo compartes? 😊`
                            : `¡Sí! 😊 Tenemos vacantes, pero primero dime tu ${firstMissing}. ✨`;
                    }
                }


                // Transition Logic
                // 🛠️ [HACK] Synchronous Gender fallback for Orchestrator
                let tempGenero = candidateUpdates.genero || candidateData.genero;
                if ((!tempGenero || tempGenero === 'Desconocido') && (candidateUpdates.nombreReal || candidateData.nombreReal)) {
                    const nr = (candidateUpdates.nombreReal || candidateData.nombreReal || "").trim().toLowerCase();
                    const firstWord = nr.split(/\s+/)[0] || "";
                    if (['jose', 'jesús', 'jesus', 'josé'].includes(firstWord)) {
                        tempGenero = "Hombre";
                    } else if (firstWord.startsWith("maria") || firstWord.startsWith("ana") || firstWord.startsWith("laura") || firstWord.startsWith("brenda") || firstWord.endsWith("a")) {
                        tempGenero = "Mujer";
                    } else {
                        tempGenero = "Hombre";
                    }
                    candidateUpdates.genero = tempGenero;
                    candidateData.genero = tempGenero;
                    await updateCandidate(candidateId, { genero: tempGenero });
                }

                const finalAudit = auditProfile({ ...candidateData, ...candidateUpdates }, customFields);
                isNowComplete = finalAudit.paso1Status === 'COMPLETO';

                if (await Orchestrator.checkBypass(candidateData, finalAudit, batchConfig.bypass_enabled === 'true')) {
                    const handoverResult = await Orchestrator.executeHandover({ ...candidateData, ...candidateUpdates }, config, msgId);
                    if (handoverResult?.triggered) {
                        Object.assign(candidateUpdates, { projectId: handoverResult.projectId, stepId: handoverResult.stepId });
                        responseTextVal = null;
                        if (!aiResult) aiResult = {};
                        aiResult.simulatorHandoverText = handoverResult.introMessage;
                        handoverTriggered = true;
                    }
                }

                if (!handoverTriggered && isNowComplete && !candidateData.congratulated) {
                    const _congratsName = (candidateUpdates.nombreReal || candidateData.nombreReal || '').split(' ')[0];
                    responseTextVal = null;
                    if (aiResult) aiResult.response_text = null;
                    candidateUpdates.congratulated = true;
                    await MediaEngine.sendCongratsPack(config, candidateData.whatsapp, 'bot_celebration_sticker', candidateId);

                    // ── Disparar Paso 2 inmediatamente — sin cron, sin Redis key ──
                    candidateUpdates.paso2Estado = 'esperando_colonia';
                    candidateUpdates.paso2Requerido = true;
                    await redis?.sadd('paso2_waiting', candidateId);
                    const _p2Phone = candidateData.whatsapp || '';
                    const _p2InstanceId = config?.instanceId || resolvedInstanceId || candidateData.instanceId || '';
                    const _p2Token = config?.token || '';
                    const _p2Nombre = _congratsName || candidateUpdates.nombreReal || candidateData.nombreReal || '';
                    const _p2Ts = new Date().toISOString();
                    const _p2B1 = _p2Nombre
                        ? `Oye ${_p2Nombre}, estoy revisando mi sistema y encontré algo para ti 👀`
                        : `Oye, estoy revisando mi sistema y encontré algo para ti 👀`;
                    const _p2B2 = `Compárteme porfi 🙏 el nombre de tu colonia. Es para validar si te queda una ruta de transporte 🚌🏘️`;
                    // priority 10/11 — llegan después de la felicitación (priority 0)
                    Promise.resolve()
                        .then(() => sendUltraMsgMessage(_p2InstanceId, _p2Token, _p2Phone, _p2B1, 'chat', { priority: 10 }))
                        .then(() => saveMessage(candidateId, { from: 'bot', content: _p2B1, timestamp: _p2Ts }))
                        .then(() => sendUltraMsgMessage(_p2InstanceId, _p2Token, _p2Phone, _p2B2, 'chat', { priority: 11 }))
                        .then(() => saveMessage(candidateId, { from: 'bot', content: _p2B2, timestamp: _p2Ts }))
                        .catch(e => console.error('[paso2] Error:', e.message));
                }

            } catch (err) {
                console.error('❌ [GPT BRAIN FATAL] Error:', err.message);
                const fbContext = {
                    isProfileComplete: audit?.paso1Status === 'COMPLETO',
                    missingFields: audit?.missingLabels || [],
                    isNewFlag: isNewFlag,
                    candidateName: displayName,
                    lastBotMessages,
                    categoriesList
                };
                aiResult = AIGuard.validate(null, fbContext);
                responseTextVal = formatRecruiterMessage(aiResult?.response_text, candidateData);
            }
        }

        // --- REACTION LOGIC ---
        let reactionPromise = Promise.resolve();
        if (msgId && config && aiResult?.reaction) {
            reactionPromise = sendUltraMsgReaction(config.instanceId, config.token, msgId, aiResult.reaction);
        }

        let deliveryPromise = Promise.resolve();
        // 📐 LAST-MILE FORMATTER: Ensure formatting is applied regardless of which code path built responseTextVal
        if (responseTextVal) responseTextVal = formatRecruiterMessage(responseTextVal, candidateData);

        // 🚨 PREMATURE CLOSURE GUARD: If GPT generated a closing message but fields are still missing,
        // strip the closing phrase and append the question for the next missing field.
        // SKIP if isNowComplete — profile was just finished this turn and closing is intentional.
        if (responseTextVal && auditForMode && auditForMode.missingLabels && auditForMode.missingLabels.length > 0 && !isNowComplete) {
            const _CLOSING_RE = /(?:te contactar[eé]|te escribir[eé]|nos\s+vemos|¡hasta\s+(luego|pronto|la\s+próxima)|¡bye|¡chao|te\s+aviso\s+pronto|pronto\s+un\s+reclutador|estaremos?\s+en\s+contacto|listo\s+por\s+hoy|eso\s+es\s+todo\s+por\s+ahora|te\s+agradezco\s+tu\s+paciencia|te\s+agradecer[eé]\s+tu\s+paciencia)/i;
            if (_CLOSING_RE.test(responseTextVal)) {
                // Remove the closing sentence
                responseTextVal = responseTextVal
                    .split(/[.!]\s+/)
                    .filter(s => !_CLOSING_RE.test(s))
                    .join('. ')
                    .trim();
                // Ensure it ends with the data question
                const _nextMissing = auditForMode.missingLabels[0];
                if (responseTextVal && !responseTextVal.endsWith('?')) {
                    responseTextVal += `[MSG_SPLIT]¿Me puedes compartir tu ${_nextMissing}? 😊`;
                }
            }
        }

        // ⚠️ Compute resText AFTER formatRecruiterMessage so [MSG_SPLIT] injections are visible
        let resText = String(responseTextVal || '').replace(/\[MSG_SPLIT\]/g, '').trim();

        // 🧹 MOVE TAG SANITIZER: Strip internal move tags from outbound messages
        const moveTagPattern = /[{[]\s*move(?::\s*(?:exit|no_interesa|\w+))?\s*[}\]]/i;
        const moveTagPatternGlobal = /[{[]\s*move(?::\s*(?:exit|no_interesa|\w+))?\s*[}\]]/gi;
        const hasMoveIntent = moveTagPattern.test(String(aiResult?.thought_process || '')) || moveTagPattern.test(resText);

        if (moveTagPattern.test(resText)) {
            resText = resText.replace(moveTagPatternGlobal, '').trim();
            responseTextVal = resText || null;
        }

        if (responseTextVal) {
            // [MEDIA RECOVERY]: If Brenda leaked the link into text but forgot the JSON field, recover it
            if (!aiResult?.media_url || aiResult.media_url === 'null') {
                const mediaTagPattern = /\[MEDIA_DISPONIBLE:?\s*(https?:\/\/[^\s\]]+)\]/i;
                const tagMatch = responseTextVal.match(mediaTagPattern);
                if (tagMatch && tagMatch[1]) {
                    if (!aiResult) aiResult = {};
                    aiResult.media_url = tagMatch[1];
                } else {
                    const mediaPattern = /https?:\/\/[^/]+\/api\/(image\?id=|media\/)([^\s)]+)/i;
                    const match = responseTextVal.match(mediaPattern);
                    if (match) {
                        if (!aiResult) aiResult = {};
                        aiResult.media_url = match[0];
                    }
                }
            }

            // [CLEANUP]: Sweep out ANY literal tag [MEDIA_DISPONIBLE] or [MEDIA_DISPONIBLE: url]
            responseTextVal = responseTextVal.replace(/\[MEDIA_DISPONIBLE[^\]]*\]/gi, '').trim();

            // 🛡️ [MAPS PROTECTION]: If GPT mistakenly put a Maps link into media_url, it's NOT an attachment!
            if (aiResult?.media_url && aiResult.media_url.match(/maps\.app\.goo\.gl|maps\.google|google\.com\/maps/i)) {
                // Ensure the link is actually inside the text so the user can click it
                if (!responseTextVal.includes(aiResult.media_url)) {
                    responseTextVal = `${responseTextVal.trim()} ${aiResult.media_url}`;
                }
                aiResult.media_url = null; // Clear it so it doesn't get downloaded as a broken 518kB "image"
            }

            // 🔄 MEDIA+FALLBACK COHERENCE FIX: When GPT found the FAQ media (media_url is set)
            // but still used the fallback text ("Es una excelente pregunta..."), replace the
            // text with a coherent introduction so it makes sense before the PDF/image arrives.
            if (aiResult?.media_url && aiResult.media_url !== 'null'
                && responseTextVal && /^Es una excelente pregunta/i.test(responseTextVal.trim())) {
                responseTextVal = '¡Claro que sí! 📍 Aquí te comparto la información:';
            }

            if (aiResult?.media_url && aiResult.media_url !== 'null') {

                // Failsafe: Remove any leaked media URLs to prevent duplicate display natively vs text
                // 🛡️ IMPORTANT: Temporarily protect [MSG_SPLIT] so it survives the whitespace collapse
                const leakedUrlRegex = /https?:\/\/[^\s)]*\/api\/(image|media)[^\s)]*/gi;
                const markdownImageRegex = /!\[.*?\]\(.*?\)/g;
                responseTextVal = responseTextVal
                    .replace(markdownImageRegex, '')  // strip markdown images ![...](url)
                    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // strip markdown links [text](url) → text
                    .replace(leakedUrlRegex, '')      // strip ONLY internal media URLs
                    .replace(/\[MSG_SPLIT\]/g, '\u0000SPLIT\u0000') // protect sentinel
                    .replace(/[^\S\n]+/g, ' ')         // collapse horizontal whitespace only (preserve \n)
                    .replace(/\n{3,}/g, '\n\n')        // cap excessive newlines to max 2
                    // eslint-disable-next-line no-control-regex -- centinela \u0000 intencional (imposible en texto de WhatsApp)
                    .replace(/\u0000SPLIT\u0000/g, '[MSG_SPLIT]') // restore sentinel
                    .trim();
            }
        }

        const filterRegex = /^\[\s*(SILENCIO|NULL|UNDEFINED|REACCIÓN.*?|REACCION.*?)\s*\]$/i;
        const isTechnicalOrEmpty = !resText || filterRegex.test(String(resText).trim());

        // 🛡️ [FINAL DELIVERY SAFEGUARD]: If Brenda is about to go silent but profile isn't closed, force a fallback
        // Special case: in recruiter mode, close_conversation:true with empty response = bot silence on a FAQ question.
        // We must still send a fallback in that case, UNLESS there is a valid media_url being sent.
        const hasMedia = aiResult?.media_url && aiResult.media_url !== 'null';
        const recruiterClosedSilently = isRecruiterMode && isTechnicalOrEmpty && aiResult?.close_conversation && !hasMoveIntent && !recruiterTriggeredMove && !handoverTriggered && !hasMedia;
        
        // 🛡️ PIVOT EXCLUSION: When the pivot guard already sent the vacancy directly (isHandlingPivot=true),
        // aiResult and responseTextVal are both null by design — the message was already delivered.
        // Without this guard, isTechnicalOrEmpty=true triggers a "Ayúdame a entenderte mejor" fallback.
        if ((isTechnicalOrEmpty && !hasMoveIntent && !recruiterTriggeredMove && !aiResult?.close_conversation && !handoverTriggered && !hasMedia && !isHandlingPivot && !isNowComplete) || recruiterClosedSilently) {
            if (isRecruiterMode) {
                // If the AI sent an FAQ Media URL but hallucinated the text away, safely append a generic CTA
                if (hasMedia) {
                    responseTextVal = "Aquí está la información. 😉 ¿Te gustaría que te agende una cita de entrevista?";
                } else if (recruiterClosedSilently) {
                    // Unknown / unanswered question — use the designed RADAR DE DUDAS fallback text,
                    // Unknown / unanswered — friendly clarification variant
                    const _clarifyOptsSilent = [
                        'Mmm, no te entendí bien 😅 ¿Puedes repetir tu pregunta de otra forma?',
                        'No estoy segura de entenderte, ¿me lo puedes explicar diferente? 🙏',
                        'Ayúdame a entenderte mejor, ¿qué quieres saber exactamente? 😊'
                    ];
                    responseTextVal = _clarifyOptsSilent[Math.floor(Math.random() * _clarifyOptsSilent.length)];
                } else {
                    // Generic error — friendly clarification variant
                    const _clarifyOptsErr = [
                        'Mmm, no te entendí bien 😅 ¿Puedes repetirlo de otra forma?',
                        'No estoy segura de entenderte, ¿puedes explicarlo diferente? 🙏',
                        'Ayúdame a entenderte mejor, ¿qué quieres saber? 😊'
                    ];
                    responseTextVal = _clarifyOptsErr[Math.floor(Math.random() * _clarifyOptsErr.length)];

                }
            } else {
                responseTextVal = "¡Ay! Me distraje un segundo. 😅 ¿Qué me decías?";
            }
        }

        if (responseTextVal) {
            deliveryPromise = (async () => {
                let mUrl = aiResult?.media_url;

                // --- MESSAGE SPLITTER LOGIC ---
                let messagesToSend = [];

                // 1️⃣ Handle SPLIT sentinel from formatRecruiterMessage (confirmation & special splits)
                const SENTINEL = '[MSG_SPLIT]';
                if (responseTextVal.includes(SENTINEL)) {
                    _responseWithSplit = responseTextVal; // capturar con [MSG_SPLIT] antes de reemplazar
                    responseTextVal.split(SENTINEL).forEach(p => { if (p.trim()) messagesToSend.push(p.trim()); });
                    responseTextVal = responseTextVal.replace(/\[MSG_SPLIT\]/g, '\n\n').trim();
                } else {
                    // Strip any leaked sentinel residue before sending, then try regex split
                    responseTextVal = responseTextVal.replace(/\[MSG_SPLIT\]/g, ' ').trim();
                    // 2️⃣ Regex-based split for scheduling CTAs
                    const splitRegex = /(¿Te gustaría que (?:te )?agende.*?(?:entrevista|cita).*?\?|¿Te gustaría agendar.*?entrevista.*?\?|¿Te queda bien\??|¿Te queda bien este día\??|¿Te puedo agendar|¿Deseas que programe|¿Te interesa que asegure|¿Te confirmo tu cita|¿Quieres que reserve|¿Procedo a agendar|¿Te aparto una cita|¿Avanzamos con|¿Autorizas que agende)/i;
                    const match = responseTextVal.match(splitRegex);

                    if (match) {
                        // Use natural sentence boundary instead of raw CTA start
                        const beforeCta = responseTextVal.substring(0, match.index);
                        const lastBang = beforeCta.lastIndexOf('!');
                        let lastDot = beforeCta.lastIndexOf('.');
                        // 🛡️ ABBREVIATION GUARD: Don't split at "Lic.", "Dr.", "Ing.", etc.
                        // If the word before the dot is ≤4 chars or starts with capital and ≤ 5 chars (like "Mtra."), it's likely an abbreviation.
                        while (lastDot > 0) {
                            const wordBeforeDot = beforeCta.substring(0, lastDot).split(/[\s,]/).pop() || '';
                            if (wordBeforeDot.length <= 5) {
                                // It's an abbreviation, look for the previous dot
                                lastDot = beforeCta.lastIndexOf('.', lastDot - 1);
                            } else {
                                break; // Valid sentence end found
                            }
                        }
                        const naturalEnd = Math.max(lastBang, lastDot);
                        let splitAt = naturalEnd > 25 ? naturalEnd + 1 : match.index;
                        // Advance past trailing emojis/spaces
                        if (naturalEnd > 25) {
                            while (splitAt < beforeCta.length &&
                                (isEmoji(beforeCta[splitAt]) || beforeCta[splitAt] === ' ')) splitAt++;
                        }
                        const part1 = responseTextVal.substring(0, splitAt).trim();
                        const part2 = responseTextVal.substring(splitAt).trim();
                        if (part1) messagesToSend.push(part1);
                        messagesToSend.push(part2);
                    } else {
                        messagesToSend.push(responseTextVal);
                    }
                }

                // 🔑 CAPA 6: If any sent message contains the CTA, set cita_pending in Redis
                // so the NEXT affirmative from the candidate is treated as a confirmed acceptance.
                const CTA_PATTERN = /¿te gustar[ií]a agendar|¿te agendo una cita|¿te aparto una cita|¿quieres que programe|¿te puedo agendar|solo por confirmar|me confirmas si quieres|quieres que agendemos|solo para confirmar|¿te interesa conocer esta|te gustaría conocerla|¿te la presento|¿te gustaría saber más|¿avanzamos con|avanzamos con tu cita|¿te parece bien ese horario|este horario te queda bien|¿cuál prefieres\?/i;
                const _hasCTAinBatch = messagesToSend.some(m => CTA_PATTERN.test(m));
                if (_hasCTAinBatch && isRecruiterMode) {
                    setCitaPendingFlag(redis, candidateId).catch(() => {});
                    incrCTAIndex(redis, candidateId).catch(() => {}); // 🔁 Advance sequential counter
                }

                if (mUrl && mUrl !== 'null') {
                    // Ensure absolute URL for UltraMsg
                    if (mUrl.startsWith('/api/')) {
                        mUrl = `https://candidatic.com${mUrl}`;
                    } else if (mUrl.includes('candidatic.ia') && !mUrl.includes('candidatic.com')) {
                        mUrl = mUrl.replace('candidatic.ia', 'candidatic.com');
                    }

                    // Detect if it's a PDF
                    let isPdf = mUrl.toLowerCase().includes('.pdf') || mUrl.includes('mime=application%2Fpdf');
                    let extractedFilename = null;
                    if (mUrl.includes('/api/image')) {
                        try {
                            // Safe URL parsing regardless of domain
                            const urlObj = mUrl.startsWith('http') ? new URL(mUrl) : new URL(mUrl, 'https://candidatic.com');
                            const mediaId = urlObj.searchParams.get('id');
                            if (mediaId) {
                                const redis = getRedisClient();
                                if (redis) {
                                    const metaRaw = await redis.get(`meta:image:${mediaId}`);
                                    if (metaRaw) {
                                        const meta = JSON.parse(metaRaw);
                                        if (meta.mime === 'application/pdf') isPdf = true;
                                        if (meta.filename) extractedFilename = meta.filename;
                                    }
                                }
                            }
                        } catch (e) { console.warn('[MEDIA DELIVERY] Deep detection failed:', e.message); }
                    }

                    const filename = extractedFilename || (isPdf ? 'Informacion.pdf' : 'Imagen.jpg');

                    // Stagger delivery text -> media -> CTA priority (Strict sequential await to guarantee WhatsApp arrival order)
                    if (!isSimulatorPhone) {
                        if (messagesToSend.length > 1) {
                            await sendBotMessageWithRetry(config, candidateData, candidateId, messagesToSend[0], 'chat', { priority: 1 });
                            await sendBotMessageWithRetry(config, candidateData, candidateId, mUrl, isPdf ? 'document' : 'image', { filename, priority: 2 });
                            await sendBotMessageWithRetry(config, candidateData, candidateId, messagesToSend[1], 'chat', { priority: 3 });
                        } else {
                            await sendBotMessageWithRetry(config, candidateData, candidateId, mUrl, isPdf ? 'document' : 'image', { filename, priority: 1 });
                            await sendBotMessageWithRetry(config, candidateData, candidateId, messagesToSend[0], 'chat', { priority: 2 });
                        }
                    }

                } else {
                    // Text only, send sequentially to guarantee order
                    if (!isSimulatorPhone) {
                        for (let i = 0; i < messagesToSend.length; i++) {
                            // 💬 Show typing before every bubble after the first
                            if (i > 0) {
                                sendUltraMsgPresence(candidateData.whatsapp, 'composing').catch(() => {});
                            }
                            await sendBotMessageWithRetry(config, candidateData, candidateId, messagesToSend[i], 'chat', { priority: i + 1 });
                        }
                    }
                }
            })();
        }

        // 🧬 [STATE SYNC] Ensure we know if they are complete even if we didn't go through Gemini
        if (!isNowComplete) {
            const finalAudit = auditProfile({ ...candidateData, ...candidateUpdates }, customFields);
            isNowComplete = finalAudit.paso1Status === 'COMPLETO';
        }

        // 📝 [DEBUG LOG]: Store full trace (only in debug mode to save Redis I/O)
        if (process.env.DEBUG_MODE === 'true') {
            try {
                const redisClient = getRedisClient();
                if (redisClient) {
                    const trace = {
                        v: "V_FINAL_STABLE_V1",
                        timestamp: new Date().toISOString(),
                        receivedMessage: aggregatedText,
                        intent,
                        apiUsed: isRecruiterMode ? `recruiter-agent(Step: ${activeStepId})` : 'capturista-brain',
                        aiResult,
                        isNowComplete
                    };
                    await redisClient.lpush(`debug:agent:logs:${candidateId}`, JSON.stringify(trace));
                    await redisClient.ltrim(`debug:agent:logs:${candidateId}`, 0, 49);
                    await redisClient.set('debug:global:last_run', JSON.stringify({
                        candidateId,
                        timestamp: trace.timestamp,
                        msg: aggregatedText.substring(0, 50),
                        hasUQ: !!aiResult?.unanswered_question
                    }), 'EX', 3600);
                }
            } catch (e) {
                console.error(`[DEBUG] Trace failed: `, e.message);
            }
        }

        const finalReaction = (aiResult?.reaction && aiResult.reaction !== 'null' && aiResult.reaction !== 'undefined') ? aiResult.reaction : null;
        let dbContentToSave = _responseWithSplit || responseTextVal;

        if (!dbContentToSave) {
            dbContentToSave = finalReaction ? `[REACCIÓN: ${finalReaction}]` : ' ';
        } else {
            dbContentToSave = dbContentToSave.trim();
            if (finalReaction && !dbContentToSave.includes('[REACCIÓN:')) {
                dbContentToSave += ` [REACCIÓN: ${finalReaction}]`;
            }
        }
        // 🧹 [DATA SANITATION]: Remove emojis and extra spaces from extracted values
        for (const key of ['categoria', 'municipio', 'escolaridad', 'nombreReal', 'fechaNacimiento']) {
            if (typeof candidateUpdates[key] === 'string') {
                candidateUpdates[key] = candidateUpdates[key].replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]|✅|⏰|✨|🎯|💪|😊|👍|👋/g, '').trim();
            }
        }

        // ── ESCOLARIDAD SAFETY NET ────────────────────────────────────────────────
        // Deterministic fallback: if GPT failed to extract escolaridad but the user's
        // message contains a known keyword/abbreviation, save it directly.
        if (!candidateUpdates.escolaridad && !candidateData.escolaridad) {
            const _ESC_DIRECT = [
                [/\b(primaria|prima|prim)\b/i, 'Primaria'],
                [/\b(secundaria|secund|secu|sec)\b/i, 'Secundaria'],
                [/\b(preparatoria|bachillerato|prepa|prep|cbetis|cbtis|conalep|cecyte|cetis)\b/i, 'Preparatoria'],
                [/\b(licenciatura|licenc|lic|ingenieria|ingenier[ií]a)\b/i, 'Licenciatura'],
                [/\b(universidad|uni|itesm|tec de monterrey|uanl|udem)\b/i, 'Licenciatura'],
                [/\b(t[eé]cnic[ao]|tecnica|tecnico|carrera t[eé]cnica)\b/i, 'Técnica'],
                [/\b(posgrado|maestr[ií]a|maestria|doctorado|mba)\b/i, 'Posgrado']
            ];
            const msgLower = aggregatedText.toLowerCase();
            for (const [pattern, nivel] of _ESC_DIRECT) {
                if (pattern.test(msgLower)) {
                    candidateUpdates.escolaridad = nivel;
                    break;
                }
            }
        }

        // Conversion tracking: if candidate was reengaged and now has fewer missing fields, mark as converted
        if (
            !candidateData.reengagement_converted &&
            (Number(candidateData.reengagement_attempts) || 0) > 0
        ) {
            const missingBefore = getMissingFields(candidateData);
            const missingAfter  = getMissingFields({ ...candidateData, ...candidateUpdates });
            if (missingBefore.length > 0 && missingAfter.length < missingBefore.length) {
                candidateUpdates.reengagement_converted = true;
                candidateUpdates.reengagement_converted_at = new Date().toISOString();
            }
        }

        // 🕐 Sella el instante en que el perfil pasa a COMPLETO (flanco de subida). Lo usa el
        // disparador "candidato que regresa" para su filtro de antigüedad. Se guarda en el
        // mismo updateCandidate de abajo. Idempotente: solo la primera vez (no se re-sella).
        if (candidateData.paso2Estado !== 'completo'
            && (candidateUpdates.paso2Estado || candidateData.paso2Estado) === 'completo'
            && !candidateData.paso2CompletadoAt) {
            candidateUpdates.paso2CompletadoAt = new Date().toISOString();
        }

        await Promise.allSettled([
            deliveryPromise,
            reactionPromise,
            updateCandidate(candidateId, candidateUpdates),
            saveMessage(candidateId, {
                from: 'bot',
                content: dbContentToSave,
                timestamp: new Date().toISOString()
            })
        ]);

        // ── AGENTE KATCON (event-driven): si Brenda ACABA de terminar la extracción
        // (paso2Estado → 'completo' EN ESTE TURNO) disparamos el PUNTO KATCON al instante.
        // El tag "KATCON ANUNCIO" ya viene desde el anuncio; "completo" se marca aquí → este
        // es el momento exacto. Fire-and-forget (no await): jamás bloquea ni rompe el extractor.
        // Todos los candados (toggle de Oscar, corte no-retroactivo, una-sola-vez) van dentro.
        const _wasP2Complete = candidateData.paso2Estado === 'completo';
        const _isP2Complete = (candidateUpdates.paso2Estado || candidateData.paso2Estado) === 'completo';
        if (!_wasP2Complete && _isP2Complete) {
            // ── SECCIÓN "CANDIDATO RECIÉN COMPLETO" ──────────────────────────────────
            // TODA esta sección corre bajo UN SOLO blindaje de segundo plano (runInBackground
            // → waitUntil). Antes cada gancho era fire-and-forget suelto y Vercel CONGELA la
            // instancia al responder 200 → el trabajo pendiente (envíos con pausa, llamadas al
            // LLM) se descartaba en silencio. Al envolver la sección entera en un solo lugar,
            // cualquier gancho que se agregue aquí en el futuro queda protegido automáticamente,
            // sin depender de que alguien recuerde envolverlo. Ver api/utils/background.js.
            // Se corren en secuencia (mismo candidato → orden de mensajes predecible) y cada uno
            // aísla su propio error para no cortar a los siguientes.
            runInBackground((async () => {
                // KATCON: manda el mensaje de banco "PUNTO KATCON" (la cita). Determinístico, sin IA.
                await maybeSendKatconOnComplete(candidateId, { ...candidateData, ...candidateUpdates })
                    .catch(e => console.error('[COMPLETION] katcon:', e?.message));

                // FLOWS (constructor visual de automatizaciones): evalúa los flujos activos y
                // ejecuta las acciones que apliquen. Sin cron ni IA — ver api/utils/flow-engine.js.
                await runFlowsForCandidate(candidateId, { ...candidateData, ...candidateUpdates })
                    .catch(e => console.error('[COMPLETION] flows:', e?.message));

                // AGENT CANDIDATIC (agente en vivo, generalizado por etiqueta): encola al candidato
                // y dispara el motor de atención (agent-attend.js), que SÍ llama a Claude para
                // decidir qué mandar. Se encola SOLO si aplica (candados ya validados adentro).
                const entry = await maybeEnqueueForLiveAgent(candidateId, { ...candidateData, ...candidateUpdates })
                    .catch(() => null);
                if (entry) await attendLiveCandidate(candidateId, entry.tag)
                    .catch(e => console.error('[COMPLETION] live-agent:', e?.message));
            })());
        }

        recordAITelemetry(candidateId, 'brenda_turn_complete', {
            latency: Date.now() - startTime,
            mode: isRecruiterMode ? 'recruiter' : (isHostMode ? 'host' : 'capturista'),
            bubbles: String(_responseWithSplit || responseTextVal || '').split('[MSG_SPLIT]').filter(Boolean).length || 0,
            hasMedia: !!(aiResult?.media_url && aiResult.media_url !== 'null')
        }).catch(() => {});

        return { 
            text: responseTextVal || aiResult?.simulatorHandoverText || '', 
            mediaUrl: aiResult?.media_url && aiResult.media_url !== 'null' ? aiResult.media_url : null 
        };
    } catch (error) {
        console.error('❌ [AI Agent] Fatal Error:', error);
        const fallbackMsg = "¡Ay! Me distraje un segundo. 😅 ¿Qué me decías?";
        if (candidateData && candidateData.whatsapp) {
            const fallbackResult = await sendFallback(candidateData, fallbackMsg).catch(err => ({ success: false, error: err.message }));
            if (fallbackResult?.success) {
                await saveMessage(candidateId, {
                    from: 'bot',
                    content: fallbackMsg,
                    timestamp: new Date().toISOString()
                }).catch(() => { });
            }
        }
        return { text: fallbackMsg, mediaUrl: null };
    }
};

async function sendFallback(cand, text) {
    const config = await getUltraMsgConfig(cand?.incomingPhoneNumberId || cand?.instanceId);
    if (config && cand.whatsapp) {
        return await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, text);
    }
    return { success: false, error: 'missing_candidate_or_config' };
}

async function sendBotMessageWithRetry(config, cand, candidateId, body, type = 'chat', extraParams = {}) {
    const sendOnce = () => sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, body, type, extraParams);
    let result = await sendOnce();

    // Meta/network hiccups are usually transient. Retry only once to avoid slow duplicate storms.
    if (!result?.success && type === 'chat') {
        await new Promise(resolve => setTimeout(resolve, 700));
        result = await sendOnce();
    }

    if (!result?.success) {
        try {
            await recordAITelemetry(candidateId, 'brenda_delivery_failed', {
                type,
                error: result?.error || 'unknown_send_error'
            });
        } catch (_) {}
    }

    return result;
}
