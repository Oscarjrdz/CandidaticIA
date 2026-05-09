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
        text.includes('candidata') ||
        text.includes('candidatos') ||
        text.includes('candidatas') ||
        text.includes('persona') ||
        text.includes('personas') ||
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
        text.includes('conocimiento') ||
        text.includes('hora') ||
        text.includes('horario')
    );

    const asksDatabaseDimension = (
        text.includes('mujer') ||
        text.includes('mujeres') ||
        text.includes('hombre') ||
        text.includes('hombres') ||
        text.includes('genero') ||
        text.includes('edad') ||
        text.includes('edades') ||
        text.includes('año') ||
        text.includes('años') ||
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

const SNAPSHOT_CACHE_KEY = 'copilot:snapshot:cache';
const SNAPSHOT_CACHE_TTL = 5 * 60; // 5 min en segundos

export async function getCandidateKnowledgeSnapshot() {
    const redis = getRedisClient();
    if (!redis) throw new Error('Redis no disponible');

    // Devolver snapshot cacheado si está fresco
    try {
        const cached = await redis.get(SNAPSHOT_CACHE_KEY);
        if (cached) return JSON.parse(cached);
    } catch { /* ignore cache miss */ }

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
    const byHour = new Map();
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
    const recentCandidates = [];
    const allCandidatesSummary = [];

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
                
                const hour = createdDate.getHours();
                const hourLabel = `${hour.toString().padStart(2, '0')}:00`;
                increment(byHour, hourLabel);
                
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

            // Build searchable candidate roster (safe fields only)
            const safeSummary = {
                id: candidate.id,
                nombre: candidate.nombreReal || candidate.nombre || 'Sin nombre',
                genero: candidate.genero || '',
                edad: calculateAge(candidate) || '',
                municipio: candidate.municipio || '',
                categoria: candidate.categoria || '',
                escolaridad: candidate.escolaridad || '',
                puesto: candidate.puesto || '',
                experiencia: candidate.experiencia || '',
                origen: candidate.origen || candidate.source || '',
                estado: audit.isComplete ? 'Completo' : 'Pendiente',
                datosFaltantes: audit.missingLabels.join(', ') || '',
                fecha: createdDate ? formatDateKey(createdDate) : '',
                ultimoMensaje: candidate.ultimoMensaje ? formatDateKey(new Date(candidate.ultimoMensaje)) : '',
                tags: Array.isArray(candidate.tags) ? candidate.tags.join(', ') : '',
                projectId: candidate.projectId || '',
                colonia: candidate.colonia || '',
                ciudad: candidate.ciudad || '',
                disponibilidad: candidate.disponibilidad || ''
            };

            // Add custom field values to summary
            for (const key of customFieldKeys) {
                const val = candidate[key];
                if (val && typeof val !== 'object') safeSummary[key] = String(val);
            }

            allCandidatesSummary.push(safeSummary);
            if (recentCandidates.length < 50) recentCandidates.push(safeSummary);
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

    const snapshot = {
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
            byWeekday: topEntries(byWeekday, 7),
            byHour: topEntries(byHour, 24)
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
        recentCandidates,
        allCandidatesSummary,
        privacy: {
            mode: 'aggregate_and_roster',
            note: 'No phone numbers or profile pictures are included. Roster contains safe profile fields only.',
            excludesPersonalFields: ['whatsapp', 'profilePic', 'messages']
        }
    };

    // Guardar en caché 5 min (fire-and-forget)
    try {
        await redis.set(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot), 'EX', SNAPSHOT_CACHE_TTL);
    } catch { /* ignore */ }

    return snapshot;
}

/**
 * O(1) quick stats for the general copilot prompt (~50 tokens).
 */
export async function getQuickCandidateStats() {
    const redis = getRedisClient();
    if (!redis) return null;
    try {
        const [complete, pending] = await Promise.all([
            redis.scard('stats:list:complete').catch(() => 0),
            redis.scard('stats:list:pending').catch(() => 0)
        ]);
        return `Base de candidatos: ${complete + pending} total (${complete} completos, ${pending} pendientes).`;
    } catch { return null; }
}

/**
 * Converts the heavy JSON snapshot into compact text (~500-800 tokens).
 */
function formatCompactSnapshot(snapshot) {
    const t = snapshot.totals;
    const nc = snapshot.newCandidates;
    const lines = [];

    lines.push(`=== BASE DE CANDIDATOS (cifras reales, ${snapshot.timezone}) ===`);
    lines.push(`Total: ${t.candidates} | Completos: ${t.completeAudited} | Pendientes: ${t.pendingAudited}`);
    lines.push(`Con fecha: ${t.withCreationDate} | Sin fecha: ${t.withoutCreationDate}`);
    lines.push(`Con edad: ${t.withAge} | Sin edad: ${t.withoutAge}`);
    lines.push(`Desde Ads: ${t.adsCandidates} | Manual/Chat: ${t.manualCandidates}`);
    lines.push('');
    lines.push(`Hoy (${nc.today.date}): ${nc.today.count} | Ayer (${nc.yesterday.date}): ${nc.yesterday.count}`);
    lines.push(`Mejor día: ${nc.bestDay.date} (${nc.bestDay.count})`);
    lines.push(`Promedio 7d: ${nc.averageLast7Days} | Promedio 30d: ${nc.averageLast30Days}`);
    lines.push(`Últimos 7 días: ${nc.last7Days.map(d => `${d.date}:${d.count}`).join(', ')}`);
    lines.push('');

    const distMap = {
        byGender: 'Género', byMunicipality: 'Municipio', byCategory: 'Categoría',
        byEducation: 'Escolaridad', byOrigin: 'Origen', byStatus: 'Estado', byWeekday: 'Día semana', byHour: 'Hora del día'
    };
    for (const [key, label] of Object.entries(distMap)) {
        const dist = snapshot.distributions[key];
        if (dist?.length) lines.push(`${label}: ${dist.slice(0, 25).map(d => `${d.label}(${d.count})`).join(', ')}`);
    }

    if (snapshot.ageAnalytics?.byBucket?.length) {
        lines.push(`Rangos edad: ${snapshot.ageAnalytics.byBucket.map(d => `${d.label}(${d.count})`).join(', ')}`);
    }
    if (snapshot.ageAnalytics?.byExactAge?.length) {
        lines.push(`Edades exactas: ${snapshot.ageAnalytics.byExactAge.slice(0, 30).map(d => `${d.label}(${d.count})`).join(', ')}`);
    }

    // Custom/extra field distributions (compact)
    const skipKeys = new Set(['genero', 'municipio', 'categoria', 'escolaridad', 'origen', 'statusAudit']);
    if (snapshot.fieldDistributions) {
        for (const [field, entries] of Object.entries(snapshot.fieldDistributions)) {
            if (!skipKeys.has(field) && entries.length > 0) {
                lines.push(`${field}: ${entries.slice(0, 15).map(d => `${d.label}(${d.count})`).join(', ')}`);
            }
        }
    }

    return lines.join('\n');
}

/**
 * Extract structured filter constraints from the conversation context.
 * Flash LLM call (gpt-4o-mini).
 */
async function extractSearchFilter(questionContext) {
    const systemPrompt = `
You are an intent extractor for a database of job candidates.
Extract the mathematical/logical filter constraints from the query and return a valid JSON object.

Rules:
1. Return ONLY JSON.
2. If the user is NOT asking about candidates or NOT applying a specific filter, set hasFilter to false.
3. The schema must exactly match this interface:
{
  "hasFilter": boolean,
  "gender": string | null, // "femenino" or "masculino"
  "ageMin": number | null,
  "ageMax": number | null,
  "status": string | null, // "Completo" or "Pendiente"
  "municipality": string | null,
  "dateRelative": string | null, // "hoy", "ayer", "semana"
  "keywords": string[] // any other specific nouns, names, roles, or keywords mentioned
}

Example: "cuantas mujeres de 20 a 25 años de Monterrey llegaron hoy"
{
  "hasFilter": true,
  "gender": "femenino",
  "ageMin": 20,
  "ageMax": 25,
  "status": null,
  "municipality": "Monterrey",
  "dateRelative": "hoy",
  "keywords": []
}

Example: "y de 28" (Context implies women because of conversation)
{
  "hasFilter": true,
  "gender": "femenino",
  "ageMin": 28,
  "ageMax": 28,
  "status": null,
  "municipality": null,
  "dateRelative": null,
  "keywords": []
}

Example: "hombres mayores a 30"
{
  "hasFilter": true,
  "gender": "masculino",
  "ageMin": 31,
  "ageMax": null,
  "status": null,
  "municipality": null,
  "dateRelative": null,
  "keywords": []
}
`;

    try {
        const result = await getOpenAIResponse(
            [{ role: 'user', content: questionContext }],
            systemPrompt,
            'gpt-4o-mini',
            null,
            { type: 'json_object' },
            null,
            150
        );
        return JSON.parse(result.content);
    } catch(e) {
        console.error("[Search Extractor] Failed:", e.message);
        return { hasFilter: true, keywords: questionContext.split(' ') }; // fallback
    }
}

/**
 * Server-side candidate search. Filters the roster in Node.js using structured intent.
 */
export async function searchCandidateRoster(roster, searchContext) {
    if (!roster?.length) return { totalMatches: 0, candidates: [] };
    
    // Quick heuristic to skip LLM extraction if there's clearly no context
    if (!searchContext || searchContext.trim().length < 3) return { totalMatches: 0, candidates: [] };

    const filter = await extractSearchFilter(searchContext);
    if (!filter.hasFilter) return { totalMatches: 0, candidates: [] };

    let results = roster;

    // --- Date filters ---
    if (filter.dateRelative) {
        const today = formatDateKey(new Date());
        const yesterday = formatDateKey(addDays(new Date(), -1));
        const weekAgo = formatDateKey(addDays(new Date(), -7));

        if (filter.dateRelative === 'hoy') results = results.filter(c => c.fecha === today);
        else if (filter.dateRelative === 'ayer') results = results.filter(c => c.fecha === yesterday);
        else if (filter.dateRelative === 'semana') results = results.filter(c => c.fecha >= weekAgo);
    }

    // --- Gender filter ---
    if (filter.gender) {
        results = results.filter(c => {
            const g = normalizeText(c.genero || '');
            return filter.gender === 'femenino' ? (g.includes('mujer') || g.includes('femenin')) : (g.includes('hombre') || g.includes('masculin'));
        });
    }

    // --- Age filter ---
    if (filter.ageMin !== null) {
        results = results.filter(c => c.edad >= filter.ageMin);
    }
    if (filter.ageMax !== null) {
        results = results.filter(c => c.edad <= filter.ageMax);
    }

    // --- Status filter ---
    if (filter.status) {
        results = results.filter(c => filter.status === 'Completo' ? c.estado === 'Completo' : c.estado === 'Pendiente');
    }

    // --- Municipality filter ---
    if (filter.municipality) {
        const searchMuni = normalizeText(filter.municipality);
        results = results.filter(c => normalizeText(c.municipality || c.municipio || '').includes(searchMuni));
    }

    // --- Keyword search ---
    if (filter.keywords && filter.keywords.length > 0) {
        const stopWords = new Set(['como', 'dime', 'lista', 'candidatos', 'base', 'datos', 'perfiles', 'tiene', 'donde', 'brenda']);
        const terms = filter.keywords.map(k => normalizeText(k)).filter(w => w.length > 2 && !stopWords.has(w));
        
        if (terms.length > 0) {
            results = results.filter(c => {
                const text = normalizeText(Object.values(c).filter(v => typeof v === 'string').join(' '));
                return terms.some(t => text.includes(t) || text === t);
            });
        }
    }

    return { totalMatches: results.length, candidates: results.slice(0, 30) };
}

/**
 * Format search results as compact text for GPT.
 */
function formatSearchResults(searchData) {
    if (!searchData || !searchData.candidates || searchData.candidates.length === 0) return '';
    const { totalMatches, candidates } = searchData;
    
    const lines = [`\n=== BÚSQUEDA ESPECÍFICA (Total coincidencias: ${totalMatches}. Mostrando ${candidates.length}) ===`];
    lines.push(`NOTA PARA BRENDA: Si te preguntan "cuántos" y la búsqueda específica tiene resultados, usa el "Total coincidencias: ${totalMatches}" como tu respuesta oficial.`);
    
    for (const c of candidates) {
        const parts = [c.nombre];
        if (c.genero) parts.push(c.genero);
        if (c.edad) parts.push(`${c.edad} años`);
        if (c.municipio) parts.push(c.municipio);
        if (c.categoria) parts.push(c.categoria);
        if (c.puesto) parts.push(c.puesto);
        parts.push(c.estado);
        if (c.datosFaltantes) parts.push(`faltan: ${c.datosFaltantes}`);
        if (c.fecha) parts.push(c.fecha);
        lines.push(`• ${parts.join(' | ')}`);
    }
    return lines.join('\n');
}

export async function answerCandidateKnowledgeQuestion(question, history = [], model = 'gpt-4o-mini') {
    const snapshot = await getCandidateKnowledgeSnapshot();

    // Compact stats text (~500-800 tokens instead of 10K+ JSON)
    const compactStats = formatCompactSnapshot(snapshot);

    // Pass context from the last few messages so cross-referenced questions (like "mujeres" then "de 20") work
    const searchContext = history.slice(-2).map(m => m.content).join(' ') + ' ' + question;
    
    // Server-side search: only matching candidates go to GPT
    const searchResults = searchCandidateRoster(snapshot.allCandidatesSummary, searchContext);
    const searchText = formatSearchResults(searchResults);

    const systemPrompt = `
Eres Brenda Rodriguez, copiloto interno de Candidatic IA.
Tienes acceso a datos REALES de la base de candidatos.

Reglas:
- Responde en español natural, claro y ejecutivo.
- Usa SOLO los datos proporcionados. No inventes números.
- Para preguntas de conteo, usa las distribuciones de ESTADÍSTICAS.
- Para preguntas sobre candidatos específicos, usa CANDIDATOS ENCONTRADOS.
- Si te preguntan "hoy" o "ayer", usa zona horaria ${TIME_ZONE}.
- No muestres teléfonos ni datos personales.
- Da lectura operativa breve cuando convenga: tendencia, pico o alerta.

ESTADÍSTICAS:
${compactStats}
${searchText}
`;

    const messages = [
        ...history.slice(-6),
        { role: 'user', content: question }
    ];

    const result = await getOpenAIResponse(messages, systemPrompt, model, null, null, null, 900);

    return {
        reply: result.content,
        model: result.model,
        skill: 'candidate_knowledge'
    };
}
