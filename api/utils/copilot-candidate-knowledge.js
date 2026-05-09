import { getOpenAIResponse } from './openai.js';
import { getRedisClient, auditProfile } from './storage.js';

const TIME_ZONE = 'America/Monterrey';
const CANDIDATES_LIST = 'candidates:list';
const CANDIDATE_PREFIX = 'candidate:';
const CHUNK_SIZE = 500;
const ANALYTIC_FIELD_ALLOWLIST = [
    'genero',
    'municipio',
    'categoria',
    'escolaridad',
    'origen',
    'source',
    'statusAudit',
    'projectId',
    'adId',
    'adHeadline',
    'adSource',
    'puesto',
    'experiencia',
    'disponibilidad',
    'colonia',
    'estado',
    'ciudad'
];

function formatDateKey(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function parseCandidateDate(candidate) {
    const raw = candidate?.primerContacto || candidate?.createdAt || candidate?.fecha || candidate?.ultimoMensaje;
    if (raw) {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const idMatch = String(candidate?.id || '').match(/cand_(\d{10,})_/);
    if (idMatch) {
        const parsed = new Date(Number(idMatch[1]));
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    return null;
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function calculateAge(candidate) {
    const storedAge = Number(candidate?.edad);
    if (Number.isFinite(storedAge) && storedAge > 0 && storedAge < 100) return Math.floor(storedAge);

    const rawDob = String(candidate?.fechaNacimiento || '').trim();
    if (!rawDob) return null;

    let birthDate = null;
    const slashMatch = rawDob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
        birthDate = new Date(Number(slashMatch[3]), Number(slashMatch[2]) - 1, Number(slashMatch[1]));
    } else {
        const parsed = new Date(rawDob);
        if (!Number.isNaN(parsed.getTime())) birthDate = parsed;
    }

    if (!birthDate || Number.isNaN(birthDate.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;

    return age > 0 && age < 100 ? age : null;
}

function ageBucket(age) {
    if (!Number.isFinite(age)) return 'Sin edad';
    if (age < 18) return 'Menor de 18';
    if (age <= 24) return '18-24';
    if (age <= 34) return '25-34';
    if (age <= 44) return '35-44';
    if (age <= 54) return '45-54';
    if (age <= 64) return '55-64';
    return '65+';
}

function cleanAnalyticValue(value) {
    if (value === null || value === undefined || value === '') return 'Sin dato';
    if (Array.isArray(value)) return value.length ? value.map(item => String(item).trim()).filter(Boolean) : ['Sin dato'];
    if (typeof value === 'object') return null;

    const clean = String(value).trim();
    if (!clean || clean.toLowerCase() === 'undefined' || clean.toLowerCase() === 'null') return 'Sin dato';
    if (clean.length > 120) return `${clean.slice(0, 117)}...`;
    return clean;
}

function increment(map, key, amount = 1) {
    if (!key) return;
    const cleanKey = String(key).trim();
    if (!cleanKey || cleanKey.toLowerCase() === 'undefined' || cleanKey.toLowerCase() === 'null') return;
    map.set(cleanKey, (map.get(cleanKey) || 0) + amount);
}

function topEntries(map, limit = 100) {
    return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([label, count]) => ({ label, count }));
}

function sortedNumberEntries(map) {
    return [...map.entries()]
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([label, count]) => ({ label: String(label), count }));
}

function buildSeries(countsByDate, days) {
    const today = new Date();
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = formatDateKey(addDays(today, -i));
        series.push({ date, count: countsByDate.get(date) || 0 });
    }
    return series;
}

function average(series) {
    if (!series.length) return 0;
    const total = series.reduce((sum, item) => sum + item.count, 0);
    return Number((total / series.length).toFixed(2));
}

function findBestDay(countsByDate) {
    let best = { date: null, count: 0 };
    for (const [date, count] of countsByDate.entries()) {
        if (count > best.count) best = { date, count };
    }
    return best;
}

function weekdayName(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat('es-MX', { weekday: 'long', timeZone: 'UTC' }).format(date);
}

export function isCandidateKnowledgeQuestion(message = '') {
    const text = normalizeText(message);
    const mentionsCandidates = (
        text.includes('candidato') ||
        text.includes('candidatos') ||
        text.includes('base de datos') ||
        text.includes('base de candidatos') ||
        text.includes('leads') ||
        text.includes('postulantes')
    );

    const asksCandidateMetric = (
        text.includes('hoy') ||
        text.includes('ayer') ||
        text.includes('nuevo') ||
        text.includes('nuevos') ||
        text.includes('dia') ||
        text.includes('semana') ||
        text.includes('mes') ||
        text.includes('cuantos') ||
        text.includes('cuantas') ||
        text.includes('mas candidatos') ||
        text.includes('estadistica') ||
        text.includes('conocimiento')
    );

    const asksDatabaseDimension = (
        text.includes('mujer') ||
        text.includes('mujeres') ||
        text.includes('hombre') ||
        text.includes('hombres') ||
        text.includes('genero') ||
        text.includes('edad') ||
        text.includes('edades') ||
        text.includes('municipio') ||
        text.includes('ciudad') ||
        text.includes('escolaridad') ||
        text.includes('categoria') ||
        text.includes('origen') ||
        text.includes('perfil completo') ||
        text.includes('incompleto')
    );

    return (mentionsCandidates && asksCandidateMetric) || (asksDatabaseDimension && (text.includes('cuanto') || text.includes('cuantos') || text.includes('cuantas') || text.includes('dime') || text.includes('analiza') || text.includes('hay')));
}

export async function getCandidateKnowledgeSnapshot() {
    const redis = getRedisClient();
    if (!redis) throw new Error('Redis no disponible');

    const [completeCount, pendingCount, totalIndexed] = await Promise.all([
        redis.scard('stats:list:complete').catch(() => 0),
        redis.scard('stats:list:pending').catch(() => 0),
        redis.zcard(CANDIDATES_LIST).catch(() => 0)
    ]);

    const countsByDate = new Map();
    const byOrigin = new Map();
    const byCategory = new Map();
    const byMunicipality = new Map();
    const byEducation = new Map();
    const byGender = new Map();
    const byStatus = new Map();
    const byWeekday = new Map();
    const byAge = new Map();
    const byAgeBucket = new Map();
    const customFieldDistributions = new Map();
    const generalFieldDistributions = new Map();
    const todayKey = formatDateKey(new Date());
    const yesterdayKey = formatDateKey(addDays(new Date(), -1));

    let scanned = 0;
    let withDate = 0;
    let withoutDate = 0;
    let adsCandidates = 0;
    let manualCandidates = 0;
    let completeAudited = 0;
    let pendingAudited = 0;
    let withAge = 0;
    let withoutAge = 0;

    const customFieldsJson = await redis.get('custom_fields').catch(() => null);
    let customFields = [];
    try {
        customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];
    } catch {
        customFields = [];
    }
    const customFieldKeys = customFields.map(field => field.value).filter(Boolean);
    const analyticKeys = [...new Set([...ANALYTIC_FIELD_ALLOWLIST, ...customFieldKeys])];
    analyticKeys.forEach(key => generalFieldDistributions.set(key, new Map()));
    customFieldKeys.forEach(key => customFieldDistributions.set(key, new Map()));

    while (scanned < totalIndexed) {
        const ids = await redis.zrevrange(CANDIDATES_LIST, scanned, scanned + CHUNK_SIZE - 1);
        if (!ids || ids.length === 0) break;

        const pipeline = redis.pipeline();
        ids.forEach(id => pipeline.get(`${CANDIDATE_PREFIX}${id}`));
        const results = await pipeline.exec();

        for (const [err, raw] of results) {
            if (err || !raw) continue;
            let candidate = null;
            try {
                candidate = JSON.parse(raw);
            } catch {
                continue;
            }

            const createdDate = parseCandidateDate(candidate);
            if (createdDate) {
                const dateKey = formatDateKey(createdDate);
                increment(countsByDate, dateKey);
                increment(byWeekday, weekdayName(dateKey));
                withDate++;
            } else {
                withoutDate++;
            }

            const origin = candidate.origen || candidate.source || (candidate.adId || candidate.adHeadline ? 'facebook_ads' : 'sin_origen');
            increment(byOrigin, origin);
            increment(byCategory, candidate.categoria || 'Sin categoria');
            increment(byMunicipality, candidate.municipio || 'Sin municipio');
            increment(byEducation, candidate.escolaridad || 'Sin escolaridad');
            increment(byGender, candidate.genero || 'Sin genero');

            const age = calculateAge(candidate);
            if (age !== null) {
                increment(byAge, age);
                increment(byAgeBucket, ageBucket(age));
                withAge++;
            } else {
                increment(byAgeBucket, 'Sin edad');
                withoutAge++;
            }

            for (const key of analyticKeys) {
                const distribution = generalFieldDistributions.get(key);
                const value = cleanAnalyticValue(candidate[key]);
                if (Array.isArray(value)) {
                    value.forEach(item => increment(distribution, item));
                } else if (value !== null) {
                    increment(distribution, value);
                }
            }

            for (const key of customFieldKeys) {
                const distribution = customFieldDistributions.get(key);
                const value = cleanAnalyticValue(candidate[key]);
                if (Array.isArray(value)) {
                    value.forEach(item => increment(distribution, item));
                } else if (value !== null) {
                    increment(distribution, value);
                }
            }

            if (candidate.origen === 'facebook_ctwa' || candidate.adId || candidate.adHeadline) adsCandidates++;
            if (candidate.origen === 'manual_chat') manualCandidates++;

            const audit = auditProfile(candidate);
            if (audit.isComplete) {
                completeAudited++;
                increment(byStatus, 'Completo');
            } else {
                pendingAudited++;
                increment(byStatus, 'Pendiente');
            }
        }

        scanned += ids.length;
    }

    const last7Days = buildSeries(countsByDate, 7);
    const last30Days = buildSeries(countsByDate, 30);
    const bestDay = findBestDay(countsByDate);
    const totalWithFallback = totalIndexed || completeCount + pendingCount;
    const fieldDistributions = {};
    for (const [field, map] of generalFieldDistributions.entries()) {
        if (map.size > 0) fieldDistributions[field] = topEntries(map, 150);
    }

    const customDistributions = {};
    for (const [field, map] of customFieldDistributions.entries()) {
        if (map.size > 0) customDistributions[field] = topEntries(map, 150);
    }

    return {
        generatedAt: new Date().toISOString(),
        timezone: TIME_ZONE,
        totals: {
            candidates: totalWithFallback,
            indexed: totalIndexed,
            completeFromStats: completeCount,
            pendingFromStats: pendingCount,
            completeAudited,
            pendingAudited,
            withCreationDate: withDate,
            withoutCreationDate: withoutDate,
            withAge,
            withoutAge,
            adsCandidates,
            manualCandidates
        },
        newCandidates: {
            today: { date: todayKey, count: countsByDate.get(todayKey) || 0 },
            yesterday: { date: yesterdayKey, count: countsByDate.get(yesterdayKey) || 0 },
            bestDay,
            last7Days,
            last30Days,
            averageLast7Days: average(last7Days),
            averageLast30Days: average(last30Days)
        },
        distributions: {
            byOrigin: topEntries(byOrigin, 100),
            byCategory: topEntries(byCategory, 100),
            byMunicipality: topEntries(byMunicipality, 150),
            byEducation: topEntries(byEducation, 100),
            byGender: topEntries(byGender, 50),
            byStatus: topEntries(byStatus, 20),
            byWeekday: topEntries(byWeekday, 7)
        },
        ageAnalytics: {
            byExactAge: sortedNumberEntries(byAge),
            byBucket: topEntries(byAgeBucket, 20)
        },
        fieldCatalog: {
            standardAnalyticFields: ANALYTIC_FIELD_ALLOWLIST,
            customFields: customFields.map(field => ({ value: field.value, label: field.label || field.value }))
        },
        fieldDistributions,
        customFieldDistributions: customDistributions,
        privacy: {
            mode: 'aggregate_only',
            excludesPersonalFields: ['nombre', 'nombreReal', 'whatsapp', 'profilePic', 'messages']
        }
    };
}

export async function answerCandidateKnowledgeQuestion(question, history = [], model = 'gpt-4o-mini') {
    const snapshot = await getCandidateKnowledgeSnapshot();

    const systemPrompt = `
Eres Brenda Rodriguez, copiloto interno de Candidatic IA.
Estás usando la skill "Conocimiento de la base de Candidatos".

Reglas:
- Responde en español natural, claro y ejecutivo.
- Usa solo los datos del SNAPSHOT. No inventes números.
- Puedes responder preguntas por género, edad exacta, rangos de edad, municipio, categoría, escolaridad, origen, estado, campos personalizados y fechas usando las distribuciones del SNAPSHOT.
- Si te preguntan "cuántas mujeres", usa distributions.byGender. Si preguntan edades, usa ageAnalytics.byExactAge o ageAnalytics.byBucket.
- Si preguntan por un municipio, categoría u otro valor específico, busca el valor más cercano en las distribuciones disponibles.
- Si el usuario pregunta "hoy" o "ayer", usa la zona horaria ${TIME_ZONE}.
- Explica cuando un dato dependa de "primerContacto", "createdAt" o respaldo por id.
- No muestres teléfonos ni datos personales.
- Si conviene, da una lectura operativa breve: tendencia, pico, alerta o siguiente pregunta útil.

SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}
`;

    const messages = [
        ...history.slice(-6),
        { role: 'user', content: question }
    ];

    const result = await getOpenAIResponse(messages, systemPrompt, model, null, null, null, 900);

    return {
        reply: result.content,
        snapshot,
        model: result.model,
        skill: 'candidate_knowledge'
    };
}
