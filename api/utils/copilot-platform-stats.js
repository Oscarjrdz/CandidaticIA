import { getRedisClient } from './storage.js';

const CACHE_TTL_MS = 60 * 1000;
const RECENT_SAMPLE_LIMIT = 500;

let cachedStats = null;
let cachedAt = 0;

function safeParse(value, fallback) {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function cleanBucketValue(value) {
    return String(value || '').trim() || 'Sin dato';
}

function bump(map, value) {
    const key = cleanBucketValue(value);
    map[key] = (map[key] || 0) + 1;
}

function topEntries(map, limit = 8) {
    return Object.entries(map || {})
        .map(([name, count]) => ({ name, count: toNumber(count) }))
        .filter(item => item.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

function getActiveStatus(item) {
    const status = String(item?.status || item?.estado || '').toLowerCase();
    if (!status) return true;
    return !['inactive', 'inactivo', 'archived', 'archivado', 'deleted', 'eliminado', 'closed', 'cerrado'].includes(status);
}

async function getRecentCandidateBuckets(redis) {
    const ids = await redis.zrevrange('candidates:list', 0, RECENT_SAMPLE_LIMIT - 1);
    if (!ids?.length) {
        return {
            sampleSize: 0,
            origins: [],
            categories: [],
            municipalities: [],
            schoolLevels: [],
            genders: []
        };
    }

    const pipe = redis.pipeline();
    ids.forEach(id => pipe.get(`candidate:${id}`));
    const rows = await pipe.exec();

    const buckets = {
        origins: {},
        categories: {},
        municipalities: {},
        schoolLevels: {},
        genders: {}
    };
    let sampleSize = 0;

    for (const [err, raw] of rows) {
        if (err || !raw) continue;
        const c = safeParse(raw, null);
        if (!c) continue;
        sampleSize += 1;
        bump(buckets.origins, c.origen || c.source);
        bump(buckets.categories, c.categoria);
        bump(buckets.municipalities, c.municipio);
        bump(buckets.schoolLevels, c.escolaridad);
        bump(buckets.genders, c.genero);
    }

    return {
        sampleSize,
        origins: topEntries(buckets.origins),
        categories: topEntries(buckets.categories),
        municipalities: topEntries(buckets.municipalities),
        schoolLevels: topEntries(buckets.schoolLevels),
        genders: topEntries(buckets.genders)
    };
}

export async function getPlatformStats({ forceRefresh = false } = {}) {
    if (!forceRefresh && cachedStats && Date.now() - cachedAt < CACHE_TTL_MS) {
        return { ...cachedStats, cache: 'hit' };
    }

    const redis = getRedisClient();
    if (!redis) {
        return { success: false, error: 'Redis no disponible' };
    }

    const pipe = redis.pipeline();
    pipe.scard('stats:list:complete');
    pipe.scard('stats:list:pending');
    pipe.scard('candidates:unread');
    pipe.get('stats:msg:incoming');
    pipe.get('stats:msg:outgoing');
    pipe.hgetall('candidatic:tag_counts');
    pipe.get('candidatic:chat_tags');
    pipe.get('custom_fields');
    pipe.get('automation_rules');
    pipe.get('candidatic_vacancies');
    pipe.zcard('projects:all');
    pipe.get('candidatic_users');
    pipe.get('candidatic_roles');

    const results = await pipe.exec();
    const val = (index, fallback = null) => results[index]?.[1] ?? fallback;

    const complete = toNumber(val(0));
    const incomplete = toNumber(val(1));
    const unread = toNumber(val(2));
    const incoming = toNumber(val(3));
    const outgoing = toNumber(val(4));
    const tagCounts = val(5, {}) || {};
    const savedTags = safeParse(val(6), []);
    const customFields = safeParse(val(7), []);
    const automationRules = safeParse(val(8), []);
    const vacancies = safeParse(val(9), []);
    const projectsTotal = toNumber(val(10));
    const users = safeParse(val(11), []);
    const roles = safeParse(val(12), []);

    const activeVacancies = Array.isArray(vacancies) ? vacancies.filter(getActiveStatus).length : 0;
    const enabledRules = Array.isArray(automationRules) ? automationRules.filter(rule => rule?.enabled !== false).length : 0;
    const activeUsers = Array.isArray(users) ? users.filter(user => user?.status !== 'Inactive').length : 0;
    const recent = await getRecentCandidateBuckets(redis);

    const stats = {
        success: true,
        generatedAt: new Date().toISOString(),
        cache: 'miss',
        candidates: {
            total: complete + incomplete,
            complete,
            incomplete,
            unread
        },
        messages: {
            incoming,
            outgoing,
            total: incoming + outgoing
        },
        tags: {
            configured: Array.isArray(savedTags) ? savedTags.length : 0,
            top: topEntries(tagCounts, 10)
        },
        filters: {
            fixed: ['unread', 'complete', 'incomplete', 'tag', 'search', 'unreadFirst'],
            customFields: Array.isArray(customFields) ? customFields.map(f => ({
                value: f.value,
                label: f.label || f.value
            })).slice(0, 20) : []
        },
        automations: {
            total: Array.isArray(automationRules) ? automationRules.length : 0,
            enabled: enabledRules
        },
        vacancies: {
            total: Array.isArray(vacancies) ? vacancies.length : 0,
            active: activeVacancies
        },
        projects: {
            total: projectsTotal
        },
        users: {
            total: Array.isArray(users) ? users.length : 0,
            active: activeUsers,
            roles: Array.isArray(roles) ? roles.length : 0
        },
        recentSample: recent
    };

    cachedStats = stats;
    cachedAt = Date.now();
    return stats;
}

export function isPlatformStatsIntent(message) {
    const normalized = String(message || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const statsWords = [
        'cuantos', 'cuantas', 'estadistica', 'estadisticas', 'metricas', 'resumen',
        'dashboard', 'plataforma', 'datos', 'numeros', 'reporte'
    ];
    const platformWords = [
        'candidato', 'candidatos', 'completo', 'completos', 'incompleto', 'incompletos',
        'sin leer', 'no leidos', 'unread', 'tag', 'tags', 'etiqueta', 'etiquetas',
        'filtro', 'filtros', 'vacante', 'vacantes', 'proyecto', 'proyectos',
        'automatizacion', 'automatizaciones', 'usuarios', 'mensajes'
    ];

    return statsWords.some(word => normalized.includes(word)) &&
        platformWords.some(word => normalized.includes(word));
}

export function getDirectPlatformStatsReply(message, stats) {
    if (!stats?.success) return null;
    const normalized = String(message || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const asksCount = /cuantos|cuantas|numero|total/.test(normalized);
    const asksCandidates = /candidato|candidatos|completo|incompleto|sin leer|no leidos|unread/.test(normalized);
    const asksTags = /tag|tags|etiqueta|etiquetas/.test(normalized);
    const asksFilters = /filtro|filtros|campos/.test(normalized);

    if (asksCount && asksCandidates && !asksTags && !asksFilters) {
        return `Tenemos ${stats.candidates.total} candidatos: ${stats.candidates.complete} completos, ${stats.candidates.incomplete} incompletos y ${stats.candidates.unread} sin leer.`;
    }

    if (asksCount && asksTags) {
        const top = stats.tags.top.slice(0, 5).map(tag => `${tag.name}: ${tag.count}`).join(', ');
        return top
            ? `Hay ${stats.tags.configured} tags configurados. Top tags: ${top}.`
            : `Hay ${stats.tags.configured} tags configurados, sin conteos activos todavia.`;
    }

    if (asksFilters) {
        const custom = stats.filters.customFields.map(field => field.label).slice(0, 8).join(', ');
        return `Filtros base: ${stats.filters.fixed.join(', ')}. Campos personalizados: ${custom || 'sin campos personalizados'}.`;
    }

    return null;
}

export function formatPlatformStatsForPrompt(stats) {
    if (!stats?.success) return '';
    const topTags = stats.tags.top.slice(0, 8).map(tag => `${tag.name}:${tag.count}`).join(', ') || 'sin tags activos';
    const topOrigins = stats.recentSample.origins.slice(0, 5).map(item => `${item.name}:${item.count}`).join(', ') || 'sin dato';
    const topCategories = stats.recentSample.categories.slice(0, 5).map(item => `${item.name}:${item.count}`).join(', ') || 'sin dato';
    const topMunicipalities = stats.recentSample.municipalities.slice(0, 5).map(item => `${item.name}:${item.count}`).join(', ') || 'sin dato';

    return `
[METRICAS DE PLATAFORMA - AGREGADAS, SIN DATOS PERSONALES]
- Candidatos: total ${stats.candidates.total}, completos ${stats.candidates.complete}, incompletos ${stats.candidates.incomplete}, sin leer ${stats.candidates.unread}
- Mensajes: entrantes ${stats.messages.incoming}, salientes ${stats.messages.outgoing}
- Tags configurados: ${stats.tags.configured}; top tags: ${topTags}
- Filtros base: ${stats.filters.fixed.join(', ')}
- Campos personalizados: ${stats.filters.customFields.map(f => f.label).slice(0, 12).join(', ') || 'sin campos personalizados'}
- Vacantes: total ${stats.vacancies.total}, activas ${stats.vacancies.active}
- Proyectos: ${stats.projects.total}
- Automatizaciones: total ${stats.automations.total}, activas ${stats.automations.enabled}
- Usuarios: total ${stats.users.total}, activos ${stats.users.active}, roles ${stats.users.roles}
- Muestra reciente de ${stats.recentSample.sampleSize} candidatos: origenes ${topOrigins}; categorias ${topCategories}; municipios ${topMunicipalities}
INSTRUCCION: Responde con estos agregados. No inventes candidatos individuales ni telefonos.
`;
}
