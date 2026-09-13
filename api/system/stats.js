// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/system/stats  —  Estadísticas agregadas de candidatos (sección Statics)
// ═══════════════════════════════════════════════════════════════════════════════
// Se apoya 100% en el índice invertido facetado (bulk:idx:v1:*) que ya mantiene
// Envíos Masivos. Los conteos se obtienen con SCARD sobre sets ya canonizados, así
// que por la red solo viajan ENTEROS — nunca se lee un solo blob de candidato.
//
// El payload ensamblado se cachea 5 min (stats:overview:v1). `?refresh=true` lo
// salta y fuerza recálculo. No crea ningún cron ni escritura en el camino caliente.
// ═══════════════════════════════════════════════════════════════════════════════

import { getRedisClient, validateAdminSession } from '../utils/storage.js';
import { ensureFacetIndex } from '../utils/facet-index.js';

const V = 'bulk:idx:v1';
const CACHE_KEY = 'stats:overview:v1';
const CACHE_TTL = 5 * 60; // 5 min

const MANUAL_PROJECTS_KEY = 'candidatic_manual_projects';
const MANUAL_PROJECT_LINKS_PREFIX = 'crm_links:';

const AGE_MIN = 15;
const AGE_MAX = 99;
const SIN_DATO = 'Sin dato';

// Buckets de edad para la gráfica "EDADES PROPORCIÓN DEL TOTAL".
const AGE_BUCKETS = [
    { label: '18-24', min: 18, max: 24 },
    { label: '25-34', min: 25, max: 34 },
    { label: '35-44', min: 35, max: 44 },
    { label: '45-54', min: 45, max: 54 },
    { label: '55+', min: 55, max: AGE_MAX },
    { label: 'Menores de 18', min: AGE_MIN, max: 17 },
];

// Reusa el mismo loader que candidates.js para que, si el índice hay que
// reconstruirlo, los conteos de steps por proyecto queden consistentes.
async function loadManualProjectData(redis) {
    const projectsRaw = await redis.get(MANUAL_PROJECTS_KEY).catch(() => null);
    const projects = projectsRaw ? JSON.parse(projectsRaw) : [];
    const projectLinks = {};
    await Promise.all((Array.isArray(projects) ? projects : []).map(async (project) => {
        if (!project?.id) return;
        const linksRaw = await redis.get(`${MANUAL_PROJECT_LINKS_PREFIX}${project.id}`).catch(() => null);
        try { projectLinks[project.id] = linksRaw ? JSON.parse(linksRaw) : []; } catch { projectLinks[project.id] = []; }
    }));
    return { manualProjects: Array.isArray(projects) ? projects : [], projectLinks };
}

// SCARD de todos los valores de una dimensión, en un solo pipeline.
async function cardinalities(redis, dim, values) {
    if (!values || values.length === 0) return [];
    const pipe = redis.pipeline();
    values.forEach((value) => pipe.scard(`${V}:${dim}:${value}`));
    const rows = await pipe.exec();
    return values.map((label, i) => {
        const [err, count] = rows[i] || [];
        return { label, value: err ? 0 : (Number(count) || 0) };
    });
}

// Conteo por bucket de edad: SCARD de cada edad exacta del rango, sumado en JS.
async function ageBuckets(redis) {
    const pipe = redis.pipeline();
    for (let age = AGE_MIN; age <= AGE_MAX; age++) pipe.scard(`${V}:edad:${age}`);
    const rows = await pipe.exec();
    const byAge = {};
    for (let age = AGE_MIN; age <= AGE_MAX; age++) {
        const [err, count] = rows[age - AGE_MIN] || [];
        byAge[age] = err ? 0 : (Number(count) || 0);
    }
    return AGE_BUCKETS
        .map((b) => {
            let sum = 0;
            for (let age = b.min; age <= b.max; age++) sum += byAge[age] || 0;
            return { label: b.label, value: sum };
        })
        .filter((b) => b.value > 0);
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    const refresh = req.query.refresh === 'true';

    try {
        if (!refresh) {
            const cached = await redis.get(CACHE_KEY).catch(() => null);
            if (cached) {
                res.setHeader('Cache-Control', 'no-store');
                return res.json({ ...JSON.parse(cached), cached: true });
            }
        }

        const meta = await ensureFacetIndex(redis, () => loadManualProjectData(redis));
        const dims = meta?.dims || {};
        const total = Number(meta?.total) || 0;

        // Municipio: top 8 + "Otros" (una pie con 51 rebanadas es ilegible).
        const [genero, escolaridad, estatus, municipioAll, edades] = await Promise.all([
            cardinalities(redis, 'genero', dims.genero || []),
            cardinalities(redis, 'escolaridad', dims.escolaridad || []),
            cardinalities(redis, 'estatus', dims.estatus || []),
            cardinalities(redis, 'municipio', dims.municipio || []),
            ageBuckets(redis),
        ]);

        const municipioSorted = municipioAll
            .filter((m) => m.label !== SIN_DATO)
            .sort((a, b) => b.value - a.value);
        const TOP_N = 8;
        const municipioTop = municipioSorted.slice(0, TOP_N);
        const otrosSum = municipioSorted.slice(TOP_N).reduce((acc, m) => acc + m.value, 0);
        const municipio = otrosSum > 0
            ? [...municipioTop, { label: 'Otros', value: otrosSum }]
            : municipioTop;

        const find = (arr, label) => (arr.find((x) => x.label === label)?.value) || 0;
        const mujeres = find(genero, 'Mujer');
        const hombres = find(genero, 'Hombre');
        const completos = find(estatus, 'completo');
        const incompletos = find(estatus, 'incompleto');

        const payload = {
            success: true,
            generatedAt: meta?.generatedAt || new Date().toISOString(),
            total,
            // Comparaciones parte-vs-todo (donut con número al centro).
            mujeres,
            hombres,
            completos,
            incompletos,
            // Distribuciones categóricas (pie).
            edades,
            municipio,
            escolaridad: escolaridad.filter((e) => e.value > 0),
            cached: false,
        };

        await redis.set(CACHE_KEY, JSON.stringify({ ...payload, cached: undefined }), 'EX', CACHE_TTL).catch(() => {});

        res.setHeader('Cache-Control', 'no-store');
        return res.json(payload);
    } catch (error) {
        console.error('[STATS] Error:', error?.message);
        return res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }
}
