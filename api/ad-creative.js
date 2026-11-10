/**
 * Endpoint del creativo de un anuncio (para verlo dentro del chat del candidato).
 * GET /api/ad-creative?adId=<id>
 *
 * El creativo (imagen/texto/título/url/video) se guarda UNA vez por anuncio en la side-key
 * `ad_creative:<adId>` (lo escribe el webhook al primer candidato de cada anuncio) — NO vive en
 * el blob del candidato (se sacó por ancho de banda). Este endpoint lo lee bajo demanda.
 *
 * La `adImageUrl` guardada viene del referral de Meta y es un CDN firmado que EXPIRA. Igual que
 * en ads-stats.js, si hay token de Marketing pedimos el thumbnail fresco del creativo y lo
 * cacheamos aparte (`ad_creative_thumb:<adId>`, TTL corto) para no pegarle a Meta en cada apertura.
 */

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const META_FETCH_TIMEOUT_MS = 8000;
const THUMB_CACHE_TTL_SECONDS = 30 * 60; // 30 min: la imagen fresca basta para varias aperturas

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

    const { validateAdminSession, getRedisClient } = await import('./utils/storage.js');
    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const adId = String(req.query?.adId || '').trim();
    if (!adId) return res.status(400).json({ error: 'adId es requerido' });

    const client = getRedisClient();
    if (!client) return res.status(500).json({ error: 'Redis no disponible' });

    try {
        const raw = await client.get(`ad_creative:${adId}`);
        if (!raw) return res.status(200).json({ adId, found: false });

        let creative;
        try { creative = JSON.parse(raw); } catch { creative = null; }
        if (!creative) return res.status(200).json({ adId, found: false });

        // Imagen fresca del creativo (la URL de referral guardada expira). Cacheada aparte.
        let freshImage = null;
        try {
            freshImage = await client.get(`ad_creative_thumb:${adId}`);
        } catch { /* sin caché de thumb: intentamos abajo */ }

        const adsToken = process.env.META_ADS_TOKEN;
        if (!freshImage && adsToken) {
            freshImage = await fetchFreshThumbnail(adId, adsToken);
            if (freshImage) {
                client.set(`ad_creative_thumb:${adId}`, freshImage, 'EX', THUMB_CACHE_TTL_SECONDS).catch(() => {});
            }
        }

        return res.status(200).json({
            adId,
            found: true,
            adHeadline: creative.adHeadline || null,
            adBody: creative.adBody || null,
            adUrl: creative.adUrl || null,
            adMediaType: creative.adMediaType || null,
            adVideoUrl: creative.adVideoUrl || null,
            // Preferir la imagen fresca de Meta; si no, la guardada (puede estar expirada).
            adImageUrl: freshImage || creative.adImageUrl || null
        });
    } catch (error) {
        console.error('Error leyendo creativo de anuncio:', error.message);
        return res.status(500).json({ error: 'Error al leer el creativo del anuncio' });
    }
}

// Pide a Meta el thumbnail del creativo de UN anuncio. Devuelve la URL o null (anuncio
// borrado/sin permiso/sin token válido → se cae a la imagen guardada en el caller).
async function fetchFreshThumbnail(adId, adsToken) {
    const fields = 'creative.thumbnail_width(512).thumbnail_height(512){thumbnail_url}';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);
    try {
        const url = `${GRAPH_BASE_URL}/${adId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(adsToken)}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        const data = await response.json();
        return data?.creative?.thumbnail_url || null;
    } catch {
        return null; // timeout / red / anuncio inaccesible — best effort
    } finally {
        clearTimeout(timer);
    }
}
