/**
 * AUDITORÍA DE FUNCIONAMIENTO — una ventana de tiempo, todos los chats que ENTRARON.
 *
 * Revisa los 3 ejes del sistema sobre cada chat con al menos un mensaje ENTRANTE
 * (del candidato) en la ventana, de inicio a fin, haya terminado o no:
 *   EJE 1 — Escenario: ¿entró a donde debía? (nuevos saludados, recurrentes ruteados)
 *   EJE 2 — Extracción de Brenda: paso1/paso2, bucle de fecha, edad-en-años (valida el fix)
 *   EJE 3 — Flujos: COMPLETOS para completos, INCOMPLETOS para incompletos, vacante asignada
 *   ANOMALÍAS — silencio sin handoff (posible drop), flujo DOBLE, incompletos atascados
 *
 * Uso:
 *   node scripts/auditoria/auditar-ventana.mjs "2026-11-10 14:30" "2026-11-10 20:56"
 *   node scripts/auditoria/auditar-ventana.mjs "2026-11-11 00:00"            # desde esa hora hasta AHORA
 *   node scripts/auditoria/auditar-ventana.mjs hoy                           # 00:00 MTY hoy → ahora
 * Las horas se interpretan en zona America/Monterrey.
 *
 * Fuente: Redis de producción (REDIS_URL del entorno o de .env.production).
 * Escribe un JSON de respaldo con el detalle por chat (tiene PII → NO commitear) en
 *   scripts/auditoria/out/auditoria-<startISO>.json
 *
 * NOTA: solo LEE Redis. No escribe nada en producción. Seguro de correr cuando sea.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Redis from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Config: los 2 flujos activos (actualizar si cambian) ---
const FLOWS = {
    'flow_1790812900561_nl1jrpg': 'COMPLETOS',
    'flow_1790815508746_m6vyas6': 'INCOMPLETOS',
    'flow_1793145464887_c2flpv6': 'SIN_EXTRACCION',
};
const CORE = ['nombreReal', 'genero', 'fechaNacimiento', 'municipio', 'categoria', 'escolaridad'];

// --- Resolver REDIS_URL ---
function redisUrl() {
    if (process.env.REDIS_URL) return process.env.REDIS_URL;
    const envPath = path.join(__dirname, '../../.env.production');
    const raw = fs.readFileSync(envPath, 'utf8');
    return raw.match(/REDIS_URL\s*=\s*"?([^"\n]+)"?/)[1];
}

// --- Parseo de la ventana (zona Monterrey = UTC-6, sin DST) ---
function mtyToUTCms(str) {
    // "2026-11-10 14:30" interpretado como hora Monterrey → ms UTC
    const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (!m) throw new Error(`Fecha no válida: "${str}" (usa "YYYY-MM-DD HH:MM")`);
    const [, Y, Mo, D, H = '0', Mi = '0'] = m;
    return Date.parse(`${Y}-${Mo}-${D}T${H.padStart(2, '0')}:${Mi.padStart(2, '0')}:00-06:00`);
}
function parseArgs() {
    const a = process.argv.slice(2);
    const now = Date.now();
    if (a[0] === 'hoy' || !a[0]) {
        const d = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
        return { start: mtyToUTCms(`${d} 00:00`), end: now };
    }
    return { start: mtyToUTCms(a[0]), end: a[1] ? mtyToUTCms(a[1]) : now };
}

const hm = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Monterrey' }).slice(11, 16);
const missing = (c) => {
    const out = [];
    for (const f of CORE) {
        const v = String(c[f] || '').toLowerCase().trim();
        let bad = !c[f] || v.length < 2 || v.includes('proporcion') || v === 'desconocido';
        if (f === 'nombreReal' && !bad && v.split(/\s+/).filter(Boolean).length < 2) bad = true;
        if (f === 'fechaNacimiento' && !bad && !/^(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[012])\/\d{4}$/.test(v)) bad = true;
        if (bad) out.push(f);
    }
    return out;
};
const isFull = (c) => missing(c).length === 0 && c.paso2Estado === 'completo';

async function main() {
    const { start, end } = parseArgs();
    const inWin = (ms) => ms >= start && ms <= end;
    const url = redisUrl();
    const r = new Redis(url, { tls: url.startsWith('rediss') ? {} : undefined, maxRetriesPerRequest: 3 });

    const ids = await r.zrangebyscore('activity:tracker', start, end);
    const D = [];
    for (const id of ids) {
        const blob = await r.get(`candidate:${id}`);
        if (!blob) continue;
        let c; try { c = JSON.parse(blob); } catch { continue; }
        const msgs = (await r.lrange(`messages:${id}`, -150, -1))
            .map(m => { try { return JSON.parse(m); } catch { return null; } })
            .filter(Boolean).map(m => ({ ...m, _ms: Date.parse(m.timestamp || 0) }));
        const inbound = msgs.filter(m => m.from === 'user' && inWin(m._ms));
        if (!inbound.length) continue;
        const lastIn = Math.max(...inbound.map(m => m._ms));
        const botAfter = msgs.some(m => (m.from === 'bot' || m.from === 'me') && m._ms > lastIn);
        const execMembers = {}, progress = {};
        for (const fid of Object.keys(FLOWS)) {
            execMembers[FLOWS[fid]] = await r.sismember(`flow:executed:v1:${fid}`, id);
            progress[FLOWS[fid]] = (await r.exists(`flow:progress:v1:${fid}:${id}`)) ? 1 : 0;
        }
        const flowsInWin = [...new Set(msgs.filter(m => m.meta?.flow && inWin(m._ms)).map(m => FLOWS[m.meta.flowId] || m.meta.flowId))];
        D.push({
            id, nombreReal: c.nombreReal, tel: c.whatsapp,
            isNew: inWin(Date.parse(c.primerContacto || c.createdAt || 0)),
            origen: c.origen, adHeadline: c.adHeadline, adId: c.adId,
            genero: c.genero, fechaNacimiento: c.fechaNacimiento, municipio: c.municipio,
            categoria: c.categoria, escolaridad: c.escolaridad, colonia: c.colonia,
            experiencia: c.experiencia, mesesExperiencia: c.mesesExperiencia,
            paso2Estado: c.paso2Estado, vacanteActual: c.vacanteActual, blocked: c.blocked,
            inbound: inbound.length, botRespondedAfter: botAfter,
            lastInboundTxt: (inbound[inbound.length - 1]?.content || '').slice(0, 120), lastInboundMty: hm(lastIn),
            flowsInWin, execMembers, progress,
            reengaged: await r.get(`flow:reengaged:v1:${id}`).catch(() => null),
            msgs: msgs.filter(m => inWin(m._ms)).map(m => ({
                f: m.from, t: hm(m._ms), ty: m.type, b: (m.content || '').slice(0, 180),
                fl: m.meta?.flow ? (FLOWS[m.meta.flowId] || m.meta.flowId) + '/' + (m.meta.nodeId || '').slice(-6) : undefined,
            })),
        });
    }
    await r.quit();
    D.sort((a, b) => (a.msgs[0]?.t || '').localeCompare(b.msgs[0]?.t || ''));

    // --- Métricas ---
    const flowSig = (c) => {
        const s = new Set(c.flowsInWin);
        for (const [k, v] of Object.entries(c.execMembers)) if (v) s.add(k);
        for (const [k, v] of Object.entries(c.progress)) if (v) s.add(k);
        return [...s];
    };
    const nNew = D.filter(c => c.isNew).length;
    const greeted = D.filter(c => c.isNew).filter(c => {
        const fb = c.msgs.find(m => m.f !== 'user');
        return fb && /Brenda|Hola|reclutadora|vacante|Nombre y Apellidos/i.test(fb.b || '');
    });
    const comp = D.filter(isFull);
    const noVac = comp.filter(c => !c.vacanteActual || !String(c.vacanteActual).trim());
    const dobLoop = D.filter(c => c.msgs.filter(m => m.f === 'bot' && /fecha de nacimiento/i.test(m.b || '')).length >= 3);
    const ageSynth = D.filter(c => /^01\/01\/\d{4}$/.test(String(c.fechaNacimiento || '')));
    const silent = D.filter(c => !c.botRespondedAfter && !c.blocked);
    const bothFlows = D.filter(c => flowSig(c).filter(x => x === 'COMPLETOS' || x === 'INCOMPLETOS').length >= 2);
    const stalled = D.filter(c => !isFull(c) && c.inbound >= 5);

    const ln = (s = '') => console.log(s);
    ln(`\n================ AUDITORÍA ${hm(start)}→${hm(end)} MTY (${new Date(start).toLocaleDateString('sv-SE',{timeZone:'America/Monterrey'})}) ================`);
    ln(`Chats con entrada: ${D.length} | Nuevos: ${nNew} | Recurrentes: ${D.length - nNew} | De anuncio: ${D.filter(c => c.origen === 'facebook_ctwa' || c.adId || c.adHeadline).length}`);
    ln(`Paso1 completo: ${D.filter(c => missing(c).length === 0).length} | Perfil COMPLETO: ${comp.length}`);

    ln(`\n--- EJE 1 ESCENARIOS ---`);
    ln(`Nuevos saludados correctamente: ${greeted.length}/${nNew}${greeted.length === nNew ? ' ✅' : ' ⚠️'}`);
    D.filter(c => c.isNew && !greeted.includes(c)).forEach(c => ln(`  ⚠ ${c.nombreReal || '(s/n)'} ${c.tel}`));

    ln(`\n--- EJE 2 EXTRACCIÓN ---`);
    ln(`Bucle de fecha (bot pidió fecha ≥3×): ${dobLoop.length}`);
    dobLoop.forEach(c => ln(`  • ${c.nombreReal || '(s/n)'} ${c.tel} fnac:${c.fechaNacimiento || 'NUNCA'} p2:${c.paso2Estado || '-'}`));
    ln(`Fechas 01/01/aaaa (edad-en-años sintetizada por el fix): ${ageSynth.length}  [verificar si son post-deploy o recurrentes]`);
    ageSynth.forEach(c => ln(`  • ${c.nombreReal || '(s/n)'} ${c.tel} fnac:${c.fechaNacimiento} new:${c.isNew} comp:${isFull(c)}`));

    ln(`\n--- EJE 3 FLUJOS ---`);
    ln(`Completos: ${comp.length} | con vacante: ${comp.length - noVac.length} | SIN vacante (filtrados): ${noVac.length}`);
    noVac.forEach(c => ln(`  • ${c.nombreReal} gen:${c.genero} fnac:${c.fechaNacimiento} esc:${c.escolaridad} cat:${c.categoria} muni:${c.municipio}`));

    ln(`\n--- ANOMALÍAS ---`);
    ln(`Silencio sin handoff (posible drop): ${silent.length}`);
    silent.forEach(c => ln(`  • ${c.nombreReal || '(s/n)'} ${c.tel} new:${c.isNew} p2:${c.paso2Estado || '-'} últ@${c.lastInboundMty}:"${c.lastInboundTxt.slice(0, 50)}"`));
    ln(`Flujo DOBLE (ambos flujos — debe ser 0 con el fix): ${bothFlows.length}`);
    bothFlows.forEach(c => ln(`  • ${c.nombreReal || '(s/n)'} ${c.tel} p2:${c.paso2Estado} reengaged:${c.reengaged || '-'}`));
    ln(`Incompletos atascados (≥5 inbound): ${stalled.length}`);
    stalled.forEach(c => ln(`  • ${c.nombreReal || '(s/n)'} ${c.tel} inbound:${c.inbound} falta:[${missing(c).join(',')}] p2:${c.paso2Estado || '-'} flujos:[${c.flowsInWin}]`));

    // Respaldo con detalle por chat (PII → NO commitear)
    const outDir = path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `auditoria-${new Date(start).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(D, null, 1));
    ln(`\nDetalle por chat (PII, no commitear): ${file}`);
}
main().catch(e => { console.error(e); process.exit(1); });
