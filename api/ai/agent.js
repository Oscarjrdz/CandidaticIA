// [PREMIUM ARCHITECTURE] V_FINAL_STABLE_V1 - Zero-Silence Infrastructure Active | Deploy: 2026-03-13
/* global process */
import { processUnansweredQuestion } from './faq-engine.js';
import {
    getRedisClient,
    getMessages,
    saveMessage,
    updateCandidate,
    getCandidateById,
    auditProfile,
    getProjectById,
    getVacancyById,
    recordAITelemetry,
    moveCandidateStep,
    addCandidateToProject,
    recordVacancyInteraction,
    updateProjectCandidateMeta,
    getActiveBypassRules,
    getProjects
} from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig, sendUltraMsgReaction } from '../whatsapp/utils.js';
import { getSchemaByField } from '../utils/schema-registry.js';
import { getCachedConfig, getCachedConfigBatch } from '../utils/cache.js';
import { getOpenAIResponse } from '../utils/openai.js';
import { processRecruiterMessage } from './recruiter-agent.js';
import { inferGender } from '../utils/gender-helper.js';
import { classifyIntent } from './intent-classifier.js';
import { FEATURES } from '../utils/feature-flags.js';
import { AIGuard } from '../utils/ai-guard.js';
import { Orchestrator } from '../utils/orchestrator.js';
import { MediaEngine } from '../utils/media-engine.js';
import { intelligentExtract } from '../utils/intelligent-extractor.js';
import { scheduleRemindersForCandidate } from '../utils/reminder-scheduler.js';

// 🚀 TURBO MODE: Silence all synchronous Vercel console I/O unless actively debugging
if (process.env.DEBUG_MODE !== 'true') {
    console.log = function () { };
}

// ─────────────────────────────────────────────────────────────────────────────
// 📐 SHARED MESSAGE FORMATTER — applies to all recruiter/bot response texts
// ─────────────────────────────────────────────────────────────────────────────
const _DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const _MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
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
            return `${dayMatch} ${parseInt(parts[2])} de ${monMatch.charAt(0).toUpperCase() + monMatch.slice(1)}`;
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
async function getCitaPendingFlag(redis, candidateId) {
    if (!redis || !candidateId) return false;
    try { return (await redis.get(`cita_pending:${candidateId}`)) === '1'; } catch (_) { return false; }
}
async function clearCitaPendingFlag(redis, candidateId) {
    if (!redis || !candidateId) return;
    try { await redis.del(`cita_pending:${candidateId}`); } catch (_) {}
}
// ――― PIVOT_PENDING FLAG HELPERS ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// When Brenda sends the pivot tease ("tengo otra opción"), we set this flag.
// On the candidate’s NEXT message, if affirmative, we present the next vacancy
// directly WITHOUT running the LLM (avoiding the “no hay más vacantes” hallucination).
// cita_pending is CLEARED on pivot so the Ambiguity Guard doesn’t intercept the “Sí”.
const PIVOT_PENDING_TTL = 900; // 15 minutes
async function setPivotPendingFlag(redis, candidateId) {
    if (!redis || !candidateId) return;
    try { await redis.set(`pivot_pending:${candidateId}`, '1', 'EX', PIVOT_PENDING_TTL); } catch (_) {}
}
async function getPivotPendingFlag(redis, candidateId) {
    if (!redis || !candidateId) return false;
    try { return (await redis.get(`pivot_pending:${candidateId}`)) === '1'; } catch (_) { return false; }
}
async function clearPivotPendingFlag(redis, candidateId) {
    if (!redis || !candidateId) return;
    try { await redis.del(`pivot_pending:${candidateId}`); } catch (_) {}
}
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
async function getCTAIndex(redis, candidateId) {
    if (!redis || !candidateId) return 0;
    try { return parseInt((await redis.get(`cta_idx:${candidateId}`)) || '0'); } catch (_) { return 0; }
}
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
    text = text.replace(/\s{2,}/g, ' ').trim();

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

    // 🔧 DATE-EXAMPLE GUARD: Strip "(ej. DD/MM/YYYY)" from segments NOT about birth date (per-segment).
    {
        const _DATE_EJ_RE = /\s*\(ej\.?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\)/gi;
        const _DATE_KEYWORDS = /fecha|nacimiento|cumplea|cu[aá]ndo naciste|nac[íi]|d[íi]a.*mes|cuantos a[nñ]os/i;
        text = text.split('[MSG_SPLIT]').map(seg => _DATE_KEYWORDS.test(seg) ? seg : seg.replace(_DATE_EJ_RE, '')).join('[MSG_SPLIT]');
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
        text = text.replace(/^[^\w\n\r\[]*Primaria\b/gm,     '🎒 Primaria');
        text = text.replace(/^[^\w\n\r\[]*Secundaria\b/gm,   '🏫 Secundaria');
        text = text.replace(/^[^\w\n\r\[]*Preparatoria\b/gm, '🎓 Preparatoria');
        text = text.replace(/^[^\w\n\r\[]*Licenciatura\b/gm, '📚 Licenciatura');
        text = text.replace(/^[^\w\n\r\[]*T[eé]cnica\b/gm,   '🛠️ Técnica');
        text = text.replace(/^[^\w\n\r\[]*Posgrado\b/gm,     '🧠 Posgrado');
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
                const _before = text.substring(0, _idx).trimEnd();
                if (_before.length > 0 && !_before.endsWith('\n')) {
                    text = _before + '\n\n' + text.substring(_idx);
                    _pos = _before.length + 2;
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
            .replace(/\n{3,}/g, '\n')
            .trim();

        // Double newline before the FIRST escolaridad emoji (space between header and list)
        text = text.replace(/([^\n])\n(🎒|🏫|🎓|📚|🛠|🧠)/, '$1\n\n$2');

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
                // Inject first name before the closing ?
                if (candidateData?.nombreReal) {
                    const firstName = candidateData.nombreReal.trim().split(/\s+/)[0];
                    if (firstName && firstName.length > 1) {
                        question = question.replace(/(\?)([\s\p{Emoji}\s]*)$/u, (_, q, trail) => ` ${firstName}${q}${trail || ''}`);
                    }
                }
                text = `${beforeQ}[MSG_SPLIT]${question}`;
            }
        }
    } else if (asksAboutEsc) {
        // GPT asked but forgot the list — inject it before the closing question
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
    if (/✅/.test(text)) {
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

        // 4️⃣ Collapse triple+ newlines
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
                if (candidateData?.nombreReal) {
                    const firstName = candidateData.nombreReal.trim().split(/\s+/)[0];
                    if (firstName && firstName.length > 1) {
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

    // 🎂 FECHA DE NACIMIENTO: Inject example format if GPT forgot it
    // Only inject when ASKING for the date, not when confirming it was saved.
    if (/fecha de nacimiento|cu[aá]ndo naciste|d[ií]a de nacimiento/i.test(text)
        && !/(?:ej\.|ejemplo|DD\/|por ejemplo|\d{2}\/\d{2}\/\d{4})/i.test(text)
        && !/ya tengo|tengo tu|registr|anot[eéaó]|captur|guard[aáe]/i.test(text)
        && text.includes('?')) {
        // Append example cleanly after the text rather than interrupting the sentence
        text = text.trimEnd() + '\n(ej. 19/05/1983)';
    }


    // 📅 DATE LIST: Remove LEADING 📅 (before number emoji), KEEP/ADD TRAILING 📅 (after date)
    // Target format: "1️⃣ Miércoles 11 de Marzo 📅"
    // Step 1: strip any 📅 that appears right before a number emoji
    text = text.replace(/📅\s*(1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣)/g, '$1');
    // Step 2: for each date line that has a number emoji but no trailing 📅, add one
    text = text.replace(
        /^((1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣)\s+(?:Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado|Domingo)[^\n📅]*?)(?!\s*📅)\s*$/gm,
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
    if (!stepContext.isInicio && !text.includes('[MSG_SPLIT]') && !text.includes('\xbf')) {
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
    return text;
}
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_EXTRACTION_RULES = `
[EXTRAER]: nombreReal, genero, fechaNacimiento, edad, municipio, categoria, escolaridad.
1. REFINAR: Si el dato en [ESTADO] es incompleto, fusiónalo con el nuevo.
2. FORMATO: Nombres/Municipios en Title Case. Fecha DD/MM/YYYY.
3. ESCOLARIDAD: Primaria, Secundaria, Preparatoria, Licenciatura, Técnica, Posgrado.
4. EMPLEO: "Empleado" o "Desempleado".
5. CATEGORÍA: Solo de: {{categorias}}.
`;

export const DEFAULT_CEREBRO1_RULES = `
[FASE 1: TU MISIÓN PRINCIPAL - FLUJO DE CAPTURA]
Tu objetivo técnico es obtener: {{faltantes}}.

 REGLAS DE MISIÓN:
 1. CORTESÍA PROFESIONAL: Si el usuario dice "Sí", "Claro", "Te ayudo" o saluda, responde siempre de manera amable pero PROFESIONAL. Tienes ESTRICTAMENTE PROHIBIDO usar lenguaje coqueto o informal como "me chiveas" o "qué lindo". Eres una Licenciada en Recursos Humanos y debes mantener el respeto.
 2. NOMBRE COMPLETO: Si solo te da el nombre de pila sin apellidos, agradécele y pídele sus apellidos con amabilidad profesional para avanzar en su registro.
 3. CATEGORÍA: Si AÚN NO has mostrado la lista de categorías en este historial, muéstrala en formato vertical con ✅ y doble salto de línea entre cada opción. Si YA la mostraste (revisa el historial), TIENES PROHIBIDO repetirla completa — solo pregunta: "¿Cuál de las opciones que te compartí te interesa más?".
     ESTRUCTURA al mostrar por PRIMERA VEZ:
     "¡Perfecto! Mira, estas son las opciones que tengo para ti: 

     {{categorias}}

     ¿Cuál de estas opciones te interesa?"
 4. FORMATO ESCOLARIDAD: Cuando preguntes por el nivel de escolaridad, es ESTRICTAMENTE OBLIGATORIO que muestres las opciones en una lista VERTICAL con un emoji diferente y un DOBLE salto de línea (\n\n) entre cada opción (ej: 🎒 Primaria \n\n 🏫 Secundaria \n\n ...). ¡PROHIBIDO ponerlas en el mismo renglón separadas por comas!
 5. FECHA DE NACIMIENTO: Pídela SIEMPRE dando el ejemplo exacto: "(ej: 19/05/1990)". No lo olvides.
 5. DINÁMICA: Si responde algo que no sea el dato (ej: "No vivo ahí", "No sé"), SIEMPRE sé empática primero ("Entiendo perfectamente") y luego re-enfoca pidiendo el dato que falta o el siguiente.
 6. PERSUASIÓN (PREGUNTAS DE VACANTES/SUELDO/LUGAR/ENTREVISTAS): Cuando el candidato pregunta algo como "¿Dónde son?", "¿Cuándo son las entrevistas?", "¿Cuánto pagan?", DEBES: (a) Responder BREVEMENTE con algo real y positivo (ej: "Las entrevistas son en la zona metropolitana de Monterrey, te confirmamos la dirección exacta cuando completemos tu registro 😊"), y (b) Redirigir amablemente al dato faltante: {{faltantes}}. NUNCA ignores la pregunta ni la respondas con la lista de categorías en lugar de una respuesta real.
 7. ORDEN ESTRICTO: Siempre debes pedir el PRIMER dato de la lista de {{faltantes}}. ¡PROHIBIDO saltarte al segundo dato si el candidato evadió la pregunta o no respondió con el primero!
 8. LENGUAJE: PROHIBIDO decir "base de datos" o "robot". Di "nuestro sistema" o "tu registro en la plataforma".
 9. CORTESÍA INICIAL: Si te saluda, salúdalo de vuelta amablemente antes de pedir el dato.
 10. PREGUNTAS PERSONALES: Eres Brenda Rodríguez de Monterrey. Mantén siempre el perfil estrictamente profesional si preguntan cosas personales y regresa al tema de reclutamiento. PROHIBIDO DECIR QUE ERES UN BOT.`;

export const DEFAULT_SYSTEM_PROMPT = `
[PERSONALIDAD]:
Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. 
Eres carismática, profesional, coqueta y muy divertida. 
Hablas como una joven de oficina que usa su encanto para que los candidatos se sientan en confianza.
Usa emojis para hacerlo agradable y tierno, no uses los mismos siempre. No uses asteriscos (*).

[REGLAS DE ORO]:
- NUNCA REPITAS MENSAJES. Sé creativa, varía tus palabras.
- PERSUASIÓN (vacantes/entrevistas/empleo): Si el candidato pregunta por vacantes, sueldos, entrevistas, lugar o cualquier información de empleo Y el perfil está incompleto, responde de forma coherente y natural reconociendo la pregunta. Explica que para poder compartirle esa información personalizada, primero necesitas completar su registro. Luego redirige al dato faltante. NUNCA ignores la pregunta ni la respondas con la lista de categorías. Ejemplo: "Claro 😊, las vacantes son en la zona metropolitana de Monterrey. Para decirte exactamente cuál te conviene más, primero necesito que completemos tu registro. ¿Cuál categoría te interesa?"
- Si te ligan o halagan: Responde con picardía, gracia y mucha dulzura (ej: "¡Ay, qué lindo! 🤭✨ me chiveas"), pero re-enfoca a la extracción inmediatamente para no perder el tiempo.
- CURIOSIDAD DEL USUARIO: Si te preguntan si eres un bot, di que eres una persona real (reclutadora de 25 años viviendo en Monterrey). NUNCA admitas ser IA.
- MENSAJES CORTOS: Máximo 4 líneas.

[PROTOCOLO DE SALUDO (ALEATORIO)]:
Usa frases como: "¡Hola! 👋 Qué gusto saludarte", "¡Hola, hola! 👋 Soy la Lic. Brenda", "¡Qué tal! Por aquí la Lic. Brenda", "¡Mucho gusto! ✨". Varía siempre.

[REGLAS DE FORMATO]:
- PROHIBIDO USAR ASTERISCOS (*).
- No uses "Hola" en segundos mensajes, solo en el inicial.
- No hagas halagos personales (guapo, lindo, etc.).
- LISTAS VERTICALES: Categorías siempre una por renglón con ✅.
- FECHAS: Siempre usa el ejemplo (19/05/1990).
- NO digas "base de datos", di "tu registro" o "nuestro sistema".

- NOMBRES: NUNCA uses el municipio, ciudad, colonia o cualquier dato diferente al nombre como forma de dirigirte al candidato. Siempre usa su nombre real del [ESTADO]. Si aún no tienes su nombre, no uses ningún dato de reemplazo.
- CONFIRMACIÓN DE DATOS: Cuando el candidato te da un municipio/ciudad, confirma el dato con frases como "¡Perfecto, registrado! 🌟" o "Listo, anotado 😊" — NUNCA repitas como saludo el nombre de la ciudad.
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
        /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/,
        // DD/MM/YY (2-digit year)
        /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/,
    ];

    let day, month, year;
    let matched = false;

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

    // 2. Try Numeric Patterns
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
    const normalizedIn = normalizeBirthDate(incoming);
    if (normalizedIn.isValid) return normalizedIn.date;

    // If existing part exists and new part arrives (e.g. "25" then "Mayo")
    // For now, satisfy with normalization, but additive logic could go here
    return incoming;
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
    try {
        const redis = getRedisClient();

        // 1. Initial High-Speed Parallel Acquisition (Memory Boost: 40 messages)
        const configKeys = [
            'custom_fields',
            'bot_ia_prompt',
            'assistant_ia_prompt',
            'ai_config',
            'candidatic_categories',
            'bot_extraction_rules',
            'bot_cerebro1_rules',
            'bypass_enabled',
            'bot_ia_model'
        ];

        const [candidateData, config, allMessages, batchConfig] = await Promise.all([
            getCandidateById(candidateId),
            getUltraMsgConfig(),
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

        if (!candidateData) return 'ERROR: No se encontró al candidato';

        // 0. Initialize Candidate Updates accumulator
        const candidateUpdates = {
            lastBotMessageAt: new Date().toISOString(),
            ultimoMensaje: new Date().toISOString(),
            esNuevo: candidateData.esNuevo === 'SI' ? 'NO' : candidateData.esNuevo
        };

        let intent = 'UNKNOWN';
        let isNowComplete = false;

        // 🛡️ [BLOCK SHIELD]: Force silence if candidate is blocked
        if (candidateData.blocked === true) {
            return null;
        }

        // 🔄 [RE-ENGAGEMENT FLOW]: Intercept candidates who said NO INTERESA and message again
        {
            const reengageKey = `reengagement:${candidateId}`;
            const noInteresaMarkerKey = `noInteresa:${candidateId}`;
            const reengageState = await redis?.get(reengageKey);
            // isNoInteresa: reads a Redis marker set when the exit move fires (reliable, step-name agnostic)
            const noInteresaMarker = await redis?.get(noInteresaMarkerKey);
            const isNoInteresa = !!noInteresaMarker ||
                /no.?interesa/i.test(candidateData.status || '');

            const msgText = (typeof incomingMessage === 'string' ? incomingMessage : '').toLowerCase().trim();
            const saidYes = /\b(si|sí|yes|claro|dale|quiero|me interesa|por favor|ándale|andale|sip|órale|orale)\b/.test(msgText);
            const saidNo = /\b(no|nel|nope|paso|no gracias|no quiero|ahorita no|todavía no)\b/.test(msgText) && !saidYes;

            if (isNoInteresa || reengageState) {
                const firstName = getFirstName(candidateData.nombreReal) || 'candidato';

                if (reengageState === 'ASKED') {
                    if (saidYes) {
                        // ── Phase 2: Candidate said YES ──────────────────────────────────────
                        const vacancies = await getReengageVacancies(candidateData);
                        const config = await getUltraMsgConfig();
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
                            await new Promise(r => setTimeout(r, 1800));
                            await sendUltraMsgMessage(config.instanceId, config.token, phone, profileMsg, 'chat', { priority: 1 });
                            await saveMessage(candidateId, { from: 'bot', content: profileMsg, timestamp: new Date().toISOString() });

                            await redis?.set(reengageKey, 'CONFIRMING_PROFILE', 'EX', 604800);
                            return noVacMsg;
                        }

                        // Build list bubble
                        const _NUM_EMOJIS_RE = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
                        const listLines = vacancies.map((v, i) => {
                            const num = _NUM_EMOJIS_RE[i] || `${i+1}.`;
                            const company = v.company ? ` – ${v.company}` : '';
                            return `${num} ${v.name}${company}`;
                        }).join('\n');
                        const listMsg = `¡Claro que sí! Actualmente tenemos estas opciones disponibles:\n\n${listLines}`;
                        const ctaMsg = `¿Cuál te interesa ${firstName}?`;

                        await sendUltraMsgMessage(config.instanceId, config.token, phone, listMsg, 'chat', { priority: 0 });
                        await saveMessage(candidateId, { from: 'bot', content: listMsg, timestamp: new Date().toISOString() });
                        await new Promise(r => setTimeout(r, 1500));
                        await sendUltraMsgMessage(config.instanceId, config.token, phone, ctaMsg, 'chat', { priority: 1 });
                        await saveMessage(candidateId, { from: 'bot', content: ctaMsg, timestamp: new Date().toISOString() });

                        await redis?.set(reengageKey, 'SHOWING', 'EX', 604800);
                        return listMsg;

                    } else if (saidNo) {
                        // ── Phase 2b: Candidate said NO ─────────────────────────────────────
                        const config = await getUltraMsgConfig();
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
                        const config = await getUltraMsgConfig();
                        const closeMsg = `¡Perfecto ${firstName}! En cuanto llegue algo que se ajuste a tu perfil, ¡serás el primero en saberlo! 🌟 ¡Mucho éxito! 🍀`;
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, closeMsg, 'chat');
                        await saveMessage(candidateId, { from: 'bot', content: closeMsg, timestamp: new Date().toISOString() });
                        await redis?.del(reengageKey);
                        return closeMsg;
                    } else {
                        // Candidate wants to correct something → let GPT capture the new data,
                        // then on NEXT message we re-check vacancies
                        await redis?.set(reengageKey, 'RECHECK_VACANCIES', 'EX', 604800);
                        // Fall through to normal agent flow so GPT extracts and saves the correction
                    }

                } else if (reengageState === 'RECHECK_VACANCIES') {
                    // ── Phase 3b: After data was corrected, re-evaluate vacancies ────────
                    // candidateData is fresh (already updated by GPT in previous turn)
                    const vacancies = await getReengageVacancies(candidateData);
                    const config = await getUltraMsgConfig();
                    const phone = candidateData.whatsapp;

                    if (vacancies.length > 0) {
                        const _NUM_EMOJIS_R2 = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
                        const listLines2 = vacancies.map((v, i) => {
                            const num = _NUM_EMOJIS_R2[i] || `${i+1}.`;
                            const company = v.company ? ` – ${v.company}` : '';
                            return `${num} ${v.name}${company}`;
                        }).join('\n');
                        const goodNewsMsg = `¡Tengo buenas noticias ${firstName}! Con tus datos actualizados encontré estas opciones para ti:\n\n${listLines2}`;
                        const ctaMsg2 = `¿Cuál te interesa ${firstName}?`;

                        await sendUltraMsgMessage(config.instanceId, config.token, phone, goodNewsMsg, 'chat', { priority: 0 });
                        await saveMessage(candidateId, { from: 'bot', content: goodNewsMsg, timestamp: new Date().toISOString() });
                        await new Promise(r => setTimeout(r, 1500));
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

                    const config = await getUltraMsgConfig();
                    const phone = candidateData.whatsapp;
                    const ctaBubble = `¿Te gustaría conocer las vacantes que tenemos disponibles para ti?`;

                    await sendUltraMsgMessage(config.instanceId, config.token, phone, greetText, 'chat', { priority: 0 });
                    await saveMessage(candidateId, { from: 'bot', content: greetText, timestamp: new Date().toISOString() });
                    await new Promise(r => setTimeout(r, 2000));
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

            const isTranscriptionPrefix = textVal.includes('[AUDIO TRANSCRITO]') || textVal.includes('🎙️');
            const isInternalJson = isJson && (parsed.extracted_data || parsed.thought_process);

            if (textVal && textVal !== '{}' && !isTranscriptionPrefix && !isInternalJson) {
                userParts.push({ text: textVal });
                aggregatedText += (aggregatedText ? " | " : "") + textVal;
            }
        }

        if (userParts.length === 0) userParts.push({ text: 'Hola' });

        let recentHistory = validMessages
            .slice(-10) // Memory Boost: 10 messages of history (Optimized for Vercel Serverless latency)
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
        const secSinceLastBot = Math.floor((new Date() - lastBotMsgAt) / 1000);

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
        const isLongSilence = minSinceLastBot >= 5;
        const currentIsSilenced = candidateData.silencioActivo === true || candidateData.silencioActivo === 'true';

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
[SUFICIENCIA DE NOMBRE]: Si ya tienes un nombre y UN apellido, EL NOMBRE ESTÁ COMPLETO. No preguntes por más apellidos.`;
        }

        const identityContext = !isNameBoilerplate ? `Estás hablando con ${displayName}.` : 'No sabes el nombre del candidato aún. Pídelo amablemente.';
        systemInstruction += `\n[RECORDATORIO DE IDENTIDAD]: ${identityContext} NO confundas nombres con lugares geográficos.SI NO SABES EL NOMBRE REAL(Persona), NO LO INVENTES Y PREGÚNTALO.\n`;
        const currentMessageForGpt = {
            role: 'user',
            content: aggregatedText
        };

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
        let project = null;
        let activeStepNameLower = ''; // hoisted so delivery section can read it
        let recruiterTriggeredMove = false; // hoisted — used in final delivery safeguard (lines ~2789)
        let historyForGpt = [...recentHistory, currentMessageForGpt];

        if (activeProjectId) {
            // ⚡ FIX 1: Single parallel read — project data + cand_meta (was 2 sequential hgets for the same key)
            const redisForMeta = getRedisClient();
            const [projectResult, metaRawUnified] = await Promise.all([
                getProjectById(activeProjectId),
                redisForMeta ? redisForMeta.hget(`project:cand_meta:${activeProjectId}`, candidateId).catch(() => null) : Promise.resolve(null)
            ]);
            project = projectResult;

            // Single parse of metaRawUnified — used for both stepId and currentVacancyIndex
            let parsedMeta = null;
            try { if (metaRawUnified) parsedMeta = JSON.parse(metaRawUnified); } catch (_) { }

            if (parsedMeta?.stepId && parsedMeta.stepId !== 'step_new') {
                activeStepId = parsedMeta.stepId;
            }

            const currentStep = project?.steps?.find(s => s.id === activeStepId) || project?.steps?.[0];
            activeStepNameLower = (currentStep?.name || '').toLowerCase();

            // Active vacancy index — prefer project:cand_meta (most authoritative source)
            let currentIdx = parsedMeta?.currentVacancyIndex !== undefined
                ? parsedMeta.currentVacancyIndex
                : (candidateData.currentVacancyIndex !== undefined
                    ? candidateData.currentVacancyIndex
                    : (candidateData.projectMetadata?.currentVacancyIndex || 0));

            let activeVacancyId = null;
            if (project?.vacancyIds && project.vacancyIds.length > 0) {
                activeVacancyId = project.vacancyIds[Math.min(currentIdx, project.vacancyIds.length - 1)];
            } else if (project?.vacancyId) {
                activeVacancyId = project.vacancyId;
            }

            recruiterTriggeredMove = false; // reset per-call inside block

            // 🤫 NO INTERESA SILENCE + REACTIVATION
            const currentStepNameLower = (currentStep?.name || '').toLowerCase();
            const isNoInteresaStep = currentStepNameLower.includes('no interesa');

            if (isNoInteresaStep) {
                const FAREWELL_PATTERNS = /^(adiós|adios|hasta luego|bye|chao|gracias|ok gracias|okas|oks|hasta pronto|nos vemos|cuídate|cuidate|hasta la próxima|hasta la proxima|salud[o]?s?|saludos|buen[ao]s?\s+d[ií]as|buen[ao]s?\s+tarde|buen[ao]s?\s+noche|buenas|k|q|ok|👋|🙋|😊|graciass|graciaas)\s*[!.]*$/i;
                const REACTIVATION_YES = /^(s[ií]|claro|ok dale|dale|por fa|porfa|me interesa|s[ií] quiero|me gustar[íi]a|s[ií] por favor|adelante|ándale|andale|quiero|me interesa s[ií]|va|sale|si claro)\s*[!.]*$/i;

                const isFarewellMessage = FAREWELL_PATTERNS.test(aggregatedText.trim());
                const isReactivationYes = REACTIVATION_YES.test(aggregatedText.trim());
                // Vacancy question also triggers compact list (not just "Sí")
                const VACANCY_Q_RE = /(?:qu[eé]\s+vacantes?|qu[eé]\s+(?:opciones?|puestos?|trabajo|empleos?)\s+(?:tienen?|hay|tienen?|ofrecen?)|tienen?\s+vacantes?|hay\s+vacantes?)/i;
                const isVacancyQuestion = VACANCY_Q_RE.test(aggregatedText.trim());

                if (isFarewellMessage) {
                    console.error(`[RECRUITER BRAIN] No Interesa — farewell detected, staying silent for ${candidateId}`);
                    return; // Silent
                }

                if (isReactivationYes || isVacancyQuestion) {
                    console.error(`[RECRUITER BRAIN] No Interesa — candidate wants to see vacancies, running bypass match for ${candidateId}`);
                    try {
                        const candFirstName = (candidateData.nombreReal || candidateData.nombre || 'Claro').split(' ')[0];

                        // 1. Run bypass rules to find the best matching project
                        const { getActiveBypassRules, getProjects: getAllProjects } = await import('../utils/storage.js');
                        const allProjects = await getAllProjects();
                        const rules = await getActiveBypassRules();

                        let targetProject = null;

                        // Evaluate bypass rules (same logic as Orchestrator)
                        const normalizeStr = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
                        const cAge = parseInt(candidateData.edad);
                        const cGender = normalizeStr(candidateData.genero);
                        const cCat = normalizeStr(candidateData.categoria);
                        const cMun = normalizeStr(candidateData.municipio);
                        const cEsc = normalizeStr(candidateData.escolaridad);

                        for (const rule of rules) {
                            if (!isNaN(cAge)) {
                                if (rule.minAge && cAge < parseInt(rule.minAge)) continue;
                                if (rule.maxAge && cAge > parseInt(rule.maxAge)) continue;
                            }
                            const rGender = normalizeStr(rule.gender || 'Cualquiera');
                            if (rGender !== 'cualquiera' && cGender !== rGender) continue;

                            if (rule.categories?.length > 0) {
                                const catMatch = rule.categories.some(rc => { const r = normalizeStr(rc); return r.includes(cCat) || cCat.includes(r); });
                                if (!catMatch) continue;
                            }
                            if (rule.municipios?.length > 0) {
                                const munMatch = rule.municipios.some(rm => { const r = normalizeStr(rm); return r.includes(cMun) || cMun.includes(r); });
                                if (!munMatch) continue;
                            }
                            if (rule.escolaridades?.length > 0) {
                                const escMatch = rule.escolaridades.some(re => { const r = normalizeStr(re); return r.includes(cEsc) || cEsc.includes(r); });
                                if (!escMatch) continue;
                            }
                            targetProject = allProjects.find(p => p.id === rule.projectId) || null;
                            if (targetProject) break;
                        }

                        // Fallback to current project if no bypass match
                        if (!targetProject) targetProject = project;

                        const vacancyIds = targetProject?.vacancyIds || [];
                        if (!vacancyIds.length) {
                            await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp,
                                `¡Claro, ${candFirstName}! 😊 En este momento estamos actualizando nuestras vacantes. Te avisaré en cuanto tengamos algo nuevo. ¡Gracias por tu interés! 🌟`, 'chat');
                            return;
                        }

                        // 2. Build compact vacancy list: numbered with name + company + category
                        const NUM_LIST = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
                        const vacancyLines = [];
                        let vIdx = 0;
                        for (const vid of vacancyIds) {
                            const vac = await getVacancyById(vid);
                            if (!vac) continue;
                            const num = NUM_LIST[vIdx] || `${vIdx + 1}.`;
                            const line = `${num} ${vac.name}\n   🏢 ${vac.company || 'Candidatic'}${vac.category ? `\n   📂 ${vac.category}` : ''}`;
                            vacancyLines.push(line);
                            vIdx++;
                        }

                        if (!vacancyLines.length) {
                            await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp,
                                `¡Claro, ${candFirstName}! 😊 En este momento estamos actualizando nuestras vacantes. ¡Te avisaré en cuanto tengamos algo nuevo! 🌟`, 'chat');
                            return;
                        }

                        const listMsg = `¡Claro, ${candFirstName}! 🌟 Estas son nuestras vacantes disponibles:\n\n${vacancyLines.join('\n\n')}`;
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, listMsg, 'chat', { priority: 1 });
                        saveMessage(candidateId, { from: 'me', content: listMsg, timestamp: new Date().toISOString() }).catch(() => {});

                        // 3. Close with a hook
                        await new Promise(r => setTimeout(r, 700));
                        const closingMsg = `¿Alguna de estas opciones te llama la atención? 😊`;
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, closingMsg, 'chat', { priority: 1 });
                        saveMessage(candidateId, { from: 'me', content: closingMsg, timestamp: new Date().toISOString() }).catch(() => {});

                        // 4. Move candidate to first step of matched project to restart flow
                        const firstStep = targetProject.steps?.[0];
                        if (firstStep) {
                            await moveCandidateStep(targetProject.id, candidateId, firstStep.id);
                            await updateCandidate(candidateId, {
                                projectId: targetProject.id,
                                stepId: firstStep.id,
                                currentVacancyIndex: 0,
                                currentVacancyName: null
                            });
                        }
                    } catch (e) {
                        console.error('[RECRUITER BRAIN] Reactivation error:', e.message);
                    }
                    return;
                }
                // If not farewell and not a clear 'yes' — let the AI handle it (reactivation prompt)
            }

            if (currentStep?.aiConfig?.enabled && currentStep.aiConfig.prompt) {
                isRecruiterMode = true;
                const activeAiConfig = batchConfig.ai_config ? (typeof batchConfig.ai_config === 'string' ? JSON.parse(batchConfig.ai_config) : batchConfig.ai_config) : {};

                // --- MULTI-VACANCY REJECTION SHIELD ---
                let skipRecruiterInference = false;

                // ⚡ FIX 2: Run intent classifier IN PARALLEL with the recruiter LLM
                // We only need the result if the candidate rejected/pivoted — checked after both resolve
                const hasMultiVacancy = project.vacancyIds && project.vacancyIds.length > 0;
                const intentPromise = hasMultiVacancy
                    ? classifyIntent(candidateId, aggregatedText, historyForGpt.map(h => h.content || '').join('\n'))
                    : Promise.resolve('UNKNOWN');

                // intentPromise runs concurrently — resolved after recruiter call below
                // We resolve it NOW only when we need it for the rejection check
                intent = await intentPromise;

                if ((intent === 'REJECTION' || intent === 'PIVOT') && hasMultiVacancy) {
                    const isPivot = intent === 'PIVOT';
                    const currentIdx = candidateData.currentVacancyIndex || 0;

                    // ⚡ FIX 5: Extract rejection reason from candidate text directly — no extra GPT call
                    const words = aggregatedText.trim().split(/\s+/).slice(0, 6).join(' ');
                    const reason = words.length > 2 ? words : 'No le interesó';

                    const currentHist = candidateData.projectMetadata?.historialRechazos || [];
                    const activeVacId = project.vacancyIds[Math.min(currentIdx, project.vacancyIds.length - 1)];

                    if (!isPivot) {
                        // Only log formal rejection, not pivots
                        currentHist.push({ vacancyId: activeVacId, timestamp: new Date().toISOString(), motivo: reason });
                        candidateUpdates.historialRechazos = currentHist;
                        await recordVacancyInteraction(candidateId, project.id, activeVacId, 'REJECTED', reason);
                    }
                    candidateUpdates.currentVacancyIndex = currentIdx + 1;

                    // Fetch next vacancy name for real-time UI updates
                    if (project.vacancyIds[currentIdx + 1]) {
                        const nextVac = await getVacancyById(project.vacancyIds[currentIdx + 1]);
                        if (nextVac) candidateUpdates.currentVacancyName = nextVac.name;
                    }

                    await updateProjectCandidateMeta(project.id, candidateId, {
                        currentVacancyIndex: currentIdx + 1,
                        currentVacancyName: candidateUpdates.currentVacancyName
                    });

                    if (currentIdx + 1 >= project.vacancyIds.length) {
                        // All vacancies exhausted → fire move:exit
                        aiResult = {
                            thought_process: "ALL_VACANCIES_REJECTED { move: exit }",
                            response_text: null,
                            close_conversation: true,
                            reaction: '👍'
                        };
                        skipRecruiterInference = true;
                    } else {
                        // ✅ More vacancies available — send PIVOT message in two bubbles
                        // Bubble 1: empathic acknowledgement + tease of next vacancy
                        // Bubble 2: "¿Te gustaría conocerla?" — clear yes/no question, no ambiguity
                        const _PIVOT_MSGS = [
                            '¡Entendido, no hay problema! 😊 De hecho, tengo otra opción que podría interesarte más 👀✨',
                            '¡Está bien, lo entiendo! Pero espera... tengo otra vacante disponible que podría ser justo lo que buscas. 🌟',
                            '¡Sin problema! Curiosamente tengo otra posición disponible que puede encajarte mejor. 😊✨'
                        ];
                        const _pivotMsg = _PIVOT_MSGS[Math.floor(Math.random() * _PIVOT_MSGS.length)];
                        // Use sequential variant for Burbuja 2 (same counter as CTA)
                        const _pivotB2Idx = await getCTAIndex(redis, candidateId);
                        const _pivotB2 = _PIVOT_B2_VARIANTS[_pivotB2Idx % _PIVOT_B2_VARIANTS.length];
                        incrCTAIndex(redis, candidateId).catch(() => {}); // Advance counter
                        // Send both bubbles immediately, then skip the LLM this turn
                        responseTextVal = `${_pivotMsg}[MSG_SPLIT]${_pivotB2}`;
                        aiResult = {
                            thought_process: 'PIVOT_TO_NEXT_VACANCY — sent teaser, awaiting candidate confirmation',
                            response_text: responseTextVal,
                            close_conversation: false
                        };
                        skipRecruiterInference = true;
                        // ✅ Set pivot_pending so the next "Sí" presents the vacancy directly
                        // Clear cita_pending so Ambiguity Guard doesn’t intercept that "Sí"
                        await Promise.all([
                            setPivotPendingFlag(redis, candidateId),
                            clearCitaPendingFlag(redis, candidateId)
                        ]).catch(() => {});
                    }
                }

                // 🎟️ CITA-CONFIRMED FAREWELL GUARD: If the candidate already has a confirmed
                // appointment (citaFecha + citaHora) and sends a farewell/thanks message,
                // do NOT run the recruiter AI — it may return { move: exit } and wrongly
                // trigger the No Interesa flow. Just respond with a warm farewell.
                {
                    // 🎟️ CITA-CONFIRMED FAREWELL GUARD: If the candidate already has a confirmed
                    // appointment (citaFecha + citaHora) and sends a farewell/thanks message,
                    // do NOT run the recruiter AI — it may return { move: exit } and wrongly
                    // trigger the No Interesa flow. Just respond with a warm farewell.
                    const mdStr = candidateData.projectMetadata;
                    const parsedMd = (typeof mdStr === 'string' && mdStr.trim() !== '') ? JSON.parse(mdStr) : (mdStr || {});
                    const mergedMeta = { ...parsedMd, ...(candidateUpdates.projectMetadata || {}) };
                    // Also check the last bot messages as fallback (in case DB flush was async)
                    const lastBotHasCita = (lastBotMessages || []).some(m => /tu cita queda agendada|te esperamos el|agendada para el/i.test(m));
                    const hasCitaConfirmed = lastBotHasCita || (
                        mergedMeta?.citaFecha && mergedMeta?.citaHora
                        && mergedMeta.citaFecha !== 'null' && mergedMeta.citaHora !== 'null'
                    );
                    const FAREWELL_RE = /^(bye|adiós|adios|hasta luego|chao|gracias|ok gracias|graciass|hasta pronto|nos vemos|cuídate|cuidate|hasta la próxima|hasta la proxima|hasta pronto|👋|🙋|buen[ao]s?\s+d[ií]as|buen[ao]s?\s+tarde|buen[ao]s?\s+noche)\s*[!.?]*$/i;
                    if (hasCitaConfirmed && FAREWELL_RE.test(aggregatedText.trim())) {
                        const candFirstName = (candidateUpdates.nombreReal || candidateData.nombreReal || 'tú').split(' ')[0];
                        const humanCitaFecha = mergedMeta.citaFecha.includes('-')
                            ? (() => {
                                const p = mergedMeta.citaFecha.split('-');
                                if (p.length === 3) {
                                    const D = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
                                    const M = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
                                    const d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
                                    return `${D[d.getDay()]} ${d.getDate()} de ${M[d.getMonth()]}`;
                                }
                                return mergedMeta.citaFecha;
                            })()
                            : mergedMeta.citaFecha;
                        responseTextVal = `¡Hasta pronto, ${candFirstName}! 🌸 Recuerda que te esperamos el ${humanCitaFecha} a las ${mergedMeta.citaHora}. ¡Mucho éxito! 👋`;
                        skipRecruiterInference = true;
                    }
                }

                // 🩹 FAQ MUTE FIX: If the bot previously said "déjame consultarlo" and the user just says "Ok" or "Gracias", mute the AI
                const _lastBotMsg = historyForGpt.filter(h => h.role === 'assistant' || h.role === 'model').slice(-1)[0];
                // For FAQ MUTE FIX: only look at the very last message
                const _botText = (_lastBotMsg?.content || '').toLowerCase();
                // For CITA AFFIRMATIVE GUARD: scan LAST 3 bot messages (CTA question may be
                // before a media/PDF bubble that becomes the "last" assistant entry)
                const _recentBotText = historyForGpt
                    .filter(h => h.role === 'assistant' || h.role === 'model')
                    .slice(-3)
                    .map(h => (h.content || '').toLowerCase())
                    .join(' ');

                const _isJustThanksOrOk = /^(gracias|muchas gracias|mil gracias|perfecto|ok|okay|vale|gracias a ti|excelente|va|si|sí)\s*$/i.test(aggregatedText.trim().replace(/[^\w\sñáéíóúü]/gi, ''));
                if (_botText.includes('déjame consultarlo') && _isJustThanksOrOk) {
                    skipRecruiterInference = true;
                    responseTextVal = "";
                }

                // 🔀 PIVOT PENDING GUARD: If we just sent a tease about another vacancy and
                // the candidate says "Sí", bypass LLM confusion and inject a forced context
                // so the recruiter presents the next vacancy immediately.
                if (!skipRecruiterInference) {
                    const _isPivotPending = await getPivotPendingFlag(redis, candidateId);
                    if (_isPivotPending) {
                        const _isAffirmativePivot = /^(s[ií]|claro|dale|ok|va|sí quiero|si quiero|me interesa|por favor|porfa|adelante|quiero saber|dime|cuéntame|cuentame|muéstramela|muestramela|cual es|que vacante)/i.test(aggregatedText.trim());
                        const _isNegativePivot = /^(no|no gracias|ya no|no quiero|no me interesa|no ma)/i.test(aggregatedText.trim());

                        if (_isAffirmativePivot) {
                            // Candidate confirmed — present next vacancy. Clear flag and let LLM run
                            // BUT with a system note that forces presentation of the new vacancy.
                            await clearPivotPendingFlag(redis, candidateId);
                            // 🛡️ PIVOT-CITA CONFLICT FIX: Also clear _citaPending so the downstream
                            // isFiltro+isUserAffirmative+_citaPending guard doesn't treat "sí" as
                            // scheduling acceptance and prematurely move the candidate to next step.
                            clearCitaPendingFlag(redis, candidateId).catch(() => {});
                            isHandlingPivot = true;
                            historyForGpt = [
                                ...historyForGpt.slice(0, -1),
                                {
                                    role: 'user',
                                    content: `[NUEVA VACANTE CONFIRMADA]: El candidato acaba de aceptar ver la siguiente vacante disponible. OBLIGATORIO: Preséntale la vacante actual completa (nombre, empresa, sueldo, horario, beneficios) y pregúntale si le interesa. NO menciones la vacante anterior. Actúa como si fuera la primera vez que le presentas esta vacante.`
                                }
                            ];
                            console.log(`[PIVOT GUARD] ✅ Candidate confirmed next vacancy. Forcing presentation.`);
                        } else if (_isNegativePivot) {
                            // Candidate rejected pivot — clear flag, let exit flow handle it
                            await clearPivotPendingFlag(redis, candidateId);
                            console.log(`[PIVOT GUARD] ❌ Candidate rejected pivot.`);
                        } else {
                            // Unclear — keep pivot_pending, let LLM handle, inject note
                            historyForGpt = [
                                ...historyForGpt.slice(0, -1),
                                {
                                    role: 'user',
                                    content: `[CONTEXTO PIVOT]: Brenda ofreció mostrar una nueva vacante disponible. El candidato respondió: "${aggregatedText}". Si la respuesta es afirmativa, preséntale la vacante actual. Si es negativa, despídete amablemente.`
                                }
                            ];
                        }
                    }
                }

                // ═══════════════════════════════════════════════════════════════════
                // 🗓️ CITA AFFIRMATIVE GUARD (RESTORED — original working behavior)
                // When bot offered to schedule AND candidate affirms → inject confirmation
                // context so GPT fires { move } to Cita step. This worked for weeks.
                // Extended regex covers ALL scheduling verbs Brenda might use.
                // ═══════════════════════════════════════════════════════════════════
                const _todayStrCs = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Monterrey' });

                // Detect scheduling offer — covers agende, programe, confirme, reserve, aparte + cita/entrevista
                const _botAskedCita = /\b(?:agendar(?:te)?|programar(?:te)?|confirmar(?:te)?|reservar(?:te)?|apartar(?:te)?|agend[eo]|program[eo]|confirm[eo]|reserv[eo]|aparto)\b.*\b(?:cita|entrevista)\b|\b(?:cita|entrevista)\b.*\b(?:agendar(?:te)?|programar(?:te)?|confirmar(?:te)?|reservar(?:te)?|apartar(?:te)?|agend[eo]|program[eo]|confirm[eo]|reserv[eo]|aparto)\b/i.test(_recentBotText)
                    && !/queda\s+bien\s+ese\s+d[ií]a|cu[aá]l\s+(?:te\s+)?(?:queda\s+mejor|prefer|hora)|a\s+qu[eé]\s+hora|qu[eé]\s+hora\s+prefer/i.test(_recentBotText);

                const _isAffirmativeCs = /^(s[ií]|claro|dale|por\s*favor|porfa|por\s*fa|[aá]ndale|andale|v[aá]|adelante|ok\s*dale|sale|va|quiero|me\s+interesa|s[ií]\s+quiero|perfecto|s[ií]\s+por\s+favor|de\s+una|obvio|claro\s+que\s+s[ií]|s[ií]\s+claro|si\s+quiero)\s*[!.]*$/i.test(aggregatedText.trim());

                // Solo aplicar el GUARD si NO estamos ya mostrando el listado de días/horas de agenda
                // (evita robar respuestas cortas como 'claro' o 'si' cuando escoge opción)
                const _isAlreadyInCalendarSelection = /1️⃣/.test(_recentBotText);

                if (!skipRecruiterInference && !_isAlreadyInCalendarSelection && _botAskedCita && _isAffirmativeCs) {
                    // 🔑 DETERMINISTIC CITA MOVE: bypass GPT entirely.
                    // GPT in the INICIO step is unreliable at converting a 'sí' affirmation
                    // into a { move } — it often generates empty output or a clarification fallback.
                    // We set aiResult.thought_process = '{ move }' directly so hasMoveIntent fires.
                    skipRecruiterInference = true;
                    const _candFirst = (candidateData.nombreReal || '').trim().split(/\s+/)[0] || '';
                    responseTextVal = `\u00a1Perfecto${_candFirst ? `, ${_candFirst}` : ''}! Vamos a agendar tu cita de entrevista. \ud83c\udf1f`;
                    aiResult = {
                        response_text: responseTextVal,
                        thought_process: '{ move }',
                        extracted_data: {}
                    };
                }

                // ═══════════════════════════════════════════════════════════════════
                // 📅 CITA STEP RESOLVER: Deterministic day + time selection
                // Handles: numbers (1-6), ordinals (primero/último/penúltimo),
                //          day names (viernes → ambiguous → sub-list),
                //          hour selection for already-selected date.
                // Only runs in steps with future calendarOptions.
                // ═══════════════════════════════════════════════════════════════════
                const _stepHasFutureDatesForOpt = (currentStep.calendarOptions || []).some(opt => {
                    const m = opt.match(/^(\d{4}-\d{2}-\d{2})/);
                    return m && m[1] >= _todayStrCs;
                });

                if (!skipRecruiterInference && _stepHasFutureDatesForOpt) {
                    // 🔧 BURST FIX: When user sends multiple messages rapidly (e.g. "la opcion 4", "la uno", "sabado 21"),
                    // they are aggregated with newlines. We try each line individually for ordinal/day parsing.
                    const _rawInputFull = aggregatedText.trim().toLowerCase();
                    const _rawInputLines = _rawInputFull.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    const _rawInput = _rawInputLines[0] || _rawInputFull; // Use first line for primary parsing
                    const _futureDayOpts = (currentStep.calendarOptions || [])
                        .filter(o => { const m = o.match(/^(\d{4}-\d{2}-\d{2})/); return m && m[1] >= _todayStrCs; });
                    const _uDays = [...new Set(_futureDayOpts
                        .map(o => { const m = o.match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; })
                        .filter(Boolean)
                    )];
                    const _DN4 = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
                    const _MN4 = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
                    const _NE4 = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
                    const _fn4 = (candidateData.nombreReal || candidateData.nombre || '').split(' ')[0];

                    // ── Helper: parse user input as a 1-based list index ──────────────
                    const _parseOrdinal = (txt) => {
                        const _cleanTxt = txt.replace(/^(?:(?:el|la|los|las|opci[oó]n?)\s+)+/i, '').trim();
                        const _ordMap = {
                            'primer': 1, 'primero': 1, 'primera': 1, 'uno': 1, '1': 1,
                            'segundo': 2, 'segunda': 2, 'dos': 2, '2': 2,
                            'tercero': 3, 'tercera': 3, 'tres': 3, '3': 3,
                            'cuarto': 4, 'cuarta': 4, 'cuatro': 4, '4': 4,
                            'quinto': 5, 'quinta': 5, 'cinco': 5, '5': 5,
                            'sexto': 6, 'sexta': 6, 'seis': 6, '6': 6,
                            'séptimo': 7, 'séptima': 7, 'septimo': 7, 'septima': 7, 'siete': 7, '7': 7,
                            'octavo': 8, 'octava': 8, 'ocho': 8, '8': 8,
                            'noveno': 9, 'novena': 9, 'nueve': 9, '9': 9,
                        };
                        if (_ordMap[_cleanTxt] !== undefined) return _ordMap[_cleanTxt];
                        if (/^[uú]ltim[ao]?$/i.test(_cleanTxt)) return -1;   // last (m/f)
                        if (/^pen[uú]ltim[ao]?$/i.test(_cleanTxt)) return -2; // second to last (m/f)
                        const numMatch = _cleanTxt.match(/^(\d+)\.?$/);
                        if (numMatch) return parseInt(numMatch[1]);
                        return null;
                    };

                    // ── Helper: build hour list for a given date ─────────────────────
                    const _buildHourList = (dateStr, fname) => {
                        const _hours = _futureDayOpts
                            .filter(o => o.startsWith(dateStr))
                            .map(o => o.replace(dateStr, '').replace(/^\s*@\s*/, '').trim())
                            .filter(h => h.length > 0)
                            .sort((a, b) => {
                                // Sort by actual time value, not alphabetically
                                const toMin = t => { const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i); if (!m) return 0; let [,h,min,ap] = m; h=parseInt(h); if(ap?.toUpperCase()==='PM'&&h!==12) h+=12; if(ap?.toUpperCase()==='AM'&&h===12) h=0; return h*60+parseInt(min); };
                                return toMin(a) - toMin(b);
                            });
                        const _d = new Date(parseInt(dateStr.substr(0,4)), parseInt(dateStr.substr(5,2))-1, parseInt(dateStr.substr(8,2)));
                        const _humanDate = `${_DN4[_d.getDay()]} ${_d.getDate()} de ${_MN4[_d.getMonth()]}`;
                        if (_hours.length === 0) return null; // No hours configured — let GPT handle

                        const _hourLines = _hours.map((h, i) => `${_NE4[i] || `${i+1}.`} ${h} ⏰`).join('\n');
                        return `${fname ? `${fname}, estos` : 'Estos'} son los horarios para el ${_humanDate}:\n\n${_hourLines}\n\n¿En cuál horario te queda mejor? 😊`;
                    };

                    // ── Helper: day-of-week from day name ────────────────────────────
                    const _parseDayName = (txt) => {
                        const _dayNames = {
                            'lun': 1, 'lunes': 1,
                            'mar': 2, 'martes': 2,
                            'mie': 3, 'mié': 3, 'miercoles': 3, 'miércoles': 3,
                            'jue': 4, 'jueves': 4,
                            'vie': 5, 'viernes': 5,
                            'sab': 6, 'sáb': 6, 'sabado': 6, 'sábado': 6,
                            'dom': 0, 'domingo': 0,
                        };
                        const _norm = txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
                        // Strip common noise prefixes directly
                        const _cleanTxt = _norm.replace(/^(?:(?:el|la|los|las|para|el dia|para el dia)\s+)+/i, '').trim();
                        
                        for (const [key, val] of Object.entries(_dayNames)) {
                            // Match if it's strictly the keyword, or starts with keyword + space/comma
                            if (_cleanTxt === key || _cleanTxt.startsWith(key + ' ') || _cleanTxt.startsWith(key + ',')) {
                                return val;
                            }
                        }
                        
                        // Fallback: search anywhere in string using word boundaries
                        for (const [key, val] of Object.entries(_dayNames)) {
                            if (new RegExp(`(?:^|\\s)${key}(?:\\s|$|,)`).test(_norm)) {
                                return val;
                            }
                        }
                        return null;
                    };

                    // ── State: has the candidate already selected a date? ────────────
                    // (Used by BRANCH B to avoid re-offering the day list when GPT already has citaFecha)
                    const _citaFechaStored = candidateData.projectMetadata?.citaFecha
                        || candidateUpdates.projectMetadata?.citaFecha;

                    // ── BRANCH A (PASO 4): Both date AND hour chosen → candidate is confirming ─
                    // When the user says anything affirmative ('claro señorita', 'sí', 'ok', 'dale', etc.)
                    // after seeing the "¿Estamos de acuerdo?" message, fire { move } deterministically.
                    const _citaHoraStoredPaso4 = candidateData.projectMetadata?.citaHora
                        || candidateUpdates.projectMetadata?.citaHora;

                    if (!skipRecruiterInference && _citaFechaStored && _citaHoraStoredPaso4) {
                        // Broad affirmation — covers formal, informal, and colloquial Spanish
                        const _isBroadAffirmation = /^[¡!]*\s*(s[ií]|ya|bueno|genial|entendido|enterado|chido|chida|e[cq]hale?|claro|dale|por\s*favor|porfa|por\s*fa|[aá]ndale|andale|v[aá]|adelante|ok\s*dale|sale|sale\s*y\s*vale|quiero|perfecto|de\s*acuerdo|est[aá]\s*bien|me\s*parece\s*bien|me\s*parece\s*perfecto|todo\s*bien|con\s+gusto|obvio|correcto|excelente|listo|confirmado|[aá]ndale\s+pues|s[ií]\s+claro|s[ií]\s+gracias|gracias|s[ií]\s+se[ñn]orita|claro\s+se[ñn]orita|s[ií]\s+se[ñn]or|claro\s+que\s+s[ií]|de\s+una|ok|va|va[aá]monos|👍|✅)\s*[!.¡]*$/i
                            .test(aggregatedText.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

                        if (_isBroadAffirmation) {
                            // Build human-readable date + hour for the final confirmation message
                            const _storedDateP4 = _citaFechaStored;
                            const _storedHourP4 = _citaHoraStoredPaso4;
                            const _selD4 = new Date(parseInt(_storedDateP4.substr(0,4)), parseInt(_storedDateP4.substr(5,2))-1, parseInt(_storedDateP4.substr(8,2)));
                            const _humanDateP4 = `${_DN4[_selD4.getDay()]} ${_selD4.getDate()} de ${_MN4[_selD4.getMonth()]}`;

                            skipRecruiterInference = true;
                            responseTextVal = `¡Perfecto${_fn4 ? `, ${_fn4}` : ''}! ✅ Tu cita queda agendada para el ${_humanDateP4} a las ${_storedHourP4}. ¡Te esperamos! 🌟`;
                            aiResult = {
                                response_text: responseTextVal,
                                extracted_data: { citaFecha: _storedDateP4, citaHora: _storedHourP4 },
                                thought_process: '{ move }'   // fires the step transition
                            };
                        }
                    }

                    // ── BRANCH A (PASO 2-3): Date IS chosen → candidate is picking an HOUR ────
                    // Deterministic resolver: map ordinal input to the exact time slot.
                    // This prevents GPT from skipping the PASO 3 confirmation and firing { move } prematurely.
                    if (!skipRecruiterInference && _citaFechaStored) {
                        // Get the sorted list of hours for the chosen date
                        const _storedDate = _citaFechaStored;
                        const _dateHours = (_futureDayOpts || [])
                            .filter(o => o.startsWith(_storedDate))
                            .map(o => o.replace(_storedDate, '').replace(/^\s*@\s*/, '').trim())
                            .filter(h => h.length > 0)
                            .sort((a, b) => {
                                const tf = t => { const m2 = t.match(/(\d+):(\d+)\s*(AM|PM)?/i); if (!m2) return 0; let hh=parseInt(m2[1]),mm2=parseInt(m2[2]),ap=(m2[3]||'').toUpperCase(); if(ap==='PM'&&hh!==12)hh+=12; if(ap==='AM'&&hh===12)hh=0; return hh*60+mm2; };
                                return tf(a) - tf(b);
                            });

                        // Check citaHora: if already stored, we're in PASO 3 (confirmation) — let GPT handle
                        const _citaHoraStored = candidateData.projectMetadata?.citaHora
                            || candidateUpdates.projectMetadata?.citaHora;

                        // Only intercept if we have hours for this date and no hour chosen yet
                        if (_dateHours.length > 0 && !_citaHoraStored) {
                            let _resolvedHourIdx = null;

                            // Try each burst line through ordinal parser
                            for (const _line of _rawInputLines) {
                                const _ordNum = _parseOrdinal(_line);
                                if (_ordNum !== null) {
                                    if (_ordNum === -1) _resolvedHourIdx = _dateHours.length - 1;
                                    else if (_ordNum === -2) _resolvedHourIdx = Math.max(0, _dateHours.length - 2);
                                    else if (_ordNum >= 1 && _ordNum <= _dateHours.length) _resolvedHourIdx = _ordNum - 1;
                                    if (_resolvedHourIdx !== null) break;
                                }
                            }

                            // Also try matching the raw time string (e.g. "03:00", "3pm", "las 3")
                            if (_resolvedHourIdx === null) {
                                for (const _line of _rawInputLines) {
                                    const _timeMatch = _line.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
                                    if (_timeMatch) {
                                        let _hh = parseInt(_timeMatch[1]);
                                        const _mm = parseInt(_timeMatch[2] || '0');
                                        const _ap = (_timeMatch[3] || '').toUpperCase();
                                        if (_ap === 'PM' && _hh !== 12) _hh += 12;
                                        if (_ap === 'AM' && _hh === 12) _hh = 0;
                                        const _inputMins = _hh * 60 + _mm;
                                        const tf = t => { const m2 = t.match(/(\d+):(\d+)\s*(AM|PM)?/i); if (!m2) return 0; let hh=parseInt(m2[1]),mm2=parseInt(m2[2]),ap=(m2[3]||'').toUpperCase(); if(ap==='PM'&&hh!==12)hh+=12; if(ap==='AM'&&hh===12)hh=0; return hh*60+mm2; };
                                        const _matchIdx = _dateHours.findIndex(h => Math.abs(tf(h) - _inputMins) <= 30);
                                        if (_matchIdx !== -1) { _resolvedHourIdx = _matchIdx; break; }
                                    }
                                }
                            }

                            if (_resolvedHourIdx !== null) {
                                // 🔥 DETERMINISTIC: Save citaHora + build confirmation message — SKIP GPT
                                const _chosenHour = _dateHours[_resolvedHourIdx];
                                if (!candidateUpdates.projectMetadata) candidateUpdates.projectMetadata = {};
                                candidateUpdates.projectMetadata.citaHora = _chosenHour;

                                // Build human-readable date for confirmation
                                const _selD2 = new Date(parseInt(_storedDate.substr(0,4)), parseInt(_storedDate.substr(5,2))-1, parseInt(_storedDate.substr(8,2)));
                                const _humanDate2 = `${_DN4[_selD2.getDay()]} ${_selD2.getDate()} de ${_MN4[_selD2.getMonth()]}`;

                                skipRecruiterInference = true;
                                responseTextVal = `Ok${_fn4 ? ` ${_fn4}` : ''}, entonces agendamos tu entrevista para el ${_humanDate2} a las ${_chosenHour}.[MSG_SPLIT]¿Estamos de acuerdo? 🤝`;
                                aiResult = {
                                    response_text: responseTextVal,
                                    extracted_data: { citaFecha: _storedDate, citaHora: _chosenHour },
                                    thought_process: 'CITA:deterministic_hour_confirmation'
                                };
                            }
                        }
                    }

                    // ── BRANCH B: No date chosen yet → candidate is picking a DAY ────
                    if (!skipRecruiterInference && !_citaFechaStored) {
                        let _resolvedDayIdx = null; // index in _uDays (0-based)

                        // 1) Try ordinal / number — iterate through burst lines
                        for (const _line of _rawInputLines) {
                            const _ordNum = _parseOrdinal(_line);
                            if (_ordNum !== null) {
                                if (_ordNum === -1) _resolvedDayIdx = _uDays.length - 1;
                                else if (_ordNum === -2) _resolvedDayIdx = Math.max(0, _uDays.length - 2);
                                else if (_ordNum >= 1 && _ordNum <= _uDays.length) _resolvedDayIdx = _ordNum - 1;
                                if (_resolvedDayIdx !== null) break;
                            }
                        }

                        // 2) Try day name (with optional number disambiguation)
                        if (_resolvedDayIdx === null) {
                            // Try each burst line for day name match
                            let _matchedLine = _rawInput;
                            let _dayOfWeek = null;
                            for (const _line of _rawInputLines) {
                                _dayOfWeek = _parseDayName(_line);
                                if (_dayOfWeek !== null) { _matchedLine = _line; break; }
                            }
                            if (_dayOfWeek !== null) {
                                const _matchingIdxs = _uDays
                                    .map((ds, i) => {
                                        const d = new Date(parseInt(ds.substr(0,4)), parseInt(ds.substr(5,2))-1, parseInt(ds.substr(8,2)));
                                        return d.getDay() === _dayOfWeek ? i : -1;
                                    })
                                    .filter(i => i !== -1);

                                if (_matchingIdxs.length === 1) {
                                    _resolvedDayIdx = _matchingIdxs[0];
                                } else if (_matchingIdxs.length > 1) {
                                    // Try to disambiguate by matching a day-of-month number in the input
                                    // e.g. "viernes 20" → find the Friday with date=20
                                    const _dayNumMatch = _matchedLine.match(/(\d{1,2})/);
                                    if (_dayNumMatch) {
                                        const _dayNum = parseInt(_dayNumMatch[1]);
                                        const _specificIdx = _matchingIdxs.find(dIdx => {
                                            const ds = _uDays[dIdx];
                                            const d = new Date(parseInt(ds.substr(0,4)), parseInt(ds.substr(5,2))-1, parseInt(ds.substr(8,2)));
                                            return d.getDate() === _dayNum;
                                        });
                                        if (_specificIdx !== undefined) {
                                            _resolvedDayIdx = _specificIdx;
                                        } else {
                                            // Still ambiguous — show sub-list
                                            skipRecruiterInference = true;
                                            const _dayNameLabel = _DN4[new Date(parseInt(_uDays[_matchingIdxs[0]].substr(0,4)), parseInt(_uDays[_matchingIdxs[0]].substr(5,2))-1, parseInt(_uDays[_matchingIdxs[0]].substr(8,2))).getDay()];
                                            const _subLines = _matchingIdxs.map((dIdx, i) => {
                                                const ds = _uDays[dIdx];
                                                const d = new Date(parseInt(ds.substr(0,4)), parseInt(ds.substr(5,2))-1, parseInt(ds.substr(8,2)));
                                                return `${_NE4[i] || `${i+1}.`} ${_DN4[d.getDay()]} ${d.getDate()} de ${_MN4[d.getMonth()]} 📅`;
                                            }).join('\n');
                                            responseTextVal = `Hay ${_matchingIdxs.length} ${_dayNameLabel.toLowerCase()}s disponibles${_fn4 ? `, ${_fn4}` : ''}. ¿Cuál de los dos?\n\n${_subLines}`;
                                            aiResult = { response_text: responseTextVal, extracted_data: {}, thought_process: 'CITA:ambiguous_day_name' };
                                        }
                                    } else {
                                        // No number — show sub-list
                                        skipRecruiterInference = true;
                                        const _dayNameLabel = _DN4[new Date(parseInt(_uDays[_matchingIdxs[0]].substr(0,4)), parseInt(_uDays[_matchingIdxs[0]].substr(5,2))-1, parseInt(_uDays[_matchingIdxs[0]].substr(8,2))).getDay()];
                                        const _subLines = _matchingIdxs.map((dIdx, i) => {
                                            const ds = _uDays[dIdx];
                                            const d = new Date(parseInt(ds.substr(0,4)), parseInt(ds.substr(5,2))-1, parseInt(ds.substr(8,2)));
                                            return `${_NE4[i] || `${i+1}.`} ${_DN4[d.getDay()]} ${d.getDate()} de ${_MN4[d.getMonth()]} 📅`;
                                        }).join('\n');
                                        responseTextVal = `Hay ${_matchingIdxs.length} ${_dayNameLabel.toLowerCase()}s disponibles${_fn4 ? `, ${_fn4}` : ''}. ¿Cuál de los dos?\n\n${_subLines}`;
                                        aiResult = { response_text: responseTextVal, extracted_data: {}, thought_process: 'CITA:ambiguous_day_name' };
                                    }
                                }
                            }
                        }

                        // 3) If resolved (unambiguous) → build response DETERMINISTICALLY
                        // We set skipRecruiterInference=true to avoid GPT call which can timeout.
                        if (_resolvedDayIdx !== null && !skipRecruiterInference) {
                            const _selDate = _uDays[_resolvedDayIdx];

                            // Save citaFecha deterministically regardless of what GPT returns
                            if (!candidateUpdates.projectMetadata) candidateUpdates.projectMetadata = {};
                            candidateUpdates.projectMetadata.citaFecha = _selDate;

                            // Build explicit hour list inline
                            const _selD = new Date(parseInt(_selDate.substr(0,4)), parseInt(_selDate.substr(5,2))-1, parseInt(_selDate.substr(8,2)));
                            const _humanSelDate = `${_DN4[_selD.getDay()]} ${_selD.getDate()} de ${_MN4[_selD.getMonth()]}`;
                            const _selHrs = (currentStep.calendarOptions || [])
                                .filter(o => o.startsWith(_selDate))
                                .map(o => o.replace(_selDate, '').replace(/^\s*@\s*/, '').trim())
                                .filter(h => h.length > 0)
                                .sort((a, b) => {
                                    const tf = t => { const m2 = t.match(/(\d+):(\d+)\s*(AM|PM)?/i); if (!m2) return 0; let hh=parseInt(m2[1]),mm2=parseInt(m2[2]),ap=m2[3]; if(ap?.toUpperCase()==='PM'&&hh!==12) hh+=12; if(ap?.toUpperCase()==='AM'&&hh===12) hh=0; return hh*60+mm2; };
                                    return tf(a) - tf(b);
                                });
                            const _hrsInjection = _selHrs.length > 0
                                ? _selHrs.map((h, i) => `${_NE4[i] || `${i+1}.`} ${h} ⏰`).join('\n')
                                : null;

                            if (_hrsInjection) {
                                // 🔥 DETERMINISTIC RESPONSE: Skip GPT entirely — build the hour list ourselves
                                skipRecruiterInference = true;
                                responseTextVal = `Perfecto${_fn4 ? `, ${_fn4}` : ''}, para el ${_humanSelDate} tengo estas opciones de horario:\n\n${_hrsInjection}[MSG_SPLIT]¿Cuál te queda mejor? 😊`;
                                aiResult = {
                                    response_text: responseTextVal,
                                    extracted_data: { citaFecha: _selDate },
                                    thought_process: 'CITA:deterministic_hour_selection'
                                };
                            } else {
                                // No hours found for this date — inject system message and let GPT handle
                                const _injMsg = `[SISTEMA INTERNO - ELECCIÓN DE DÍA CONFIRMADA]: El candidato eligió el ${_humanSelDate} (citaFecha: ${_selDate}). OBLIGATORIO: 1) Guarda citaFecha="${_selDate}" en extracted_data. 2) Muestra los horarios disponibles del sistema para esa fecha. ESTÁ ESTRICTAMENTE PROHIBIDO usar "unanswered_question" aquí.`;
                                historyForGpt = [
                                    ...historyForGpt.slice(0, -1),
                                    { role: 'user', content: _injMsg }
                                ];
                            }
                        }


                    }
                }




                if (!skipRecruiterInference) {
                    const updatedDataForAgent = { ...candidateData, ...candidateUpdates, projectMetadata: { ...candidateData.projectMetadata, ...(candidateUpdates.projectMetadata || {}), currentVacancyIndex: candidateUpdates.currentVacancyIndex !== undefined ? candidateUpdates.currentVacancyIndex : candidateData.projectMetadata?.currentVacancyIndex } };

                    // 🔄 VACANCY TRANSITION CONTEXT: If we just advanced to a new vacancy due to rejection,
                    // replace the rejection message in history with a system note so GPT doesn't
                    // apply the rejection to the NEW vacancy before even presenting it.
                    let historyForRecruiter = historyForGpt;
                    const vacancyJustAdvanced = candidateUpdates.currentVacancyIndex !== undefined
                        && candidateUpdates.currentVacancyIndex > (candidateData.currentVacancyIndex || 0);

                    if (vacancyJustAdvanced) {
                        const newIdx = candidateUpdates.currentVacancyIndex;
                        historyForRecruiter = [
                            ...historyForGpt.slice(0, -1), // Drop the rejection message
                            {
                                role: 'user',
                                content: `[SISTEMA INTERNO]: El candidato rechazó la vacante anterior.Ahora preséntale la siguiente vacante disponible(índice ${newIdx}).Es la primera vez que la ve.NO asumas que la rechaza — apreséntatela con entusiasmo y espera su respuesta.`
                            }
                        ];
                    }

                    // ⚡ PERFORMANCE OPTIMIZATION: Filter out purely extraction-phase bot messages 
                    // and limit history to the last 10 messages so GPT isn't overwhelmed by 40+ messages.
                    historyForRecruiter = historyForRecruiter.filter(m => {
                        if (m.role === 'model' || m.role === 'assistant') {
                            const txt = m.content || '';
                            // Extraction phase signature: bot asking for specific fields with system labels
                            if (txt.includes('[EXTRACCIÓN GLOBAL]') || txt.includes('Cerebro Extractor')) return false;
                        }
                        return true;
                    }).slice(-10);

                    try {
                        aiResult = await processRecruiterMessage(
                            updatedDataForAgent,
                            project,
                            currentStep,
                            historyForRecruiter,
                            config,
                            activeAiConfig.openaiApiKey,
                            currentIdx
                        );
                    } catch (_recErr) {
                        console.error('[RECRUITER] Error on message, using radar fallback:', _recErr.message);
                        // Soft fallback: respond as radar-de-dudas instead of showing 'Disculpa!'
                        responseTextVal = 'Es una excelente pregunta, déjame consultarlo con el equipo de recursos humanos para darte el dato exacto y no quedarte mal. ✨';
                        aiResult = { response_text: responseTextVal, extracted_data: {}, thought_process: 'FALLBACK:recruiter_error' };
                    }

                    if (aiResult?.response_text) {
                        // 🧹 Strip leaked unanswered_question text
                        responseTextVal = aiResult.response_text
                            .replace(/\n?unanswered_question:\s*.+/gi, '')
                            .replace(/\n?\"unanswered_question\":\s*\".+\"/gi, '')
                            .trim();
                        // 📐 Apply shared formatter (hours format, ✅ list normalization)
                        const _isInicioPasoFmt = /filtro|inicio|contacto/i.test(activeStepNameLower);
                        // Read sequential CTA index for this turn (incremented at delivery)
                        const _ctaVariantIdxFmt = await getCTAIndex(redis, candidateId);
                        responseTextVal = formatRecruiterMessage(responseTextVal, candidateData, { isInicio: _isInicioPasoFmt, ctaVariantIdx: _ctaVariantIdxFmt });
                        aiResult.response_text = responseTextVal;

                    }

                    // 🧠 EXTRACTION SYNC (RECRUITER MODE)
                    // If OpenAI extracted data during a project step, merge it.
                    if (aiResult?.extracted_data) {
                        const { categoria, municipio, escolaridad, citaFecha, citaHora } = aiResult.extracted_data;
                        if (categoria) candidateUpdates.categoria = categoria;
                        if (municipio) candidateUpdates.municipio = municipio;
                        if (escolaridad) candidateUpdates.escolaridad = escolaridad;

                        // Calendario / Agenda (Guardar en projectMetadata)
                        if (citaFecha || citaHora) {
                            if (!candidateUpdates.projectMetadata) {
                                candidateUpdates.projectMetadata = { ...(candidateData.projectMetadata || {}) };
                            }
                            if (citaFecha && citaFecha !== 'null' && citaFecha !== 'N/A') candidateUpdates.projectMetadata.citaFecha = citaFecha;
                            if (citaHora && citaHora !== 'null' && citaHora !== 'N/A') candidateUpdates.projectMetadata.citaHora = citaHora;
                        }

                    }

                    const rawUQ = aiResult?.unanswered_question;
                    const unansweredQ = rawUQ && rawUQ !== 'null' && rawUQ !== 'undefined' && String(rawUQ).trim().length > 3
                        ? String(rawUQ).trim() : null;

                    // 🛡️ RADAR GUARD: AI set unanswered_question but forgot the response_text.
                    // Enforce the exact fallback text defined in RECRUITER_IDENTITY so the bot
                    // never goes silent on a question — keeps conversation open without presupposing any next step.
                    // ONLY enforce if it also failed to provide a valid media_url.
                    const hasMediaInsideRadar = aiResult?.media_url && aiResult.media_url !== 'null';
                    if (unansweredQ && !responseTextVal && !hasMediaInsideRadar) {
                        const _isInicioPasoRadar = /filtro|inicio|contacto/i.test(activeStepNameLower);
                        responseTextVal = 'Es una excelente pregunta, déjame consultarlo con el equipo de recursos humanos para darte el dato exacto y no quedarte mal. ✨';
                        // 🎯 Capa 2: Fallback in Inicio step ALWAYS carries CTA in separate bubble
                        if (_isInicioPasoRadar) {
                            responseTextVal += '[MSG_SPLIT]¿Te gustaría agendar tu entrevista? 😊';
                        }
                        aiResult.response_text = responseTextVal;
                    }

                    // 🔄 RECALCULATE activeVacancyId: if we just rotated to a new vacancy this turn,
                    // use the NEW index so questions are filed under the correct vacancy
                    if (candidateUpdates.currentVacancyIndex !== undefined && project?.vacancyIds?.length > 0) {
                        const updatedIdx = candidateUpdates.currentVacancyIndex;
                        const safeUpdatedIdx = Math.min(updatedIdx, project.vacancyIds.length - 1);
                        activeVacancyId = project.vacancyIds[safeUpdatedIdx];
                    }

                    // 🎯 FAQ RADAR: Save to FAQ engine regardless — unanswered OR answered
                    const openAiKey = activeAiConfig.openaiApiKey || process.env.OPENAI_API_KEY;
                    if (activeVacancyId && openAiKey) {
                        if (unansweredQ) {
                            await recordAITelemetry(candidateId, 'faq_detected', { vacancyId: activeVacancyId, question: unansweredQ });
                            processUnansweredQuestion(activeVacancyId, unansweredQ, responseTextVal, openAiKey)
                                .catch(() => { });
                        } else {
                            const lastUserMsg = historyForGpt.filter(h => h.role === 'user').slice(-1)[0];
                            let userText = lastUserMsg?.content || '';
                            
                            // Clean system markers from userText (e.g. [CONTEXTO PIVOT], [SISTEMA INTERNO])
                            userText = userText.replace(/\[.*?\]:\s*/g, '');
                            userText = userText.replace(/Brenda ofreció.*?: /i, '');
                            userText = userText.replace(/^"|"$/g, '');
                            
                            try {
                                const parsed = JSON.parse(userText);
                                if (parsed && parsed.text) userText = parsed.text;
                            } catch (e) {
                                // sometimes it's double stringified
                                try {
                                    const doubleParsed = JSON.parse(JSON.parse(`"${userText}"`));
                                    if (doubleParsed && doubleParsed.text) userText = doubleParsed.text;
                                } catch (e2) { /* ignore, it's raw text */ }
                            }

                            const questionPatterns = /[?¿]|cuál|cómo|cuánto|cuándo|dónde|qué|quién|hacen|tienen|hay|incluye|\bes\b|\bson\b|dan|pagan|trabaj|horario|sueldo|salario|uniforme|transporte|beneficio|requisito|antidop/i;
                            const isQuestion = questionPatterns.test(userText) && userText.length > 5;
                            if (isQuestion && responseTextVal) {
                                processUnansweredQuestion(activeVacancyId, userText, responseTextVal, openAiKey)

                                    .catch(() => { });
                            }
                        }
                    } else {
                    }
                }

                // ⚡ ROBUST MOVE TAG DETECTION WITH PAYLOAD PARSING
                // Attempt to parse advanced JSON-like tags: { move: "Citados", setDate: "Lunes", setTime: "10:00" }
                // Or fallback to classic: { move } / { move: exit }
                // Notice the ".*?" is optional so that `{ move }` works
                const tpValue = aiResult?.thought_process || '';
                const rtValue = aiResult?.response_text || '';
                const advanceBracketsMatch = tpValue.match(/[\{\[]\s*(move.*?)[\}\]]/is) ||
                    rtValue.match(/[\{\[]\s*(move.*?)[\}\]]/is);

                let hasMoveTag = false;
                let hasExitTag = false;
                let extractedMoveTarget = null;

                if (advanceBracketsMatch && advanceBracketsMatch[0]) {
                    hasMoveTag = true;

                    // 🚫 QUERY FIREWALL (Capa 0 — runs before anything else)
                    // In Filtro/Inicio steps, a QUERY must NEVER advance the step.
                    // A question is a question whether it has ¿? or not.
                    // The AI sometimes hallucinates { move } when a candidate asks about the interview.
                    const _firewallStepName = (currentStep?.name || '').toLowerCase();
                    const _isInicioPasoFirewall = /filtro|inicio|contacto/i.test(_firewallStepName);
                    // 🛡️ MUTE FIX: Do not run firewall if `skipRecruiterInference` is strictly true
                    // This protects deterministic { move } injections (like Affirmative Guard) from being blocked
                    if (_isInicioPasoFirewall && !hasExitTag && !skipRecruiterInference) {
                        // Guard 1: Intent classifier already said QUERY
                        const _isQueryIntent = intent === 'QUERY';
                        // Guard 2: Message contains question words even without punctuation
                        const _hasQuestionWords = /\?|¿|cu[aá]ndo|c[oó]mo|d[oó]nde|me llevan|cu[aá]l|tienen|hay\s|aceptan|puedo|pueden|dan\s|pagan|dan\s|necesito|requisitos|trabaj[a-z]|queda\s|es\s+.*\?/i.test(aggregatedText.trim())
                            && !/^(s[ií]|claro|dale|ok|va|adelante|perfecto|excelente|me interesa|si quiero|quiero|obvio)/i.test(aggregatedText.trim());
                        if (_isQueryIntent || _hasQuestionWords) {
                            hasMoveTag = false; // 🛑 NOT an acceptance — it's a question
                            console.log(`[QUERY FIREWALL] Blocked false-positive move in Inicio step. intent=${intent}, msg="${aggregatedText.substring(0, 60)}"`);
                        }
                    }
                    // Keep just the string `{ move }` or `{ move: exit }`
                    const innerContent = advanceBracketsMatch[0];

                    // If it specifically says exit or no_interesa
                    if (/move:\s*(exit|no_interesa|no interesa)/i.test(innerContent)) {
                        hasExitTag = true;
                    }

                    // Try to extract setDate / setTime using loose Regex (JSON.parse often fails on LLM output)
                    const dateMatch = innerContent.match(/setDate:\s*["']([^"']+)["']/i);
                    const timeMatch = innerContent.match(/setTime:\s*["']([^"']+)["']/i);
                    // Match `move: "Cita"` or `move: 'Cita'` or even `move: Cita` WITHOUT QUOTES
                    const specificMoveMatch = innerContent.match(/move:\s*["']?([^"'\s}]+)["']?/i);

                    if (specificMoveMatch && specificMoveMatch[1]) {
                        extractedMoveTarget = specificMoveMatch[1].trim();
                        // Auto-detect if target was exit
                        if (extractedMoveTarget.toLowerCase().includes('no interesa') || extractedMoveTarget.toLowerCase() === 'exit') {
                            hasExitTag = true;
                        }
                    }

                    // 🛡️ FALSE REJECTION SHIELD: If they are in "Citados", ignore exit triggers caused by a simple "gracias" or positive sentiment
                    if (hasExitTag) {
                        const originStepNameExit = (currentStep?.name || '').toLowerCase();
                        if (originStepNameExit.includes('citado')) {
                            const isJustThanksOrOk = /^(gracias|muchas gracias|mil gracias|perfecto|ok|okay|vale|gracias a ti|excelente|va|si|sí)\s*$/i.test(aggregatedText.trim().replace(/[^\w\sñáéíóúü]/gi, ''));
                            if (isJustThanksOrOk) {
                                hasExitTag = false;
                                extractedMoveTarget = null;
                            }
                        }
                    }

                    if (dateMatch || timeMatch) {
                        if (!candidateUpdates.projectMetadata) {
                            candidateUpdates.projectMetadata = { ...candidateData.projectMetadata };
                        }
                        if (dateMatch && dateMatch[1]) candidateUpdates.projectMetadata.citaFecha = dateMatch[1].trim();
                        if (timeMatch && timeMatch[1]) candidateUpdates.projectMetadata.citaHora = timeMatch[1].trim();
                    }
                }

                // 🛡️ CONTEXTUAL SAFETY TRIGGER — META GRADE
                // isFiltro moves ONLY when cita_pending flag is confirmed in Redis.
                // This prevents any ambient "Sí" from prematurely advancing the step.
                let inferredAcceptance = false;
                if (!hasMoveTag) {
                    const lastBotMsg = historyForGpt.filter(h => h.role === 'assistant' || h.role === 'model').slice(-1)[0];
                    const botText = (lastBotMsg?.content || '').toLowerCase();
                    const isInterviewInvite = /agendar|agendamos|te queda bien|estamos de acuerdo|agendo una cita|aparte un lugar|avanzamos con tu cita|te confirmo tu cita/i.test(botText);

                    const isUserAffirmative = /^(si|sí|claro|por supuesto|obvio|va|dale|ok|okay|sipi|simon|simón|me parece bien|está bien|perfecto|excelente|adelante)/i.test(aggregatedText.trim());

                    const originStepName = (currentStep?.name || '').toLowerCase();
                    const isFiltro = originStepName.includes('filtro') || originStepName.includes('inicio') || originStepName.includes('contacto');
                    const isCitadosStep = originStepName.includes('citado');

                    // 🔑 Capa 4: Read cita_pending from Redis
                    const _citaPending = await getCitaPendingFlag(redis, candidateId);

                    if (isInterviewInvite && (intent === 'ACCEPTANCE' || isUserAffirmative) && _citaPending) {
                        // Clear the flag — confirmed
                        clearCitaPendingFlag(redis, candidateId).catch(() => {});
                        hasMoveTag = true;
                        inferredAcceptance = true;
                    } else if (isFiltro && isUserAffirmative && _citaPending) {
                        // 🛡️ PIVOT GUARD: If the last bot message was offering a new vacancy pivot,
                        // the candidate's "sí" is for SEEING the vacancy — NOT for scheduling.
                        // Block the premature move and let the LLM present the new vacancy instead.
                        const _lastBotWasPivot = /te gustar[ií]a conocerla|quieres conocerla|conocer la vacante|Te la presento|cuent[ae] de ella|conocer esta opci[oó]n|saber m[aá]s|te interesa conocer/i.test(botText);
                        if (!_lastBotWasPivot) {
                            // Candidate explicitly confirmed after seeing the CTA
                            clearCitaPendingFlag(redis, candidateId).catch(() => {});
                            hasMoveTag = true;
                            inferredAcceptance = true;
                        }
                    } else if (isFiltro && isUserAffirmative && !_citaPending && !hasMoveTag) {
                        // 🎯 Capa 5: DIRECT TRANSITION — candidate said Sí but we never sent the CTA yet
                        // Or the Redis flag expired/missed. We completely trust the 'Sí' and move to Cita.
                        // ⛔ PIVOT EXCEPTION: If the last bot message was asking about a new vacancy
                        // ("¿Te gustaría conocerla?"), the Sí is clearly about seeing the vacancy —
                        // not scheduling. Let the LLM response go through untouched.
                        const _isPivotContext = /te gustar[ií]a conocerla|quieres conocerla|conocer la vacante|conocerla\?|te la presento|cuente de ella|conocer esta opci[oó]n|saber m[aá]s/i.test(botText);
                        if (!_isPivotContext) {
                            // Automatically skip the "Solo por confirmar" redundancy and infer acceptance
                            hasMoveTag = true;
                            extractedMoveTarget = 'Cita';
                            inferredAcceptance = true;
                        }
                    }

                    // 🎯 CITADOS RETRACTION ACCEPTANCE: If in Citados and bot offered a new vacancy
                    // and candidate said Sí → move to Cita step
                    if (!hasMoveTag && isCitadosStep && isUserAffirmative && isInterviewInvite) {
                        hasMoveTag = true;
                        extractedMoveTarget = 'Cita';
                        inferredAcceptance = true;
                    }

                    // Check THIS bot text for confirmation of appointment
                    const thisBotText = (aiResult?.response_text || '').toLowerCase();
                    let isCitaConfirmation = thisBotText.includes('queda agendada') ||
                        thisBotText.includes('entrevista agendada') ||
                        thisBotText.includes('confirmada tu entrevista');

                    if (!hasMoveTag && isCitaConfirmation) {
                        hasMoveTag = true;
                        extractedMoveTarget = "Citados";
                        inferredAcceptance = true;

                        // Attempt to extract date and time from the text as fallback
                        const dateRegex = /(?:para el|el d[íi]a)\s+([a-zA-Z0-9\s]+?)\s+a\s+las/i;
                        const timeRegex = /a\s+las\s+([0-9:]+\s*(?:AM|PM|am|pm|hrs))/i;

                        const textDateMatch = aiResult?.response_text?.match(dateRegex);
                        const textTimeMatch = aiResult?.response_text?.match(timeRegex);

                        if (textDateMatch || textTimeMatch) {
                            if (!candidateUpdates.projectMetadata) {
                                candidateUpdates.projectMetadata = { ...(candidateData.projectMetadata || {}) };
                            }
                            if (textDateMatch) candidateUpdates.projectMetadata.citaFecha = textDateMatch[1].trim();
                            if (textTimeMatch) candidateUpdates.projectMetadata.citaHora = textTimeMatch[1].trim();

                        }
                    }
                }

                // 🛡️ [CITA STEP SAFEGUARD & CALENDAR RENDERER]
                const isCitaStep = (currentStep?.name || '').toLowerCase().includes('cita');
                if (isCitaStep && !hasExitTag) {
                    const mergedMeta = { ...(candidateData.projectMetadata || {}), ...(candidateUpdates.projectMetadata || {}) };

                    // Fallback to extract from historical context if somehow lost
                    if (!mergedMeta.citaFecha || !mergedMeta.citaHora || mergedMeta.citaFecha === 'null' || mergedMeta.citaHora === 'null') {
                        const allContext = historyForGpt.map(h => typeof h.content === 'string' ? h.content : JSON.stringify(h.content)).join(' ');
                        const dateFallback = allContext.match(/(?:para el|el d[íi]a)\s+([a-zA-Z0-9\s]+?)\s+a\s+las/i);
                        const timeFallback = allContext.match(/a\s+las\s+([0-9:]+\s*(?:AM|PM|am|pm|hrs))/i);
                        if (dateFallback && !mergedMeta.citaFecha) mergedMeta.citaFecha = dateFallback[1].trim();
                        if (timeFallback && !mergedMeta.citaHora) mergedMeta.citaHora = timeFallback[1].trim();

                        if (dateFallback || timeFallback) {
                            candidateUpdates.projectMetadata = mergedMeta;
                        }
                    }

                    const isInvalidFecha = !mergedMeta.citaFecha || mergedMeta.citaFecha === 'null' || String(mergedMeta.citaFecha).includes('YYYY') || String(mergedMeta.citaFecha).includes('N/A');
                    const isInvalidHora = !mergedMeta.citaHora || mergedMeta.citaHora === 'null' || String(mergedMeta.citaHora).includes('string') || String(mergedMeta.citaHora).includes('N/A');

                    // 1) VETO LOGIC: If AI tries to move without both pieces of data, BLOCK IT.
                    if (hasMoveTag && (isInvalidFecha || isInvalidHora)) {
                        hasMoveTag = false;
                        inferredAcceptance = false;
                        isCitaConfirmation = false;
                    }

                    // 2) FALLBACK RENDERER: If we are missing data, force the question/calendar array.
                    // This must run even if hasMoveTag is false!
                    if (isInvalidFecha || isInvalidHora) {
                        const lowerResponse = (responseTextVal || "").toLowerCase();
                        const isMissingDayOrHour = (!lowerResponse.includes('día') && !lowerResponse.includes('hora') && !lowerResponse.includes('fecha'));
                        // If we already have citaFecha but not citaHora, the AI should ALWAYS show hour options.
                        // Don't let the AI regress to re-offering days if we already know the date.
                        const aiHallucinatedHourQuestion = !isInvalidFecha && isInvalidHora;

                        if (isMissingDayOrHour || aiHallucinatedHourQuestion) {
                            // Determine exactly what is missing for a pinpoint fallback
                            let callToAction = "¿Qué día de la semana prefieres de las opciones que te mencioné?"; // Default day missing

                            if (!isInvalidFecha && isInvalidHora) {
                                // 🩹 AGENT FALLBACK FIX: Don't ask an open question if we know the date.
                                // Instead, manually render the available hours for that date to prevent GPT-4o-mini from hallucinating an open question.
                                let availableHoursForDate = [];


                                if (currentStep?.calendarOptions && Array.isArray(currentStep.calendarOptions)) {
                                    // Match calendar options containing the date string (YYYY-MM-DD or parsed equivalents)
                                    const dateStr = String(mergedMeta.citaFecha).trim();


                                    availableHoursForDate = currentStep.calendarOptions
                                        .filter(opt => {
                                            // Handle exact string match first
                                            if (opt.includes(dateStr)) {
                                                return true;
                                            }

                                            // Attempt robust numerical matching by parsing both YYYY-MM-DD and the option prefix
                                            const targetParts = dateStr.split('-');
                                            if (targetParts.length === 3) {
                                                const tY = parseInt(targetParts[0], 10);
                                                const tM = parseInt(targetParts[1], 10);
                                                const tD = parseInt(targetParts[2], 10);

                                                // Option comes in format "YYYY-MM-DD @ HH:mm"
                                                const optParts = opt.split('@')[0].trim().split('-');
                                                if (optParts.length === 3) {
                                                    const oY = parseInt(optParts[0], 10);
                                                    const oM = parseInt(optParts[1], 10);
                                                    const oD = parseInt(optParts[2], 10);

                                                    if (tY === oY && tM === oM && tD === oD) {
                                                        return true;
                                                    }
                                                }
                                            }

                                            // Attempt to match text dates: e.g. "Domingo 8 de Marzo" against "2026-03-08"
                                            const monthsStr = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                                            if (targetParts.length === 3) {
                                                const tM = parseInt(targetParts[1], 10);
                                                const tD = parseInt(targetParts[2], 10);
                                                if (!isNaN(tM) && !isNaN(tD) && tM >= 1 && tM <= 12) {
                                                    const monthName = monthsStr[tM - 1];
                                                    const dayRegex = new RegExp(`(^|\\s)(0?${tD})\\b`, 'i');
                                                    const monthRegex = new RegExp(monthName, 'i');
                                                    const safeOpt = opt.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");

                                                    if (dayRegex.test(safeOpt) && monthRegex.test(safeOpt)) {
                                                        return true;
                                                    }
                                                }
                                            }

                                            return false;
                                        })
                                        .map(opt => {
                                            const parts = opt.split('@');
                                            return parts.length > 1 ? parts[1].trim() : opt;
                                        });

                                } else {
                                }

                                if (availableHoursForDate.length > 0) {
                                    const formattedHours = availableHoursForDate.map((h, i) => `🔹 Opción ${i + 1}: ${h}`).join('\n\n');
                                    callToAction = `Perfecto, para el ${mergedMeta.citaFecha} tengo estas opciones de horario para ti:\n\n${formattedHours}\n\n¿Cuál prefieres?`;

                                    // 🩹 INQUIRY FIX: Do NOT wipe responseTextVal if the AI provided a legitimate FAQ answer / job inquiry response (like "Sí tenemos vales").
                                    // Make sure we only wipe it if it was hallucinating its own hours array.
                                    if (responseTextVal && /opciones|horario|perfecto/i.test(responseTextVal) && responseTextVal.includes('1️⃣')) {
                                        responseTextVal = "";
                                    }
                                } else {
                                    // Safe fallback if literal string match fails
                                    callToAction = `Perfecto, para el ${mergedMeta.citaFecha}. ¿A qué hora te gustaría asistir de los horarios disponibles?`;
                                }
                            } else if (!mergedMeta.citaFecha || mergedMeta.citaFecha === 'null') {
                                // 🩹 REDUNDANT DAY QUESTION FIX: If the bot already provided a day list, make the CTA a second bubble
                                if (responseTextVal && /Tengo entrevistas los días:/i.test(responseTextVal)) {
                                    const dayMatches = responseTextVal.match(/1️⃣/g);
                                    if (dayMatches && dayMatches.length === 1 && !responseTextVal.includes('2️⃣')) {
                                        callToAction = "[MSG_SPLIT]¿Te queda bien este día? 😊";
                                    } else {
                                        callToAction = "[MSG_SPLIT]¿En cuál día te queda mejor? 🗓️";
                                    }
                                } else if (responseTextVal && /¿Cuál de los (dos|tres|opciones)\?|disponibles.*¿Cuál/i.test(responseTextVal)) {
                                    // Already asked the candidate to clarify an ambiguous day, no need for generic CTA
                                    callToAction = "";
                                } else {
                                    callToAction = "¿Qué día te queda mejor para agendar tu cita?";
                                }
                            }

                            // Initialize if null to forcefully break silence caused by AIGuard
                            if (!responseTextVal) responseTextVal = "";

                            // Ensure we don't duplicate the CTA if the AI managed to output it via FAQ engine merging
                            if (!responseTextVal.includes(callToAction) && !responseTextVal.includes("opciones de horario")) {
                                // 🩹 FAQ RADAR FIX: If responseTextVal has an FAQ answer, add a double newline barrier
                                const separator = responseTextVal.length > 0 ? '\n\n' : '';
                                responseTextVal = `${responseTextVal.trim()}${separator}${callToAction}`.trim();
                            }
                        }
                    } else {
                    }
                }

                if (hasMoveTag || hasExitTag) {
                    let currentIndex = project.steps.findIndex(s => s.id === activeStepId);
                    if (currentIndex === -1) currentIndex = 0;

                    let nextStep = null;
                    let isExitMove = false;

                    if (hasExitTag) {
                        nextStep = project.steps.find(s =>
                            s.name?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes('no interesa')
                        );
                        isExitMove = true;
                    } else if (extractedMoveTarget) {
                        // AI explicitly asked for a step name (e.g. "Citados")
                        const targetNormalized = extractedMoveTarget.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        nextStep = project.steps.find(s =>
                            s.name?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(targetNormalized)
                        );
                        // If it didn't find the exact target, default to linear next step
                        if (!nextStep) {
                            nextStep = project.steps[currentIndex + 1];
                        }
                    } else {
                        // Linear progression
                        nextStep = project.steps[currentIndex + 1];
                    }

                    if (nextStep) {
                        const recruiterFinalSpeech = responseTextVal;
                        responseTextVal = null;
                        let cleanSpeech = '';

                        if (recruiterFinalSpeech) {
                            cleanSpeech = recruiterFinalSpeech
                                .replace(/\[\s*(SILENCIO|NULL|UNDEFINED|REACCIÓN.*?|REACCION.*?)\s*\]/gi, '')
                                .replace(/[\{\[]\s*move(?:[\s:]+\w+)?\s*[\}\]]/gi, '')
                                .trim();
                        }

                        // NOTE: The Inicio→Cita transition now handled by the deterministic bypass above.
                        // If cleanSpeech is empty here (from GPT silent move), simply skip — no message needed.


                        // 🤫 EXCEPCIÓN UX: Si estamos en el paso "CITA", NO enviar el speech de despedida.
                        const originStepName = (currentStep?.name || '').toLowerCase();
                        const isCitaStepOrigin = originStepName.includes('cita');

                        if (cleanSpeech.length > 0 && !isCitaStepOrigin) {
                            try {
                                await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, cleanSpeech, 'chat', { priority: 1 });
                            } catch (e) {
                                console.error('Error enviando pre-move:', e.message);
                            }
                            saveMessage(candidateId, { from: 'me', content: cleanSpeech, timestamp: new Date().toISOString() }).catch(() => { });
                            await new Promise(r => setTimeout(r, 300));
                        }


                        // 🟢 OPTIMISTIC LOCKING: Move candidate in DB right now before the heavy dispatch
                        // so if a concurrent message comes in, it's evaluated in the next step context
                        await moveCandidateStep(activeProjectId, candidateId, nextStep.id);
                        recruiterTriggeredMove = true;
                        candidateUpdates.stepId = nextStep.id;
                        candidateUpdates.projectId = activeProjectId;
                        // 🧹 Clear cita_pending — candidate officially moved, flag no longer needed
                        clearCitaPendingFlag(redis, candidateId).catch(() => {});

                        // 🔄 CITADOS→CITA RESET: When retraction from Citados sends candidate back to Cita
                        // for a new vacancy, clear the old appointment data so the scheduling flow starts fresh.
                        const fromCitados = (currentStep?.name || '').toLowerCase().includes('citado');
                        const toCita = (nextStep?.name || '').toLowerCase().includes('cita') && !nextStep.name.toLowerCase().includes('citado');
                        if (fromCitados && toCita) {
                            if (!candidateUpdates.projectMetadata) {
                                candidateUpdates.projectMetadata = { ...(candidateData.projectMetadata || {}) };
                            }
                            candidateUpdates.projectMetadata.citaFecha = null;
                            candidateUpdates.projectMetadata.citaHora = null;
                        }

                        // 🔔 PRE-SCHEDULE REMINDERS: Register reminder timestamps in Redis Sorted Set
                        // (fire-and-forget — never block the main confirmation flow)
                        const _metaForReminders = { ...(candidateData.projectMetadata || {}), ...(candidateUpdates.projectMetadata || {}) };
                        if (nextStep.scheduledReminders?.length && _metaForReminders.citaFecha && _metaForReminders.citaHora) {
                            scheduleRemindersForCandidate({
                                candidateId,
                                projectId: activeProjectId,
                                stepId: nextStep.id,
                                citaFecha: _metaForReminders.citaFecha,
                                citaHora: _metaForReminders.citaHora
                            }).catch(e => console.error('[REMINDER] Pre-schedule error:', e.message));
                        }

                        // 🟢 NEW: Dispatch Appointment Confirmation Sequence regardless of cleanSpeech
                        const originStepNameForConfirm = (currentStep?.name || '').toLowerCase();
                        // ⚠️ Must exclude 'citado' — 'citado'.includes('cita') === true which would re-fire confirmation on every Citado message
                        const isCitaStepConfirm = originStepNameForConfirm.includes('cita') && !originStepNameForConfirm.includes('citado');


                        if (isCitaStepConfirm) {
                            const confArray = currentStep.appointmentConfirmation || [];

                            if (confArray.length > 0) {
                                const metaDataForVars = { ...(candidateData.projectMetadata || {}), ...(candidateUpdates.projectMetadata || {}) };
                                const humanDate = humanizeDate(metaDataForVars.citaFecha);

                                // ✅ SEQUENTIAL with stagger — guarantees WhatsApp arrival order
                                for (let i = 0; i < confArray.length; i++) {
                                    const item = confArray[i];
                                    if (!item.enabled) continue;

                                    try {
                                        if (item.type === 'text' && item.data?.text) {
                                            let finalMsg = item.data.text;
                                            finalMsg = finalMsg.replace(/\{\{\s*(?:nombre|name)\s*\}\}/ig, candidateData.nombreReal || candidateData.nombre || 'Candidato');
                                            finalMsg = finalMsg.replace(/\{\{\s*citaFecha\s*\}\}/ig, humanDate || 'fecha acordada');
                                            finalMsg = finalMsg.replace(/\{\{\s*citaHora\s*\}\}/ig, metaDataForVars.citaHora || 'hora acordada');

                                            await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, finalMsg, 'chat', { priority: 1 });
                                            saveMessage(candidateId, { from: 'me', content: finalMsg, timestamp: new Date().toISOString() }).catch(() => { });
                                        }
                                        else if (item.type === 'image' && item.data?.url) {
                                            let imgUrl = item.data.url;
                                            if (imgUrl.startsWith('/')) {
                                                imgUrl = `${process.env.NEXT_PUBLIC_API_URL || 'https://candidatic-ia.vercel.app'}${imgUrl}`;
                                            } else if (imgUrl.includes('candidatic.ia') && !imgUrl.includes('vercel.app')) {
                                                imgUrl = imgUrl.replace('candidatic.ia', 'candidatic-ia.vercel.app');
                                            }
                                            await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, imgUrl, 'image', { priority: 1 });
                                            saveMessage(candidateId, { from: 'me', content: `[Imagen Adjunta: ${imgUrl}]`, timestamp: new Date().toISOString() }).catch(() => { });
                                        }
                                        else if (item.type === 'location' && item.data?.lat && item.data?.lng) {
                                            await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, item.data.address || 'Ubicación', 'location', {
                                                lat: item.data.lat,
                                                lng: item.data.lng,
                                                address: item.data.address || 'Oficina',
                                                priority: 1
                                            });
                                            saveMessage(candidateId, { from: 'me', content: `[Ubicación: ${item.data.address} (${item.data.lat}, ${item.data.lng})]`, timestamp: new Date().toISOString() }).catch(() => { });
                                        }

                                        // Stagger between messages to guarantee WhatsApp delivery order
                                        if (i < confArray.length - 1) {
                                            await new Promise(r => setTimeout(r, 800));
                                        }
                                    } catch (err) {
                                        console.error(`[RECRUITER BRAIN] ❌ Error enviando confirmación (${item?.type}):`, err.message);
                                    }
                                }
                            }
                        }

                        // 🔄 SEQUENTIAL: sticker first, then chained AI
                        // Running in parallel risks Vercel serverless killing chainedAI before OpenAI responds
                        try {
                            const redis = getRedisClient();
                            const stepNameLower = isExitMove ? 'exit' : (currentStep?.name?.toLowerCase().trim().replace(/\s+/g, '_'));
                            const specificKeys = [];
                            if (isExitMove) specificKeys.push('bot_bridge_exit', 'bot_bridge_no_interesa');
                            if (stepNameLower && !isExitMove) specificKeys.push(`bot_bridge_${stepNameLower}`);
                            if (!isExitMove) specificKeys.push(`bot_bridge_${activeStepId}`, 'bot_step_move_sticker');

                            let bridgeKey = null;
                            for (const key of specificKeys) {
                                if (await redis?.exists(key)) { bridgeKey = key; break; }
                            }

                            if (bridgeKey) {
                                const bridgeSticker = await redis?.get(bridgeKey);
                                if (bridgeSticker) {
                                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, bridgeSticker, 'sticker');
                                }
                            } else {
                            }
                        } catch (e) { console.error(`[RECRUITER BRAIN] Bridge Fail: `, e.message); }

                        // 🚪 NO INTERESA ARRIVAL: Send farewell message + clear vacancy linkage
                        const nextStepNameLower = (nextStep?.name || '').toLowerCase();
                        if (nextStepNameLower.includes('no interesa') || isExitMove) {
                            // 📌 Set the noInteresa Redis marker so the re-engagement intercept can detect this candidate
                            redis?.set(`noInteresa:${candidateId}`, '1', 'EX', 60 * 60 * 24 * 180).catch(() => {}); // 180 days
                            // 🧹 Reset any stale reengagement state from a previous cycle — otherwise
                            // the next time the candidate messages, the intercept hits an old SHOWING/CONFIRMING_PROFILE
                            // state and silently fails instead of starting a fresh re-engagement round.
                            redis?.del(`reengagement:${candidateId}`).catch(() => {});
                            try {
                                const candFirstName = (candidateData.nombreReal || candidateData.nombre || 'amig@').split(' ')[0];
                                const farewellPart1 = `Entiendo perfectamente, ${candFirstName} 🙏 Lamento que ninguna de nuestras oportunidades haya encajado contigo en este momento.`;
                                const farewellPart2 = `Si en algún momento algo cambia y te interesa explorar una nueva vacante, aquí estaré para ayudarte. ¡Mucho éxito en tu búsqueda! 🍀👋`;
                                await new Promise(r => setTimeout(r, 600));
                                await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, farewellPart1, 'chat', { priority: 1 });
                                saveMessage(candidateId, { from: 'me', content: farewellPart1, timestamp: new Date().toISOString() }).catch(() => {});
                                await new Promise(r => setTimeout(r, 600));
                                await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, farewellPart2, 'chat', { priority: 1 });
                                saveMessage(candidateId, { from: 'me', content: farewellPart2, timestamp: new Date().toISOString() }).catch(() => {});
                                // Clear vacancy linkage — both top-level AND projectMetadata (where the UI column reads from)
                                candidateUpdates.currentVacancyName = null;
                                candidateUpdates.currentVacancyIndex = null;
                                // Also wipe inside projectMetadata so the Kanban/table column clears
                                if (!candidateUpdates.projectMetadata) {
                                    candidateUpdates.projectMetadata = { ...(candidateData.projectMetadata || {}) };
                                }
                                candidateUpdates.projectMetadata.currentVacancyName = null;
                                candidateUpdates.projectMetadata.currentVacancyIndex = null;
                                // Sync projectMetadata store explicitly
                                updateProjectCandidateMeta(activeProjectId, candidateId, {
                                    currentVacancyName: null,
                                    currentVacancyIndex: null
                                }).catch(() => {});
                            } catch (e) { console.error('[RECRUITER BRAIN] Farewell msg error:', e.message); }
                        }

                        // 📅 DETERMINISTIC DAY LIST: When moving to a scheduling step (has calendarOptions),
                        // ALWAYS send the day list before calling the step's AI — regardless of aiConfig.
                        const _nextTodayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Monterrey' });
                        const _nextHasFutureDays = (nextStep.calendarOptions || []).some(opt => {
                            const m = opt.match(/^(\d{4}-\d{2}-\d{2})/);
                            return m && m[1] >= _nextTodayStr;
                        });

                        if (_nextHasFutureDays) {
                            try {
                                const _futDays = [...new Set(
                                    (nextStep.calendarOptions || [])
                                        .filter(o => { const m = o.match(/^(\d{4}-\d{2}-\d{2})/); return m && m[1] >= _nextTodayStr; })
                                        .map(o => { const m = o.match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; })
                                        .filter(Boolean)
                                )];
                                const _DN3 = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
                                const _MN3 = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
                                const _NE3 = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
                                const _fn3 = (candidateData.nombreReal || candidateData.nombre || '').split(' ')[0];
                                const _dayLines3 = _futDays.map((ds, i) => {
                                    const d = new Date(parseInt(ds.substr(0,4)), parseInt(ds.substr(5,2))-1, parseInt(ds.substr(8,2)));
                                    return `${_NE3[i] || `${i+1}.`} ${_DN3[d.getDay()]} ${d.getDate()} de ${_MN3[d.getMonth()]} 📅`;
                                }).join('\n\n');
                                const _dayListMsg = `${_fn3 ? `${_fn3}, t` : 'T'}engo entrevistas los días:\n\n${_dayLines3}`;
                                const _dayAskMsg = `¿En cuál día te queda mejor? 😊`;

                                await new Promise(r => setTimeout(r, 800));
                                await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, _dayListMsg, 'chat').catch(() => {});
                                await new Promise(r => setTimeout(r, 1500));
                                await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, _dayAskMsg, 'chat').catch(() => {});
                                await saveMessage(candidateId, { from: 'me', content: _dayListMsg + '\n\n' + _dayAskMsg, timestamp: new Date().toISOString() });
                            } catch (_dlErr) {
                                console.error('[DAY LIST] Failed to send day list on step entry:', _dlErr.message);
                            }
                        }

                        // Now trigger next step's AI
                        const isTerminalStep = nextStepNameLower.includes('citado') || nextStepNameLower.includes('no interesa') || isExitMove;

                        if (nextStep.aiConfig?.enabled && nextStep.aiConfig.prompt && !isTerminalStep && !_nextHasFutureDays) {

                            try {
                                // 🧹 CLEAN HISTORY for the new step. Keep both user and assistant roles so the AI knows which FAQs were already answered.
                                const historyForNextStep = [
                                    ...historyForGpt.slice(-4), // Keep last 4 messages (context aware)
                                    { role: 'user', content: `[SISTEMA]: El candidato acaba de avanzar al paso "${nextStep.name}".Este es tu primer contacto en este paso.Sigue tu OBJETIVO DE PASO.` }
                                ];
                                if (cleanSpeech && cleanSpeech.length > 0) {
                                    historyForNextStep.splice(-1, 0, { role: 'assistant', content: cleanSpeech });
                                }


                                const nextAiResult = await processRecruiterMessage(
                                    { ...candidateData, ...candidateUpdates },
                                    project, nextStep, historyForNextStep, config,
                                    activeAiConfig.openaiApiKey,
                                    candidateUpdates.currentVacancyIndex !== undefined ? candidateUpdates.currentVacancyIndex : currentIdx
                                );


                                if (nextAiResult?.response_text) {
                                    let cMessagesToSend = [];
                                    let chainText = nextAiResult.response_text;

                                    // 📅 INTERVIEW DATES FORMATTER: Detect and reformat the cita dates message
                                    const isDateMsg = /^[¡!]?Listo\b/i.test(chainText.trim());
                                    if (isDateMsg) {
                                        // Step 1: Normalize header
                                        chainText = chainText.replace(/Tengo entrevistas disponibles (?:para el|(?:los días)?):?/gi, 'Tengo entrevistas los días:');
                                        chainText = chainText.replace(/(¡Listo[^!¡\n]*!?\s*[⏬⬇️]*)\s+(Tengo\b)/i, '$1\n$2');

                                        // Step 2: If dates are inline prose (no 1️⃣/2️⃣), convert to numbered list
                                        const NUM_D = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'];
                                        chainText = chainText.replace(
                                            /(Tengo entrevistas los d[ií]as:)\s*([^\n?¿⏬]+)/i,
                                            (match, header, datesStr) => {
                                                if (/1️⃣|2️⃣/.test(datesStr)) return match; // already formatted
                                                const dates = datesStr.split(/,\s*|\s+y\s+/)
                                                    .map(d => d.trim())
                                                    .filter(d => /(?:Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado|Domingo)/i.test(d));
                                                if (dates.length === 0) return match;
                                                return header + '\n' + dates.map((d, i) => `${NUM_D[i] || `${i+1}.`} ${d} 📅`).join('\n');
                                            }
                                        );
                                    }


                                    // 📐 DRY: Appy shared formatting logic (replaces ~50 duplicate lines)
                                    chainText = formatRecruiterMessage(chainText, candidateData);

                                    // Interpret [MSG_SPLIT] injected by formatRecruiterMessage
                                    if (chainText.includes('[MSG_SPLIT]')) {
                                        chainText.split('[MSG_SPLIT]').forEach(p => { if (p.trim()) cMessagesToSend.push(p.trim()); });
                                    } else {
                                        const splitRegex = /(¿Te gustaría que (?:te )?agende.*?(?:entrevista|cita).*?\?|¿Te gustaría agendar.*?entrevista.*?\?|¿Te queda bien\??|¿Te queda bien este día\??|¿Te puedo agendar|¿Deseas que programe|¿Te interesa que asegure|¿Te confirmo tu cita|¿Quieres que reserve|¿Procedo a agendar|¿Te aparto una cita|¿Avanzamos con|¿Autorizas que agende)/i;
                                        const match = chainText.match(splitRegex);

                                        if (match) {
                                            const beforeCta = chainText.substring(0, match.index);
                                            const cta = chainText.substring(match.index);
                                            if (beforeCta.trim()) cMessagesToSend.push(beforeCta.trim());
                                            cMessagesToSend.push(cta.trim());
                                        } else {
                                            if (chainText.trim()) cMessagesToSend.push(chainText.trim());
                                        }
                                    }

                                    const filterRegex = /^\[\s*(SILENCIO|NULL|UNDEFINED|REACCIÓN.*?|REACCION.*?)\s*\]$/i;

                                    // Sequential send with delay for correct WhatsApp bubble separation
                                    for (let i = 0; i < cMessagesToSend.length; i++) {
                                        let msgClean = String(cMessagesToSend[i]).trim();
                                        if (!msgClean || filterRegex.test(msgClean)) continue;

                                        // Ensure MSG_SPLIT is cleanly removed before sending if it didn't trigger a split earlier
                                        msgClean = msgClean.replace(/\[MSG_SPLIT\]/g, '\n\n').trim();

                                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, msgClean, 'chat', { priority: i + 1 }).catch(() => { });
                                        if (i < cMessagesToSend.length - 1) await new Promise(r => setTimeout(r, 1500));
                                    }

                                    const safeLogText = (nextAiResult.response_text || '').replace(/\[MSG_SPLIT\]/g, '\n\n').trim();
                                    await saveMessage(candidateId, { from: 'me', content: safeLogText, timestamp: new Date().toISOString() });
                                } else {
                                }
                            } catch (e) {
                                console.error(`[RECRUITER BRAIN] Chain Fail: `, e.message);
                            }
                        } else {
                        }
                    }
                }
            }
        }

        // --- BIFURCATION POINT: Silence Shield / Recruiter / GPT Host / Gemini ---
        let isBridgeActive = false;
        let isHostMode = false;

        // 🛡️ [SILENCE SHIELD REMOVED]: Since follow-up system is gone, we no longer muzzle Brenda after completion.
        // We now allow GPT Host or Capturista Brain to handle social interactions naturally.

        const bridgeCounter = (typeof candidateData.bridge_counter === 'number') ? parseInt(candidateData.bridge_counter || 0) : 0;
        candidateUpdates.bridge_counter = bridgeCounter + 1; // Now correctly persisted in candidateUpdates

        // 2. GPT HOST (OpenAI Social Brain) - Triggers after 2 messages of silence
        const aiConfigJson = batchConfig.ai_config;
        const activeAiConfig = aiConfigJson ? (typeof aiConfigJson === 'string' ? JSON.parse(aiConfigJson) : aiConfigJson) : {};
        if (!isRecruiterMode && !isBridgeActive && isProfileComplete && activeAiConfig.gptHostEnabled && activeAiConfig.openaiApiKey) {
            isHostMode = true;
            try {
                const hostPrompt = activeAiConfig.gptHostPrompt || 'Eres la Lic. Brenda Rodríguez de Candidatic.';
                const gptResponse = await getOpenAIResponse(allMessages, `${hostPrompt} \n[ADN]: ${JSON.stringify(candidateData)} `, activeAiConfig.openaiModel || 'gpt-4o-mini', activeAiConfig.openaiApiKey);

                if (gptResponse?.content) {
                    const textContent = gptResponse.content.replace(/\*/g, '');
                    aiResult = {
                        response_text: textContent,
                        thought_process: "GPT Host Response",
                        reaction: (/\b(gracias|ti)\b/i.test(textContent)) ? '👍' : null,
                        gratitude_reached: false,
                        close_conversation: false
                    };
                    responseTextVal = textContent;
                }
            } catch (e) {
                console.error('[GPT Host] error:', e);
                isHostMode = false; // Fallback to Gemini if OpenAI fails
            }
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
                if (!customPrompt) {
                    const extractionRules = batchConfig.bot_extraction_rules || DEFAULT_EXTRACTION_RULES;
                    systemInstruction += `\n[REGLAS DE EXTRACCIÓN (VIPER-GPT)]: ${extractionRules.replace(/{{categorias}}/g, categoriesList)}`;
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

                if (!customPrompt) {
                    // Extended behavior rules — only for bots without a custom prompt
                    // (custom prompts define their own behavior, code rules would conflict)
                    systemInstruction += `
[RECONOCIMIENTO DE TURNO Y REGLAS DE NOMBRE]: 
- Si el usuario provee su nombre o apellidos, extráelo en "extracted_data.nombreReal" formatiendo a Title Case (Ej: "juan perez" -> "Juan Perez").
- ⚠️ REGLA DE COMBINACIÓN DE NOMBRES: Si el candidato YA tiene un nombre guardado en su [ADN] (ej: "Oscar") y ahora te da sus apellidos ("Rodriguez"), DEBES combinarlos y devolver el nombre COMPLETO (Ej: "Oscar Rodriguez"). NUNCA devuelvas solo el apellido si ya tenías el nombre, porque reemplazará sus datos y causará un error.
- REGLA ESTRICTA DE NOMBRES: NUNCA extraigas apodos, frases de cortesía o afirmaciones como "Si", "Claro", "sin problema", "buenas noches" como nombre. Si el texto no es un nombre real válido, NO LO EXTRAIGAS.
- 🕒 REGLA DE RETENCIÓN DE AGENDA: Si el candidato YA tiene "citaFecha" o "citaHora" en su [ADN], OBLIGATORIAMENTE debes re-escribir ese mismo valor en tu "extracted_data" a menos que el candidato pida explícitamente cambiar la fecha/hora.
- FECHAS CRÍTICAS: "citaFecha" DEBE ser estrictamente formato "YYYY-MM-DD". Transforma menciones como "el lunes" a la fecha exacta correspondiente.
- GÉNERO (OBLIGATORIO Y SILENCIOSO): Está estrictamente prohibido preguntarle al candidato por su género. Sin embargo, SIEMPRE debes deducirlo del nombre del candidato o contexto del chat.
- ESCOLARIDAD (FORMATO OBLIGATORIO): Cuando preguntes por escolaridad, muestra opciones en lista VERTICAL con emojis.
- Si el usuario sólo te da un nombre sin apellidos (ej: "Oscar"), extráelo y PREGUNTA POR SUS APELLIDOS.
- CRÍTICO: Tú eres la Licenciada Brenda Rodríguez. EL USUARIO ES OTRA PERSONA. NUNCA extraigas "Brenda" o "Brenda Rodríguez" como nombre del usuario.

[REGLA ANTI-REDUNDANCIA OBLIGATORIA]:
- NUNCA preguntes al candidato por un dato que acabas de extraer exitosamente en el campo "extracted_data" de este mismo JSON.

[REGLAS DE HOMOGENEIZACIÓN (ESTRICTAS)]:
- **Municipio**: Devuelve ÚNICAMENTE el nombre oficial del municipio sin direcciones completas ni calles.
- **Escolaridad**: Clasifica en una sola palabra: Primaria, Secundaria, Preparatoria, Licenciatura, Técnica, o Posgrado.
- **Categoría**: Si el candidato escribe "Ayudante", extrae estrictamente "Ayudante General" u otra categoría que haga *match exacto* a la lista. Si opera maquinaria -> "Montacarguista".\n`;
                }
                // When customPrompt is active: NO behavioral rules injected — the prompt owns everything.




                const isGenericStart = isNewFlag && /^(hola|buen[oa]s|info|vacantes?|empleos?|trabajos?|ola|q tal|que tal|\s*)$/i.test(aggregatedText.trim());
                let bypassGpt = false;

                if (isNewFlag) {
                    if (isGenericStart && auditForMode.missingLabels.length > 0) {
                        // Bypass works with or without customPrompt — faster (no GPT call) + 2 bubbles
                        bypassGpt = true;
                    } else {
                        const welcomeName = 'Brenda Rodríguez';
                        // If it's a specific question (not just "hola"), inject full CEREBRO1 rules
                        // so the PERSUASIÓN rule applies and the question is answered before asking for name
                        const isSpecificQuestion = !isGenericStart && /\?|vacante|empleo|trabajo|sueldo|horario|turno|beneficio|pagan|salar/i.test(aggregatedText);
                        if (isSpecificQuestion && !customPrompt && auditForMode.missingLabels.length > 0) {
                            let baseRules = batchConfig.bot_cerebro1_rules || DEFAULT_CEREBRO1_RULES;
                            const cerebro1Rules = baseRules
                                .replace('{{faltantes}}', auditForMode.missingLabels.join(', '))
                                .replace(/{{categorias}}/g, categoriesList)
                                .replace(/\[LISTA DE CATEGORÍAS\]/g, categoriesList);
                            systemInstruction += `\n[MISION: BIENVENIDA CON PREGUNTA]: Es el primer mensaje. Preséntate en UNA SOLA ORACIÓN como Brenda Rodríguez de Candidatic (NO termines la frase en "Lic."). Luego responde brevemente la pregunta del candidato con info real. Al final pide el dato faltante: ${auditForMode.missingLabels[0]}.\n${cerebro1Rules}\n`;
                        } else {
                            systemInstruction += `\n[MISION: BIENVENIDA]: Es el inicio. Preséntate en UNA SOLA ORACIÓN como Brenda Rodríguez de Candidatic (NO termines la frase en "Lic."). Luego en otra línea pide el Nombre Y Apellidos completos del candidato — siempre incluye al menos un emoji en esa segunda línea. ✨🌸\n`;
                        }
                    }
                } else if (auditForMode.paso1Status !== 'COMPLETO') {
                    candidateUpdates.esNuevo = 'NO';

                    if (customPrompt) {
                        // Custom prompt already has all behavior rules — only inject the dynamic context
                        const missingList = auditForMode.missingLabels.join(', ');
                        systemInstruction += `\n[CONTEXTO DE MISIÓN]: Datos aún faltantes del candidato: ${missingList}. Categorías disponibles:\n${categoriesList}\n`;
                    } else {
                        let baseRules = batchConfig.bot_cerebro1_rules || DEFAULT_CEREBRO1_RULES;
                        const cerebro1Rules = baseRules
                            .replace('{{faltantes}}', auditForMode.missingLabels.join(', '))
                            .replace(/{{categorias}}/g, categoriesList)
                            .replace(/\[LISTA DE CATEGORÍAS\]/g, categoriesList);
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
                                const _fechaHint = /fecha|nacimiento/i.test(_nextLabel) ? ` (ej. 19/05/1990)` : '';
                                systemInstruction += `\n[NOTA DE CONTEXTO]: El candidato preguntó sobre vacantes/entrevistas. Responde en DOS burbujas con [MSG_SPLIT]: Burbuja 1 = MÁXIMO 2 líneas, cálida con emoji, reconoce brevemente la pregunta y di que primero necesitas un dato — PROHIBIDO comenzar con halagos descontextualizados como "¡Vas excelente!", "¡Genial!", "¡Perfecto!". Burbuja 2 = Pregunta DIRECTA y ESPECÍFICA (NO genérica) por: "${_nextLabel}"${_fechaHint} — con emoji. PROHIBIDO usar frases vagas como "¿me ayudas con tus datos?".\n`;
                            } else if (isPersonalQ) {
                                systemInstruction += `\n[NOTA DE CONTEXTO - PREGUNTA PERSONAL/LIGUE]: El candidato hizo una pregunta personal o de ligue. Usa [MSG_SPLIT] para DOS burbujas: Burbuja 1 = respuesta BREVE y coqueta en personaje (con picardía/humor), PROHIBIDO usar halagos descontextualizados como "¡Vas excelente!", "¡Genial!", "¡Perfecto!" — solo evasión divertida. Burbuja 2 = pregunta DIRECTA por el dato faltante: ${auditForMode.missingLabels[0]} — con emoji. PROHIBIDO mezclar ambas en una sola burbuja.\n`;
                            } else {
                                const nextField = auditForMode.missingLabels[0];
                                const isEscolaridad = /escolaridad/i.test(nextField);
                                const splitHint = isEscolaridad
                                    ? ` Usa DOS separadores [MSG_SPLIT]: uno ANTES de la lista de escolaridad y otro DESPUÉS de la lista, terminando con un mensaje corto de empuje con emoji (ej: "¿Cuál es la tuya? 🌟" o "¡Elige la que más te identifica! 😊") para animar al candidato a contestar.`
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
                    const welcomeName = 'Brenda Rodríguez';
                    const greetingEmojis = ["👋", "✨", "🌸", "😊", "😇", "💖", "🌟"];
                    const gEmoji = greetingEmojis[Math.floor(Math.random() * greetingEmojis.length)];
                    const line1 = `¡Hola! ${gEmoji} Soy ${welcomeName}, reclutadora de Candidatic.`;
                    const nameAskEmojis = ["😊", "🌸", "✨", "💖", "😇", "🌟"];
                    const nEmoji = nameAskEmojis[Math.floor(Math.random() * nameAskEmojis.length)];
                    const line2 = `¿Me puedes compartir tu Nombre y Apellidos completos? ${nEmoji}`;
                    gptResult = {
                        content: JSON.stringify({
                            response_text: `${line1}[MSG_SPLIT]${line2}`,
                            extracted_data: {},
                            reaction: '✨',
                            thought_process: "AUTO_GREETING_BYPASS: Fast initial response for generic greeting."
                        }),
                        usage: { total_tokens: 0 }
                    };
                } else {
                    gptResult = await getOpenAIResponse(recentHistory, `${systemInstruction}\n[ADN]: ${JSON.stringify(candidateData)}`, selectedModel, activeAiConfig.openaiApiKey, { type: "json_object" }, null, 600);


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
                        responseTextVal = formatRecruiterMessage(aiResult.response_text, candidateData);
                    } catch (err) {
                        console.error('[GPT BRAIN] JSON Parse Fail:', err.message);
                        throw new Error('GPT returned invalid JSON');
                    }
                }

                // Merge Extracted Data
                if (aiResult?.extracted_data && Object.keys(aiResult.extracted_data).length > 0) {
                    const ext = aiResult.extracted_data;

                    if (ext.nombreReal && ext.nombreReal.trim().length > 1) {
                        const previousName = candidateData.nombreReal || '';

                        // We trust the AI validation from the prompt above
                        ext.nombreReal = coalesceName(candidateData.nombreReal, ext.nombreReal);

                        // If we got a valid gender inference and the candidate doesn't have one yet
                        if (!candidateData.genero && ext.genero && ext.genero !== 'Desconocido') {
                            // Keep inferred gender
                        } else {
                            delete ext.genero; // Don't override existing or save 'Desconocido'
                        }
                    } else if (ext.nombreReal !== undefined) {
                        // Name was null, rejected by validation, or too short. Do not save.
                        delete ext.nombreReal;
                    }

                    if (ext.fechaNacimiento) {
                        ext.fechaNacimiento = coalesceDate(candidateData.fechaNacimiento, ext.fechaNacimiento);
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
                    const nr = (candidateUpdates.nombreReal || candidateData.nombreReal || "").toLowerCase();
                    if (nr.startsWith("maria") || nr.startsWith("ana ") || nr.startsWith("laura") || nr.startsWith("brenda") || nr.endsWith("a")) {
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
                        handoverTriggered = true;
                    }
                }

                if (!handoverTriggered && isNowComplete && !candidateData.congratulated) {
                    responseTextVal = "¡Listo! 🌟 Ya tengo todos tus datos guardados. Pronto un reclutador te contactará. ✨🌸";
                    candidateUpdates.congratulated = true;
                    await MediaEngine.sendCongratsPack(config, candidateData.whatsapp, 'bot_celebration_sticker');
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
            const _CLOSING_RE = /(?:te contactar[eé]|te escribir[eé]|nos\s+vemos|¡hasta\s+(luego|pronto|la\s+próxima)|¡bye|¡chao|te\s+aviso\s+pronto|pronto\s+un\s+reclutador|estaremos\s+en\s+contacto|listo\s+por\s+hoy|eso\s+es\s+todo\s+por\s+ahora)/i;
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
        const moveTagPattern = /[\{\[]\s*move(?::\s*(?:exit|no_interesa|\w+))?\s*[\}\]]/i;
        const moveTagPatternGlobal = /[\{\[]\s*move(?::\s*(?:exit|no_interesa|\w+))?\s*[\}\]]/gi;
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
                    const mediaPattern = /https?:\/\/[^/]+\/api\/(image\?id=|media\/)([^\s\)]+)/i;
                    const match = responseTextVal.match(mediaPattern);
                    if (match) {
                        if (!aiResult) aiResult = {};
                        aiResult.media_url = match[0];
                    }
                }
            }

            // [CLEANUP]: Sweep out ANY literal tag [MEDIA_DISPONIBLE] or [MEDIA_DISPONIBLE: url]
            responseTextVal = responseTextVal.replace(/\[MEDIA_DISPONIBLE[^\]]*\]/gi, '').trim();

            // 🔄 MEDIA+FALLBACK COHERENCE FIX: When GPT found the FAQ media (media_url is set)
            // but still used the fallback text ("Es una excelente pregunta..."), replace the
            // text with a coherent introduction so it makes sense before the PDF/image arrives.
            if (aiResult?.media_url && aiResult.media_url !== 'null'
                && responseTextVal && /^Es una excelente pregunta/i.test(responseTextVal.trim())) {
                responseTextVal = '¡Claro que sí! 📍 Aquí te comparto la información:';
            }

            if (aiResult?.media_url && aiResult.media_url !== 'null') {

                // Failsafe: Remove any detected URLs or Markdown images to prevent leakage
                // 🛡️ IMPORTANT: Temporarily protect [MSG_SPLIT] so it survives the whitespace collapse
                const urlRegex = /https?:\/\/[^\s\)]+/g;
                const markdownImageRegex = /!\[.*?\]\(.*?\)/g;
                responseTextVal = responseTextVal
                    .replace(markdownImageRegex, '')  // strip markdown images ![...](url)
                    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // strip markdown links [text](url) → text
                    .replace(urlRegex, '')              // strip bare https:// URLs
                    .replace(/\[MSG_SPLIT\]/g, '\u0000SPLIT\u0000') // protect sentinel
                    .replace(/[^\S\n]+/g, ' ')         // collapse horizontal whitespace only (preserve \n)
                    .replace(/\n{3,}/g, '\n\n')        // cap excessive newlines to max 2
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
        
        if ((isTechnicalOrEmpty && !hasMoveIntent && !recruiterTriggeredMove && !aiResult?.close_conversation && !handoverTriggered && !hasMedia) || recruiterClosedSilently) {
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
                    responseTextVal.split(SENTINEL).forEach(p => { if (p.trim()) messagesToSend.push(p.trim()); });
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
                const CTA_PATTERN = /¿te gustar[ií]a agendar|¿te agendo una cita|¿te aparto una cita|¿quieres que programe|¿te puedo agendar|solo por confirmar|me confirmas si quieres|quieres que agendemos|solo para confirmar|¿te interesa conocer esta|te gustaría conocerla|¿te la presento|¿te gustaría saber más/i;
                const _hasCTAinBatch = messagesToSend.some(m => CTA_PATTERN.test(m));
                if (_hasCTAinBatch && isRecruiterMode) {
                    setCitaPendingFlag(redis, candidateId).catch(() => {});
                    incrCTAIndex(redis, candidateId).catch(() => {}); // 🔁 Advance sequential counter
                }

                if (mUrl && mUrl !== 'null') {
                    // Ensure absolute URL for UltraMsg
                    if (mUrl.startsWith('/api/')) {
                        mUrl = `https://candidatic-ia.vercel.app${mUrl}`;
                    } else if (mUrl.includes('candidatic.ia') && !mUrl.includes('vercel.app')) {
                        mUrl = mUrl.replace('candidatic.ia', 'candidatic-ia.vercel.app');
                    }

                    // Detect if it's a PDF
                    let isPdf = mUrl.toLowerCase().includes('.pdf') || mUrl.includes('mime=application%2Fpdf');
                    let extractedFilename = null;
                    if (mUrl.includes('/api/image')) {
                        try {
                            // Safe URL parsing regardless of domain
                            const urlObj = mUrl.startsWith('http') ? new URL(mUrl) : new URL(mUrl, 'https://candidatic-ia.vercel.app');
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
                    if (messagesToSend.length > 1) {
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, messagesToSend[0], 'chat', { priority: 1 }).catch(() => { });
                        await new Promise(r => setTimeout(r, 600)); // Network spacing
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, mUrl, isPdf ? 'document' : 'image', { filename, priority: 2 }).catch(() => { });
                        await new Promise(r => setTimeout(r, 600));
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, messagesToSend[1], 'chat', { priority: 3 }).catch(() => { });
                    } else {
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, mUrl, isPdf ? 'document' : 'image', { filename, priority: 1 }).catch(() => { });
                        await new Promise(r => setTimeout(r, 600));
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, messagesToSend[0], 'chat', { priority: 2 }).catch(() => { });
                    }

                } else {
                    // Text only, send sequentially to guarantee order
                    for (let i = 0; i < messagesToSend.length; i++) {
                        await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, messagesToSend[i], 'chat', { priority: i + 1 }).catch(() => { });
                        if (i < messagesToSend.length - 1) await new Promise(r => setTimeout(r, 1500));
                    }
                }
            })();
        }

        // 🧬 [STATE SYNC] Ensure we know if they are complete even if we didn't go through Gemini
        if (!isNowComplete) {
            const finalAudit = auditProfile({ ...candidateData, ...candidateUpdates }, customFields);
            isNowComplete = finalAudit.paso1Status === 'COMPLETO';
        }

        // 📝 [DEBUG LOG]: Store full trace NOW before potential timeouts in secondary deliveries
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

        const finalReaction = (aiResult?.reaction && aiResult.reaction !== 'null' && aiResult.reaction !== 'undefined') ? aiResult.reaction : null;
        let dbContentToSave = responseTextVal;

        if (!dbContentToSave) {
            dbContentToSave = finalReaction ? `[REACCIÓN: ${finalReaction}]` : ' ';
        } else {
            dbContentToSave = dbContentToSave.replace(/\[MSG_SPLIT\]/g, '\n\n').trim();
        }

        // ── ESCOLARIDAD SAFETY NET ────────────────────────────────────────────────
        // Deterministic fallback: if GPT failed to extract escolaridad but the user's
        // message contains a known keyword/abbreviation, save it directly.
        if (!candidateUpdates.escolaridad && !candidateData.escolaridad) {
            const _ESC_DIRECT = [
                [/\b(primaria|prima|prim)\b/i, 'Primaria'],
                [/\b(secundaria|secund|secu|sec)\b/i, 'Secundaria'],
                [/\b(preparatoria|bachillerato|prepa|prep)\b/i, 'Preparatoria'],
                [/\b(licenciatura|licenc|lic)\b/i, 'Licenciatura'],
                [/\b(universidad)\b/i, 'Licenciatura'],
                [/\b(t[eé]cnic[ao]|tecnica|tecnico|carrera t[eé]cnica)\b/i, 'Técnica'],
                [/\b(posgrado|maestr[ií]a|maestria|doctorado)\b/i, 'Posgrado']
            ];
            const msgLower = aggregatedText.toLowerCase();
            for (const [pattern, nivel] of _ESC_DIRECT) {
                if (pattern.test(msgLower)) {
                    candidateUpdates.escolaridad = nivel;
                    break;
                }
            }
        }

        await Promise.allSettled([
            deliveryPromise,
            reactionPromise,
            updateCandidate(candidateId, candidateUpdates),
            saveMessage(candidateId, {
                from: 'me',
                content: dbContentToSave,
                timestamp: new Date().toISOString()
            })
        ]);

        return responseTextVal || '';
    } catch (error) {
        console.error('❌ [AI Agent] Fatal Error:', error);
        const fallbackMsg = "¡Ay! Me distraje un segundo. 😅 ¿Qué me decías?";
        if (candidateData && candidateData.whatsapp) {
            await sendFallback(candidateData, fallbackMsg).catch(() => { });
        }
        return fallbackMsg;
    }
};

async function sendFallback(cand, text) {
    const config = await getUltraMsgConfig();
    if (config && cand.whatsapp) {
        await sendUltraMsgMessage(config.instanceId, config.token, cand.whatsapp, text);
    }
}
