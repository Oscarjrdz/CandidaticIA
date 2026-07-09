/**
 * Medidor de ancho de banda de Redis — datos reales, no estimados.
 *
 * Lee los contadores nativos de Redis (`INFO stats`: total_net_input_bytes /
 * total_net_output_bytes), que son los mismos que usa el motor internamente
 * — no un heuristico de JSON.stringify sobre payloads de la app.
 *
 * Como esos contadores son acumulados desde que el proceso de Redis arranco
 * (se resetean si Redis reinicia), este modulo toma una foto periodica,
 * calcula el delta contra la foto anterior, y lo acumula por dia en Redis.
 * Si el valor actual es menor al de la foto anterior, se asume un reinicio
 * del proceso y el delta completo se cuenta desde cero (evita numeros
 * negativos).
 *
 * DESGLOSE "DE DONDE" (todo dato real, no estimado):
 *  - Por comando: delta de `INFO commandstats` por dia (GET, LRANGE, SCARD...).
 *    Redis ya lleva esos contadores — cero overhead en el path caliente.
 *  - Scans caros: contadores por dia de cuantas veces corren las lecturas
 *    completas (filter-counts, ads-stats) — se incrementan desde el codigo
 *    que hace el scan (recordScanEvent).
 *  - Tamano de blob: muestra pequena del peso promedio del candidato, para
 *    detectar si vuelve a inflarse (regresion).
 */

const SNAPSHOT_KEY = 'bandwidth:snapshot:last';
const DAILY_KEY_PREFIX = 'bandwidth:daily:';
const COMMANDS_KEY_PREFIX = 'bandwidth:commands:';
const SCANS_KEY_PREFIX = 'bandwidth:scans:';
const BLOBSIZE_KEY_PREFIX = 'bandwidth:blobsize:';
const DAILY_TTL_SECONDS = 60 * 60 * 24 * 95; // ~95 dias — suficiente para vista mensual con margen
const TZ = 'America/Monterrey';

function todayMty(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}

function parseInfoStats(raw) {
    const get = (key) => {
        const m = raw.match(new RegExp(`${key}:([^\r\n]+)`));
        return m ? Number(m[1]) : 0;
    };
    return {
        netInputBytes: get('total_net_input_bytes'),
        netOutputBytes: get('total_net_output_bytes'),
        commandsProcessed: get('total_commands_processed')
    };
}

/** Parsea `INFO commandstats` -> { GET: calls, LRANGE: calls, ... } (mayusculas). */
function parseCommandStats(raw) {
    const out = {};
    if (!raw) return out;
    for (const line of raw.split('\n')) {
        const m = line.match(/^cmdstat_([^:]+):calls=(\d+)/);
        if (m) out[m[1].toUpperCase()] = Number(m[2]);
    }
    return out;
}

/**
 * Toma una foto de INFO stats + commandstats, calcula el delta real desde la
 * ultima foto, y lo acumula en la llave del dia (zona horaria Monterrey).
 * Disenado para llamarse periodicamente desde un cron existente — no crea
 * ningun cron nuevo.
 */
export async function recordBandwidthSnapshot(redis) {
    if (!redis) return;
    try {
        const [rawStats, rawCmd] = await Promise.all([
            redis.info('stats'),
            redis.info('commandstats').catch(() => '')
        ]);
        const current = parseInfoStats(rawStats);
        const currentCmds = parseCommandStats(rawCmd);

        const lastRaw = await redis.get(SNAPSHOT_KEY);
        const last = lastRaw ? JSON.parse(lastRaw) : null;

        const snapshot = { ...current, commands: currentCmds };
        await redis.set(SNAPSHOT_KEY, JSON.stringify(snapshot), 'EX', DAILY_TTL_SECONDS).catch(() => {});

        // Muestra ligera del tamano de blob de candidato (regresion de adBody, etc.)
        sampleBlobSize(redis).catch(() => {});

        if (!last) return; // primera corrida: solo establece el punto de partida

        const delta = {
            netInputBytes: current.netInputBytes - last.netInputBytes,
            netOutputBytes: current.netOutputBytes - last.netOutputBytes,
            commandsProcessed: current.commandsProcessed - last.commandsProcessed
        };

        // Reset de contadores (reinicio de Redis): el delta es el valor actual completo
        if (delta.netInputBytes < 0) delta.netInputBytes = current.netInputBytes;
        if (delta.netOutputBytes < 0) delta.netOutputBytes = current.netOutputBytes;
        if (delta.commandsProcessed < 0) delta.commandsProcessed = current.commandsProcessed;

        const dayKey = `${DAILY_KEY_PREFIX}${todayMty()}`;
        const pipe = redis.pipeline();
        if (delta.netInputBytes || delta.netOutputBytes || delta.commandsProcessed) {
            pipe.hincrby(dayKey, 'netInputBytes', Math.round(delta.netInputBytes));
            pipe.hincrby(dayKey, 'netOutputBytes', Math.round(delta.netOutputBytes));
            pipe.hincrby(dayKey, 'commandsProcessed', Math.round(delta.commandsProcessed));
            pipe.hincrby(dayKey, 'samples', 1);
            pipe.expire(dayKey, DAILY_TTL_SECONDS);
        }

        // Delta por comando -> acumular en bandwidth:commands:<dia>
        const lastCmds = last.commands || {};
        const cmdDayKey = `${COMMANDS_KEY_PREFIX}${todayMty()}`;
        let anyCmd = false;
        for (const [cmd, calls] of Object.entries(currentCmds)) {
            let d = calls - (lastCmds[cmd] || 0);
            if (d < 0) d = calls; // reset -> cuenta desde cero
            if (d > 0) { pipe.hincrby(cmdDayKey, cmd, d); anyCmd = true; }
        }
        if (anyCmd) pipe.expire(cmdDayKey, DAILY_TTL_SECONDS);

        await pipe.exec();
    } catch {
        // El medidor nunca debe afectar el comportamiento del cron que lo llama.
    }
}

/** Muestra el peso promedio de una muestra chica de candidatos (bytes reales). */
async function sampleBlobSize(redis) {
    const ids = await redis.zrevrange('candidates:list', 0, 24);
    if (!ids || !ids.length) return;
    const pipe = redis.pipeline();
    ids.forEach(id => pipe.get(`candidate:${id}`));
    const rows = await pipe.exec();
    const enc = new TextEncoder();
    let total = 0, n = 0;
    for (const [err, r] of rows) {
        if (err || !r) continue;
        total += enc.encode(r).length; // bytes UTF-8 reales (TextEncoder: global en Node y browser)
        n++;
    }
    if (!n) return;
    await redis.set(`${BLOBSIZE_KEY_PREFIX}${todayMty()}`, String(Math.round(total / n)), 'EX', DAILY_TTL_SECONDS).catch(() => {});
}

/**
 * Registra que corrio una lectura completa cara (fire-and-forget, cero await
 * en el path que lo llama). `source` ej: 'filter_counts', 'ads_stats'.
 */
export function recordScanEvent(redis, source) {
    if (!redis || !source) return;
    const key = `${SCANS_KEY_PREFIX}${todayMty()}`;
    redis.hincrby(key, source, 1).catch(() => {});
    redis.expire(key, DAILY_TTL_SECONDS).catch(() => {});
}

/**
 * Regresa el resumen real acumulado de los ultimos `days` dias, mas el total
 * de hoy por separado, mas el desglose "de donde" (comandos, scans, blob) de hoy.
 */
export async function getBandwidthSummary(redis, days = 30) {
    if (!redis) return { today: null, days: [], totals: null };

    const dayStrings = Array.from({ length: days }, (_, i) => todayMty(i));
    const todayStr = todayMty();
    const pipe = redis.pipeline();
    dayStrings.forEach(day => pipe.hgetall(`${DAILY_KEY_PREFIX}${day}`));
    pipe.hgetall(`${COMMANDS_KEY_PREFIX}${todayStr}`);
    pipe.hgetall(`${SCANS_KEY_PREFIX}${todayStr}`);
    pipe.get(`${BLOBSIZE_KEY_PREFIX}${todayStr}`);
    const rows = await pipe.exec();

    const dayData = dayStrings.map((day, i) => {
        const raw = rows[i]?.[1] || {};
        return {
            day,
            netInputBytes: Number(raw.netInputBytes || 0),
            netOutputBytes: Number(raw.netOutputBytes || 0),
            commandsProcessed: Number(raw.commandsProcessed || 0),
            samples: Number(raw.samples || 0)
        };
    });

    const totals = dayData.reduce((acc, d) => {
        acc.netInputBytes += d.netInputBytes;
        acc.netOutputBytes += d.netOutputBytes;
        acc.commandsProcessed += d.commandsProcessed;
        return acc;
    }, { netInputBytes: 0, netOutputBytes: 0, commandsProcessed: 0 });

    // Desglose de hoy
    const cmdRaw = rows[days]?.[1] || {};
    const commandsToday = Object.entries(cmdRaw)
        .map(([cmd, calls]) => ({ cmd, calls: Number(calls) }))
        .sort((a, b) => b.calls - a.calls);

    const scanRaw = rows[days + 1]?.[1] || {};
    const scansToday = Object.entries(scanRaw)
        .map(([source, count]) => ({ source, count: Number(count) }))
        .sort((a, b) => b.count - a.count);

    const avgBlobBytesToday = Number(rows[days + 2]?.[1] || 0);

    return {
        today: dayData[0] || null,
        days: dayData,
        totals,
        commandsToday,
        scansToday,
        avgBlobBytesToday
    };
}
