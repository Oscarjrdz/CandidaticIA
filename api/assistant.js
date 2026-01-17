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

                // --- Implementación Final: Depuración + Stream Estándar ---
                const remoteFormData = new FormData();

                // Depuración de lo que recibe Formidable
                console.log('📦 Formidable Files:', JSON.stringify(formData.files, (key, value) => {
                    if (key === 'file') return '[File Object]';
                    return value;
                }));

                const file = formData.files.file;
                const fileObj = Array.isArray(file) ? file[0] : file;

                if (!fileObj) {
                    console.error('❌ Formidable no encontró el archivo "file". Keys:', Object.keys(formData.files || {}));
                    return res.status(400).json({
                        error: 'No se recibió archivo',
                        details: 'El servidor no recibió el campo "file".',
                        debug: Object.keys(formData.files || {})
                    });
                }

                // Compatibilidad v2/v3 formidable
                const filepath = fileObj.filepath || fileObj.path;
                const filename = fileObj.originalFilename || fileObj.name || 'documento.bin';

                if (!filepath) {
                    return res.status(500).json({ error: 'Error procesando archivo', details: 'Filepath perdido', fileObj });
                }

                // Forzar extensión si falta (ayuda a mime detection)
                let finalFilename = filename;
                if (!path.extname(finalFilename) && fileObj.mimetype) {
                    const ext = mime.extension(fileObj.mimetype);
                    if (ext) finalFilename = `${filename}.${ext}`;
                }

                // Detección MIME obligatoria
                const mimetype = mime.lookup(finalFilename) || fileObj.mimetype || 'application/octet-stream';

                console.log(`📤 Preparando subida con Axios (Buffer): ${finalFilename} (${mimetype}) desde ${filepath}`);

                // Usamos Buffer + Axios para asegurar Length correcto y evitar problemas de stream
                const fileBuffer = fs.readFileSync(filepath);

                remoteFormData.append('file', fileBuffer, {
                    filename: finalFilename,
                    contentType: mimetype,
                    // knownLength se calcula solo con Buffer
                });

                const formHeaders = remoteFormData.getHeaders();

                console.log(`📤 Enviando request a BuilderBot API (Axios)...`);

                try {
                    const response = await axios.post(url, remoteFormData, {
                        headers: {
                            'x-api-builderbot': apiKey,
                            ...formHeaders
                        },
                        maxBodyLength: Infinity, // Importante para archivos grandes
                        validateStatus: () => true // No lanzar error en status != 200 para manejarlo manual
                    });

                    console.log(`📥 Respuesta BuilderBot: ${response.status} ${response.statusText}`);

                    const responseData = response.data;

                    if (response.status !== 200 && response.status !== 201) {
                        const errStr = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
                        console.error('❌ Error BuilderBot:', errStr);
                        return res.status(response.status).json({ error: 'Error subiendo archivo a BuilderBot', details: errStr });
                    }

                    // Axios ya parsea JSON automáticamente si el header es correcto
                    // Pero si viene texto plano, responseData será string
                    let finalData = responseData;
                    if (typeof responseData === 'string') {
                        try {
                            finalData = JSON.parse(responseData);
                        } catch (e) {
                            console.log('⚠️ Respuesta no-JSON de BuilderBot (asumiendo éxito):', responseData);
                            finalData = { success: true, message: 'Archivo subido correctamente', raw: responseData };
                        }
                    }

                    return res.status(200).json(finalData);

                } catch (axiosError) {
                    console.error('❌ Error Axios:', axiosError.message);
                    return res.status(500).json({ error: 'Error de conexión interno', details: axiosError.message });
                }
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
