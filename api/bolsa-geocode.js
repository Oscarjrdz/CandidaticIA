/**
 * GET /api/bolsa-geocode?url=<liga de Google Maps>
 *
 * Campo "Ubicación" de la Bolsa de Empleo: pegar una liga de Google Maps → traer la dirección.
 *   1. Expande ligas cortas (maps.app.goo.gl / goo.gl/maps) siguiendo el redirect.
 *   2. Extrae coordenadas y/o nombre del lugar de la URL.
 *   3. Reverse-geocodifica con Nominatim (el mismo servicio que usa el Mapa) para armar una
 *      dirección legible en español.
 *
 * Returns: { success, address, place, lat, lng }
 * Solo acepta hosts de Google Maps / acortadores (candado anti-SSRF).
 */

const UA = 'CandidaticBolsa/1.0 (https://www.candidatic.com)';

// Hosts permitidos: google.<tld>, goo.gl y sus subdominios (maps.app.goo.gl). Evita SSRF.
const ALLOWED_HOST = /(^|\.)(google\.[a-z.]+|goo\.gl)$/i;

function isGoogleMapsUrl(u) {
    try {
        const url = new URL(u);
        if (!/^https?:$/.test(url.protocol)) return false;
        return ALLOWED_HOST.test(url.hostname);
    } catch { return false; }
}

// Prefiere las coords del LUGAR (!3d!4d), luego el centro del mapa (@lat,lng), luego query params.
function extractLatLng(full) {
    let m = full.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { lat: +m[1], lng: +m[2] };
    m = full.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: +m[1], lng: +m[2] };
    m = full.match(/[?&](?:q|query|destination|ll|center|sll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (m) return { lat: +m[1], lng: +m[2] };
    return null;
}

function extractPlace(full) {
    const m = full.match(/\/maps\/place\/([^/@?]+)/);
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); }
    catch { return m[1].replace(/\+/g, ' ').trim(); }
}

// Arma una dirección concisa desde el objeto `address` de Nominatim.
function formatAddress(a) {
    if (!a) return '';
    const parts = [];
    if (a.road) parts.push(a.house_number ? `${a.road} ${a.house_number}` : a.road);
    const colonia = a.neighbourhood || a.suburb || a.quarter;
    if (colonia) parts.push(colonia);
    const city = a.city || a.town || a.village || a.municipality || a.county;
    if (city) parts.push(city);
    if (a.state) parts.push(a.state);
    return parts.join(', ');
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

    const raw = String(req.query.url || '').trim();
    if (!raw) return res.status(400).json({ error: 'Falta url' });
    if (!isGoogleMapsUrl(raw)) return res.status(400).json({ error: 'La liga debe ser de Google Maps' });

    try {
        // 1. Expandir liga corta siguiendo redirects (las largas se parsean directo).
        let full = raw;
        if (/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(raw)) {
            const r = await fetch(raw, { redirect: 'follow', headers: { 'User-Agent': UA } });
            full = r.url || raw;
        }

        const place = extractPlace(full);
        const coords = extractLatLng(full);

        // 2. Reverse-geocode con Nominatim si tenemos coordenadas.
        let address = '';
        if (coords) {
            try {
                const nurl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${coords.lat}&lon=${coords.lng}&accept-language=es`;
                const nr = await fetch(nurl, { headers: { 'User-Agent': UA } });
                if (nr.ok) {
                    const nd = await nr.json();
                    address = formatAddress(nd.address) || nd.display_name || '';
                }
            } catch { /* si falla, caemos al nombre del lugar de la URL */ }
        }

        const result = address || place;
        if (!result) return res.status(422).json({ error: 'No se pudo extraer una dirección de esa liga' });

        return res.status(200).json({
            success: true,
            address: result,
            place: place || null,
            lat: coords?.lat ?? null,
            lng: coords?.lng ?? null,
        });
    } catch (err) {
        console.error('[bolsa-geocode] Error:', err);
        return res.status(500).json({ error: 'Error al procesar la liga' });
    }
}
