import { getRedisClient } from '../utils/storage.js';
import { IncomingForm } from 'formidable';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';

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

        const form = new IncomingForm({
            maxFileSize: 16 * 1024 * 1024, // 16MB max
            keepExtensions: true,
            uploadDir: os.tmpdir() // Explicitly set for Vercel Serverless
        });

        const [fields, files] = await form.parse(req);

        const uploadedFile = files?.file?.[0] || files?.file;
        if (!uploadedFile) {
            return res.status(400).json({ error: 'No file provided. Use field name "file".' });
        }

        const filePath = uploadedFile.filepath;
        const originalFilename = uploadedFile.originalFilename || 'archivo';
        const mimeType = uploadedFile.mimetype || 'application/octet-stream';
        const fileSize = uploadedFile.size || 0;

        // Read file
        const fileBuffer = readFileSync(filePath);

        // Also upload to Meta to pre-cache the media_id for instant sending
        let metaMediaId = null;
        try {
            const { uploadMediaToMeta } = await import('../whatsapp/utils.js');
            const result = await uploadMediaToMeta(fileBuffer, mimeType, originalFilename);
            if (result?.mediaId) {
                metaMediaId = result.mediaId;
                console.log(`[media/upload] ✅ Pre-uploaded to Meta → media_id=${metaMediaId}`);
            }
        } catch (e) {
            console.error(`[media/upload] ⚠️ Meta pre-upload failed:`, e.message);
        }

        // Generate unique ID
        const id = `med_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const key = `image:${id}`;
        const metaKey = `meta:image:${id}`;

        const metaData = {
            mime: mimeType,
            filename: originalFilename,
            size: fileSize,
            createdAt: new Date().toISOString(),
            metaMediaId: metaMediaId
        };

        const redisOps = [
            redis.set(metaKey, JSON.stringify(metaData), 'EX', 172800), // metadata lives 48h
            redis.zadd('candidatic:media_library', Date.now(), id)
        ];

        // Only store the bulky base64 in Redis if Meta upload failed (fallback mode)
        // Set TTL to 10 minutes instead of 48 hours to avoid OOM
        if (!metaMediaId) {
             const base64Data = fileBuffer.toString('base64');
             if (base64Data.length > 5 * 1024 * 1024) {
                 return res.status(413).json({ error: 'El archivo es demasiado grande (> 5MB) y Meta rechazó la subida directa.' });
             }
             redisOps.push(redis.set(key, base64Data, 'EX', 600)); // 10 minutes
        }

        await Promise.all(redisOps);

        // URL que el chat.js puede convertir a absoluta para GatewayWapp
        const publicUrl = `/api/image?id=${id}`;

        console.log(`[media/upload] ✅ Stored ${id} (${mimeType}, ${Math.round(fileSize / 1024)}KB)${metaMediaId ? ' + Meta pre-cached (NO REDIS BLOB)' : ' + Redis Fallback Blob'}`);

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
        console.error('[media/upload] ❌ Error:', error.stack || error.message);
        return res.status(500).json({ error: `Error interno: ${error.message}` });
    }
}
