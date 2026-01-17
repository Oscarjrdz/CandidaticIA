/**
 * Endpoint para consultar eventos almacenados
 * GET /api/events?limit=50&offset=0&type=message.incoming
 */

import { getEvents, getEventsByType, getEventStats } from './utils/storage.js';

export default async function handler(req, res) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Solo aceptar GET
    if (req.method !== 'GET') {
        return res.status(405).json({
            error: 'Método no permitido',
            message: 'Solo se aceptan peticiones GET'
        });
    }

    try {
        const { limit = '50', offset = '0', type, stats } = req.query;

        // Si se solicitan estadísticas
        if (stats === 'true') {
            const eventStats = await getEventStats();
            return res.status(200).json({
                success: true,
                stats: eventStats
            });
        }

        // Filtrar por tipo si se especifica
        let events;
        if (type) {
            events = await getEventsByType(type, parseInt(limit));
        } else {
            events = await getEvents(parseInt(limit), parseInt(offset));
        }

        return res.status(200).json({
            success: true,
            count: events.length,
            events: events,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo eventos:', error);

        return res.status(500).json({
            error: 'Error interno del servidor',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Error obteniendo eventos'
        });
    }
}
