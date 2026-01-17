/**
 * Utilidades para almacenamiento de eventos
 * Usa memoria en desarrollo, Vercel KV en producción
 */

// Almacenamiento en memoria para desarrollo
let memoryStore = [];
const MAX_EVENTS = 100;

/**
 * Verifica si Vercel KV está disponible
 * Soporta tanto KV_ como STORAGE_ prefixes, y también REDIS_URL
 */
const isKVAvailable = () => {
    // Vercel puede usar diferentes nombres de variables dependiendo de cómo se configuró
    const hasKVPrefix = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
    const hasStoragePrefix = !!(process.env.STORAGE_REST_API_URL && process.env.STORAGE_REST_API_TOKEN);
    const hasRedisURL = !!process.env.REDIS_URL; // Upstash Redis usa REDIS_URL

    const available = hasKVPrefix || hasStoragePrefix || hasRedisURL;

    if (available) {
        const prefix = hasKVPrefix ? 'KV_' : hasStoragePrefix ? 'STORAGE_' : 'REDIS_URL';
        console.log(`✅ Vercel KV disponible (usando: ${prefix})`);
    }

    return available;
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

/**
 * ==========================================
 * FUNCIONES PARA CANDIDATOS
 * ==========================================
 */

/**
 * Guarda o actualiza un candidato
 */
export const saveCandidate = async (candidateData) => {
    const { whatsapp, nombre } = candidateData;

    if (!whatsapp) {
        console.error('❌ WhatsApp es requerido para guardar candidato');
        return null;
    }

    if (isKVAvailable()) {
        try {
            const { kv } = await import('@vercel/kv');

            // Buscar si ya existe
            const existingId = await kv.get(`candidate:phone:${whatsapp}`);

            const candidate = {
                id: existingId || `cand_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                nombre: nombre || 'Sin nombre',
                whatsapp: whatsapp,
                foto: candidateData.foto || null,
                primerContacto: existingId ? undefined : new Date().toISOString(),
                ultimoMensaje: new Date().toISOString(),
                totalMensajes: existingId ? undefined : 1,
                ...candidateData
            };

            if (existingId) {
                // Actualizar existente
                const existing = await kv.get(`candidate:${existingId}`);
                if (existing) {
                    candidate.primerContacto = existing.primerContacto;
                    candidate.totalMensajes = (existing.totalMensajes || 0) + 1;
                }
            }

            // Guardar candidato
            await kv.set(`candidate:${candidate.id}`, candidate);

            // Mapeo teléfono → ID
            await kv.set(`candidate:phone:${whatsapp}`, candidate.id);

            // Agregar a lista
            await kv.zadd('candidates:list', {
                score: Date.now(),
                member: candidate.id
            });

            console.log(`✅ Candidato guardado en KV: ${candidate.nombre} (${candidate.whatsapp})`);
            return candidate;
        } catch (error) {
            console.error('Error guardando candidato en KV:', error);
            // Fallback to memory, but need to construct the candidate object first
            const existingId = await getCandidateIdByPhone(whatsapp); // Check memory for existing ID
            const candidate = {
                id: existingId || `cand_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                nombre: nombre || 'Sin nombre',
                whatsapp: whatsapp,
                foto: candidateData.foto || null,
                primerContacto: existingId ? undefined : new Date().toISOString(),
                ultimoMensaje: new Date().toISOString(),
                totalMensajes: existingId ? undefined : 1,
                ...candidateData
            };
            return saveCandidateToMemory(candidate, existingId);
        }
    } else {
        // Buscar si ya existe en memoria
        const existingId = await getCandidateIdByPhone(whatsapp);
        const candidate = {
            id: existingId || `cand_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            nombre: nombre || 'Sin nombre',
            whatsapp: whatsapp,
            foto: null,
            primerContacto: existingId ? undefined : new Date().toISOString(),
            ultimoMensaje: new Date().toISOString(),
            totalMensajes: existingId ? undefined : 1,
            ...candidateData
        };
        return saveCandidateToMemory(candidate, existingId);
    }
};

// Almacenamiento en memoria para candidatos
let candidatesMemory = [];

const saveCandidateToMemory = (candidate, isUpdate) => {
    if (isUpdate) {
        // Actualizar existente
        const index = candidatesMemory.findIndex(c => c.id === candidate.id);
        if (index !== -1) {
            candidatesMemory[index] = {
                ...candidatesMemory[index],
                ...candidate,
                totalMensajes: (candidatesMemory[index].totalMensajes || 0) + 1
            };
            console.log(`📝 Candidato actualizado: ${candidate.nombre} (${candidate.whatsapp})`);
            return candidatesMemory[index];
        }
    }

    // Crear nuevo
    candidatesMemory.unshift(candidate);
    console.log(`✅ Nuevo candidato guardado: ${candidate.nombre} (${candidate.whatsapp})`);
    return candidate;
};

/**
 * Obtiene candidatos almacenados
 */
export const getCandidates = async (limit = 50, offset = 0, search = '') => {
    if (isKVAvailable()) {
        try {
            const { kv } = await import('@vercel/kv');

            // Obtener IDs ordenados por fecha (más recientes primero)
            const candidateIds = await kv.zrange('candidates:list', 0, -1, { rev: true });

            if (!candidateIds || candidateIds.length === 0) {
                return [];
            }

            // Obtener candidatos
            const candidates = await Promise.all(
                candidateIds.map(id => kv.get(`candidate:${id}`))
            );

            // Filtrar nulls y aplicar búsqueda
            let filtered = candidates.filter(c => c !== null);

            if (search) {
                const searchLower = search.toLowerCase();
                filtered = filtered.filter(c =>
                    c.nombre.toLowerCase().includes(searchLower) ||
                    c.whatsapp.includes(search)
                );
            }

            // Paginación
            return filtered.slice(offset, offset + limit);
        } catch (error) {
            console.error('Error obteniendo candidatos de KV:', error);
            return getCandidatesFromMemory(limit, offset, search);
        }
    } else {
        return getCandidatesFromMemory(limit, offset, search);
    }
};

const getCandidatesFromMemory = (limit, offset, search) => {
    let filtered = candidatesMemory;

    // Filtrar por búsqueda
    if (search) {
        const searchLower = search.toLowerCase();
        filtered = candidatesMemory.filter(c =>
            c.nombre.toLowerCase().includes(searchLower) ||
            c.whatsapp.includes(search)
        );
    }

    return filtered.slice(offset, offset + limit);
};

/**
 * Obtiene ID de candidato por teléfono
 */
const getCandidateIdByPhone = async (phone) => {
    if (isKVAvailable()) {
        try {
            const { kv } = await import('@vercel/kv');
            return await kv.get(`candidate:phone:${phone}`);
        } catch (error) {
            console.error('Error buscando candidato por teléfono:', error);
            const candidate = candidatesMemory.find(c => c.whatsapp === phone);
            return candidate ? candidate.id : null;
        }
    } else {
        const candidate = candidatesMemory.find(c => c.whatsapp === phone);
        return candidate ? candidate.id : null;
    }
};

/**
 * Obtiene candidato por ID
 */
export const getCandidateById = async (id) => {
    if (isKVAvailable()) {
        try {
            const { kv } = await import('@vercel/kv');
            return await kv.get(`candidate:${id}`);
        } catch (error) {
            console.error('Error obteniendo candidato de KV:', error);
            return candidatesMemory.find(c => c.id === id) || null;
        }
    } else {
        return candidatesMemory.find(c => c.id === id) || null;
    }
};

/**
 * Elimina un candidato
 */
export const deleteCandidate = async (id) => {
    if (isKVAvailable()) {
        try {
            const { kv } = await import('@vercel/kv');

            // Obtener candidato para eliminar mapeo de teléfono
            const candidate = await kv.get(`candidate:${id}`);

            if (!candidate) {
                return false;
            }

            // Eliminar de lista ordenada
            await kv.zrem('candidates:list', id);

            // Eliminar mapeo teléfono
            await kv.del(`candidate:phone:${candidate.whatsapp}`);

            // Eliminar candidato
            await kv.del(`candidate:${id}`);

            console.log(`🗑️ Candidato eliminado de KV: ${id}`);
            return true;
        } catch (error) {
            console.error('Error eliminando candidato de KV:', error);
            const index = candidatesMemory.findIndex(c => c.id === id);
            if (index !== -1) {
                candidatesMemory.splice(index, 1);
                return true;
            }
            return false;
        }
    } else {
        const index = candidatesMemory.findIndex(c => c.id === id);
        if (index !== -1) {
            candidatesMemory.splice(index, 1);
            console.log(`🗑️ Candidato eliminado: ${id}`);
            return true;
        }
        return false;
    }
};

/**
 * Obtiene estadísticas de candidatos
 */
export const getCandidatesStats = async () => {
    if (isKVAvailable()) {
        try {
            const { kv } = await import('@vercel/kv');

            const candidateIds = await kv.zrange('candidates:list', 0, -1);
            const total = candidateIds.length;

            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);

            // Obtener todos los candidatos para contar nuevos hoy
            const candidates = await Promise.all(
                candidateIds.map(id => kv.get(`candidate:${id}`))
            );

            const nuevosHoy = candidates.filter(c =>
                c && new Date(c.primerContacto) >= hoy
            ).length;

            // Último contacto (más reciente)
            const ultimoId = candidateIds[candidateIds.length - 1];
            const ultimoContacto = ultimoId ? await kv.get(`candidate:${ultimoId}`) : null;

            return {
                total,
                nuevosHoy,
                ultimoContacto
            };
        } catch (error) {
            console.error('Error obteniendo stats de KV:', error);
            return getCandidatesStatsFromMemory();
        }
    } else {
        return getCandidatesStatsFromMemory();
    }
};

const getCandidatesStatsFromMemory = () => {
    const total = candidatesMemory.length;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const nuevosHoy = candidatesMemory.filter(c =>
        new Date(c.primerContacto) >= hoy
    ).length;

    return {
        total,
        nuevosHoy,
        ultimoContacto: candidatesMemory[0] || null
    };
};
