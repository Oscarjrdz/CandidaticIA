/**
 * Imprime la conversación COMPLETA de un candidato (por teléfono o id) directo de Redis,
 * para el deep-dive de una anomalía detectada por auditar-ventana.mjs.
 *
 * Uso:  node scripts/auditoria/ver-chat.mjs 521XXXXXXXXXX
 *       node scripts/auditoria/ver-chat.mjs cand_1794320190795_10ynnvmcd
 *
 * Solo LEE Redis. No escribe nada.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Redis from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOWS = { 'flow_1790812900561_nl1jrpg': 'COMPLETOS', 'flow_1790815508746_m6vyas6': 'INCOMPLETOS', 'flow_1793145464887_c2flpv6': 'SIN_EXTRACCION' };
const url = process.env.REDIS_URL || fs.readFileSync(path.join(__dirname, '../../.env.production'), 'utf8').match(/REDIS_URL\s*=\s*"?([^"\n]+)"?/)[1];
const key = process.argv[2];
if (!key) { console.error('Falta el teléfono o id del candidato.'); process.exit(1); }

const r = new Redis(url, { tls: url.startsWith('rediss') ? {} : undefined });
const fmt = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Monterrey' });

let id = key;
if (!key.startsWith('cand_')) {
    // resolver teléfono → id vía índice
    const idx = await r.hget('candidatic:phone_index', key) || await r.get(`candidatic:phone_index:${key}`);
    if (idx) id = idx;
    else { // fallback: escanear
        const found = (await r.keys('candidate:*')).find(async () => false);
        if (!found) { /* escaneo pesado: intentar por el índice normal */ }
    }
}
const blob = await r.get(`candidate:${id}`);
if (!blob) { console.error(`No encontré candidate:${id} (¿teléfono sin índice? prueba con el id cand_...)`); await r.quit(); process.exit(1); }
const c = JSON.parse(blob);
console.log(`\n===== ${c.nombreReal || c.nombre || '(s/n)'} | ${c.whatsapp} | ${id} =====`);
console.log(`origen:${c.origen || '-'} ad:${c.adHeadline || c.adId || '-'} primerContacto:${c.primerContacto}`);
console.log(`gen:${c.genero || '-'} fnac:${c.fechaNacimiento || '-'} muni:${c.municipio || '-'} cat:${c.categoria || '-'} esc:${c.escolaridad || '-'}`);
console.log(`col:${c.colonia || '-'} exp:${c.experiencia || '-'} meses:${c.mesesExperiencia || '-'} paso2:${c.paso2Estado || '-'} vac:${c.vacanteActual || '-'} blocked:${c.blocked}`);
for (const fid of Object.keys(FLOWS)) {
    const ex = await r.sismember(`flow:executed:v1:${fid}`, id);
    const pr = await r.exists(`flow:progress:v1:${fid}:${id}`);
    if (ex || pr) console.log(`  flujo ${FLOWS[fid]}: exec:${ex} prog:${pr}`);
}
const reeng = await r.get(`flow:reengaged:v1:${id}`); if (reeng) console.log(`  reengaged:${reeng}`);
console.log('---');
const msgs = (await r.lrange(`messages:${id}`, -200, -1)).map(m => { try { return JSON.parse(m); } catch { return null; } }).filter(Boolean);
for (const m of msgs) {
    const who = m.from === 'user' ? '👤 CAND ' : (m.from === 'me' ? '🧑 FLUJO/HUM' : '🤖 BRENDA');
    const fl = m.meta?.flow ? ` {${FLOWS[m.meta.flowId] || m.meta.flowId}/${(m.meta.nodeId || '').slice(-6)}}` : '';
    const body = (m.content || `[${m.type || '?'}]`).replace(/\[MSG_SPLIT\]/g, ' ⏐ ');
    console.log(`[${fmt(m._ms = Date.parse(m.timestamp || 0))}] ${who}${fl}: ${body}`);
}
await r.quit();
