/**
 * CTR de completos — cómputo REAL (sin tope de 100) de los dos bloques del dashboard:
 *   - `today`      : candidatos cuyo PRIMER CONTACTO es hoy (00:00 → ahora, zona Monterrey).
 *   - `ultimos100` : los 100 candidatos más recientes (mismo criterio que la tarjeta clásica).
 *
 * Por qué se lee el superconjunto "activos hoy": `candidates:list` está ordenado por
 * `ultimoMensaje`, no por `primerContacto`. Un candidato con primer contacto HOY siempre tiene
 * también `ultimoMensaje` de hoy, así que cae dentro del rango [00:00, +inf). Leemos ese rango
 * y filtramos por fecha de lead. En días normales ese superconjunto es el tráfico de
 * conversaciones del día; los envíos masivos (que inflarían el rango) son esporádicos, así que
 * no justifican un índice extra. El resultado se cachea 60s en Redis para no releer blobs en
 * cada petición del dashboard ni en cada consulta de Grok.
 *
 * La lógica de completitud y "paso atorado" se reusa de src/utils/profileUtils.js (fuente única,
 * la misma que usa el frontend) para que el número del servidor y el del cliente nunca difieran.
 */
import { getRedisClient } from './storage.js';
import { isProfileComplete, firstMissingStep, STUCK_STEPS } from '../../src/utils/profileUtils.js';

const TZ = 'America/Monterrey';
const LIST_KEY = 'candidates:list';
const PREFIX = 'candidate:';
const CACHE_KEY = 'stats:ctr:v1';
const CACHE_TTL_SECONDS = 60;
// Tope de candidatos listados por bucket que se guardan en caché (composición para Grok). Más
// allá de esto solo cuenta el número; evita cachear miles de refs en días grandes.
const MAX_REFS_PER_BUCKET = 500;

// 00:00 de HOY en Monterrey → epoch ms. Monterrey es UTC-6 fijo (México sin horario de verano
// desde 2022), por eso el offset literal -06:00 es estable y no depende del TZ del servidor.
function mtyTodayYmd() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}
function mtyTodayStartMs() {
    return Date.parse(`${mtyTodayYmd()}T00:00:00-06:00`);
}
function mtyDateOf(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d)) return null;
    return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}

function candName(c) {
    return (c.nombreReal && String(c.nombreReal).trim())
        || (c.nombre && String(c.nombre).trim())
        || c.whatsapp
        || c.id;
}

async function mgetCandidates(redis, ids) {
    if (!ids || !ids.length) return [];
    const raws = await redis.mget(ids.map(id => PREFIX + id));
    const out = [];
    for (let i = 0; i < raws.length; i++) {
        if (!raws[i]) continue;
        try {
            const c = JSON.parse(raws[i]);
            if (!c.id) c.id = ids[i];
            out.push(c);
        } catch { /* blob corrupto: lo ignoramos */ }
    }
    return out;
}

// Clasifica un cohorte de candidatos (ya hidratados) en completos + atorados por paso,
// guardando la composición (id + nombre) de cada bucket con tope.
function classify(cohort) {
    const completosRefs = [];
    const stuckBuckets = {}; // key -> [{id,name}]
    for (const c of cohort) {
        if (isProfileComplete(c)) {
            if (completosRefs.length < MAX_REFS_PER_BUCKET) completosRefs.push({ id: c.id, nombre: candName(c) });
            continue;
        }
        const step = firstMissingStep(c) || 'otro';
        if (!stuckBuckets[step]) stuckBuckets[step] = [];
        if (stuckBuckets[step].length < MAX_REFS_PER_BUCKET) stuckBuckets[step].push({ id: c.id, nombre: candName(c) });
    }
    const total = cohort.length;
    const completos = cohort.filter(isProfileComplete).length;
    const stuck = STUCK_STEPS
        .map(s => ({ key: s.key, short: s.short, label: s.label, count: (stuckBuckets[s.key] || []).length, refs: stuckBuckets[s.key] || [] }))
        .filter(s => s.count > 0);
    return {
        total,
        completos,
        pct: total > 0 ? Math.round((completos / total) * 100) : 0,
        completosRefs,
        stuck,
    };
}

// Cómputo fresco (sin caché) de ambos bloques, con composición.
export async function computeCtrBlocks() {
    const redis = getRedisClient();
    if (!redis) return null;

    const startMs = mtyTodayStartMs();
    const todayYmd = mtyTodayYmd();

    // HOY: activos hoy (superconjunto) → filtrar por fecha de lead == hoy.
    const activeTodayIds = await redis.zrangebyscore(LIST_KEY, startMs, '+inf');
    const activeToday = await mgetCandidates(redis, activeTodayIds);
    const todayCohort = activeToday.filter(c => mtyDateOf(c.primerContacto || c.createdAt) === todayYmd);

    // RETORNADOS COMPLETOS DE HOY: candidatos con perfil completo que YA existían (primer contacto
    // en un día anterior) y volvieron a escribir hoy. Señal de actividad de Sala de Espera. Se saca
    // del MISMO superconjunto "activos hoy" (sin lectura extra de Redis): activos hoy − leads nuevos
    // de hoy, filtrado a completos. Disjunto del cohorte de hoy (esos tienen primer contacto hoy),
    // así que nunca se cuenta dos veces un "completo nuevo" como "retornado".
    const retornadosCohort = activeToday.filter(c =>
        isProfileComplete(c) && mtyDateOf(c.primerContacto || c.createdAt) !== todayYmd
    );
    const retornosRefs = [];
    for (const c of retornadosCohort) {
        if (retornosRefs.length < MAX_REFS_PER_BUCKET) retornosRefs.push({ id: c.id, nombre: candName(c) });
    }

    // ÚLTIMOS 100: los 100 más recientes del índice.
    const last100Ids = await redis.zrevrange(LIST_KEY, 0, 99);
    const last100 = await mgetCandidates(redis, last100Ids);

    return {
        today: classify(todayCohort),
        ultimos100: classify(last100),
        retornosHoy: { total: retornadosCohort.length, refs: retornosRefs },
        asOf: Date.now(),
        fecha: todayYmd,
    };
}

// Versión cacheada 60s en Redis (compartida por el endpoint del dashboard y la tool de Grok).
export async function getCtrBlocksCached() {
    const redis = getRedisClient();
    if (!redis) return null;
    const cacheKey = `${CACHE_KEY}:${mtyTodayYmd()}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) return { ...JSON.parse(cached), cache: 'hit' };
    } catch { /* caché ilegible: recomputar */ }

    const fresh = await computeCtrBlocks();
    if (fresh) {
        try { await redis.set(cacheKey, JSON.stringify(fresh), 'EX', CACHE_TTL_SECONDS); } catch { /* no bloquear por fallo de caché */ }
    }
    return fresh ? { ...fresh, cache: 'miss' } : null;
}

// Proyección ligera para el dashboard: solo conteos (sin la composición id+nombre).
export function stripComposition(block) {
    if (!block) return { total: 0, completos: 0, pct: 0, stuck: [] };
    return {
        total: block.total,
        completos: block.completos,
        pct: block.pct,
        stuck: (block.stuck || []).map(s => ({ key: s.key, short: s.short, count: s.count })),
    };
}
