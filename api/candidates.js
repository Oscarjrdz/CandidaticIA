/**
 * Endpoint para gestionar candidatos
 * GET /api/candidates?limit=50&offset=0&search=
 * GET /api/candidates/:id
 * DELETE /api/candidates/:id
 */

// NO TOP LEVEL IMPORTS to prevent boot crashes

export default async function handler(req, res) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // DYNAMIC IMPORTS
        const { getCandidates, getCandidateById, deleteCandidate } = await import('./utils/storage.js');

        // GET /api/candidates - Obtener lista o estadísticas
        if (req.method === 'GET') {
            const { limit = '100', offset = '0', search = '', stats, id, excludeLinked = 'false', tag = '' } = req.query;

            // Estadísticas (Optional mixed response)
            let statsData = null;
            if (stats === 'true') {
                const { getRedisClient } = await import('./utils/storage.js');
                const redis = getRedisClient();

                const pipeline = redis.pipeline();
                pipeline.get('stats:msg:incoming');
                pipeline.get('stats:msg:outgoing');
                pipeline.scard('stats:list:complete');
                pipeline.scard('stats:list:pending');
                const results = await pipeline.exec();

                const incoming = results[0][1] || '0';
                const outgoing = results[1][1] || '0';
                const completeCount = results[2][1] || 0;
                const pendingCount = results[3][1] || 0;

                statsData = {
                    candidates: completeCount + pendingCount,
                    incoming: parseInt(incoming),
                    outgoing: parseInt(outgoing),
                    complete: completeCount,
                    pending: pendingCount
                };
            }

            // Candidato específico por ID
            if (id) {
                const candidate = await getCandidateById(id);
                if (!candidate) {
                    return res.status(404).json({
                        success: false,
                        error: 'Candidato no encontrado'
                    });
                }
                return res.status(200).json({
                    success: true,
                    candidate: candidate
                });
            }

            // Lista de candidatos
            const { candidates, total } = await getCandidates(
                parseInt(limit),
                parseInt(offset),
                search,
                excludeLinked === 'true',
                tag
            );

            return res.status(200).json({
                success: true,
                count: candidates.length,
                total: statsData?.candidates || total,
                candidates: candidates,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                },
                stats: statsData // Include stats if requested
            });
        }

        // POST /api/candidates - Crear candidato manualmente
        if (req.method === 'POST') {
            const { whatsapp, nombre } = req.body || {};
            if (!whatsapp || !nombre) {
                return res.status(400).json({ success: false, error: 'Número y nombre son requeridos' });
            }
            const cleanPhone = whatsapp.replace(/\D/g, '');
            if (cleanPhone.length < 10) {
                return res.status(400).json({ success: false, error: 'Número inválido (mínimo 10 dígitos)' });
            }

            const { saveCandidate, getCandidateIdByPhone } = await import('./utils/storage.js');

            // Check if candidate already exists
            const existingId = await getCandidateIdByPhone(cleanPhone);
            if (existingId) {
                const existing = await getCandidateById(existingId);
                return res.status(200).json({ success: true, candidate: existing, existed: true });
            }

            const candidate = await saveCandidate({
                whatsapp: cleanPhone,
                nombre: nombre.trim(),
                origen: 'manual_chat',
                esNuevo: 'SI',
                primerContacto: new Date().toISOString(),
                ultimoMensaje: new Date().toISOString()
            });

            return res.status(201).json({ success: true, candidate, existed: false });
        }

        // PUT /api/candidates - Actualizar candidato
        if (req.method === 'PUT') {
            const body = req.body || {};
            const { id, ...updates } = body;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    error: 'ID de candidato requerido'
                });
            }

            const { updateCandidate, getCandidateById } = await import('./utils/storage.js');
            const { cleanNameWithAI, detectGender, cleanMunicipioWithAI } = await import('./utils/ai.js');

            // --- AI Logic for Nombre Real ---
            if (updates.nombreReal) {
                const cleanedName = await cleanNameWithAI(updates.nombreReal);
                updates.nombreReal = cleanedName || updates.nombreReal; // Fallback to human input if AI rejects/fails

                // If name changed or gender is missing, trigger gender detection
                const existing = await getCandidateById(id);
                if (!existing.genero || existing.nombreReal !== cleanedName) {
                    const gender = await detectGender(cleanedName);
                    if (gender !== 'Desconocido') {
                        updates.genero = gender;
                    }
                }
            }

            // --- AI Logic for Municipio ---
            if (updates.municipio) {
                const cleanedMunicipio = await cleanMunicipioWithAI(updates.municipio);
                updates.municipio = cleanedMunicipio;
            }

            const updatedCandidate = await updateCandidate(id, updates);
            // Trigger stats refresh in background (don't block the UI)
            import('./utils/bot-stats.js').then(m => m.calculateBotStats()).catch(() => { });

            return res.status(200).json({
                success: true,
                candidate: updatedCandidate
            });
        }

        // DELETE /api/candidates/:id - Eliminar candidato
        if (req.method === 'DELETE') {
            const { id } = req.query;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    error: 'ID de candidato requerido'
                });
            }

            await deleteCandidate(id);
            // Non-blocking background sync
            import('./utils/bot-stats.js').then(m => m.calculateBotStats()).catch(() => { });

            return res.status(200).json({
                success: true,
                message: 'Candidato eliminado correctamente'
            });
        }

        // Método no permitido
        return res.status(405).json({
            error: 'Método no permitido',
            message: 'Solo se aceptan peticiones GET, POST, PUT y DELETE'
        });

    } catch (error) {
        console.error('❌ Error en API de candidatos:', error);

        return res.status(500).json({
            error: 'Error interno del servidor',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando solicitud'
        });
    }
}
