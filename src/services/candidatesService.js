/**
 * Servicio para interactuar con la API de candidatos
 */

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3000';

/**
 * Obtiene lista de candidatos
 */
export const getCandidates = async (limit = 50, offset = 0, search = '') => {
    try {
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString()
        });

        if (search) {
            params.append('search', search);
        }

        const response = await fetch(`${API_BASE}/api/candidates?${params}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error obteniendo candidatos');
        }

        return {
            success: true,
            candidates: data.candidates || [],
            count: data.count || 0,
            pagination: data.pagination
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
 * Obtiene estadísticas de candidatos
 */
export const getCandidatesStats = async () => {
    try {
        const response = await fetch(`${API_BASE}/api/candidates?stats=true`);
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
 * Suscripción a candidatos con polling
 */
export class CandidatesSubscription {
    constructor(callback, interval = 10000) {
        this.callback = callback;
        this.interval = interval;
        this.intervalId = null;
        this.lastCount = 0;
    }

    start() {
        // Primera llamada inmediata
        this.poll();

        // Polling periódico
        this.intervalId = setInterval(() => {
            this.poll();
        }, this.interval);
    }

    async poll() {
        const result = await getCandidates(50, 0);

        if (result.success) {
            // Always notify to detect message changes in existing candidates
            // This allows the auto-export timer to trigger when new messages arrive
            this.callback(result.candidates);
        }
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}

/**
 * Realiza una búsqueda inteligente usando IA
 */
export const aiQuery = async (query) => {
    try {
        const response = await fetch(`${API_BASE}/api/ai/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query })
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
