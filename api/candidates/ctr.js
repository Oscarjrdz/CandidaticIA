import { validateAdminSession } from '../utils/storage.js';
import { getCtrBlocksCached, stripComposition, getGrokAttendedTodayCount, getLocationSharedTodayCount } from '../utils/ctr-stats.js';

/**
 * CTR de completos (REAL, sin tope de 100) para el dashboard de Candidatos.
 *
 *   GET /api/candidates/ctr → { today, ultimos100, retornosHoy, asOf, fecha }
 *
 * Cada bloque CTR: { total, completos, pct, stuck:[{key,short,count}] }.
 *   - today      = candidatos con primer contacto HOY (00:00 → ahora, zona Monterrey).
 *   - ultimos100 = los 100 candidatos más recientes.
 *   - retornosHoy = { total, completos, incompletos, todos, convertidos } — candidatos que YA
 *     existían y están activos hoy (split por estado + convertidos = incompleto→completo hoy).
 *
 * La composición (qué candidatos forman cada número) NO se devuelve aquí — eso es para Grok vía
 * la tool MCP `ver_ctr`. El dashboard solo necesita los conteos. Cacheado 60s en el servidor.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    try {
        // El conteo de "atendidos por Grok" se lee fresco (SCARD, 1 comando) aunque los bloques CTR
        // vengan de la caché de 60s — así se refleja de inmediato cuando Grok acaba de marcar uno.
        const [data, atendidosPorGrok, ubicacionesHoy] = await Promise.all([
            getCtrBlocksCached(),
            getGrokAttendedTodayCount(),
            getLocationSharedTodayCount(),
        ]);
        if (!data) return res.status(200).json({ today: stripComposition(null), ultimos100: stripComposition(null), retornosHoy: { total: 0, atendidosPorGrok }, ubicacionesHoy, asOf: Date.now() });

        res.setHeader('Cache-Control', 'private, max-age=30');
        return res.status(200).json({
            today: stripComposition(data.today),
            ultimos100: stripComposition(data.ultimos100),
            retornosHoy: {
                total: data.retornosHoy?.total || 0,            // completos retornados (compat MCP/tarjeta previa)
                completos: data.retornosHoy?.completos ?? data.retornosHoy?.total ?? 0,
                incompletos: data.retornosHoy?.incompletos || 0,
                todos: data.retornosHoy?.todos ?? data.retornosHoy?.total ?? 0, // completos + incompletos
                convertidos: data.retornosHoy?.convertidos || 0, // llegaron incompletos y completaron hoy
                atendidosPorGrok,
            },
            ubicacionesHoy,
            asOf: data.asOf,
            fecha: data.fecha,
        });
    } catch (error) {
        console.error('[candidates/ctr] error:', error);
        return res.status(500).json({ error: 'Error calculando CTR' });
    }
}
