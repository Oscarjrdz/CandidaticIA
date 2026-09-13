import axios from 'axios';

// Solo se permite proxear media de Meta/WhatsApp (único uso real: renderizar
// imágenes/audio recibidos en el chat — ver ChatWindow.jsx getSafeMediaUrl).
// La validación es por HOSTNAME exacto tras parsear la URL: usar `.includes()`
// sobre el string completo era burlable (`http://evil.com/?x=graph.facebook.com`
// pasaba el filtro y filtraba META_ACCESS_TOKEN al servidor atacante).
function isAllowedMetaHost(hostname) {
    return (
        hostname === 'lookaside.fbsbx.com' ||
        hostname === 'graph.facebook.com' ||
        hostname === 'whatsapp.net' ||
        hostname.endsWith('.whatsapp.net') ||
        hostname.endsWith('.fbcdn.net')
    );
}

export default async function handler(req, res) {
    const { url } = req.query;

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return res.status(400).send('Invalid URL');
    }

    // Solo https y solo hosts de Meta. Sin fallback de redirección (era un
    // open-redirect: nuestro dominio servía para mandar usuarios a cualquier sitio).
    if (parsed.protocol !== 'https:' || !isAllowedMetaHost(parsed.hostname)) {
        return res.status(400).send('URL no permitida');
    }

    try {
        const token = process.env.META_ACCESS_TOKEN;

        const response = await axios.get(parsed.toString(), {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            responseType: 'stream',
            timeout: 30000
            // axios sigue redirecciones (Meta rebota lookaside -> fbcdn para servir bytes)
            // y su librería follow-redirects ya elimina el header Authorization en saltos
            // a otro host, así que el token no se filtra aunque haya redirección.
        });

        // Forward headers
        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Access-Control-Allow-Origin', '*');

        return response.data.pipe(res);

    } catch (error) {
        console.error('Error in /api/proxy:', error.message);
        return res.status(500).send('Proxy Error');
    }
}
