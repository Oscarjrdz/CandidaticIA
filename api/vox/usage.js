/**
 * POST /api/vox/usage
 *
 * El calculador de costo de Vox se PERSISTE server-side (no vive solo en la pantalla).
 * El navegador recibe los eventos `response.done` de la Realtime API con el desglose de tokens
 * y los reporta aquí; el servidor RECALCULA el costo con las tarifas de `vox:config`
 * (fuente de verdad) y acumula por día (zona Monterrey) + guarda un snapshot por sesión.
 *
 * Fire-and-forget desde el cliente: si la pestaña se cierra, lo ya reportado queda registrado.
 */

const DAILY_PREFIX = 'vox:cost:';        // hash por día (zona Monterrey)
const SESSION_PREFIX = 'vox:session:';   // record consolidado por sesión (config + costo)
const SESSION_TTL = 30 * 24 * 60 * 60;   // 30 días de historial para auditar picos

function montyDate() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
}

// Costo en USD a partir del desglose de tokens y las tarifas (USD por 1M tokens).
function computeCostUsd(tok, pricing) {
    const per = (count, rate) => (Number(count) || 0) * (Number(rate) || 0) / 1_000_000;
    return (
        per(tok.audioInput, pricing.audioInput) +
        per(tok.audioInputCached, pricing.audioInputCached) +
        per(tok.audioOutput, pricing.audioOutput) +
        per(tok.textInput, pricing.textInput) +
        per(tok.textInputCached, pricing.textInputCached) +
        per(tok.textOutput, pricing.textOutput)
    );
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { getRedisClient, validateAdminSession } = await import('../utils/storage.js');
        const { VOX_CONFIG_KEY, mergeWithDefaults } = await import('./config.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const sessionId = String(body.sessionId || '').slice(0, 64) || `anon_${Date.now()}`;
        const durationSec = Number(body.durationSec) || 0;
        const tok = {
            audioInput: Number(body.audioInput) || 0,
            audioInputCached: Number(body.audioInputCached) || 0,
            audioOutput: Number(body.audioOutput) || 0,
            textInput: Number(body.textInput) || 0,
            textInputCached: Number(body.textInputCached) || 0,
            textOutput: Number(body.textOutput) || 0,
        };

        // Recalcula el costo con las tarifas server-side (autoritativo).
        const raw = await redis.get(VOX_CONFIG_KEY);
        let stored = null;
        try { stored = raw ? JSON.parse(raw) : null; } catch { stored = null; }
        const cfg = mergeWithDefaults(stored);
        const costUsd = computeCostUsd(tok, cfg.pricing);
        const costMxn = costUsd * (Number(cfg.fxRate) || 0);

        const dayKey = DAILY_PREFIX + montyDate();
        const sessKey = SESSION_PREFIX + sessionId;

        // TODO el payload del cliente es un DELTA desde su último reporte; aquí se acumula.
        // Daily y session usan el mismo esquema de hash para mantener la semántica consistente.
        const pipe = redis.pipeline();
        for (const [field, val] of Object.entries(tok)) {
            pipe.hincrbyfloat(dayKey, field, val);
            pipe.hincrbyfloat(sessKey, field, val);
        }
        pipe.hincrbyfloat(dayKey, 'costUsd', costUsd);
        pipe.hincrbyfloat(dayKey, 'seconds', durationSec);
        pipe.hincrbyfloat(sessKey, 'costUsd', costUsd);
        pipe.hincrbyfloat(sessKey, 'seconds', durationSec);
        if (body.isFinal) pipe.hincrby(dayKey, 'calls', 1);
        pipe.hset(sessKey, 'userId', String(userId), 'updatedAt', new Date().toISOString());
        pipe.expire(dayKey, 400 * 24 * 60 * 60); // ~13 meses de retención
        pipe.expire(sessKey, SESSION_TTL);
        await pipe.exec();

        return res.status(200).json({ success: true, costUsd, costMxn });
    } catch (error) {
        console.error('[vox/usage] error:', error.message);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
