function todayMty() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
}

export function estimateJsonBytes(value) {
    if (value === undefined || value === null) return 0;
    try {
        return Buffer.byteLength(JSON.stringify(value));
    } catch {
        return 0;
    }
}

export async function recordUsageMetric(redis, endpoint, metrics = {}) {
    return false;
}

export async function readUsageMetrics(redis, day = todayMty()) {
    return [];
}
