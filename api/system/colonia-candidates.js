/**
 * GET /api/system/colonia-candidates — candidatos del AMM que tienen COLONIA en texto pero NO
 * compartieron ubicación GPS (esos ya salen en /api/system/candidate-locations). Alimenta el filtro
 * "Colonias" de la sección Mapa: el frontend resuelve cada uno a una colonia del catálogo con
 * matchColoniaId() (src/data/coloniasAMM.js) y lo ilumina dentro de su colonia al seleccionarla.
 *
 * Fuente de datos (barata, sin leer los blobs completos de 22k candidatos):
 *   1. candidates:list → universo de ids (se actualiza en CADA saveCandidate → los nuevos entran ya).
 *   2. menos los ids con pin GPS (candidatic:candidate_locations).
 *   3. pipeline GET candidate:facet:<id> (~277B c/u, escrita en cada saveCandidate) → nombreReal,
 *      municipio, colonia. Se filtra en código: del AMM + con colonia.
 *
 * Frescura: como se enumera desde candidates:list y se leen las proyecciones (ambas se escriben en
 * cada guardado), un candidato NUEVO con colonia aparece dentro de la ventana de caché (~1 min), sin
 * depender del rebuild periódico del índice facetado. Incluye COMPLETOS e INCOMPLETOS por igual.
 *
 * Costo: ~6 MB de lectura de Redis por corrida en frío (≈22k facets). Se MITIGA con:
 *   - caché en memoria de 60s (por instancia serverless), y
 *   - carga PEREZOSA en el frontend (solo se pide al abrir el panel de Colonias, no en cada mapa).
 * Es una acción de admin poco frecuente, así que el costo real es de decenas de MB/día (despreciable
 * vs. el consumo mensual). Si algún día se vuelve caliente, migrar a un índice incremental
 * colonia→candidatos mantenido en saveCandidate (mismo patrón que syncCandidateStats).
 *
 * El filtro de AMM de aquí es GRUESO (solo acota la lectura); el match fino y la tabla de alias viven
 * ÚNICAMENTE en el frontend (matchColoniaId). Incluir de más es inofensivo: el frontend lo descarta.
 */

// Municipios del AMM + variantes que escriben los candidatos (normalizado, sin acentos) → solo para
// ACOTAR qué sets de municipio leer. No es la lógica de match (esa está en el frontend).
const AMM_NORM = new Set([
    'monterrey', 'guadalupe', 'san nicolas de los garza', 'apodaca', 'general escobedo',
    'santa catarina', 'san pedro garza garcia', 'garcia', 'juarez', 'salinas victoria',
    'pesqueria', 'cienega de flores', 'general zuazua', 'el carmen', 'hidalgo', 'abasolo',
    'santiago', 'cadereyta jimenez'
]);
const MUNI_ALIAS = {
    'benito juarez': 'juarez', 'escobedo': 'general escobedo', 'san nicolas': 'san nicolas de los garza',
    'san nicolas de los garza nuevo leon': 'san nicolas de los garza', 'san pedro': 'san pedro garza garcia',
    'garza garcia': 'san pedro garza garcia', 'zuazua': 'general zuazua', 'cadereyta': 'cadereyta jimenez',
    'cienega de flores nuevo leon': 'cienega de flores'
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const muniInAMM = (v) => { const n = norm(v); return AMM_NORM.has(MUNI_ALIAS[n] || n); };
const hasColonia = (v) => {
    const s = norm(v);
    return s.length > 0 && !s.includes('proporcionad') && !['n/a', 'na', 'null', 'ninguno', 'ninguna', 'none', '-', 'desconocido', 'undefined', 'sin colonia'].includes(s);
};

const CACHE_TTL_MS = 60000;
let _cache = { data: null, ts: 0 };

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    try {
        const { getRedisClient, validateAdminSession } = await import('../utils/storage.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        const now = Date.now();
        if (_cache.data && (now - _cache.ts) < CACHE_TTL_MS && req.query.fresh !== '1') {
            return res.status(200).json({ success: true, cached: true, total: _cache.data.length, candidates: _cache.data });
        }

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        // 1. Universo FRESCO de candidatos: `candidates:list` se actualiza en CADA saveCandidate, así
        //    que un candidato nuevo (con o sin colonia) entra de inmediato — no depende del rebuild
        //    periódico del índice facetado. Se le quitan los que ya tienen pin GPS (esos salen en
        //    /api/system/candidate-locations y NO deben duplicarse como pin aproximado de colonia).
        const [allIds, gpsIds] = await Promise.all([
            redis.zrange('candidates:list', 0, -1),
            redis.hkeys('candidatic:candidate_locations')
        ]);
        const gpsSet = new Set(gpsIds || []);
        const targetIds = (allIds || []).filter(id => !gpsSet.has(id));
        if (!targetIds.length) {
            _cache = { data: [], ts: now };
            return res.status(200).json({ success: true, total: 0, candidates: [] });
        }

        // 2. Lee las proyecciones ligeras (candidate:facet:<id> ~277B, escritas en cada saveCandidate —
        //    SIEMPRE frescas), NO los blobs completos. Filtra en código: del AMM + con colonia. Incluye
        //    por igual perfiles COMPLETOS e INCOMPLETOS (no se filtra por completitud). ~6 MB de lectura
        //    en frío; se mitiga con la caché de 60s y la carga perezosa del panel en el frontend.
        const pipe = redis.pipeline();
        for (const id of targetIds) pipe.get(`candidate:facet:${id}`);
        const results = await pipe.exec();

        const out = [];
        for (let i = 0; i < targetIds.length; i++) {
            const raw = results?.[i]?.[1];
            if (!raw) continue;
            let f;
            try { f = JSON.parse(raw); } catch { continue; }
            if (!muniInAMM(f.municipio) || !hasColonia(f.colonia)) continue;
            out.push({
                id: targetIds[i],
                n: String(f.nombreReal || '').slice(0, 60),   // nombre para el popup
                m: String(f.municipio || ''),                  // municipio crudo → matchColoniaId
                c: String(f.colonia || '')                     // colonia cruda   → matchColoniaId
            });
        }

        _cache = { data: out, ts: now };
        return res.status(200).json({ success: true, total: out.length, candidates: out });
    } catch (error) {
        console.error('[colonia-candidates] error:', error.message);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
