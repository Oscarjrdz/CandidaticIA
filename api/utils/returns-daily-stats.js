/**
 * Estadística diaria de RETORNADOS — para la gráfica "Atendidos por día" (apilada: nuevos +
 * completos regresados + incompletos regresados) del dashboard.
 *
 * Definición (acordada con Oscar, 2026-11-12):
 *   • Retornado del día D = candidato cuyo PRIMER CONTACTO fue un día ANTERIOR y que VOLVIÓ A ESCRIBIR
 *     el día D (mensaje ENTRANTE o clic en otro anuncio —que genera un entrante—). NO cuenta si solo
 *     lo contactamos nosotros ese día (un envío masivo manda un saliente pero eso no es un retorno).
 *   • Se clasifica por su estatus AL LLEGAR ese día (no por el estado de ahorita):
 *        completo regresado   → ya había completado su perfil ANTES de D (paso2CompletadoAt < inicio de D).
 *        incompleto regresado → aún no había completado al inicio de D (aunque lo complete ese mismo día;
 *                                esa conversión es un "convertido", dato aparte del CTR).
 *   • Un candidato cuenta UNA sola vez por día.
 *
 * Patrón de almacenamiento = ESPEJO de stats:daily:captures (api/candidate-daily-stats.js):
 *   • Dos hashes absolutos por día: RET_COMPLETE_KEY / RET_INCOMPLETE_KEY (ymd → count).
 *   • Hoy se mantiene al día SIN hook en el hot path: computeCtrBlocks (que ya recorre los activos
 *     de hoy para la tarjeta) llama persistTodayReturns() y hace HSET del valor de hoy en cada cómputo
 *     (cacheado 60s). Los días pasados quedan congelados en su último valor computado.
 *   • Backfill ÚNICO (lock-protegido, idempotente) reconstruye los días ANTERIORES a hoy escaneando el
 *     historial de mensajes de los candidatos activos en la ventana — es la única fuente de "qué días
 *     estuvo activo" cada candidato. Corre una vez tras el deploy; de ahí vive del upsert de hoy.
 *
 * Solo este módulo escribe estos hashes. No toca ninguna ruta de caché ni el hot path de mensajes.
 */
const TZ = 'America/Monterrey';
export const RET_COMPLETE_KEY = 'stats:daily:returns:complete';
export const RET_INCOMPLETE_KEY = 'stats:daily:returns:incomplete';
// v2: el backfill ahora cuenta solo retornos REALES (mensaje entrante del candidato), no cualquier
// actividad del día. El nombre nuevo re-dispara el backfill una vez tras el deploy, reconstruyendo
// el histórico sin inflación por envíos masivos salientes.
const INIT_MARKER = 'stats:daily:returns:initialized:v2';
const BACKFILL_LOCK_KEY = 'stats:daily:returns:backfill_lock';
// Cuántos días hacia atrás reconstruye el backfill (cubre de sobra la ventana de 7 días del chart).
const BACKFILL_DAYS = 14;

function mtyDate(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d)) return null;
    return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}
function mtyDayStartMs(ymd) {
    // Monterrey = UTC-6 fijo (sin horario de verano desde 2022).
    return Date.parse(`${ymd}T00:00:00-06:00`);
}

// ¿Estaba COMPLETO al inicio del día `ymd`? (clasificación por estatus al llegar).
// Autoritativo: paso2CompletadoAt. Legado: un completo viejo sin ese timestamp completó hace mucho
// (antes de que existiera el campo) → para cualquier día reciente cuenta como "ya completo".
export function wasCompleteBefore(candidate, dayStartMs) {
    const compAt = candidate.paso2CompletadoAt ? Date.parse(candidate.paso2CompletadoAt) : null;
    if (compAt !== null && !isNaN(compAt)) return compAt < dayStartMs;
    return candidate.paso2Estado === 'completo'; // legado: completó antes del campo → ya estaba completo
}

/**
 * Persiste el conteo de retornados de HOY en los hashes. Lo llama computeCtrBlocks con los blobs
 * de "activos hoy" que YA tiene cargados (cero lecturas extra). Clasifica por estatus al llegar.
 * Devuelve { compReg, incompReg } por si el caller los quiere.
 */
export async function persistTodayReturns(redis, activeTodayBlobs, todayYmd) {
    if (!redis) return { compReg: 0, incompReg: 0 };
    const dayStartMs = mtyDayStartMs(todayYmd);
    let compReg = 0, incompReg = 0;
    for (const c of activeTodayBlobs) {
        const pc = mtyDate(c.primerContacto || c.createdAt);
        if (!pc || pc === todayYmd) continue; // nuevo de hoy → no es retornado
        // Retorno REAL = escribió hoy (entrante). Si solo recibió un saliente (envío masivo) no cuenta.
        const lu = c.lastUserMessageAt ? Date.parse(c.lastUserMessageAt) : 0;
        if (isNaN(lu) || lu < dayStartMs) continue;
        if (wasCompleteBefore(c, dayStartMs)) compReg++; else incompReg++;
    }
    try {
        await redis.pipeline()
            .hset(RET_COMPLETE_KEY, todayYmd, String(compReg))
            .hset(RET_INCOMPLETE_KEY, todayYmd, String(incompReg))
            .exec();
    } catch { /* no bloquear la tarjeta por fallo de persistencia */ }
    return { compReg, incompReg };
}

/**
 * Backfill ÚNICO de los días ANTERIORES a hoy. Escanea el historial de mensajes de los candidatos
 * activos en la ventana para reconstruir, por día, cuántos retornados hubo y su split al llegar.
 * Idempotente (HSET absoluto) y protegido por lock. Excluye HOY (lo mantiene persistTodayReturns).
 */
export async function backfillReturnsDaily(redis) {
    const gotLock = await redis.set(BACKFILL_LOCK_KEY, '1', 'NX', 'EX', 300).catch(() => null);
    if (!gotLock) return false;
    try {
        const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
        const windowStartMs = mtyDayStartMs(todayYmd) - BACKFILL_DAYS * 86400000;
        const complete = {}; // ymd -> count
        const incomplete = {};

        // Solo los candidatos ACTIVOS en la ventana pueden ser "retornados" de algún día de ella.
        // activity:tracker (score = última actividad) acota la población a unos pocos miles en vez
        // de escanear los ~13.6k blobs — y así el backfill termina dentro del maxDuration.
        const ids = await redis.zrangebyscore('activity:tracker', windowStartMs, Date.now());
        const BATCH = 200;
        for (let i = 0; i < ids.length; i += BATCH) {
            const chunk = ids.slice(i, i + BATCH);
            // Blobs + mensajes del lote en dos pipelines (sin leer de a uno).
            const blobPipe = redis.pipeline();
            chunk.forEach(id => blobPipe.get(`candidate:${id}`));
            const msgPipe = redis.pipeline();
            chunk.forEach(id => msgPipe.lrange(`messages:${id}`, -200, -1));
            const [blobRes, msgRes] = await Promise.all([blobPipe.exec(), msgPipe.exec()]);

            for (let j = 0; j < chunk.length; j++) {
                const blobRaw = blobRes?.[j]?.[1];
                if (!blobRaw) continue;
                let c; try { c = JSON.parse(blobRaw); } catch { continue; }
                const pcDay = mtyDate(c.primerContacto || c.createdAt);
                if (!pcDay) continue;
                const rawMsgs = msgRes?.[j]?.[1] || [];
                const activeDays = new Set();
                for (const m of rawMsgs) {
                    let obj; try { obj = JSON.parse(m); } catch { continue; }
                    if (obj.from !== 'user') continue; // solo ENTRANTES = retorno real (no salientes nuestros)
                    const t = Date.parse(obj.timestamp || 0);
                    if (isNaN(t) || t < windowStartMs) continue;
                    const day = mtyDate(obj.timestamp);
                    if (!day || day >= todayYmd) continue;   // hoy lo maneja el upsert en vivo
                    if (pcDay >= day) continue;              // ese día aún no era "retornado"
                    activeDays.add(day);
                }
                for (const day of activeDays) {
                    if (wasCompleteBefore(c, mtyDayStartMs(day))) complete[day] = (complete[day] || 0) + 1;
                    else incomplete[day] = (incomplete[day] || 0) + 1;
                }
            }
        }

        const pipe = redis.pipeline();
        for (const [d, v] of Object.entries(complete)) pipe.hset(RET_COMPLETE_KEY, d, String(v));
        for (const [d, v] of Object.entries(incomplete)) pipe.hset(RET_INCOMPLETE_KEY, d, String(v));
        pipe.set(INIT_MARKER, '1');
        await pipe.exec();
        return true;
    } finally {
        await redis.del(BACKFILL_LOCK_KEY).catch(() => {});
    }
}

// Dispara el backfill una vez (tras deploy) si no está inicializado. No bloquea al caller si otra
// instancia ya lo tomó. Devuelve true si los hashes están listos para leer.
export async function ensureReturnsInitialized(redis) {
    if (!redis) return false;
    let ok = await redis.exists(INIT_MARKER).catch(() => 0);
    if (!ok) {
        const did = await backfillReturnsDaily(redis).catch(() => false);
        ok = did || (await redis.exists(INIT_MARKER).catch(() => 0));
    }
    return !!ok;
}

// Lee los dos hashes y devuelve { [ymd]: { compReg, incompReg } } (solo días con algún valor).
export async function getReturnsMaps(redis) {
    if (!redis) return { complete: {}, incomplete: {} };
    try {
        const [complete, incomplete] = await Promise.all([
            redis.hgetall(RET_COMPLETE_KEY),
            redis.hgetall(RET_INCOMPLETE_KEY),
        ]);
        return { complete: complete || {}, incomplete: incomplete || {} };
    } catch {
        return { complete: {}, incomplete: {} };
    }
}
