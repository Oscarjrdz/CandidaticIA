/**
 * /api/system/map-pins  — pines personalizados del Mapa (creados a mano por reclutadores).
 *
 * Distinto de /api/system/candidate-locations (esos son pins automáticos de candidatos que
 * compartieron su ubicación por WhatsApp y viven en `candidatic:candidate_locations`).
 * Estos los crea el usuario a mano y se guardan en el hash `candidatic:map_pins`
 * (id → JSON {lat,lng,label,note,color,createdBy,ts}).
 *
 *   GET    → lista todos los pines manuales
 *   POST   → crea un pin   { lat, lng, label?, note?, color? }
 *   DELETE → borra un pin   ?id=<id>
 *
 * Todas las mutaciones exigen sesión de admin (patrón estándar del repo).
 */

const PINS_KEY = 'candidatic:map_pins';
const MAX_PINS = 2000;          // tope de seguridad para no inflar el hash sin límite
const MAX_LOGO_LEN = 200000;    // ~150KB en base64; el front ya reduce a miniatura, esto es el tope duro
const COLORS = new Set([
    'blue', 'sky', 'cyan', 'teal', 'emerald', 'green', 'lime', 'amber',
    'orange', 'red', 'rose', 'pink', 'fuchsia', 'violet', 'indigo', 'slate'
]);

function cleanLogo(v) {
    if (typeof v !== 'string') return '';
    if (!v.startsWith('data:image/')) return '';   // solo miniaturas embebidas (data URI)
    if (v.length > MAX_LOGO_LEN) return '';
    return v;
}

function parsePin(id, raw) {
    let p;
    try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
    const lat = Number(p?.lat), lng = Number(p?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
        id,
        lat, lng,
        label: typeof p.label === 'string' ? p.label : '',
        note: typeof p.note === 'string' ? p.note : '',
        color: COLORS.has(p.color) ? p.color : 'blue',
        logo: cleanLogo(p.logo),
        createdBy: p.createdBy || '',
        ts: p.ts || 0
    };
}

export default async function handler(req, res) {
    try {
        const { getRedisClient, validateAdminSession } = await import('../utils/storage.js');
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        // ---- GET: listar (requiere sesión igual que candidate-locations) ----
        if (req.method === 'GET') {
            const userId = await validateAdminSession(req);
            if (!userId) return res.status(401).json({ error: 'No autorizado' });
            const rawAll = await redis.hgetall(PINS_KEY);
            const pins = [];
            for (const [id, val] of Object.entries(rawAll || {})) {
                const pin = parsePin(id, val);
                if (pin) pins.push(pin);
            }
            pins.sort((a, b) => b.ts - a.ts);
            return res.status(200).json({ success: true, total: pins.length, pins });
        }

        // ---- POST: crear ----
        if (req.method === 'POST') {
            const userId = await validateAdminSession(req);
            if (!userId) return res.status(401).json({ error: 'No autorizado' });

            const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
            const lat = Number(body.lat), lng = Number(body.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                return res.status(400).json({ error: 'Coordenadas inválidas' });
            }

            const count = await redis.hlen(PINS_KEY);
            if (count >= MAX_PINS) return res.status(409).json({ error: `Límite de ${MAX_PINS} pines alcanzado` });

            const id = `mp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const pin = {
                lat: +lat.toFixed(6),
                lng: +lng.toFixed(6),
                label: String(body.label || '').slice(0, 120),
                note: String(body.note || '').slice(0, 500),
                color: COLORS.has(body.color) ? body.color : 'blue',
                logo: cleanLogo(body.logo),
                createdBy: userId,
                ts: Date.now()
            };
            await redis.hset(PINS_KEY, id, JSON.stringify(pin));
            return res.status(200).json({ success: true, pin: { id, ...pin } });
        }

        // ---- DELETE: borrar ----
        if (req.method === 'DELETE') {
            const userId = await validateAdminSession(req);
            if (!userId) return res.status(401).json({ error: 'No autorizado' });
            const id = req.query?.id || (typeof req.body === 'object' ? req.body?.id : null);
            if (!id) return res.status(400).json({ error: 'Falta id' });
            await redis.hdel(PINS_KEY, String(id));
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('[map-pins] error:', error.message);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
