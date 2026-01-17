import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';

// Disable default body parser for file uploads
export const config = {
    api: {
        bodyParser: false,
    },
};

const BUILDERBOT_API_URL = 'https://app.builderbot.cloud/api/v2';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { botId, answerId, apiKey, type, fileId } = req.query;

    if (!botId || !answerId || !apiKey) {
        return res.status(400).json({ error: 'Faltan credenciales (botId, answerId, apiKey)' });
    }

    try {
        // --- 1. PROMPT / INSTRUCTIONS ---
        if (type === 'instructions') {
            if (req.method === 'GET') {
                const url = `${BUILDERBOT_API_URL}/${botId}/answer/${answerId}/plugin/assistant`;

                // Necesitamos leer stream o body manualmente si bodyParser está en false
                // Pero GET no tiene body. Fetch funciona directo.
                const response = await fetch(url, {
                    headers: { 'x-api-builderbot': apiKey }
                });

                if (!response.ok) {
                    const err = await response.text();
                    return res.status(response.status).json({ error: 'Error obteniendo instrucciones', details: err });
                }

                const data = await response.json();
                return res.status(200).json(data);
            }

            if (req.method === 'POST') {
                // Parse body manually because we disabled it globally for this route (to support files)
                // For JSON post, we need to read the stream
                const body = await parseJsonBody(req);

                const url = `${BUILDERBOT_API_URL}/${botId}/answer/${answerId}/plugin/assistant`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-builderbot': apiKey
                    },
                    body: JSON.stringify(body)
                });

                if (!response.ok) {
                    const err = await response.text();
                    return res.status(response.status).json({ error: 'Error actualizando instrucciones', details: err });
                }

                const data = await response.json();
                return res.status(200).json(data);
            }
        }

        // --- 2. FILES ---
        if (type === 'files') {
            const url = `${BUILDERBOT_API_URL}/${botId}/answer/${answerId}/plugin/assistant/files`;

            if (req.method === 'GET') {
                const response = await fetch(url, {
                    headers: { 'x-api-builderbot': apiKey }
                });

                if (!response.ok) {
                    const err = await response.text();
                    return res.status(response.status).json({ error: 'Error listando archivos', details: err });
                }

                const data = await response.json();
                return res.status(200).json(data);
            }

            if (req.method === 'POST') {
                // Subida de archivos con formidable
                const formData = await parseMultipartForm(req);

                // Construir multipart form data para enviar a BuilderBot
                // Necesitamos Node 18+ FormData o usar librería 'form-data'
                // Vercel serverless usa Node 18+ nativo

                const remoteFormData = new FormData();
                const file = formData.files.file;

                // Formidable v3 devuelve array, v2 objeto. Asumimos v3 (array) o checkeamos
                const fileObj = Array.isArray(file) ? file[0] : file;

                if (!fileObj) {
                    return res.status(400).json({ error: 'No se recibió archivo', receivedFiles: Object.keys(formData.files || {}) });
                }

                // Compatibilidad v2/v3 formidable
                const filepath = fileObj.filepath || fileObj.path;
                const filename = fileObj.originalFilename || fileObj.name || 'documento';
                const mimetype = fileObj.mimetype || fileObj.type || 'application/octet-stream';

                if (!filepath) {
                    return res.status(500).json({ error: 'Error procesando archivo', details: 'Filepath missing in formidable object', fileObj });
                }

                const fileBlob = new Blob([fs.readFileSync(filepath)], { type: mimetype });
                remoteFormData.append('file', fileBlob, filename);

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'x-api-builderbot': apiKey
                        // No setear Content-Type, fetch lo hace automático con boundary
                    },
                    body: remoteFormData
                });

                if (!response.ok) {
                    const err = await response.text();
                    return res.status(response.status).json({ error: 'Error subiendo archivo', details: err });
                }

                const data = await response.json();
                return res.status(200).json(data);
            }

            if (req.method === 'DELETE') {
                if (!fileId) return res.status(400).json({ error: 'Falta fileId' });

                const deleteUrl = `${url}?fileId=${fileId}`;
                const response = await fetch(deleteUrl, {
                    method: 'DELETE',
                    headers: { 'x-api-builderbot': apiKey }
                });

                if (!response.ok) {
                    const err = await response.text();
                    return res.status(response.status).json({ error: 'Error eliminando archivo', details: err });
                }

                return res.status(200).json({ success: true, message: 'Archivo eliminado' });
            }
        }

        return res.status(400).json({ error: 'Tipo de operación no válido o método no soportado' });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: 'Error interno', details: error.message });
    }
}

// Helpers par formidable y body parsing
const parseMultipartForm = (req) => {
    return new Promise((resolve, reject) => {
        // En Vercel/AWS Lambda, siempre usar /tmp para archivos temporales
        const options = {
            keepExtensions: true,
            uploadDir: '/tmp',
            filename: (name, ext, part, form) => {
                return part.originalFilename; // Mantener nombre original si es posible
            }
        };

        // Asegurar que /tmp existe (debería)
        try {
            if (!fs.existsSync('/tmp')) fs.mkdirSync('/tmp');
        } catch (e) {
            delete options.uploadDir; // Fallback a default si falla
        }

        const form = new IncomingForm(options);

        form.parse(req, (err, fields, files) => {
            if (err) reject(err);
            resolve({ fields, files });
        });
    });
};

const parseJsonBody = (req) => {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                resolve({});
            }
        });
        req.on('error', reject);
    });
};
