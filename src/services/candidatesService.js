/**
 * Servicio para interactuar con la API de candidatos
 */

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3000';

/**
 * Obtiene lista de candidatos
 */
export const getCandidates = async (limit = 100, offset = 0, search = '', includeStats = false, tag = '') => {
    try {
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString()
        });

        if (search) params.append('search', search);
        if (includeStats) params.append('stats', 'true'); // Hybrid mode
        if (tag) params.append('tag', tag);

        const response = await fetch(`${API_BASE}/api/candidates?${params}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error obteniendo candidatos');
        }

        // Handle strict stats response or mixed response
        const stats = data.stats || null;

        return {
            success: true,
            candidates: data.candidates || [],
            count: data.count || 0,
            total: data.total || 0,
            pagination: data.pagination,
            stats: stats
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            candidates: [],
            count: 0
        };
    }
};

/**
 * Obtiene estadísticas de candidatos de forma ultra ligera (sin array de candidatos)
 */
export const getCandidatesStats = async () => {
    try {
        const response = await fetch(`${API_BASE}/api/candidates?stats=true&limit=0`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error obteniendo estadísticas');
        }

        return {
            success: true,
            stats: data.stats
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            stats: null
        };
    }
};

/**
 * Obtiene un candidato por ID
 */
export const getCandidateById = async (id) => {
    try {
        const response = await fetch(`${API_BASE}/api/candidates?id=${id}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error obteniendo candidato');
        }

        return {
            success: true,
            candidate: data.candidate
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            candidate: null
        };
    }
};

/**
 * Actualiza un candidato
 */
export const updateCandidate = async (id, updates) => {
    try {
        const response = await fetch(`${API_BASE}/api/candidates`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id, ...updates })
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error actualizando candidato');
        }

        return {
            success: true,
            candidate: data.candidate
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Elimina un candidato
 */
export const deleteCandidate = async (id) => {
    try {
        const response = await fetch(`${API_BASE}/api/candidates?id=${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error eliminando candidato');
        }

        return {
            success: true,
            message: data.message
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Suscripción a candidatos con polling optimizado
 * Desacopla la consulta pesada de la lista de candidatos de la consulta ligera de estadísticas.
 */
export class CandidatesSubscription {
    constructor(callback, interval = 15000) { // 15 segundos para la lista pesada
        this.callback = callback;
        this.interval = interval;
        this.intervalId = null;
        this.statsIntervalId = null;
        this.lastCount = 0;
        this.limit = 100;
        this.offset = 0;
        this.search = '';
    }

    updateParams(limit, offset, search = '') {
        this.limit = limit;
        this.offset = offset;
        this.search = search;
    }

    start() {
        this.pollFull();
        
        // Loop 1: Lista completa de candidatos (Pesado, cada 15s)
        this.intervalId = setInterval(() => {
            this.pollFull();
        }, this.interval);

        // Loop 2: Estadísticas del dashboard (Ligero, cada 3s)
        this.statsIntervalId = setInterval(() => {
            this.pollStats();
        }, 3000);
    }

    async pollFull() {
        const result = await getCandidates(this.limit, this.offset, this.search, true);
        if (result.success) {
            this.callback(result.candidates, result.stats);
        }
    }

    async pollStats() {
        const result = await getCandidatesStats();
        if (result.success) {
            // Pasamos null en candidates para indicar que es un update solo de stats
            this.callback(null, result.stats);
        }
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.statsIntervalId) {
            clearInterval(this.statsIntervalId);
            this.statsIntervalId = null;
        }
    }
}

/**
 * Realiza una búsqueda inteligente usando IA
 */
export const aiQuery = async (query, excludeLinked = false) => {
    try {
        const response = await fetch(`${API_BASE}/api/ai/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query, excludeLinked })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error en la búsqueda inteligente');
        }

        return {
            success: true,
            candidates: data.candidates || [],
            count: data.count || 0,
            ai: data.ai
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            candidates: [],
            count: 0
        };
    }
};

/**
 * Bloquea o desbloquea un candidato
 */
export const blockCandidate = async (id, block = true) => {
    try {
        const response = await fetch(`${API_BASE}/api/candidates/block`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id, block })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error procesando bloqueo');
        }

        return {
            success: true,
            ...data
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
};
