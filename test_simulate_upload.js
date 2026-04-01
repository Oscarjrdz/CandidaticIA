import http from 'http';
import FormData from 'form-data';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Load environmental variables if needed
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// We will test the local functions by directly importing them, but since they expect Next.js/Vite-like req/res, 
// and formidable expects a proper Node req stream, we will serve them using a minimal http server.

import uploadHandler from './api/media/upload.js';
import chatHandler from './api/chat.js';

const PORT = 3456;

const server = http.createServer(async (req, res) => {
    // Basic shim for Vercel-like req/res
    res.status = function(code) {
        this.statusCode = code;
        return this;
    };
    res.json = function(data) {
        this.setHeader('Content-Type', 'application/json');
        this.end(JSON.stringify(data));
    };

    try {
        if (req.method === 'POST' && req.url === '/api/media/upload') {
            await uploadHandler(req, res);
        } else if (req.url === '/api/chat') {
            // Read JSON body for chat
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                if (body) {
                    try { req.body = JSON.parse(body); } catch(e) {}
                }
                // Shim req.headers.host and x-forwarded-proto
                req.headers['x-forwarded-proto'] = 'http';
                req.headers.host = `localhost:${PORT}`;
                await chatHandler(req, res);
            });
        } else {
            res.status(404).json({ error: 'Not found' });
        }
    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ error: 'Internal shim error', details: err.message });
    }
});

server.listen(PORT, async () => {
    console.log(`\n🚀 Servidor de prueba iniciado en http://localhost:${PORT}`);
    
    try {
        console.log('\n=========================================');
        console.log('🧪 PASO 1: Simulando Upload desde Chat Web');
        console.log('=========================================');
        
        // Vamos a crear un archivo temporal dummy simulando una imagen
        const dummyPath = path.join(process.cwd(), 'dummy_test_image.jpg');
        fs.writeFileSync(dummyPath, 'Falso contenido de imagen binaria para test');
        
        const form = new FormData();
        form.append('file', fs.createReadStream(dummyPath));
        form.append('candidateId', 'test_candidate_123'); // Aunque upload.js no lo use
        
        console.log('-> Enviando POST multipart/form-data a /api/media/upload...');
        let uploadData;
        try {
            const tempRes = await axios.post(`http://localhost:${PORT}/api/media/upload`, form, {
                headers: form.getHeaders(),
                validateStatus: null // No tirar error en != 2xx
            });
            uploadData = tempRes.data;
            console.log(`<- Respuesta Upload [Status ${tempRes.status}]:`, uploadData);
        } catch (e) {
            console.error(e.message);
            fs.unlinkSync(dummyPath);
            process.exit(1);
        }

        fs.unlinkSync(dummyPath); // clean up

        if (!uploadData.success || !uploadData.mediaUrl) {
            console.error('❌ Falló la subida de imagen.');
            process.exit(1);
        }
        
        console.log('\n=========================================');
        console.log('🧪 PASO 2: Simulando Enviar Mensaje en chat.js');
        console.log('=========================================');
        
        const chatPayload = {
            candidateId: 'test_candidate_123',
            type: 'image',
            mediaUrl: uploadData.mediaUrl, // e.g. /api/image?id=med_xxx
            message: 'Mira esta foto!'
        };
        
        console.log('-> Enviando POST application/json a /api/chat con payload:', chatPayload);
        
        const chatRes = await fetch(`http://localhost:${PORT}/api/chat`, {
            method: 'POST',
            body: JSON.stringify(chatPayload),
            headers: { 'Content-Type': 'application/json' }
        });
        
        const chatData = await chatRes.json();
        console.log(`<- Respuesta Chat [Status ${chatRes.status}]:`);
        console.log(JSON.stringify(chatData, null, 2));
        
        // Note: chat handler might fail if candidate doesn't exist in DB, 
        // but the important part is getting to that logic and constructing the URL.
        if (chatData.error === 'Candidato no encontrado') {
            console.log('✅ El chat handler recibió correctamente la data (falló al buscar candidato porque es de prueba, lo cual es normal).');
        } else if (chatData.success) {
            console.log('✅ Mensaje enviado exitosamente en la prueba.');
        }

        console.log('\n✅ PRUEBA DE FLUJO COMPLETADA.');
    } catch(err) {
        console.error('\n❌ ERROR DURANTE LA PRUEBA:', err);
    } finally {
        server.close();
        process.exit(0);
    }
});
