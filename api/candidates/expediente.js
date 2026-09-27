import {
    getRedisClient,
    validateAdminSession,
    getCandidateById,
    getExpediente,
    addExpedienteEntry,
    removeExpedienteEntry,
} from '../utils/storage.js';

/**
 * Expediente Digital — archivos guardados por candidato (INE, CV, comprobantes...).
 *
 *   GET    /api/candidates/expediente?candidateId=<id>          → { success, entries[] }
 *   POST   /api/candidates/expediente                           → guardar un archivo
 *            body: { candidateId, mediaUrl, type, filename, mime, note, sourceMsgId, source }
 *            - source 'chat'   → copia los bytes a un Blob PERMANENTE propio del expediente
 *                                (así no depende del ciclo de vida del mensaje original).
 *            - source 'upload' → el archivo ya pasó por /api/media/upload (Blob permanente):
 *                                solo se referencia su URL, sin recopiar bytes.
 *   DELETE /api/candidates/expediente?candidateId=<id>&entryId=<id>  → quitar del expediente
 *
 * Todo protegido con validateAdminSession (patrón estándar de endpoints que mutan datos).
 */

// Lee los bytes de un media ya almacenado por su id: Redis base64 → Blob → Meta.
// Mismo orden de fallback que /api/image, para poder copiarlo a una ubicación permanente.
async function readMediaBytesById(rawId) {
    const client = getRedisClient();
    let buffer = null;
    let mime = '';

    let meta = {};
    try {
        const metaRaw = await client.get(`meta:image:${rawId}`);
        if (metaRaw) meta = JSON.parse(metaRaw);
    } catch { /* sin registro */ }
    mime = meta.mime || '';

    try {
        const data = await client.get(`image:${rawId}`);
        if (data) buffer = Buffer.from(data, 'base64');
    } catch { /* sin base64 en Redis */ }

    if (!buffer && process.env.BLOB_READ_WRITE_TOKEN) {
        try {
            const { get } = await import('@vercel/blob');
            const result = await get(`media/${rawId}`, { access: 'private' });
            if (result?.stream) {
                buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
                if (!mime) mime = result.headers?.get?.('content-type') || '';
            }
        } catch { /* no está en Blob */ }
    }

    if (!buffer && meta.metaMediaId) {
        try {
            const { downloadMetaMedia } = await import('../whatsapp/utils.js');
            const m = await downloadMetaMedia(meta.metaMediaId);
            if (m?.buffer) { buffer = m.buffer; if (!mime) mime = m.mimeType || ''; }
        } catch { /* Meta no disponible */ }
    }

    return { buffer, mime, filename: meta.filename || '' };
}

// Guarda los bytes en un objeto Blob PERMANENTE propio del expediente y registra su
// meta SIN TTL. Devuelve una URL /api/image?id=<newId> servida por el CDN igual que
// cualquier otro media, pero que nunca caduca.
async function persistPermanentCopy({ buffer, mime, filename }) {
    const client = getRedisClient();
    const newId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const size = buffer?.length || 0;
    const contentType = mime || 'application/octet-stream';

    if (process.env.BLOB_READ_WRITE_TOKEN && buffer) {
        const { put } = await import('@vercel/blob');
        await put(`media/${newId}`, buffer, {
            access: 'private',
            contentType,
            addRandomSuffix: false,
        });
    } else if (buffer) {
        // Sin Blob configurado: último recurso, base64 en Redis SIN TTL (raro en prod).
        await client.set(`image:${newId}`, buffer.toString('base64'));
    }

    await client.set(`meta:image:${newId}`, JSON.stringify({
        mime: contentType,
        filename: filename || 'archivo',
        size,
        createdAt: new Date().toISOString(),
        blobPath: process.env.BLOB_READ_WRITE_TOKEN ? `media/${newId}` : undefined,
    })); // sin TTL — permanente

    return { url: `/api/image?id=${newId}`, size };
}

// Borrado PROFUNDO del archivo físico: registro en Redis (meta + base64) y el objeto en
// Blob. Solo se llama para copias PROPIAS del expediente (exp_* copiado desde chat, med_*
// subido desde desktop) — NUNCA para in_* (media original del mensaje del chat, que es
// compartida y se debe conservar aunque se quite del expediente).
async function deletePermanentMedia(rawId) {
    const client = getRedisClient();
    try { await client.del(`meta:image:${rawId}`, `image:${rawId}`); } catch { /* ya no existía */ }
    if (process.env.BLOB_READ_WRITE_TOKEN) {
        try {
            const { del } = await import('@vercel/blob');
            await del(`media/${rawId}`); // el store privado acepta el pathname
        } catch { /* ya no existía en Blob */ }
    }
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ success: false, error: 'No autorizado' });

    try {
        if (req.method === 'GET') {
            const candidateId = Array.isArray(req.query.candidateId) ? req.query.candidateId[0] : req.query.candidateId;
            if (!candidateId) return res.status(400).json({ success: false, error: 'candidateId requerido' });
            const entries = await getExpediente(candidateId);
            return res.status(200).json({ success: true, entries });
        }

        if (req.method === 'POST') {
            const { candidateId, sourceMsgId, type, mediaUrl, filename, mime, note, source } = req.body || {};
            if (!candidateId || !mediaUrl) {
                return res.status(400).json({ success: false, error: 'candidateId y mediaUrl requeridos' });
            }
            const candidate = await getCandidateById(candidateId);
            if (!candidate) return res.status(404).json({ success: false, error: 'Candidato no encontrado' });

            let finalUrl = mediaUrl;
            let sizeBytes = 0;
            let finalMime = mime || '';

            if (source === 'upload') {
                // Ya persistido por /api/media/upload → solo referenciar.
                finalUrl = mediaUrl;
            } else {
                // save-from-chat: copiar a un Blob permanente propio del expediente.
                const idMatch = String(mediaUrl).match(/[?&]id=([^&#]+)/);
                if (idMatch) {
                    const srcId = decodeURIComponent(idMatch[1]).split('.')[0];
                    const { buffer, mime: readMime, filename: readName } = await readMediaBytesById(srcId);
                    if (buffer) {
                        const saved = await persistPermanentCopy({ buffer, mime: mime || readMime, filename: filename || readName });
                        finalUrl = saved.url;
                        sizeBytes = saved.size;
                        finalMime = mime || readMime || '';
                    }
                    // Si no se pudieron leer los bytes, se referencia el original (mejor que fallar).
                } else if (/^https?:\/\//i.test(mediaUrl)) {
                    // URL absoluta (fallback Meta): descargar y copiar.
                    try {
                        const resp = await fetch(mediaUrl);
                        const buffer = Buffer.from(await resp.arrayBuffer());
                        const ct = resp.headers.get('content-type') || '';
                        const saved = await persistPermanentCopy({ buffer, mime: mime || ct, filename });
                        finalUrl = saved.url;
                        sizeBytes = saved.size;
                        finalMime = mime || ct;
                    } catch { finalUrl = mediaUrl; }
                }
            }

            const entry = await addExpedienteEntry(candidateId, {
                type: type || 'document',
                url: finalUrl,
                filename: filename || 'archivo',
                mime: finalMime,
                note: note || '',
                sizeBytes,
                sourceMsgId: sourceMsgId || null,
                savedBy: userId,
            });
            return res.status(200).json({ success: true, entry });
        }

        if (req.method === 'DELETE') {
            const candidateId = req.query.candidateId || req.body?.candidateId;
            const entryId = req.query.entryId || req.body?.entryId;
            if (!candidateId || !entryId) {
                return res.status(400).json({ success: false, error: 'candidateId y entryId requeridos' });
            }
            // Borrado PROFUNDO: además de quitar la referencia, se borra el archivo físico
            // (Blob + meta) cuando es una copia propia del expediente. Se busca la entrada
            // antes de removerla para conocer su URL/id.
            const entries = await getExpediente(candidateId);
            const entry = entries.find(e => e && e.id === entryId);
            if (entry) {
                const idMatch = String(entry.url || '').match(/[?&]id=([^&#]+)/);
                if (idMatch) {
                    const mid = decodeURIComponent(idMatch[1]).split('.')[0];
                    // exp_* (copiado desde chat) y med_* (subido desde desktop) son copias
                    // PROPIAS del expediente → se borran de verdad. in_* (media original del
                    // chat, en el raro fallback de referencia) se conserva.
                    if (/^(exp_|med_)/.test(mid)) {
                        await deletePermanentMedia(mid);
                    }
                }
            }
            const ok = await removeExpedienteEntry(candidateId, entryId);
            return res.status(200).json({ success: ok });
        }

        return res.status(405).json({ success: false, error: 'Método no permitido' });
    } catch (error) {
        console.error('[expediente] ❌', error.message);
        return res.status(500).json({ success: false, error: 'Error interno', details: error.message });
    }
}
