/**
 * AUDITORÍA DE EXTRACCIÓN — garantiza que Brenda contestó coherente y GUARDÓ lo que el
 * candidato dio, en cada chat con extracción en la ventana.
 *
 * Tres garantías que verifica (determinista, directo de Redis):
 *   A. NO MUDA: todo turno de texto del candidato en extracción tuvo respuesta ≤120s.
 *   B. GUARDÓ lo que dieron: si el candidato dio una FECHA/ESCOLARIDAD/CATEGORÍA reconocible,
 *      el campo quedó guardado (no vacío). (El caso Karen: dio "14mayo 1984" y fnac quedó vacío.)
 *   C. COHERENTE: Brenda no re-preguntó el mismo dato ≥3× (bucle) ni lo pidió después de darlo.
 *
 * Uso:  node scripts/auditoria/auditar-extraccion.mjs                 # hoy 00:00 → ahora
 *       node scripts/auditoria/auditar-extraccion.mjs "2026-11-11 00:00" "2026-11-11 14:30"
 *
 * Solo LEE Redis. Escribe el detalle (PII) en scripts/auditoria/out/ (gitignored).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Redis from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.REDIS_URL || fs.readFileSync(path.join(__dirname, '../../.env.production'), 'utf8').match(/REDIS_URL\s*=\s*"?([^"\n]+)"?/)[1];

const MES = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept|sep|oct|nov|dic';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const looksLikeDate = (txt) => {
    const t = norm(txt);
    if (/ubicaci|^📍|-?\d{2}\.\d{3,}/.test(t)) return false; // ubicación/coordenadas, no fecha
    return new RegExp(`\\b\\d{1,2}\\s*(?:de\\s+)?(?:${MES})\\s*(?:del?\\s+)?\\d{2,4}\\b`).test(t)
        || /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/.test(t)
        || /\b\d{6}\b|\b\d{8}\b/.test(t);
};
const looksLikeAge = (txt) => { const t = norm(txt); return !/experiencia|trabaj|hace\s+\d/.test(t) && (/\b(?:tengo|edad)\s+\d{1,2}\b/.test(t) || /\b\d{1,2}\s*anos\b/.test(t)); };
const looksLikeSchool = (txt) => /\b(primaria|secundaria|prepa|preparatoria|bachillerato|bachiller|licenciatura|universidad|carrera|tecnica|tecnico|profesional|posgrado|maestria|ingenieria)\b/.test(norm(txt));
const CATS = ['operador general', 'ayudante general', 'soldador', 'montacargas', 'montacarguista', 'mantenimiento'];
const looksLikeCategory = (txt) => { const t = norm(txt); return CATS.some(c => t.includes(c)); };
const isButton = (b) => /^(DIME COMO LLEGAR|No estoy en casa|AGENDAR ENTREVISTA|No quiero ir|Dame Pase|✅|📍 Ubicación:|Pide ubicación|🚌)/i.test(b) || /^[\p{Emoji}\s]+$/u.test(b);

// Palabra clave del campo + que la frase sea realmente una PREGUNTA/petición (no una
// CONFIRMACIÓN tipo "tu fecha de nacimiento ya está registrada", que también menciona el campo).
const KEY = {
    nombre: /nombre y apellidos|nombre completo|cu[aá]l es tu nombre|tu nombre/i,
    fecha: /fecha de nacimiento|cu[aá]ndo naciste/i,
    municipio: /municipio/i,
    categoria: /categor[íi]a/i,
    escolaridad: /escolaridad|grado.*estudi|nivel de (estudios|escolaridad)/i,
};
const isConfirm = (t) => /registrad|ya est[aá]|anotad|guardad|perfecto|excelente|gracias|naciste el|tu (fecha|nombre|municipio|categor|escolarid).*(es|ya|qued)|qued[oó] registrad|listo|elegiste|genial|registr[eé]/i.test(t);
const isQuestion = (t) => /\?|¿|me (compart|das|puede|proporci|dices)|necesito|me falta|comp[aá]rteme|me escribes|cu[aá]l es tu|confirm[aá]|me confirmas|podr[íi]as/i.test(t);
const isAsk = (t, campo) => KEY[campo].test(t) && isQuestion(t) && !isConfirm(t);
const fieldEmpty = (c, f) => { const v = norm(c[f]); return !v || v.length < 2 || v.includes('proporcion') || v === 'desconocido'; };
const dateFieldOk = (c) => /^(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[012])\/\d{4}$/.test(String(c.fechaNacimiento || ''));

function mtyToUTCms(str) {
    const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    const [, Y, Mo, D, H = '0', Mi = '0'] = m;
    return Date.parse(`${Y}-${Mo}-${D}T${H.padStart(2, '0')}:${Mi.padStart(2, '0')}:00-06:00`);
}
const args = process.argv.slice(2);
const now = Date.now();
const start = args[0] ? mtyToUTCms(args[0]) : mtyToUTCms(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' })} 00:00`);
const end = args[1] ? mtyToUTCms(args[1]) : now;
const mty = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Monterrey' });

const r = new Redis(url, { tls: url.startsWith('rediss') ? {} : undefined, maxRetriesPerRequest: 3 });
const ids = await r.zrangebyscore('activity:tracker', start, end);

let audited = 0;
const A_mute = [], B_notSaved = [], C_loop = [], C_reask = [];
const detail = [];

for (const id of ids) {
    const blob = await r.get(`candidate:${id}`); if (!blob) continue;
    let c; try { c = JSON.parse(blob); } catch { continue; }
    const msgs = (await r.lrange(`messages:${id}`, -200, -1))
        .map(m => { try { return JSON.parse(m); } catch { return null; } }).filter(Boolean)
        .map(m => ({ ...m, _ms: Date.parse(m.timestamp || 0) }))
        .filter(m => m._ms >= start && m._ms <= end).sort((a, b) => a._ms - b._ms);
    const inbound = msgs.filter(m => m.from === 'user');
    if (!inbound.length) continue;
    audited++;
    const inExtraction = c.paso2Estado !== 'completo'; // completo = ya salió de extracción
    const issues = [];

    // --- A. MUDA (solo en extracción) ---
    if (inExtraction) {
        let i = 0;
        while (i < msgs.length) {
            if (msgs[i].from !== 'user') { i++; continue; }
            let k = i; while (k + 1 < msgs.length && msgs[k + 1].from === 'user') k++;
            const last = msgs[k], body = (last.content || '').trim();
            let next = null; for (let j = k + 1; j < msgs.length; j++) { if (msgs[j].from === 'bot' || msgs[j].from === 'me') { next = msgs[j]; break; } }
            const gap = next ? (next._ms - last._ms) / 1000 : Infinity;
            if (!isButton(body) && body.length >= 2 && gap > 120) {
                A_mute.push({ id, tel: c.whatsapp, t: mty(last._ms), body: body.slice(0, 50), gap: gap === Infinity ? '∞' : Math.round(gap) + 's' });
                issues.push('MUDA');
            }
            i = k + 1;
        }
    }

    // --- B. Dato dado pero NO guardado ---
    const gaveDate = inbound.some(m => looksLikeDate(m.content) && !looksLikeAge(m.content));
    const gaveAge = inbound.some(m => looksLikeAge(m.content));
    const gaveSchool = inbound.some(m => looksLikeSchool(m.content));
    const gaveCat = inbound.some(m => looksLikeCategory(m.content));
    if ((gaveDate || gaveAge) && !dateFieldOk(c)) { B_notSaved.push({ id, tel: c.whatsapp, campo: 'fechaNacimiento', dio: inbound.filter(m => looksLikeDate(m.content) || looksLikeAge(m.content)).map(m => m.content.slice(0, 30))[0], guardado: c.fechaNacimiento || '(vacío)' }); issues.push('NO-GUARDÓ:fecha'); }
    if (gaveSchool && fieldEmpty(c, 'escolaridad')) { B_notSaved.push({ id, tel: c.whatsapp, campo: 'escolaridad', dio: inbound.filter(m => looksLikeSchool(m.content)).map(m => m.content.slice(0, 30))[0], guardado: c.escolaridad || '(vacío)' }); issues.push('NO-GUARDÓ:escolaridad'); }
    if (gaveCat && fieldEmpty(c, 'categoria')) { B_notSaved.push({ id, tel: c.whatsapp, campo: 'categoria', dio: inbound.filter(m => looksLikeCategory(m.content)).map(m => m.content.slice(0, 30))[0], guardado: c.categoria || '(vacío)' }); issues.push('NO-GUARDÓ:categoria'); }

    // --- C. Coherencia: bucle (misma PREGUNTA real ≥3×) y re-pregunta tras dar el dato ---
    for (const campo of Object.keys(KEY)) {
        const asks = msgs.filter(m => m.from === 'bot' && isAsk(m.content || '', campo));
        if (asks.length >= 3) { C_loop.push({ id, tel: c.whatsapp, campo, veces: asks.length }); issues.push(`BUCLE:${campo}`); }
    }
    // re-pregunta REAL de fecha DESPUÉS de que el candidato dio una fecha COMPLETA válida
    const firstDateMsg = msgs.find(m => m.from === 'user' && looksLikeDate(m.content) && !looksLikeAge(m.content));
    if (firstDateMsg) {
        const askAfter = msgs.find(m => m.from === 'bot' && isAsk(m.content || '', 'fecha') && m._ms > firstDateMsg._ms + 1000);
        if (askAfter) { C_reask.push({ id, tel: c.whatsapp, dio: firstDateMsg.content.slice(0, 30), reaskT: mty(askAfter._ms) }); if (!issues.includes('RE-PREGUNTA:fecha')) issues.push('RE-PREGUNTA:fecha'); }
    }

    if (issues.length) detail.push({ tel: c.whatsapp, nombre: c.nombreReal, p2: c.paso2Estado || '(paso1)', issues });
}
await r.quit();

const uniq = (arr) => [...new Set(arr.map(x => x.id || x.tel))].length;
const ln = (s = '') => console.log(s);
ln(`\n============ AUDITORÍA DE EXTRACCIÓN ${mty(start).slice(11, 16)}→${mty(end).slice(11, 16)} MTY (${new Date(start).toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' })}) ============`);
ln(`Chats con extracción auditados: ${audited}`);
ln(`Con ALGÚN problema: ${detail.length}  |  Limpios: ${audited - detail.length}  (${(100 * (audited - detail.length) / audited).toFixed(1)}% OK)`);

ln(`\n── A. BRENDA MUDA EN EXTRACCIÓN (turno de texto sin respuesta ≤120s): ${A_mute.length} turnos / ${uniq(A_mute)} candidatos ──`);
A_mute.forEach(x => ln(`  [${x.t}] ${x.tel} "${x.body}" hueco:${x.gap}`));

ln(`\n── B. DATO DADO PERO NO GUARDADO: ${B_notSaved.length} ──`);
B_notSaved.forEach(x => ln(`  ${x.tel} | ${x.campo}: dijo "${x.dio}" → guardado: ${x.guardado}`));

ln(`\n── C. INCOHERENCIA / BUCLE ──`);
ln(`  Bucle (misma pregunta ≥3×): ${C_loop.length}`);
C_loop.forEach(x => ln(`    ${x.tel} | pidió ${x.campo} ${x.veces}×`));
ln(`  Re-preguntó la fecha DESPUÉS de que el candidato la dio: ${C_reask.length}`);
C_reask.forEach(x => ln(`    ${x.tel} | dio "${x.dio}" y volvió a pedir fecha @${x.reaskT.slice(11, 16)}`));

ln(`\n============ VEREDICTO ============`);
if (!detail.length) ln('✅ Todas las extracciones: Brenda contestó y guardó coherente. Sin incidencias.');
else ln(`⚠️  ${detail.length}/${audited} extracciones con incidencia. Revisar con: node scripts/auditoria/ver-chat.mjs <tel>`);

const outDir = path.join(__dirname, 'out'); fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `extraccion-${new Date(start).toISOString().slice(0, 10)}.json`);
fs.writeFileSync(file, JSON.stringify({ audited, detail, A_mute, B_notSaved, C_loop, C_reask }, null, 1));
ln(`\nDetalle (PII, no commitear): ${file}`);
