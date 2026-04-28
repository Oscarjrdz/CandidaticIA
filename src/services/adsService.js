const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3000';

/**
 * Obtiene las estadísticas agregadas de los anuncios de WhatsApp
 */
export const getAdsStats = async () => {
    try {
        const response = await fetch(`${API_BASE}/api/ads-stats`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error obteniendo estadísticas de anuncios');
        }

        return {
            success: true,
            ads: data.ads || [],
            totalAdsLeads: data.totalAdsLeads || 0
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
