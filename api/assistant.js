import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import mime from 'mime-types';
import axios from 'axios';

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
        console.warn('⚠️ Missing credentials in request query:', { botId: !!botId, answerId: !!answerId, apiKey: !!apiKey });
        return res.status(400).json({ error: 'Faltan credenciales (botId, answerId, apiKey)' });
    }

    // Redacted logs for debugging
    console.log(`🚀 [Assistant API] Type: ${type}, Method: ${req.method}`);
    console.log(`📍 BotId: ${botId}`);
    console.log(`🔑 ApiKey: ${apiKey ? (apiKey.substring(0, 5) + '...') : 'MISSING'}`);

    try {
        // --- 1. PROMPT / INSTRUCTIONS ---
        if (type === 'instructions') {
            const url = `${BUILDERBOT_API_URL}/${botId}/answer/${answerId}/plugin/assistant`;

            if (req.method === 'GET') {
                const response = await axios.get(url, {
                    headers: { 'x-api-builderbot': apiKey },
                    validateStatus: () => true
                });

                if (response.status !== 200) {
                    console.error('❌ Error BuilderBot GET instructions:', response.data);
                    return res.status(response.status).json({
                        error: 'Error obteniendo instrucciones',
                        details: typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
                    });
                }

                return res.status(200).json(response.data);
            }

            if (req.method === 'POST') {
                const body = await parseJsonBody(req);
                const response = await axios.post(url, body, {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-builderbot': apiKey
                    },
                    validateStatus: () => true
                });

                if (response.status !== 200 && response.status !== 201) {
                    console.error('❌ Error BuilderBot POST instructions:', response.data);
                    return res.status(response.status).json({
                        error: 'Error actualizando instrucciones',
                        details: typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
                    });
                }

                return res.status(200).json(response.data);
            }
        }

        // --- 2. FILES ---
        if (type === 'files') {
            const url = `${BUILDERBOT_API_URL}/${botId}/answer/${answerId}/plugin/assistant/files`;

            if (req.method === 'GET') {
                console.log(`📥 Listing files from BuilderBot: ${url}`);
                const response = await axios.get(url, {
                    headers: { 'x-api-builderbot': apiKey },
                    validateStatus: () => true
                });

                if (response.status !== 200) {
                    console.error('❌ Error BuilderBot GET files:', response.data);
                    return res.status(response.status).json({
                        error: 'Error listando archivos',
                        details: typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
                    });
                }

                return res.status(200).json(response.data);
            }

            if (req.method === 'POST') {
                // ... (POST logic already uses axios, but let's ensure it's robust)
                const formData = await parseMultipartForm(req);
                const remoteFormData = new FormData();
                const file = formData.files.file;
                const fileObj = Array.isArray(file) ? file[0] : file;

                if (!fileObj) {
                    return res.status(400).json({ error: 'No se recibió archivo' });
                }

                const filepath = fileObj.filepath || fileObj.path;
                const filename = fileObj.originalFilename || fileObj.name || 'documento.bin';
                const mimetype = mime.lookup(filename) || fileObj.mimetype || 'application/octet-stream';

                const fileBuffer = fs.readFileSync(filepath);
                remoteFormData.append('file', fileBuffer, {
                    filename: filename,
                    contentType: mimetype,
                });

                const response = await axios.post(url, remoteFormData, {
                    headers: {
                        'x-api-builderbot': apiKey,
                        ...remoteFormData.getHeaders()
                    },
                    maxBodyLength: Infinity,
                    validateStatus: () => true
                });

                if (response.status !== 200 && response.status !== 201) {
                    // Workaround for falso positivo deleted here to keep it clean, 
                    // or re-add if really needed. Let's keep it for now as it was there.
                    const errStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                    if (errStr.includes('Cannot read properties of undefined') || errStr.includes('reading \'0\'')) {
                        return res.status(200).json({ success: true, message: 'Archivo subido (con advertencia)' });
                    }
                    return res.status(response.status).json({ error: 'Error subiendo archivo', details: errStr });
                }

                return res.status(200).json(response.data);
            }

            if (req.method === 'DELETE') {
                if (!fileId) return res.status(400).json({ error: 'Falta fileId' });

                const response = await axios.delete(url, {
                    params: { fileId },
                    headers: { 'x-api-builderbot': apiKey },
                    validateStatus: () => true
                });

                if (response.status !== 200) {
                    return res.status(response.status).json({
                        error: 'Error eliminando archivo',
                        details: typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
                    });
                }

                return res.status(200).json({ success: true, message: 'Archivo eliminado' });
            }
        }

        return res.status(400).json({ error: 'Tipo de operación no válido' });

    } catch (error) {
        console.error('❌ Assistant API Critical Error:', error.message);
        return res.status(500).json({ error: 'Error interno del servidor', details: error.message });
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
