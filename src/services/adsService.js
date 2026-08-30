const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3000';

/**
 * Obtiene las estadísticas agregadas de los anuncios de WhatsApp
 */
export const getAdsStats = async (includeArchived = false, refresh = false, range = 'all') => {
    try {
        const params = new URLSearchParams();
        if (includeArchived) params.set('includeArchived', 'true');
        if (refresh) params.set('refresh', 'true');
        if (range && range !== 'all') params.set('range', range);
        const qs = params.toString();
        const response = await fetch(`${API_BASE}/api/ads-stats${qs ? `?${qs}` : ''}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error obteniendo estadísticas de anuncios');
        }

        return {
            success: true,
            ads: data.ads || [],
            totalAdsLeads: data.totalAdsLeads || 0,
            range: data.range || 'all',
            stale: !!data.stale
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            ads: [],
            totalAdsLeads: 0
        };
    }
};
