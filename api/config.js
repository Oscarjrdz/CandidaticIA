/**
 * Endpoint para obtener configuración del webhook
 * GET /api/config
 */

export default async function handler(req, res) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({
            error: 'Método no permitido'
        });
    }

    try {
        // Obtener la URL base del deployment
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const baseUrl = `${protocol}://${host}`;

        return res.status(200).json({
            success: true,
            webhookUrl: `${baseUrl}/api/webhook`,
            eventsUrl: `${baseUrl}/api/events`,
            environment: process.env.VERCEL_ENV || 'development',
            region: process.env.VERCEL_REGION || 'local'
        });

    } catch (error) {
        console.error('❌ Error obteniendo configuración:', error);

        return res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
}
