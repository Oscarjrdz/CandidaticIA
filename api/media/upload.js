import { getRedisClient } from '../utils/storage.js';
import { IncomingForm } from 'formidable';
import { readFileSync } from 'fs';
import path from 'path';

export const config = {
    api: {
        bodyParser: false // Needed for multipart/form-data
    }
};

/**
 * POST /api/media/upload
 * Accepts: multipart/form-data with a 'file' field
 * Returns: { success, url, id, mime }
 *
 * This endpoint is called by ChatSection.jsx when the user attaches
 * an image, video, audio, or document to send via WhatsApp.
 */
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const redis = getRedisClient();
        if (!redis) {
            return res.status(500).json({ error: 'Database connection failed' });
        }

        // Parse multipart form
        const form = new IncomingForm({
            maxFileSize: 16 * 1024 * 1024, // 16MB max
            keepExtensions: true
        });

        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const uploadedFile = files?.file?.[0] || files?.file;
        if (!uploadedFile) {
            return res.status(400).json({ error: 'No file provided. Use field name "file".' });
        }

        const filePath = uploadedFile.filepath;
        const originalFilename = uploadedFile.originalFilename || 'archivo';
        const mimeType = uploadedFile.mimetype || 'application/octet-stream';
        const fileSize = uploadedFile.size || 0;

        // Read file and convert to base64
        const fileBuffer = readFileSync(filePath);
        const base64Data = fileBuffer.toString('base64');

        // Guard: 10MB base64 limit (to be safe with Redis storage)
        if (base64Data.length > 10 * 1024 * 1024) {
            return res.status(413).json({ error: 'Archivo demasiado grande (máx 10MB)' });
        }

        // Generate unique ID
        const id = `med_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const key = `image:${id}`;
        const metaKey = `meta:image:${id}`;

        // Store in Redis (persistent, no expiration)
        const pipeline = redis.pipeline();
        pipeline.set(key, base64Data);
        pipeline.set(metaKey, JSON.stringify({
            mime: mimeType,
            filename: originalFilename,
            size: fileSize,
            createdAt: new Date().toISOString()
        }));
        // Add to media library sorted set for MediaLibrarySection
        pipeline.zadd('candidatic:media_library', Date.now(), id);
        await pipeline.exec();

        // Also upload to Meta to pre-cache the media_id for instant sending
        let metaMediaId = null;
        try {
            const { uploadMediaToMeta } = await import('../whatsapp/utils.js');
            const result = await uploadMediaToMeta(fileBuffer, mimeType, originalFilename);
            if (result?.mediaId) {
                metaMediaId = result.mediaId;
                // Store the media_id alongside the file metadata
                await redis.set(metaKey, JSON.stringify({
                    mime: mimeType,
                    filename: originalFilename,
                    size: fileSize,
                    createdAt: new Date().toISOString(),
                    metaMediaId: metaMediaId
                }));
                console.log(`[media/upload] ✅ Pre-uploaded to Meta → media_id=${metaMediaId}`);
            }
        } catch (e) {
            console.error(`[media/upload] ⚠️ Meta pre-upload failed (will retry at send time):`, e.message);
        }

        // URL que el chat.js puede convertir a absoluta para GatewayWapp
        const publicUrl = `/api/image?id=${id}`;

        console.log(`[media/upload] ✅ Stored ${id} (${mimeType}, ${Math.round(fileSize / 1024)}KB)${metaMediaId ? ' + Meta pre-cached' : ''}`);

        return res.status(200).json({
            success: true,
            url: publicUrl,
            mediaUrl: publicUrl,
            id,
            mime: mimeType,
            filename: originalFilename,
            metaMediaId
        });

    } catch (error) {
        console.error('[media/upload] ❌ Error:', error.message);
        return res.status(500).json({ error: 'Error interno al subir archivo', details: error.message });
    }
}
