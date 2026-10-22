/**
 * GET /api/system/candidate-locations
 * Devuelve la lista de candidatos que han compartido su ubicación, para la sección Mapa.
 * Lee de un jalón el índice ligero `candidatic:candidate_locations` (hash id → {lat,lng,nombre,…})
 * que mantiene el webhook en cada ubicación entrante — NO escanea los blobs de candidatos.
 */
// Caché en memoria (por instancia serverless) del listado de pins: evita re-leer el HGETALL
// completo si varios reclutadores abren/refrescan el mapa seguido. Los pins nuevos llegan en vivo
// por SSE, así que un desfase de hasta CACHE_TTL_MS en la carga inicial es imperceptible.
const CACHE_TTL_MS = 45000;
let _pinsCache = { data: null, ts: 0 };

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { getRedisClient, validateAdminSession } = await import('../utils/storage.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        // Cache hit → responde sin pegarle a Redis.
        const now = Date.now();
        if (_pinsCache.data && (now - _pinsCache.ts) < CACHE_TTL_MS && req.query.fresh !== '1') {
            return res.status(200).json({ success: true, total: _pinsCache.data.length, pins: _pinsCache.data, cached: true });
        }

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        const raw = await redis.hgetall('candidatic:candidate_locations');
        const pins = [];
        for (const [id, val] of Object.entries(raw || {})) {
            let p;
            try { p = JSON.parse(val); } catch { continue; }
            const lat = Number(p?.lat);
            const lng = Number(p?.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            pins.push({ id, lat, lng, nombre: p.nombre || '', whatsapp: p.whatsapp || '', ts: p.ts || 0 });
        }

        _pinsCache = { data: pins, ts: now };
        return res.status(200).json({ success: true, total: pins.length, pins });
    } catch (error) {
        console.error('[candidate-locations] error:', error.message);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
