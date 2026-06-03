/**
 * POST /api/bolsa-upload
 * Sube una imagen para la Bolsa de Empleo (logos, fotos de vacante, logos de empresa).
 * Guarda en Redis sin expiración → URL permanente.
 * multipart/form-data  campo: "file"
 * Returns: { success, url }
 */

import { randomUUID } from 'crypto';
import { IncomingForm } from 'formidable';
import { readFileSync } from 'fs';
import os from 'os';

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();
        if (!redis) return res.status(503).json({ error: 'Storage no disponible' });

        const form = new IncomingForm({
            maxFileSize: MAX_BYTES,
            keepExtensions: true,
            uploadDir: os.tmpdir(),
        });

        const [, files] = await form.parse(req);
        const uploaded = files?.file?.[0] || files?.file;
        if (!uploaded) return res.status(400).json({ error: 'No se recibió ningún archivo (campo: file)' });

        const mime = uploaded.mimetype || 'image/jpeg';
        if (!mime.startsWith('image/') && mime !== 'application/pdf') return res.status(400).json({ error: 'Solo se aceptan imágenes o PDF' });

        const buffer = readFileSync(uploaded.filepath);
        if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'Imagen demasiado grande (máx 4 MB)' });

        const id = randomUUID();
        // Guardar en Redis sin TTL → permanente
        await redis.set(`bolsa_img:${id}`, JSON.stringify({
            data: buffer.toString('base64'),
            mime,
            name: uploaded.originalFilename || 'imagen',
        }));

        const url = `https://www.candidatic.com/api/bolsa-image?id=${id}`;
        return res.status(200).json({ success: true, url });

    } catch (err) {
        console.error('[bolsa-upload] Error:', err);
        return res.status(500).json({ error: 'Error al subir imagen' });
    }
}
