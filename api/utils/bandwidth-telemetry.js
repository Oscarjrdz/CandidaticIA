const TZ = 'America/Monterrey';
const LIMIT_BYTES = 200 * 1024 * 1024 * 1024;
const LAST_ABSOLUTE_BYTES_KEY = 'stats:bandwidth:last_absolute_bytes';
const DRIFT_GRACE_BYTES = 100 * 1024 * 1024;

function datePartsMty(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);

    return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function todayMty() {
    const values = datePartsMty();
    return `${values.year}-${values.month}-${values.day}`;
}

function toNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function parseRedisInfoNumber(info, field) {
    const line = String(info || '').split('\n').find(item => item.startsWith(`${field}:`));
    if (!line) return 0;
    return toNumber(line.split(':')[1]?.trim());
}

async function readCurrentAbsoluteBytes(redis) {
    try {
        const info = await redis.info('stats');
        return parseRedisInfoNumber(info, 'total_net_input_bytes')
            + parseRedisInfoNumber(info, 'total_net_output_bytes');
    } catch {
        return 0;
    }
}

function reconcileTodayBytes({ rawTodayBytes, hourlyTodayBytes, liveDeltaBytes }) {
    const reliableTodayBytes = hourlyTodayBytes > 0
        ? hourlyTodayBytes + liveDeltaBytes
        : rawTodayBytes;
    const driftBytes = Math.max(0, rawTodayBytes - reliableTodayBytes);
    const driftLimit = Math.max(DRIFT_GRACE_BYTES, reliableTodayBytes * 0.5);
    const suspicious = hourlyTodayBytes > 0 && driftBytes > driftLimit;

    return {
        bytes: suspicious ? reliableTodayBytes : rawTodayBytes,
        rawBytes: rawTodayBytes,
        hourlyBytes: hourlyTodayBytes,
        liveDeltaBytes,
        driftBytes,
        suspicious,
        source: suspicious ? 'hourly_reconciled' : 'daily_total'
    };
}

export async function readBandwidthTelemetry(redis) {
    const yearMonthDay = todayMty();
    const yearMonth = yearMonthDay.substring(0, 7);
    const year = parseInt(yearMonthDay.substring(0, 4), 10);
    const month = parseInt(yearMonthDay.substring(5, 7), 10) - 1;
    const today = parseInt(yearMonthDay.substring(8, 10), 10);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const monthKey = `stats:bandwidth:${yearMonth}:total`;
    const dayKeys = [];
    for (let day = 1; day <= daysInMonth; day++) {
        const dd = String(day).padStart(2, '0');
        const mm = String(month + 1).padStart(2, '0');
        dayKeys.push(`stats:bandwidth:${year}-${mm}-${dd}:total`);
    }

    const hourKeys = [];
    for (let hour = 0; hour < 24; hour++) {
        hourKeys.push(`stats:bandwidth:${yearMonthDay}:${String(hour).padStart(2, '0')}:total`);
    }

    const [values, currentAbsoluteBytes] = await Promise.all([
        redis.mget(monthKey, ...dayKeys, ...hourKeys, LAST_ABSOLUTE_BYTES_KEY),
        readCurrentAbsoluteBytes(redis)
    ]);

    const rawUsedBytes = toNumber(values[0]);
    const daily = [];
    for (let index = 0; index < daysInMonth; index++) {
        daily.push({
            day: index + 1,
            bytes: toNumber(values[index + 1]),
            rawBytes: toNumber(values[index + 1]),
            source: 'daily_total'
        });
    }

    const hourlyStart = 1 + daysInMonth;
    const hourly = [];
    for (let index = 0; index < 24; index++) {
        hourly.push({
            hour: index,
            bytes: toNumber(values[hourlyStart + index])
        });
    }

    const lastAbsoluteBytes = toNumber(values[hourlyStart + 24]);
    const liveDeltaBytes = currentAbsoluteBytes >= lastAbsoluteBytes && lastAbsoluteBytes > 0
        ? currentAbsoluteBytes - lastAbsoluteBytes
        : 0;
    const rawTodayBytes = daily[today - 1]?.rawBytes || 0;
    const hourlyTodayBytes = hourly.reduce((sum, row) => sum + row.bytes, 0);
    const todayReconciled = reconcileTodayBytes({ rawTodayBytes, hourlyTodayBytes, liveDeltaBytes });

    if (daily[today - 1]) {
        daily[today - 1] = {
            ...daily[today - 1],
            bytes: todayReconciled.bytes,
            source: todayReconciled.source,
            driftBytes: todayReconciled.driftBytes,
            hourlyBytes: todayReconciled.hourlyBytes,
            liveDeltaBytes: todayReconciled.liveDeltaBytes,
            suspicious: todayReconciled.suspicious
        };
    }

    const usedBytes = Math.max(0, rawUsedBytes - rawTodayBytes + todayReconciled.bytes);

    return {
        success: true,
        usedBytes,
        rawUsedBytes,
        limitBytes: LIMIT_BYTES,
        percentage: usedBytes > 0 ? (usedBytes / LIMIT_BYTES) * 100 : 0,
        month: yearMonth,
        today,
        daysInMonth,
        daily,
        hourly,
        dataQuality: {
            status: todayReconciled.suspicious ? 'reconciled' : 'ok',
            todaySource: todayReconciled.source,
            todayRawBytes: todayReconciled.rawBytes,
            todayDisplayedBytes: todayReconciled.bytes,
            todayHourlyBytes: todayReconciled.hourlyBytes,
            todayLiveDeltaBytes: todayReconciled.liveDeltaBytes,
            todayDriftBytes: todayReconciled.driftBytes
        }
    };
}
