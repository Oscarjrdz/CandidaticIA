import { getRedisClient } from './storage.js';

const CACHE_TTL_MS = 60 * 1000;
const RECENT_SAMPLE_LIMIT = 500;
const MAX_CANDIDATE_SCAN = 20000;

const DEFAULT_CANDIDATE_FIELDS = [
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'nombre', label: 'Nombre' },
    { value: 'nombreReal', label: 'Nombre Real' },
    { value: 'fechaNacimiento', label: 'Nacimiento' },
    { value: 'edad', label: 'Edad' },
    { value: 'genero', label: 'Genero' },
    { value: 'municipio', label: 'Municipio' },
    { value: 'categoria', label: 'Categoria' },
    { value: 'escolaridad', label: 'Escolaridad' },
    { value: 'origen', label: 'Origen' },
    { value: 'colonia', label: 'Colonia' },
    { value: 'experiencia', label: 'Experiencia' },
    { value: 'blocked', label: 'Bloqueado' },
    { value: 'statusAudit', label: 'Estatus' }
];

const MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

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

function fieldLabel(fields, fieldValue) {
    return fields.find(field => field.value === fieldValue)?.label || fieldValue;
}

function getActiveStatus(item) {
    const status = String(item?.status || item?.estado || '').toLowerCase();
    if (!status) return true;
    return !['inactive', 'inactivo', 'archived', 'archivado', 'deleted', 'eliminado', 'closed', 'cerrado'].includes(status);
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function getMonterreyMonth() {
    const month = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Monterrey',
        month: 'numeric'
    }).format(new Date());
    return Number(month);
}

function candidateWord(count) {
    return count === 1 ? 'candidato' : 'candidatos';
}

function normalizeTag(tag) {
    return String(typeof tag === 'string' ? tag : tag?.name || '').trim();
}

function getCandidateName(c) {
    return c.nombreReal || c.nombre || c.name || c.whatsapp || c.id || 'Sin nombre';
}

function getUnreadState(c) {
    const userTime = c.lastUserMessageAt ? new Date(c.lastUserMessageAt).getTime() : 0;
    const humanTime = c.lastHumanMessageAt ? new Date(c.lastHumanMessageAt).getTime() : 0;
    const unreadMsgCount = toNumber(c.unreadMsgCount);
    return {
        unread: unreadMsgCount > 0 || (userTime > 0 && userTime > humanTime),
        unreadMsgCount
    };
}

function isCandidateComplete(c) {
    return c.statusAudit === 'complete' || c.paso2Estado === 'completo';
}

function calculateAge(fechaNacimiento, edad) {
    const explicitAge = Number(edad);
    if (Number.isFinite(explicitAge) && explicitAge > 0 && explicitAge < 100) return explicitAge;
    if (!fechaNacimiento) return null;

    const date = new Date(fechaNacimiento);
    if (Number.isNaN(date.getTime())) return null;

    const now = new Date();
    let age = now.getFullYear() - date.getFullYear();
    const monthDiff = now.getMonth() - date.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) age -= 1;
    return age > 0 && age < 100 ? age : null;
}

function compactCandidate(c, fields = DEFAULT_CANDIDATE_FIELDS) {
    const unreadState = getUnreadState(c);
    const whatsapp = String(c.whatsapp || '');
    const tags = Array.isArray(c.tags)
        ? c.tags.map(normalizeTag).filter(Boolean).slice(0, 12)
        : [];
    const age = calculateAge(c.fechaNacimiento, c.edad);
    const birthDate = c.fechaNacimiento ? new Date(c.fechaNacimiento) : null;
    const birthMonth = birthDate && !Number.isNaN(birthDate.getTime()) ? birthDate.getMonth() + 1 : null;
    const columns = {};
    for (const field of fields) {
        if (!field?.value) continue;
        const raw = field.value === 'edad' ? age : c[field.value];
        if (raw !== undefined && raw !== null && raw !== '') {
            columns[field.value] = String(raw).slice(0, 80);
        }
    }

    return {
        id: c.id,
        name: getCandidateName(c),
        nameKey: normalizeText(getCandidateName(c)),
        phone: whatsapp,
        phoneLast4: whatsapp.slice(-4),
        age,
        birthMonth,
        birthDate: c.fechaNacimiento || null,
        complete: isCandidateComplete(c),
        unread: unreadState.unread,
        unreadMsgCount: unreadState.unreadMsgCount,
        blocked: c.blocked === true,
        tags,
        projectId: c.projectId || null,
        stepId: c.stepId || null,
        category: cleanBucketValue(c.categoria),
        municipality: cleanBucketValue(c.municipio),
        school: cleanBucketValue(c.escolaridad),
        gender: cleanBucketValue(c.genero),
        origin: cleanBucketValue(c.origen || c.source),
        neighborhood: cleanBucketValue(c.colonia),
        experience: cleanBucketValue(c.experiencia),
        createdAt: c.primerContacto || c.createdAt || null,
        lastMessageAt: c.ultimoMensaje || null,
        lastUserMessageAt: c.lastUserMessageAt || null,
        lastHumanMessageAt: c.lastHumanMessageAt || null,
        columns
    };
}

async function loadCompactCandidates(redis, fields) {
    const ids = await redis.zrevrange('candidates:list', 0, MAX_CANDIDATE_SCAN - 1);
    if (!ids?.length) {
        return [];
    }

    const pipe = redis.pipeline();
    ids.forEach(id => pipe.get(`candidate:${id}`));
    const rows = await pipe.exec();

    return rows
        .map(([err, raw]) => (err || !raw) ? null : safeParse(raw, null))
        .filter(Boolean)
        .map(c => compactCandidate(c, fields));
}

function buildCandidateBuckets(candidates, limit = RECENT_SAMPLE_LIMIT) {
    const buckets = {
        origins: {},
        categories: {},
        municipalities: {},
        schoolLevels: {},
        genders: {},
        ages: {},
        ageRanges: {}
    };
    const sample = candidates.slice(0, limit);

    for (const c of sample) {
        bump(buckets.origins, c.origin);
        bump(buckets.categories, c.category);
        bump(buckets.municipalities, c.municipality);
        bump(buckets.schoolLevels, c.school);
        bump(buckets.genders, c.gender);
        if (c.age) {
            bump(buckets.ages, c.age);
            const decade = `${Math.floor(c.age / 10) * 10}-${Math.floor(c.age / 10) * 10 + 9}`;
            bump(buckets.ageRanges, decade);
        }
    }

    return {
        sampleSize: sample.length,
        origins: topEntries(buckets.origins),
        categories: topEntries(buckets.categories),
        municipalities: topEntries(buckets.municipalities),
        schoolLevels: topEntries(buckets.schoolLevels),
        genders: topEntries(buckets.genders),
        ages: topEntries(buckets.ages, 12),
        ageRanges: topEntries(buckets.ageRanges, 8)
    };
}

function buildFacets(candidates) {
    const facets = {
        unread: { total: 0, complete: 0, incomplete: 0 },
        complete: { unread: 0, read: 0 },
        incomplete: { unread: 0, read: 0 },
        tags: {},
        categories: {},
        municipalities: {},
        origins: {},
        schoolLevels: {},
        genders: {},
        ages: {},
        ageRanges: {},
        birthdaysByMonth: {}
    };

    for (const c of candidates) {
        const statusKey = c.complete ? 'complete' : 'incomplete';
        const readKey = c.unread ? 'unread' : 'read';

        if (c.unread) {
            facets.unread.total += 1;
            facets.unread[statusKey] += 1;
        }
        facets[statusKey][readKey] += 1;

        bump(facets.categories, c.category);
        bump(facets.municipalities, c.municipality);
        bump(facets.origins, c.origin);
        bump(facets.schoolLevels, c.school);
        bump(facets.genders, c.gender);
        if (c.age) {
            bump(facets.ages, c.age);
            const decade = `${Math.floor(c.age / 10) * 10}-${Math.floor(c.age / 10) * 10 + 9}`;
            bump(facets.ageRanges, decade);
        }
        if (c.birthMonth) bump(facets.birthdaysByMonth, c.birthMonth);

        for (const tag of c.tags) {
            if (!facets.tags[tag]) facets.tags[tag] = { total: 0, unread: 0, complete: 0, incomplete: 0 };
            facets.tags[tag].total += 1;
            if (c.unread) facets.tags[tag].unread += 1;
            if (c.complete) facets.tags[tag].complete += 1;
            else facets.tags[tag].incomplete += 1;
        }
    }

    return {
        unread: facets.unread,
        complete: facets.complete,
        incomplete: facets.incomplete,
        tags: Object.entries(facets.tags)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 20),
        categories: topEntries(facets.categories, 12),
        municipalities: topEntries(facets.municipalities, 12),
        origins: topEntries(facets.origins, 12),
        schoolLevels: topEntries(facets.schoolLevels, 12),
        genders: topEntries(facets.genders, 12),
        ages: topEntries(facets.ages, 20),
        ageRanges: topEntries(facets.ageRanges, 10),
        birthdaysByMonth: topEntries(facets.birthdaysByMonth, 12)
    };
}

async function loadProjects(redis, candidates) {
    const ids = await redis.zrevrange('projects:all', 0, -1);
    if (!ids.length) return [];

    const pipe = redis.pipeline();
    ids.forEach(id => pipe.get(`project:${id}`));
    ids.forEach(id => pipe.scard(`project:candidates:${id}`));
    const rows = await pipe.exec();
    const projectRows = rows.slice(0, ids.length);
    const countRows = rows.slice(ids.length);
    const candidatesByProject = new Map();

    for (const c of candidates) {
        if (!c.projectId) continue;
        if (!candidatesByProject.has(c.projectId)) {
            candidatesByProject.set(c.projectId, {
                total: 0,
                unread: 0,
                complete: 0,
                incomplete: 0,
                steps: {}
            });
        }
        const bucket = candidatesByProject.get(c.projectId);
        bucket.total += 1;
        if (c.unread) bucket.unread += 1;
        if (c.complete) bucket.complete += 1;
        else bucket.incomplete += 1;
        bump(bucket.steps, c.stepId || 'Sin etapa');
    }

    return projectRows
        .map(([err, raw], index) => {
            if (err || !raw) return null;
            const project = safeParse(raw, null);
            if (!project) return null;
            const counts = candidatesByProject.get(project.id) || {};
            const stepNameById = new Map((project.steps || []).map(step => [step.id, step.name || step.title || step.id]));
            const stepCounts = Object.entries(counts.steps || {})
                .map(([stepId, count]) => ({
                    stepId,
                    name: stepNameById.get(stepId) || stepId,
                    count
                }))
                .sort((a, b) => b.count - a.count);

            return {
                id: project.id,
                name: project.name || project.title || 'Proyecto sin nombre',
                status: project.status || project.estado || 'active',
                vacancies: Array.isArray(project.vacancyIds) ? project.vacancyIds.length : (project.vacancyId ? 1 : 0),
                steps: (project.steps || []).map(step => ({ id: step.id, name: step.name || step.title || step.id })).slice(0, 12),
                candidateCount: Math.max(toNumber(countRows[index]?.[1]), toNumber(counts.total)),
                unread: toNumber(counts.unread),
                complete: toNumber(counts.complete),
                incomplete: toNumber(counts.incomplete),
                stepCounts: stepCounts.slice(0, 12)
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.candidateCount - a.candidateCount);
}

function findProjectForCandidate(stats, candidate) {
    if (!candidate?.projectId || !Array.isArray(stats.projects?.items)) return null;
    return stats.projects.items.find(project => project.id === candidate.projectId) || null;
}

function findCandidateMatches(message, candidates, limit = 5) {
    const normalized = normalizeText(message);
    const digits = String(message || '').replace(/\D/g, '');
    const meaningfulWords = normalized
        .split(/\s+/)
        .filter(word => word.length >= 3)
        .filter(word => ![
            'candidato', 'candidata', 'candidatos', 'candidatas', 'telefono', 'whatsapp',
            'tiene', 'info', 'informacion', 'dime', 'dame', 'buscar', 'busca', 'sobre',
            'esta', 'este', 'datos', 'burbuja', 'leido', 'leer', 'mensaje', 'mensajes'
        ].includes(word));

    const scored = [];
    for (const c of candidates) {
        let score = 0;
        if (digits.length >= 4 && c.phone?.includes(digits)) score += digits.length >= 10 ? 120 : 70;
        if (digits.length >= 4 && c.phoneLast4 === digits.slice(-4)) score += 45;
        for (const word of meaningfulWords) {
            if (String(c.nameKey || '').includes(word)) score += 25;
            if (normalizeText(c.category).includes(word)) score += 8;
            if (normalizeText(c.municipality).includes(word)) score += 8;
            if (c.tags.some(tag => normalizeText(tag).includes(word))) score += 6;
        }
        if (score > 0) scored.push({ candidate: c, score });
    }

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.candidate);
}

function formatCandidateDirectReply(candidate, stats) {
    const project = findProjectForCandidate(stats, candidate);
    const step = project?.stepCounts?.find(s => s.stepId === candidate.stepId) ||
        project?.steps?.find(s => s.id === candidate.stepId);
    const unreadText = candidate.unread
        ? `si tiene burbuja sin leer${candidate.unreadMsgCount ? ` (${candidate.unreadMsgCount})` : ''}`
        : 'no tiene burbuja sin leer';
    const statusText = candidate.complete ? 'completo' : 'incompleto';
    const tagsText = candidate.tags.length ? candidate.tags.join(', ') : 'sin tags';
    const projectText = project ? `${project.name}${step?.name ? ` / ${step.name}` : ''}` : 'sin proyecto';

    return [
        `${candidate.name} (${candidate.phone || 'sin telefono'}) esta ${statusText} y ${unreadText}.`,
        `Proyecto: ${projectText}.`,
        `Perfil: ${candidate.category}, ${candidate.municipality}, ${candidate.school}, ${candidate.gender}.`,
        `Tags: ${tagsText}.`
    ].join(' ');
}

function getCandidateQuestionReply(message, stats) {
    const normalized = normalizeText(message);
    const mentionsCandidate = /\bcandidato\b|\bcandidata\b|telefono|whatsapp|burbuja|no leido|sin leer|info|informacion/.test(normalized) ||
        /\d{4,}/.test(message);
    if (!mentionsCandidate) return null;

    const matches = findCandidateMatches(message, stats.candidateIndex || []);
    if (matches.length === 1 || (matches.length > 1 && matches[0].phone && /\d{7,}/.test(message))) {
        return formatCandidateDirectReply(matches[0], stats);
    }

    if (matches.length > 1) {
        const list = matches.slice(0, 5).map(c => `${c.name} (${c.phone || c.phoneLast4})`).join(', ');
        return `Encontre varios candidatos posibles: ${list}. Dame el WhatsApp completo o el nombre mas especifico.`;
    }

    if (/\d{4,}/.test(message)) {
        return 'No encontre candidato con ese telefono en el snapshot actual.';
    }

    return null;
}

function getProjectQuestionReply(message, stats) {
    const normalized = normalizeText(message);
    if (!/proyecto|proyectos|kanban|etapa|pipeline/.test(normalized)) return null;

    const projectWords = normalized
        .split(/\s+/)
        .filter(word => word.length >= 3)
        .filter(word => !['proyecto', 'proyectos', 'candidatos', 'cuantos', 'cuantas', 'etapa', 'etapas', 'tiene'].includes(word));

    const projects = stats.projects?.items || [];
    const matches = projectWords.length
        ? projects.filter(project => projectWords.some(word => normalizeText(project.name).includes(word))).slice(0, 5)
        : [];

    if (matches.length === 1) {
        const p = matches[0];
        const steps = p.stepCounts?.length
            ? p.stepCounts.slice(0, 5).map(step => `${step.name}: ${step.count}`).join(', ')
            : 'sin candidatos por etapa';
        return `${p.name}: ${p.candidateCount} candidatos, ${p.unread} sin leer, ${p.complete} completos, ${p.incomplete} incompletos. Etapas: ${steps}.`;
    }

    if (/cuantos|cuantas|resumen|estadistica|metricas|datos/.test(normalized)) {
        const top = projects.slice(0, 5).map(p => `${p.name}: ${p.candidateCount} cand., ${p.unread} sin leer`).join('; ');
        return top ? `Hay ${stats.projects.total} proyectos. Principales: ${top}.` : `Hay ${stats.projects.total} proyectos.`;
    }

    return null;
}

function getBirthdayMonthFromMessage(message) {
    const normalized = normalizeText(message);
    if (!/cumple|cumplen|cumpleanos|cumpleaños/.test(normalized)) return null;
    if (/este mes|mes actual/.test(normalized)) return getMonterreyMonth();
    if (/proximo mes|siguiente mes/.test(normalized)) {
        const month = getMonterreyMonth();
        return month === 12 ? 1 : month + 1;
    }
    for (let i = 0; i < MONTHS.length; i += 1) {
        if (normalized.includes(MONTHS[i])) return i + 1;
    }
    return getMonterreyMonth();
}

function getBirthdayReply(message, stats) {
    const month = getBirthdayMonthFromMessage(message);
    if (!month) return null;
    const matches = (stats.candidateIndex || []).filter(c => c.birthMonth === month);
    return `Cumplen anos en ${MONTHS[month - 1]}: ${matches.length} candidatos.`;
}

function uniqueCandidateValues(candidates, stats) {
    const values = new Map();
    const add = (field, label, value) => {
        const clean = cleanBucketValue(value);
        const normalized = normalizeText(clean);
        if (!normalized || normalized === 'sin dato' || normalized.length < 3 || /^\d+$/.test(normalized)) return;
        const key = `${field}:${normalized}`;
        if (!values.has(key)) values.set(key, { field, label, value: clean, normalized });
    };

    for (const c of candidates) {
        add('municipality', 'municipio', c.municipality);
        add('category', 'categoria', c.category);
        add('school', 'escolaridad', c.school);
        add('gender', 'genero', c.gender);
        add('origin', 'origen', c.origin);
        add('neighborhood', 'colonia', c.neighborhood);
        add('experience', 'experiencia', c.experience);
        c.tags.forEach(tag => add('tag', 'tag', tag));

        for (const [field, value] of Object.entries(c.columns || {})) {
            if (DEFAULT_CANDIDATE_FIELDS.some(defaultField => defaultField.value === field)) continue;
            add(`column:${field}`, fieldLabel(stats.filters.candidateFields || [], field), value);
        }
    }

    return [...values.values()].sort((a, b) => b.normalized.length - a.normalized.length);
}

function buildQueryCriteria(message, stats) {
    const normalized = normalizeText(message);
    const criteria = [];
    let hasExplicitGender = false;

    if (/\bmujer(?:es)?\b|\bmujers\b|\bfemenin[ao]s?\b|\bfem\b/.test(normalized)) {
        hasExplicitGender = true;
        criteria.push({
            label: 'mujeres',
            test: c => /mujer|femenin|^f$/.test(normalizeText(c.gender))
        });
    }
    if (/\bhombre(?:s)?\b|\bmasculin[ao]s?\b|\bmasc\b/.test(normalized)) {
        hasExplicitGender = true;
        criteria.push({
            label: 'hombres',
            test: c => /hombre|masculin|^m$/.test(normalizeText(c.gender))
        });
    }

    const betweenAge = normalized.match(/entre\s+(\d{1,2})\s+y\s+(\d{1,2})/);
    const olderAge = normalized.match(/(?:mayores?\s+de|mas\s+de|más\s+de)\s+(\d{1,2})/);
    const youngerAge = normalized.match(/(?:menores?\s+de|menos\s+de)\s+(\d{1,2})/);
    const exactAge = normalized.match(/\b(\d{1,2})\s*(?:anos|años)\b/);

    if (betweenAge) {
        const min = Math.min(Number(betweenAge[1]), Number(betweenAge[2]));
        const max = Math.max(Number(betweenAge[1]), Number(betweenAge[2]));
        criteria.push({ label: `edad entre ${min} y ${max}`, test: c => c.age >= min && c.age <= max });
    } else if (olderAge) {
        const age = Number(olderAge[1]);
        criteria.push({ label: `mayores de ${age}`, test: c => c.age > age });
    } else if (youngerAge) {
        const age = Number(youngerAge[1]);
        criteria.push({ label: `menores de ${age}`, test: c => c.age < age });
    } else if (exactAge) {
        const age = Number(exactAge[1]);
        criteria.push({ label: `${age} anos`, test: c => c.age === age });
    }

    const birthdayMonth = getBirthdayMonthFromMessage(message);
    if (birthdayMonth) {
        criteria.push({ label: `cumpleanos en ${MONTHS[birthdayMonth - 1]}`, test: c => c.birthMonth === birthdayMonth });
    }

    if (/sin leer|no leidos|no leido|unread|burbuja/.test(normalized)) {
        criteria.push({ label: 'sin leer', test: c => c.unread });
    }
    if (/completos|completo/.test(normalized) && !/incomplet/.test(normalized)) {
        criteria.push({ label: 'completos', test: c => c.complete });
    }
    if (/incompletos|incompleto/.test(normalized)) {
        criteria.push({ label: 'incompletos', test: c => !c.complete });
    }
    if (/bloquead|silenciad/.test(normalized)) {
        criteria.push({ label: 'bloqueados', test: c => c.blocked });
    }

    const usedFields = new Set();
    for (const item of uniqueCandidateValues(stats.candidateIndex || [], stats)) {
        if (!normalized.includes(item.normalized)) continue;
        if (hasExplicitGender && item.field === 'gender') continue;
        if (usedFields.has(item.field) && item.field !== 'tag') continue;
        usedFields.add(item.field);
        criteria.push({
            label: `${item.label} ${item.value}`,
            test: c => {
                if (item.field === 'tag') return c.tags.some(tag => normalizeText(tag) === item.normalized);
                if (item.field.startsWith('column:')) {
                    const field = item.field.replace('column:', '');
                    return normalizeText(c.columns?.[field]).includes(item.normalized);
                }
                return normalizeText(c[item.field]).includes(item.normalized);
            }
        });
    }

    return criteria;
}

function getFilteredCountReply(message, stats) {
    const normalized = normalizeText(message);
    if (!/cuantos|cuantas|total|numero|conteo|gente|personas|candidat|candiad|base/.test(normalized)) return null;

    const criteria = buildQueryCriteria(message, stats);
    if (!criteria.length && /candidat|candiad|base/.test(normalized)) {
        return `Tenemos ${stats.candidates.total} candidatos en total: ${stats.candidates.complete} completos, ${stats.candidates.incomplete} incompletos y ${stats.candidates.unread} sin leer.`;
    }
    if (!criteria.length) return null;

    const matches = (stats.candidateIndex || []).filter(candidate =>
        criteria.every(criterion => criterion.test(candidate))
    );
    return `Hay ${matches.length} ${candidateWord(matches.length)} con ${criteria.map(c => c.label).join(', ')}.`;
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
    const candidateFields = [
        ...DEFAULT_CANDIDATE_FIELDS,
        ...(Array.isArray(customFields) ? customFields : [])
    ];
    const automationRules = safeParse(val(8), []);
    const vacancies = safeParse(val(9), []);
    const projectsTotal = toNumber(val(10));
    const users = safeParse(val(11), []);
    const roles = safeParse(val(12), []);

    const activeVacancies = Array.isArray(vacancies) ? vacancies.filter(getActiveStatus).length : 0;
    const enabledRules = Array.isArray(automationRules) ? automationRules.filter(rule => rule?.enabled !== false).length : 0;
    const activeUsers = Array.isArray(users) ? users.filter(user => user?.status !== 'Inactive').length : 0;
    const candidates = await loadCompactCandidates(redis, candidateFields);
    const recent = buildCandidateBuckets(candidates);
    const facets = buildFacets(candidates);
    const projects = await loadProjects(redis, candidates);

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
            candidateFields: candidateFields.map(f => ({
                value: f.value,
                label: f.label || f.value
            })).slice(0, 40),
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
            total: projectsTotal,
            items: projects.slice(0, 30)
        },
        users: {
            total: Array.isArray(users) ? users.length : 0,
            active: activeUsers,
            roles: Array.isArray(roles) ? roles.length : 0
        },
        recentSample: recent,
        facets,
        candidateIndex: candidates
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

    if (/\d{4,}/.test(String(message || ''))) return true;
    if (/candidat|candiad|base|telefono|whatsapp|burbuja|sin leer|no leido|proyecto|proyectos|kanban|etapa|pipeline|cumple|cumplen|cumpleanos|cumpleaños|anos|años|municipio|categoria|escolaridad|genero|origen|colonia|mujer|mujers|hombre|femenin|masculin/.test(normalized)) {
        return true;
    }

    const statsWords = [
        'cuantos', 'cuantas', 'estadistica', 'estadisticas', 'metricas', 'resumen',
        'dashboard', 'plataforma', 'datos', 'numeros', 'reporte'
    ];
    const platformWords = [
        'candidato', 'candidatos', 'candiadtos', 'base', 'mujeres', 'mujers', 'hombres',
        'completo', 'completos', 'incompleto', 'incompletos',
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

    const candidateReply = getCandidateQuestionReply(message, stats);
    if (candidateReply) return candidateReply;

    const filteredCountReply = getFilteredCountReply(message, stats);
    if (filteredCountReply) return filteredCountReply;

    const birthdayReply = getBirthdayReply(message, stats);
    if (birthdayReply) return birthdayReply;

    const projectReply = getProjectQuestionReply(message, stats);
    if (projectReply) return projectReply;

    const asksCount = /cuantos|cuantas|numero|total/.test(normalized);
    const asksCandidates = /candidat|candiad|base|completo|incompleto|sin leer|no leidos|unread|mujer|mujers|hombre|femenin|masculin/.test(normalized);
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
    const compact = {
        candidates: stats.candidates,
        messages: stats.messages,
        tags: {
            configured: stats.tags.configured,
            top: stats.tags.top.slice(0, 8)
        },
        filters: {
            fixed: stats.filters.fixed,
            candidateFields: stats.filters.candidateFields.slice(0, 24),
            customFields: stats.filters.customFields.slice(0, 12)
        },
        facets: {
            unread: stats.facets.unread,
            status: {
                complete: stats.facets.complete,
                incomplete: stats.facets.incomplete
            },
            tags: stats.facets.tags.slice(0, 10),
            categories: stats.facets.categories.slice(0, 8),
            municipalities: stats.facets.municipalities.slice(0, 8),
            schoolLevels: stats.facets.schoolLevels.slice(0, 8),
            genders: stats.facets.genders.slice(0, 8),
            ages: stats.facets.ages.slice(0, 12),
            ageRanges: stats.facets.ageRanges.slice(0, 8),
            birthdaysByMonth: stats.facets.birthdaysByMonth.slice(0, 12),
            origins: stats.facets.origins.slice(0, 8)
        },
        vacancies: stats.vacancies,
        projects: {
            total: stats.projects.total,
            top: stats.projects.items.slice(0, 8).map(p => ({
                name: p.name,
                candidateCount: p.candidateCount,
                unread: p.unread,
                complete: p.complete,
                incomplete: p.incomplete,
                steps: p.stepCounts.slice(0, 5).map(s => ({ name: s.name, count: s.count }))
            }))
        },
        automations: stats.automations,
        users: stats.users,
        recentSample: {
            sampleSize: stats.recentSample.sampleSize,
            origins: stats.recentSample.origins.slice(0, 5),
            categories: stats.recentSample.categories.slice(0, 5),
            municipalities: stats.recentSample.municipalities.slice(0, 5),
            schoolLevels: stats.recentSample.schoolLevels.slice(0, 5),
            genders: stats.recentSample.genders.slice(0, 5),
            ages: stats.recentSample.ages.slice(0, 8),
            ageRanges: stats.recentSample.ageRanges.slice(0, 5)
        }
    };

    return `
[PLATFORM_JSON_COMPACTO]
${JSON.stringify(compact)}
INSTRUCCION: Responde solo con estos agregados. No inventes candidatos individuales, telefonos ni datos que no esten en el JSON.
`;
}
