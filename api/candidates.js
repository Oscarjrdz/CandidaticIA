/**
 * Endpoint para gestionar candidatos
 * GET /api/candidates?limit=50&offset=0&search=
 * GET /api/candidates/:id
 * DELETE /api/candidates/:id
 */

import { getCandidates, getCandidateById, deleteCandidate, getCandidatesStats, saveMessage, getMessages } from './utils/storage.js';

export default async function handler(req, res) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // GET /api/candidates - Obtener lista o estadísticas
        if (req.method === 'GET') {
            const { limit = '50', offset = '0', search = '', stats, id } = req.query;

            // Estadísticas
            if (stats === 'true') {
                const candidatesStats = await getCandidatesStats();
                return res.status(200).json({
                    success: true,
                    stats: candidatesStats
                });
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
            const candidates = await getCandidates(
                parseInt(limit),
                parseInt(offset),
                search
            );

            return res.status(200).json({
                success: true,
                count: candidates.length,
                candidates: candidates,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
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

            const deleted = await deleteCandidate(id);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    error: 'Candidato no encontrado'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Candidato eliminado correctamente'
            });
        }

        // Método no permitido
        return res.status(405).json({
            error: 'Método no permitido',
            message: 'Solo se aceptan peticiones GET y DELETE'
        });

    } catch (error) {
        console.error('❌ Error en API de candidatos:', error);

        return res.status(500).json({
            error: 'Error interno del servidor',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando solicitud'
        });
    }
}
