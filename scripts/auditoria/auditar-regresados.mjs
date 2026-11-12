/**
 * AUDITORÍA DE REGRESADOS — ¿los candidatos que REGRESAN entran donde deben?
 *
 * Regresado = primerContacto ANTES de la ventana, con mensaje DENTRO de la ventana.
 * Verifica 2 cosas de SISTEMA (no de flujo):
 *   1. NO IGNORADO: su primer mensaje tuvo respuesta (Brenda o flujo) ≤120s.
 *   2. ENTRÓ DONDE DEBÍA: si YA estaba COMPLETO antes de la ventana, NO debe re-extraerse
 *      desde cero (Brenda re-pidiéndole el nombre). Si estaba incompleto, re-extraer es correcto.
 *
 * ⚠️ OJO AL FALSO POSITIVO (lección 2026-11-11): "¿ya tenía nombre?" NO se mide con el
 * candidate.nombreReal ACTUAL — ese se llena durante la extracción de HOY. Se mide con la
 * señal histórica: ¿Brenda dijo "ya tengo todo lo que necesitaba" ANTES de la ventana? Solo
 * eso prueba que el candidato ESTABA completo antes. (Martha/Jose Luis parecían "re-extraídos"
 * pero estaban incompletos desde agosto/octubre — agendados a mano sin terminar su registro.)
 *
 * Uso:  node scripts/auditoria/auditar-regresados.mjs                 # hoy 00:00 → ahora
 *       node scripts/auditoria/auditar-regresados.mjs "2026-11-11 00:00" "2026-11-11 13:30"
 * Solo LEE Redis.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Redis from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.REDIS_URL || fs.readFileSync(path.join(__dirname, '../../.env.production'), 'utf8').match(/REDIS_URL\s*=\s*"?([^"\n]+)"?/)[1];
const FLOWS = { 'flow_1790812900561_nl1jrpg': 'COMPLETOS', 'flow_1790815508746_m6vyas6': 'INCOMPLETOS', 'flow_1793145464887_c2flpv6': 'SIN_EXTRACCION' };

const ASKNAME = /nombre y apellidos|nombre completo|cu[aá]l es tu nombre|compartir tu nombre|p[aá]same tu nombre|compartes tu nombre/i;
const DONE = /ya tengo todo lo que necesitaba|Ya tengo todo/i;
const isButton = (b) => /^(DIME COMO LLEGAR|No estoy en casa|AGENDAR|No quiero ir|Dame Pase|✅|📍|Pide ubicaci|🚌)/i.test(b) || /^[\p{Emoji}\s]+$/u.test(b);

function mtyToUTCms(str) {
    const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    const [, Y, Mo, D, H = '0', Mi = '0'] = m;
    return Date.parse(`${Y}-${Mo}-${D}T${H.padStart(2, '0')}:${Mi.padStart(2, '0')}:00-06:00`);
}
const args = process.argv.slice(2);
const now = Date.now();
const start = args[0] ? mtyToUTCms(args[0]) : mtyToUTCms(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' })} 00:00`);
const end = args[1] ? mtyToUTCms(args[1]) : now;
const hm = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Monterrey' }).slice(11, 16);

const r = new Redis(url, { tls: url.startsWith('rediss') ? {} : undefined, maxRetriesPerRequest: 3 });
const ids = await r.zrangebyscore('activity:tracker', start, end);

let reg = 0; const byVia = {}; const ignored = [], reExtract = [];
for (const id of ids) {
    const c = await r.get(`candidate:${id}`).then(b => { try { return JSON.parse(b); } catch { return null; } });
    if (!c) continue;
    if (Date.parse(c.primerContacto || c.createdAt || 0) >= start) continue; // solo REGRESADOS
    const all = (await r.lrange(`messages:${id}`, -200, -1)).map(m => { try { return JSON.parse(m); } catch { return null; } })
        .filter(Boolean).map(m => ({ ...m, _ms: Date.parse(m.timestamp || 0) }));
    const win = all.filter(m => m._ms >= start && m._ms <= end);
    const inbound = win.filter(m => m.from === 'user');
    if (!inbound.length) continue;
    reg++;
    const firstIn = inbound[0];
    const anyResp = win.some(m => (m.from === 'bot' || m.from === 'me') && m._ms > firstIn._ms);
    const resp120 = win.find(m => (m.from === 'bot' || m.from === 'me') && m._ms >= firstIn._ms && m._ms <= firstIn._ms + 120000);
    const completoAntes = all.some(m => (m.from === 'bot' || m.from === 'me') && m._ms < start && DONE.test(m.content || ''));
    const reAskNameHoy = win.some(m => m.from === 'bot' && ASKNAME.test(m.content || ''));
    const entrada = win.find(m => m.from === 'bot' || m.from === 'me');
    const via = entrada ? (entrada.meta?.flow ? ('flujo ' + (FLOWS[entrada.meta.flowId] || '')) : (entrada.from === 'me' ? 'flujo/humano' : 'brenda')) : 'NADA';

    if (!anyResp && !isButton(firstIn.content || '')) ignored.push({ tel: c.whatsapp, t: hm(firstIn._ms), first: (firstIn.content || '').slice(0, 40), compl: c.paso2Estado === 'completo' });
    else if (completoAntes && reAskNameHoy) reExtract.push({ tel: c.whatsapp, nombre: c.nombreReal, t: hm(firstIn._ms) }); // BUG REAL: completo antes y re-extraído
    else byVia[via] = (byVia[via] || 0) + 1;
}
await r.quit();

const ln = (s = '') => console.log(s);
ln(`\n========= REGRESADOS ${hm(start)}→${hm(end)} MTY (${new Date(start).toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' })}) =========`);
ln(`Regresados (primerContacto < ventana) con mensaje en la ventana: ${reg}`);
ln(`✅ entraron bien: ${reg - ignored.length - reExtract.length}  → por dónde: ${JSON.stringify(byVia)}`);
ln(`⚠️  IGNORADOS (sin respuesta de nadie, y no era clic de botón): ${ignored.length}`);
ignored.forEach(x => ln(`   • ${x.tel} @${x.t} "${x.first}" completo:${x.compl}  (revisar: si era cierre tipo "ok/gracias" es benigno)`));
ln(`🔴 RE-EXTRAÍDOS indebidamente (COMPLETÓ antes y Brenda le re-pidió el nombre): ${reExtract.length}`);
reExtract.forEach(x => ln(`   • ${x.tel} ${x.nombre} @${x.t}`));
if (!reExtract.length) ln('   ✅ ninguno — los completos que regresan no se re-extraen.');
