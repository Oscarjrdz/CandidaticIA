/**
 * Utilidades para almacenamiento de eventos
 * Usa memoria en desarrollo, Vercel KV en producción
 */

// Almacenamiento en memoria para desarrollo
let memoryStore = [];
const MAX_EVENTS = 100;

/**
 * Verifica si Vercel KV está disponible
 */
const isKVAvailable = () => {
    return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
};

/**
 * Guarda un evento
 */
export const saveEvent = async (event) => {
    const eventWithMetadata = {
        ...event,
        id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        receivedAt: new Date().toISOString(),
        source: 'builderbot'
    };

    if (isKVAvailable()) {
        try {
            // TODO: Implementar con Vercel KV cuando esté configurado
            // const kv = await import('@vercel/kv');
            // await kv.lpush('webhook:events', JSON.stringify(eventWithMetadata));
            // await kv.ltrim('webhook:events', 0, MAX_EVENTS - 1);
            console.log('📦 KV disponible pero no implementado aún, usando memoria');
            return saveToMemory(eventWithMetadata);
        } catch (error) {
            console.error('Error guardando en KV:', error);
            return saveToMemory(eventWithMetadata);
        }
    } else {
        return saveToMemory(eventWithMetadata);
    }
};

/**
 * Guarda evento en memoria (fallback)
 */
const saveToMemory = (event) => {
    memoryStore.unshift(event);
    if (memoryStore.length > MAX_EVENTS) {
        memoryStore = memoryStore.slice(0, MAX_EVENTS);
    }
    console.log(`💾 Evento guardado en memoria (${memoryStore.length}/${MAX_EVENTS})`);
    return event;
};

/**
 * Obtiene eventos almacenados
 */
export const getEvents = async (limit = 50, offset = 0) => {
    if (isKVAvailable()) {
        try {
            // TODO: Implementar con Vercel KV
            // const kv = await import('@vercel/kv');
            // const events = await kv.lrange('webhook:events', offset, offset + limit - 1);
            // return events.map(e => JSON.parse(e));
            console.log('📦 KV disponible pero no implementado aún, usando memoria');
            return getFromMemory(limit, offset);
        } catch (error) {
            console.error('Error obteniendo de KV:', error);
            return getFromMemory(limit, offset);
        }
    } else {
        return getFromMemory(limit, offset);
    }
};

/**
 * Obtiene eventos de memoria
 */
const getFromMemory = (limit, offset) => {
    return memoryStore.slice(offset, offset + limit);
};

/**
 * Filtra eventos por tipo
 */
export const getEventsByType = async (eventType, limit = 50) => {
    const allEvents = await getEvents(MAX_EVENTS);
    return allEvents
        .filter(e => e.event === eventType)
        .slice(0, limit);
};

/**
 * Obtiene estadísticas de eventos
 */
export const getEventStats = async () => {
    const allEvents = await getEvents(MAX_EVENTS);

    const stats = {
        total: allEvents.length,
        byType: {},
        lastEvent: allEvents[0] || null,
        oldestEvent: allEvents[allEvents.length - 1] || null
    };

    allEvents.forEach(event => {
        const type = event.event || 'unknown';
        stats.byType[type] = (stats.byType[type] || 0) + 1;
    });

    return stats;
};

/**
 * Limpia todos los eventos (útil para testing)
 */
export const clearEvents = async () => {
    if (isKVAvailable()) {
        try {
            // const kv = await import('@vercel/kv');
            // await kv.del('webhook:events');
            console.log('🗑️ KV disponible pero no implementado aún, limpiando memoria');
            memoryStore = [];
        } catch (error) {
            console.error('Error limpiando KV:', error);
            memoryStore = [];
        }
    } else {
        memoryStore = [];
    }
    console.log('🗑️ Eventos limpiados');
};
