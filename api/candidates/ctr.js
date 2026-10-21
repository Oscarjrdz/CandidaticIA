import { validateAdminSession } from '../utils/storage.js';
import { getCtrBlocksCached, stripComposition } from '../utils/ctr-stats.js';

/**
 * CTR de completos (REAL, sin tope de 100) para el dashboard de Candidatos.
 *
 *   GET /api/candidates/ctr → { today, ultimos100, asOf, fecha }
 *
 * Cada bloque: { total, completos, pct, stuck:[{key,short,count}] }.
 *   - today      = candidatos con primer contacto HOY (00:00 → ahora, zona Monterrey).
 *   - ultimos100 = los 100 candidatos más recientes.
 *
 * La composición (qué candidatos forman cada número) NO se devuelve aquí — eso es para Grok vía
 * la tool MCP `ver_ctr`. El dashboard solo necesita los conteos. Cacheado 60s en el servidor.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    try {
        const data = await getCtrBlocksCached();
        if (!data) return res.status(200).json({ today: stripComposition(null), ultimos100: stripComposition(null), asOf: Date.now() });

        res.setHeader('Cache-Control', 'private, max-age=30');
        return res.status(200).json({
            today: stripComposition(data.today),
            ultimos100: stripComposition(data.ultimos100),
            asOf: data.asOf,
            fecha: data.fecha,
        });
    } catch (error) {
        console.error('[candidates/ctr] error:', error);
        return res.status(500).json({ error: 'Error calculando CTR' });
    }
}
