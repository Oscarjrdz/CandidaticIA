const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3000';

/**
 * Obtiene las estadísticas agregadas de candidatos para la sección Statics.
 * El Authorization Bearer lo agrega el interceptor global de fetch (main.jsx).
 */
export const getOverviewStats = async (refresh = false) => {
    try {
        const qs = refresh ? '?refresh=true' : '';
        const response = await fetch(`${API_BASE}/api/system/stats${qs}`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Error obteniendo estadísticas');
        }
        return { success: true, ...data };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
