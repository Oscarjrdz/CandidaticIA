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
 */

const SNAPSHOT_KEY = 'bandwidth:snapshot:last';
const DAILY_KEY_PREFIX = 'bandwidth:daily:';
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

/**
 * Toma una foto de INFO stats, calcula el delta real desde la ultima foto,
 * y lo acumula en la llave del dia (zona horaria Monterrey).
 * Disenado para llamarse periodicamente desde un cron existente — no crea
 * ningun cron nuevo.
 */
export async function recordBandwidthSnapshot(redis) {
    if (!redis) return;
    try {
        const raw = await redis.info('stats');
        const current = parseInfoStats(raw);

        const lastRaw = await redis.get(SNAPSHOT_KEY);
        const last = lastRaw ? JSON.parse(lastRaw) : null;

        await redis.set(SNAPSHOT_KEY, JSON.stringify(current), 'EX', DAILY_TTL_SECONDS).catch(() => {});

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

        if (!delta.netInputBytes && !delta.netOutputBytes && !delta.commandsProcessed) return;

        const dayKey = `${DAILY_KEY_PREFIX}${todayMty()}`;
        const pipe = redis.pipeline();
        pipe.hincrby(dayKey, 'netInputBytes', Math.round(delta.netInputBytes));
        pipe.hincrby(dayKey, 'netOutputBytes', Math.round(delta.netOutputBytes));
        pipe.hincrby(dayKey, 'commandsProcessed', Math.round(delta.commandsProcessed));
        pipe.hincrby(dayKey, 'samples', 1);
        pipe.expire(dayKey, DAILY_TTL_SECONDS);
        await pipe.exec();
    } catch {
        // El medidor nunca debe afectar el comportamiento del cron que lo llama.
    }
}

/**
 * Regresa el resumen real acumulado de los ultimos `days` dias, mas el total
 * de hoy por separado.
 */
export async function getBandwidthSummary(redis, days = 30) {
    if (!redis) return { today: null, days: [], totals: null };

    const dayStrings = Array.from({ length: days }, (_, i) => todayMty(i));
    const pipe = redis.pipeline();
    dayStrings.forEach(day => pipe.hgetall(`${DAILY_KEY_PREFIX}${day}`));
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

    return {
        today: dayData[0] || null,
        days: dayData,
        totals
    };
}
