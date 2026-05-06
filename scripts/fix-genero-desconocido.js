/**
 * Fix: convierte genero="Desconocido" a null (o infiere si hay nombre).
 *
 * - Con nombre: intenta inferir Hombre/Mujer por primer nombre en español.
 * - Sin nombre: limpia a null para que Brenda lo resuelva cuando capture el nombre.
 *
 * Uso:      node scripts/fix-genero-desconocido.js
 * Dry run:  DRY_RUN=true node scripts/fix-genero-desconocido.js
 */

import Redis from 'ioredis';
import fs from 'fs';

fs.readFileSync('/Users/oscar/Candidatic_IA/.env.local', 'utf8').split('\n').forEach(line => {
    const t = line.trim(); if (!t || t.startsWith('#')) return;
    const eq = t.indexOf('='); if (eq === -1) return;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq+1).trim();
    if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
    if (k&&v) process.env[k]=v;
});

const DRY_RUN = process.env.DRY_RUN === 'true';
if (DRY_RUN) console.log('🔍 DRY RUN — sin cambios reales.\n');

const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

// Inferencia de género por primer nombre en español
// Lista curada de nombres masculinos que terminan en -a (ambiguos) o son irregulares
const NOMBRES_MASCULINOS = new Set([
    'jose', 'jesus', 'josue', 'elias', 'isaias', 'jeremias', 'jehu', 'zuriel',
    'ezequias', 'nehemias', 'tobias', 'matias', 'zacarías', 'zacarias',
    'moises', 'lucas', 'blas', 'nicolas', 'tomas', 'dimas', 'andres', 'elias',
    'adan', 'hernan', 'ivan', 'juan', 'alan', 'axel', 'daniel', 'miguel',
    'angel', 'manuel', 'rafael', 'gabriel', 'israel', 'ismael', 'samuel',
    'ezra', 'noa', 'luca', 'iker', 'omar', 'cesar', 'edgar', 'oscar',
    'hector', 'victor', 'nestor', 'alfredo', 'roberto', 'alberto',
    'gilberto', 'humberto', 'rigoberto', 'adalberto', 'norberto', 'filiberto',
    'eduardo', 'ernesto', 'francisco', 'javier', 'alejandro', 'antonio',
    'marcos', 'carlos', 'pablo', 'pedro', 'diego', 'sergio', 'mario',
    'mario', 'gerardo', 'ricardo', 'armando', 'fernando', 'leonardo',
    'rolando', 'orlando', 'olando', 'brando', 'leandro',
    'saul', 'raul', 'paul', 'abdiel', 'ezequiel', 'uriel',
    'emilio', 'julio', 'mario', 'mario', 'dario', 'mario', 'silvio',
    'patricio', 'ignacio', 'horacio', 'mauricio', 'federico', 'rodrigo',
]);

const NOMBRES_FEMENINOS = new Set([
    'maria', 'ana', 'laura', 'lucia', 'sofia', 'valentina', 'gabriela',
    'daniela', 'mariana', 'andrea', 'jessica', 'jennifer', 'brenda',
    'karla', 'paola', 'monica', 'veronica', 'patricia', 'diana', 'carolina',
    'adriana', 'alejandra', 'vanessa', 'estefania', 'stephanie', 'cristina',
    'rosa', 'elena', 'irene', 'beatriz', 'sandra', 'claudia', 'alicia',
    'rebeca', 'rebeka', 'martha', 'marta', 'leticia', 'norma', 'gloria',
    'dolores', 'carmen', 'graciela', 'silvia', 'yolanda', 'berenice',
    'blanca', 'fabiola', 'fernanda', 'liliana', 'lorena', 'marisol',
    'miriam', 'natalia', 'nora', 'raquel', 'rocio', 'ruth', 'sara',
    'susana', 'teresa', 'yasmin', 'perla', 'wendy', 'itzel', 'yesenia',
    'xiomara', 'ivonne', 'ivette', 'celeste', 'dulce', 'esperanza',
    'edith', 'esther', 'evelyn', 'flor', 'guadalupe', 'ingrid', 'isabel',
    'jacqueline', 'janeth', 'janet', 'jazmin', 'josefina', 'julieta',
    'karina', 'lidia', 'lizbeth', 'lourdes', 'maribel', 'mariela',
    'melanie', 'melissa', 'mirna', 'nadia', 'nancy', 'noemi', 'ofelia',
    'olga', 'paloma', 'pamela', 'pilar', 'priscila', 'reina', 'sarai',
    'selene', 'sonia', 'stephania', 'tania', 'trinidad', 'viviana',
    'zaira', 'zulema', 'araceli', 'aranza', 'citlali', 'concepcion',
    'consuelo', 'cynthia', 'delia', 'denisse', 'elsa', 'emma', 'erika',
]);

const normalize = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function inferirGenero(nombreReal) {
    if (!nombreReal || typeof nombreReal !== 'string') return null;
    const primer = normalize(nombreReal.trim().split(/\s+/)[0]);
    if (!primer || primer.length < 2) return null;

    if (NOMBRES_MASCULINOS.has(primer)) return 'Hombre';
    if (NOMBRES_FEMENINOS.has(primer)) return 'Mujer';

    // Heurística por terminación
    if (primer.endsWith('a') && !primer.endsWith('ea')) return 'Mujer';  // laura, maria, etc.
    if (primer.endsWith('o')) return 'Hombre';
    if (primer.endsWith('on') || primer.endsWith('in') || primer.endsWith('an')) return 'Hombre';

    return null; // no determinable
}

// ── MIGRACIÓN ──────────────────────────────────────────────────────────────────
const total = await redis.zcard('candidates:list');
const CHUNK = 500;
let offset = 0;
let inferred = 0;
let cleared = 0;

while (offset < total) {
    const ids = await redis.zrevrange('candidates:list', offset, offset + CHUNK - 1);
    if (!ids.length) break;
    const p = redis.pipeline();
    ids.forEach(id => p.get('candidate:' + id));
    const res = await p.exec();

    for (let i = 0; i < ids.length; i++) {
        const [err, raw] = res[i];
        if (err || !raw) continue;
        let c; try { c = JSON.parse(raw); } catch { continue; }

        if (c.genero !== 'Desconocido') continue;

        const generoInferido = inferirGenero(c.nombreReal);

        if (generoInferido) {
            console.log(`  ✅ "${c.nombreReal}" → ${generoInferido}`);
            c.genero = generoInferido;
            inferred++;
        } else {
            c.genero = null;
            cleared++;
        }

        if (!DRY_RUN) {
            await redis.set('candidate:' + ids[i], JSON.stringify(c));
        }
    }

    offset += CHUNK;
    await new Promise(r => setTimeout(r, 5));
}

console.log('\n══════════════════════════════════════════');
console.log(`✅ ${DRY_RUN ? 'DRY RUN' : 'COMPLETADO'}`);
console.log('══════════════════════════════════════════');
console.log(`  Género inferido : ${inferred}`);
console.log(`  Limpiados (null): ${cleared}  ← Brenda los resolverá cuando capture el nombre`);
console.log('══════════════════════════════════════════');

redis.disconnect();
