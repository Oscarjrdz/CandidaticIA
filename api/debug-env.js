/**
 * Debug endpoint para verificar variables de entorno
 * GET /api/debug-env
 */

export default async function handler(req, res) {
    // Solo en desarrollo o con secret
    const debugSecret = req.headers['x-debug-secret'];

    if (process.env.NODE_ENV === 'production' && debugSecret !== 'candidatic-debug-2024') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const envVars = {
        NODE_ENV: process.env.NODE_ENV,
        hasWebhookSecret: !!process.env.WEBHOOK_SECRET,
        hasKV_URL: !!process.env.KV_REST_API_URL,
        hasKV_TOKEN: !!process.env.KV_REST_API_TOKEN,
        hasSTORAGE_URL: !!process.env.STORAGE_REST_API_URL,
        hasSTORAGE_TOKEN: !!process.env.STORAGE_REST_API_TOKEN,
        // Mostrar prefijos de variables disponibles (sin valores)
        availableEnvPrefixes: Object.keys(process.env)
            .filter(key => key.includes('REST_API'))
            .map(key => key.split('_')[0])
            .filter((v, i, a) => a.indexOf(v) === i) // unique
    };

    return res.status(200).json(envVars);
}
