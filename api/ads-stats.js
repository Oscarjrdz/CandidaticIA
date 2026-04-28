/**
 * Endpoint for Ads Statistics
 * GET /api/ads-stats
 */

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        try {
            const { getAdsStatistics } = await import('./utils/storage.js');
            const data = await getAdsStatistics();
            
            return res.status(200).json({
                success: true,
                ads: data.ads,
                totalAdsLeads: data.totalAdsLeads
            });
        } catch (error) {
            console.error('Error fetching ads stats:', error);
            return res.status(500).json({
                success: false,
                error: 'Error al obtener estadísticas de anuncios'
            });
        }
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
}
