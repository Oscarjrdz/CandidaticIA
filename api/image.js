import { getRedisClient } from './utils/storage.js';

const ONE_YEAR_SECONDS = 31536000;

function setPublicMediaCacheHeaders(res, etag) {
    res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, s-maxage=${ONE_YEAR_SECONDS}, immutable`);
    res.setHeader('CDN-Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
    res.setHeader('Vercel-CDN-Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (etag) res.setHeader('ETag', etag);
}

function buildMediaEtag(rawId, meta = {}) {
    const version = [
        rawId,
        meta.size || '',
        meta.createdAt || '',
        meta.metaMediaId || '',
        meta.mime || ''
    ].join(':');
    return `"${Buffer.from(version).toString('base64url')}"`;
}

async function trackMediaHit(client, source, bytes = 0) {
    if (process.env.MEDIA_METRICS !== 'true') return;
    try {
        const pipeline = client.pipeline();
        pipeline.incr(`metrics:media:${source}:hits`);
        if (bytes) pipeline.incrby(`metrics:media:${source}:bytes`, bytes);
        await pipeline.exec();
    } catch (_) {}
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).send('Method not allowed');
    }

    const { id } = req.query;

    if (!id) {
        return res.status(400).send('Missing ID');
    }

    try {
        const client = getRedisClient();
        if (!client) {
            console.error('Redis client not available in /api/image');
            return res.status(500).send('Database Error');
        }

        // Handle ?id=img_123 and ?id=img_123.jpg
        const rawId = String(Array.isArray(id) ? id[0] : id).split('.')[0];
        const requestedExt = req.query.ext;

        const key = `image:${rawId}`;
        const metaKey = `meta:image:${rawId}`;

        const metaRaw = await client.get(metaKey);
        const meta = metaRaw ? JSON.parse(metaRaw) : { mime: 'image/jpeg' };
        const etag = buildMediaEtag(rawId, meta);

        // Let browsers/CDN answer repeat views without pulling the blob from Redis/Meta.
        setPublicMediaCacheHeaders(res, etag);
        if (req.headers['if-none-match'] === etag) {
            await trackMediaHit(client, 'not_modified');
            return res.status(304).end();
        }

        if (req.method === 'HEAD' && meta.size) {
            let headMime = meta.mime;
            if (requestedExt === 'jpg' || requestedExt === 'jpeg') {
                headMime = 'image/jpeg';
            }
            res.setHeader('Content-Type', headMime);
            res.setHeader('Content-Length', meta.size);
            await trackMediaHit(client, 'head');
            return res.status(200).end();
        }

        let buffer;
        let source = 'redis';
        const data = await client.get(key);
        if (data) {
            // Binary conversion from Redis cache
            buffer = Buffer.from(data, 'base64');
        } else if (meta.blobPath && process.env.BLOB_READ_WRITE_TOKEN) {
            // 🗄️ Almacenamiento permanente (Vercel Blob, store PRIVADO): se sirve el
            // contenido a traves de esta funcion — el CDN de Vercel lo cachea 1 año
            // (headers ya puestos arriba), asi que el Blob solo se lee en el primer hit.
            source = 'blob';
            try {
                const { get } = await import('@vercel/blob');
                const result = await get(meta.blobPath, { access: 'private' });
                if (result?.stream) {
                    buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
                }
            } catch (e) {
                console.error('Error fetching from Blob:', e.message);
            }
            if (!buffer) return res.status(404).send('Not Found');
        } else if (meta.metaMediaId) {
            // Dynamic fetch from Meta (since we stopped saving huge base64 blobs to Redis to prevent OOM)
            source = 'meta';
            try {
                const { downloadMetaMedia } = await import('./whatsapp/utils.js');
                const metaMedia = await downloadMetaMedia(meta.metaMediaId);
                if (metaMedia && metaMedia.buffer) {
                    buffer = metaMedia.buffer;
                } else {
                    return res.status(404).send('Meta media not available');
                }
            } catch (e) {
                console.error('Error fetching media from Meta:', e.message);
                return res.status(500).send('Error fetching from Meta');
            }

            // 🗄️ Persistencia perezosa: Meta borra su media en ~30 dias, asi que cualquier
            // foto VISTA en el dashboard se respalda a Blob en ese momento (fire-and-forget,
            // no bloquea la respuesta). Cubre tambien las fotos entrantes de candidatos sin
            // tocar el webhook. Sin token, no hace nada.
            if (buffer && process.env.BLOB_READ_WRITE_TOKEN) {
                const lazyBuffer = buffer;
                import('@vercel/blob').then(async ({ put }) => {
                    await put(`media/${rawId}`, lazyBuffer, {
                        access: 'private',
                        contentType: meta.mime || 'image/jpeg',
                        addRandomSuffix: false
                    });
                    meta.blobPath = `media/${rawId}`;
                    // Registro renovado a 1 año: la foto ya vive en Blob
                    await client.set(metaKey, JSON.stringify(meta), 'EX', 86400 * 365);
                }).catch(() => {});
            }
        } else {
            return res.status(404).send('Not Found');
        }

        // TRACKING: Only log in debug mode — avoids 2 Redis ops per image request in production
        if (process.env.DEBUG_MODE === 'true') {
            const accessLog = {
                timestamp: new Date().toISOString(),
                id,
                ext: requestedExt,
                ua: req.headers['user-agent'] || 'Unknown',
                ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
            };
            await client.lpush('debug:media_access', JSON.stringify(accessLog));
            await client.ltrim('debug:media_access', 0, 49); // Keep last 50
        }

        // MIME Handling
        let finalMime = meta.mime;
        if (requestedExt === 'jpg' || requestedExt === 'jpeg') {
            finalMime = 'image/jpeg';
        }

        // Headers for scale and reliability
        res.setHeader('Content-Type', finalMime);
        res.setHeader('Content-Length', buffer.length);
        setPublicMediaCacheHeaders(res, etag);

        await trackMediaHit(client, source, buffer.length);

        if (req.method === 'HEAD') return res.status(200).end();

        return res.end(buffer);

    } catch (error) {
        console.error('Error in /api/image:', error);
        return res.status(500).send('Internal Error');
    }
}
