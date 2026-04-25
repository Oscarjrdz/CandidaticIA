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

// ✅ META AUDIT: getCandidatesStats REMOVED — stats now arrive via SSE globalStats (push-only)


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
    constructor(callback) {
        this.callback = callback;
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
        this.pollFull(); // Initial load only — SSE handles all subsequent updates
        // ✅ META AUDIT: Stats polling REMOVED. SSE delivers stats:global every 5s.
        // ✅ META AUDIT: Candidate list polling REMOVED. SSE Pub/Sub handles real-time updates.
    }

    async pollFull() {
        const result = await getCandidates(this.limit, this.offset, this.search, true);
        if (result.success) {
            this.callback(result.candidates, result.stats);
        }
    }

    stop() {
        // No intervals to clean up — fully SSE-driven architecture
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
