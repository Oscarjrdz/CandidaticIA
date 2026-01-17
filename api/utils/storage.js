/**
 * Utilidades para almacenamiento de eventos y candidatos
 * Usa memoria en desarrollo, Redis (Upstash) en producción
 */

import Redis from 'ioredis';

// Singleton para el cliente de Redis
let redisClient = null;

const getRedisClient = () => {
    if (!redisClient && process.env.REDIS_URL) {
        // Usar configuración optimizada para serverless
        // ioredis detecta automáticamente SSL si la URL empieza con rediss://
        // No forzamos tls: {} a menos que sea necesario

        try {
            redisClient = new Redis(process.env.REDIS_URL, {
                maxRetriesPerRequest: 3, // Fallar rápido en serverless
                connectTimeout: 5000,    // Timeout de conexión 5s
                family: 0,               // Auto-detectar IPv4/IPv6
                // Si la URL es rediss://, ioredis usa TLS automáticamente
                // Si hay problemas de certificados self-signed:
                tls: process.env.REDIS_URL.startsWith('rediss://') ? {
                    rejectUnauthorized: false
                } : undefined
            });

            redisClient.on('error', (err) => {
                console.error('Redis Client Error:', err.message);
            });

            redisClient.on('connect', () => {
                console.log('✅ Redis conectado');
            });
        } catch (error) {
            console.error('Error inicializando Redis:', error);
        }
    }
    return redisClient;
};

// Almacenamiento en memoria para desarrollo (fallback)
let memoryStore = [];
let candidatesMemory = [];
const MAX_EVENTS = 100;

/**
 * Verifica si Redis está disponible
 * Detecta REDIS_URL estándar (usado por Upstash en Marketplace de Vercel)
 */
const isKVAvailable = () => {
    const available = !!process.env.REDIS_URL;
    if (available && !redisClient) {
        // Inicializar cliente si existe la variable
        getRedisClient();
    }
    if (available) {
        // console.log('✅ Redis disponible (REDIS_URL)');
    }
    return available;
};

/**
 * ==========================================
 * FUNCIONES PARA EVENTOS (WEBHOOKS)
 * ==========================================
 */

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
            const redis = getRedisClient();
            // Guardar en lista capped
            await redis.lpush('webhook:events', JSON.stringify(eventWithMetadata));
            await redis.ltrim('webhook:events', 0, MAX_EVENTS - 1);
            return eventWithMetadata;
        } catch (error) {
            console.error('Error guardando evento en Redis:', error);
            return saveToMemory(eventWithMetadata);
        }
    } else {
        return saveToMemory(eventWithMetadata);
    }
};

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
            const redis = getRedisClient();
            const events = await redis.lrange('webhook:events', offset, offset + limit - 1);
            return events.map(e => JSON.parse(e));
        } catch (error) {
            console.error('Error obteniendo eventos de Redis:', error);
            return getFromMemory(limit, offset);
        }
    } else {
        return getFromMemory(limit, offset);
    }
};

const getFromMemory = (limit, offset) => {
    return memoryStore.slice(offset, offset + limit);
};

export const getEventsByType = async (eventType, limit = 50) => {
    const allEvents = await getEvents(MAX_EVENTS);
    return allEvents
        .filter(e => e.event === eventType)
        .slice(0, limit);
};

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

export const clearEvents = async () => {
    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();
            await redis.del('webhook:events');
        } catch (error) {
            console.error('Error limpiando Redis:', error);
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

export const saveCandidate = async (candidateData) => {
    const { whatsapp, nombre } = candidateData;

    if (!whatsapp) {
        console.error('❌ WhatsApp es requerido para guardar candidato');
        return null;
    }

    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();

            // Buscar ID existente por teléfono
            const existingId = await redis.get(`candidate:phone:${whatsapp}`);

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
                // Si existe, recuperar para mantener datos históricos
                const existingData = await redis.get(`candidate:${existingId}`);
                if (existingData) {
                    const existing = JSON.parse(existingData);
                    candidate.primerContacto = existing.primerContacto;
                    candidate.totalMensajes = (existing.totalMensajes || 0) + 1;
                }
            }

            // Guardar candidato (stringify para Redis)
            await redis.set(`candidate:${candidate.id}`, JSON.stringify(candidate));

            // Mapeo teléfono → ID
            await redis.set(`candidate:phone:${whatsapp}`, candidate.id);

            // Agregar a lista ordenada (zadd key score member)
            await redis.zadd('candidates:list', Date.now(), candidate.id);

            console.log(`✅ Candidato guardado en Redis: ${candidate.nombre} (${candidate.whatsapp})`);
            return candidate;
        } catch (error) {
            console.error('Error guardando candidato en Redis:', error);
            // Fallback a memoria intentando recuperar ID primero si es posible, si no, crear nuevo
            return saveCandidateToMemory({
                ...candidateData,
                id: `cand_${Date.now()}_fallback`,
                totalMensajes: 1
            }, false);
        }
    } else {
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

const saveCandidateToMemory = (candidate, isUpdate) => {
    if (isUpdate) {
        const index = candidatesMemory.findIndex(c => c.id === candidate.id);
        if (index !== -1) {
            candidatesMemory[index] = {
                ...candidatesMemory[index],
                ...candidate,
                totalMensajes: (candidatesMemory[index].totalMensajes || 0) + 1
            };
            return candidatesMemory[index];
        }
    }
    candidatesMemory.unshift(candidate);
    return candidate;
};

export const getCandidates = async (limit = 50, offset = 0, search = '') => {
    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();

            // Obtener IDs ordenados (más recientes primero)
            // zrevrange retorna array de IDs
            const candidateIds = await redis.zrevrange('candidates:list', 0, -1);

            if (!candidateIds || candidateIds.length === 0) {
                return [];
            }

            // Obtener datos de cada candidato (pipeline para eficiencia)
            // Usamos mget es más eficiente si las keys son simples, pero aqui son 'candidate:ID'
            // pipeline es mejor
            const pipeline = redis.pipeline();
            candidateIds.forEach(id => pipeline.get(`candidate:${id}`));
            const results = await pipeline.exec();

            // results es [[err, result], [err, result]...]
            const candidates = results
                .map(([err, res]) => res ? JSON.parse(res) : null)
                .filter(c => c !== null);

            // Filtrar por búsqueda
            let filtered = candidates;
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
            console.error('Error obteniendo candidatos de Redis:', error);
            return getCandidatesFromMemory(limit, offset, search);
        }
    } else {
        return getCandidatesFromMemory(limit, offset, search);
    }
};

const getCandidatesFromMemory = (limit, offset, search) => {
    let filtered = candidatesMemory;
    if (search) {
        const searchLower = search.toLowerCase();
        filtered = candidatesMemory.filter(c =>
            c.nombre.toLowerCase().includes(searchLower) ||
            c.whatsapp.includes(search)
        );
    }
    return filtered.slice(offset, offset + limit);
};

export const getCandidateIdByPhone = async (phone) => {
    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();
            return await redis.get(`candidate:phone:${phone}`);
        } catch (error) {
            const candidate = candidatesMemory.find(c => c.whatsapp === phone);
            return candidate ? candidate.id : null;
        }
    } else {
        const candidate = candidatesMemory.find(c => c.whatsapp === phone);
        return candidate ? candidate.id : null;
    }
};

export const getCandidateById = async (id) => {
    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();
            const data = await redis.get(`candidate:${id}`);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            return candidatesMemory.find(c => c.id === id) || null;
        }
    } else {
        return candidatesMemory.find(c => c.id === id) || null;
    }
};

export const deleteCandidate = async (id) => {
    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();

            // Obtener candidato para eliminar mapeo de teléfono
            const data = await redis.get(`candidate:${id}`);
            if (!data) return false;

            const candidate = JSON.parse(data);

            await redis.zrem('candidates:list', id);
            await redis.del(`candidate:phone:${candidate.whatsapp}`);
            await redis.del(`candidate:${id}`);

            return true;
        } catch (error) {
            console.error('Error eliminando de Redis:', error);
            return false;
        }
    } else {
        const index = candidatesMemory.findIndex(c => c.id === id);
        if (index !== -1) {
            candidatesMemory.splice(index, 1);
            return true;
        }
        return false;
    }
};

export const getCandidatesStats = async () => {
    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();

            const total = await redis.zcard('candidates:list');

            // Para 'nuevosHoy' necesitamos iterar, lo cual es costoso si hay muchos.
            // Por ahora traigamos todos los IDs (asumiendo < 1000)
            const candidateIds = await redis.zrange('candidates:list', 0, -1);

            // Usar pipeline para traer todos
            const pipeline = redis.pipeline();
            candidateIds.forEach(id => pipeline.get(`candidate:${id}`));
            const results = await pipeline.exec();

            const candidates = results
                .map(([err, res]) => res ? JSON.parse(res) : null)
                .filter(c => c !== null);

            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);

            const nuevosHoy = candidates.filter(c =>
                c && new Date(c.primerContacto) >= hoy
            ).length;

            // Último contacto (el último ID agregado)
            const ultimoContacto = candidates.length > 0 ? candidates[candidates.length - 1] : null;

            return {
                total,
                nuevosHoy,
                ultimoContacto
            };
        } catch (error) {
            console.error('Error stats Redis:', error);
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
    const nuevosHoy = candidatesMemory.filter(c => new Date(c.primerContacto) >= hoy).length;
    return {
        total,
        nuevosHoy,
        ultimoContacto: candidatesMemory[0] || null
    };
};
/**
 * ==========================================
 * FUNCIONES PARA MENSAJES (CHAT)
 * ==========================================
 */

export const saveMessage = async (candidateId, messageData) => {
    // Estructura: { id, from: 'user'|'bot', content, type, timestamp }
    const message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        type: 'text',
        ...messageData
    };

    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();
            // Guardar en lista
            await redis.rpush(`messages:${candidateId}`, JSON.stringify(message));
            // Opcional: Trim para no guardar historia infinita (ej: ultimos 1000)
            await redis.ltrim(`messages:${candidateId}`, -1000, -1);
            return message;
        } catch (error) {
            console.error('Error guardando mensaje Redis:', error);
            // Fallback memoria (implementar si es necesario)
            return message;
        }
    } else {
        // Memoria para desarrollo
        if (!memoryStore[`msg_${candidateId}`]) memoryStore[`msg_${candidateId}`] = [];
        memoryStore[`msg_${candidateId}`].push(message);
        return message;
    }
};

export const getMessages = async (candidateId, limit = 100) => {
    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();
            const messages = await redis.lrange(`messages:${candidateId}`, -limit, -1);
            return messages.map(m => JSON.parse(m));
        } catch (error) {
            console.error('Error obteniendo mensajes Redis:', error);
            return [];
        }
    } else {
        return (memoryStore[`msg_${candidateId}`] || []).slice(-limit);
    }
};
export const setLastActiveUser = async (phone) => {
    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();
            await redis.set('system:last_active_user', phone, 'EX', 3600); // 1 hora de expiración
        } catch (error) {
            console.error('Error setLastActiveUser:', error);
        }
    }
};

export const getLastActiveUser = async () => {
    if (isKVAvailable()) {
        try {
            const redis = getRedisClient();
            return await redis.get('system:last_active_user');
        } catch (error) {
            return null;
        }
    }
    return null;
};
