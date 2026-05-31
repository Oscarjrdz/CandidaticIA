/**
 * GET /api/bolsa-image?id=xxx
 * Sirve una imagen guardada por /api/bolsa-upload desde Redis.
 */

export default async function handler(req, res) {
    const { id } = req.query;
    if (!id) return res.status(400).send('Falta id');

    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();
        if (!redis) return res.status(503).send('Storage no disponible');

        const raw = await redis.get(`bolsa_img:${id}`);
        if (!raw) return res.status(404).send('Imagen no encontrada');

        const { data, mime } = JSON.parse(raw);
        const buffer = Buffer.from(data, 'base64');

        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.status(200).send(buffer);

    } catch (err) {
        console.error('[bolsa-image] Error:', err);
        return res.status(500).send('Error interno');
    }
}
