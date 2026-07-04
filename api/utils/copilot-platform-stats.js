import { getRedisClient } from './storage.js';
import { readBandwidthTelemetry } from './bandwidth-telemetry.js';

const CACHE_TTL_MS = 60 * 1000;
const RECENT_SAMPLE_LIMIT = 500;
const MAX_CANDIDATE_SCAN = 20000;
const COPILOT_STATS_PROFILE_NAME = 'Brenda Ops Metrics v2 - Bajo Consumo';

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

// Two caches keep operational questions cheap without poisoning candidate-heavy analytics.
const cachedStatsByMode = {
    full: { stats: null, at: 0 },
    light: { stats: null, at: 0 }
};

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

function safeArray(value) {
    return Array.isArray(value) ? value : [];
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

function getMonterreyDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Monterrey',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function getMonterreyMonthKey(date = new Date()) {
    return getMonterreyDateKey(date).slice(0, 7);
}

function getRelativeMonterreyDateKey(daysOffset = 0) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    return getMonterreyDateKey(date);
}

function candidateCreatedDateKey(candidate) {
    if (!candidate?.createdAt) return null;
    const date = new Date(candidate.createdAt);
    if (Number.isNaN(date.getTime())) return null;
    return getMonterreyDateKey(date);
}

function candidateWord(count) {
    return count === 1 ? 'candidato' : 'candidatos';
}

function formatBytes(bytes) {
    const n = toNumber(bytes);
    if (n <= 0) return '0 MB';
    const mb = n / (1024 * 1024);
    if (mb < 1024) return `${Number(mb.toFixed(1))} MB`;
    return `${Number((mb / 1024).toFixed(2))} GB`;
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

function emptyCandidateBuckets() {
    return {
        sampleSize: 0,
        origins: [],
        categories: [],
        municipalities: [],
        schoolLevels: [],
        genders: [],
        ages: [],
        ageRanges: []
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

function emptyFacets() {
    return {
        unread: { total: 0, complete: 0, incomplete: 0 },
        complete: { unread: 0, read: 0 },
        incomplete: { unread: 0, read: 0 },
        tags: [],
        categories: [],
        municipalities: [],
        origins: [],
        schoolLevels: [],
        genders: [],
        ages: [],
        ageRanges: [],
        birthdaysByMonth: []
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
    if (/cuantos|cuantas|total|numero|conteo/.test(normalized)) return null;

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
        .filter(word => ![
            'proyecto', 'proyectos', 'candidatos', 'candiatos', 'cuantos', 'cuantas',
            'etapa', 'etapas', 'paso', 'tiene', 'hay', 'del', 'con', 'los', 'las'
        ].includes(word));

    const projects = stats.projects?.items || [];
    const scoredProjects = projectWords.length
        ? projects
            .map(project => {
                const projectName = normalizeText(project.name);
                const projectNameWords = projectName.split(/\s+/).filter(Boolean);
                const score = projectWords.reduce((sum, word) => {
                    if (!projectName.includes(word)) return sum;
                    return sum + (projectNameWords.includes(word) ? 3 : 1);
                }, 0);
                return { project, score };
            })
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score || b.project.name.length - a.project.name.length)
        : [];
    const matches = scoredProjects.length > 1 && scoredProjects[0].score > scoredProjects[1].score
        ? [scoredProjects[0].project]
        : scoredProjects.slice(0, 5).map(item => item.project);

    if (matches.length === 1) {
        const p = matches[0];
        const stepMatch = (p.stepCounts || [])
            .filter(step => normalizeText(step.name) && normalized.includes(normalizeText(step.name)))
            .sort((a, b) => normalizeText(b.name).length - normalizeText(a.name).length)[0];
        if (stepMatch) {
            return `${p.name} / ${stepMatch.name}: ${stepMatch.count} candidatos.`;
        }

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

    for (const project of stats.projects?.items || []) {
        add('project', 'proyecto', project.name);
    }

    return [...values.values()].sort((a, b) => b.normalized.length - a.normalized.length);
}

function candidateMatchesValue(item, candidate, stats) {
    if (item.field === 'tag') return candidate.tags.some(tag => normalizeText(tag) === item.normalized);
    if (item.field === 'project') return candidate.projectId && (stats.projects?.items || []).some(project =>
        project.id === candidate.projectId && normalizeText(project.name).includes(item.normalized)
    );
    if (item.field.startsWith('column:')) {
        const field = item.field.replace('column:', '');
        return normalizeText(candidate.columns?.[field]).includes(item.normalized);
    }
    return normalizeText(candidate[item.field]).includes(item.normalized);
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
    const asksComplete = /\bcompletos?\b/.test(normalized);
    const asksIncomplete = /\bincompletos?\b/.test(normalized);
    if (asksComplete && !asksIncomplete) {
        criteria.push({ label: 'completos', test: c => c.complete });
    }
    if (asksIncomplete && !asksComplete) {
        criteria.push({ label: 'incompletos', test: c => !c.complete });
    }
    if (/bloquead|silenciad/.test(normalized)) {
        criteria.push({ label: 'bloqueados', test: c => c.blocked });
    }
    if (/\bhoy\b/.test(normalized) && /nuevo|nueva|nuevos|nuevas|llegaron|llego|llegó|entraron|entro|entró|registrad|alta|contacto/.test(normalized)) {
        const todayKey = getRelativeMonterreyDateKey(0);
        criteria.push({
            label: 'nuevos hoy',
            test: c => candidateCreatedDateKey(c) === todayKey
        });
    }
    if (/\bayer\b/.test(normalized) && /nuevo|nueva|nuevos|nuevas|llegaron|llego|llegó|entraron|entro|entró|registrad|alta|contacto/.test(normalized)) {
        const yesterdayKey = getRelativeMonterreyDateKey(-1);
        criteria.push({
            label: 'nuevos ayer',
            test: c => candidateCreatedDateKey(c) === yesterdayKey
        });
    }

    const usedFields = new Set();
    const matchedValueGroups = new Map();
    const availableValues = uniqueCandidateValues(stats.candidateIndex || [], stats);
    const matchedTags = availableValues.filter(item =>
        item.field === 'tag' && normalized.includes(item.normalized)
    );

    for (const item of availableValues) {
        if (!normalized.includes(item.normalized)) continue;
        if (hasExplicitGender && item.field === 'gender') continue;
        if (item.field !== 'tag' && matchedTags.some(tag => tag.normalized.includes(item.normalized))) continue;
        if (usedFields.has(item.field) && item.field !== 'tag') continue;
        usedFields.add(item.field);
        if (!matchedValueGroups.has(item.normalized)) matchedValueGroups.set(item.normalized, []);
        matchedValueGroups.get(item.normalized).push(item);
    }

    for (const items of matchedValueGroups.values()) {
        criteria.push({
            label: items.length === 1 ? `${items[0].label} ${items[0].value}` : items[0].value,
            test: candidate => items.some(item => candidateMatchesValue(item, candidate, stats))
        });
    }

    return criteria;
}

function getGenderBreakdownReply(message, stats) {
    const normalized = normalizeText(message);
    const asksWomen = /\bmujer(?:es)?\b|\bmujers\b|\bfemenin[ao]s?\b|\bfem\b/.test(normalized);
    const asksMen = /\bhombre(?:s)?\b|\bmasculin[ao]s?\b|\bmasc\b/.test(normalized);
    if (!asksWomen || !asksMen) return null;

    const criteria = buildQueryCriteria(message, stats).filter(criterion =>
        criterion.label !== 'mujeres' && criterion.label !== 'hombres'
    );
    const matches = criteria.length
        ? (stats.candidateIndex || []).filter(candidate => criteria.every(criterion => criterion.test(candidate)))
        : (stats.candidateIndex || []);

    const women = matches.filter(candidate => /mujer|femenin|^f$/.test(normalizeText(candidate.gender))).length;
    const men = matches.filter(candidate => /hombre|masculin|^m$/.test(normalizeText(candidate.gender))).length;
    const filterText = criteria.length ? ` con ${criteria.map(c => c.label).join(', ')}` : ' en toda la base';

    return `Hay ${matches.length} candidatos${filterText}: ${men} hombres y ${women} mujeres.`;
}

function getFilteredCountReply(message, stats) {
    const normalized = normalizeText(message);
    const asksRecentArrivals = /\bhoy\b/.test(normalized) && /nuevo|nueva|nuevos|nuevas|llegaron|llego|llegó|entraron|entro|entró|registrad|alta|contacto/.test(normalized);
    if (!/cuantos|cuantas|cuantoes|total|numero|conteo|gente|personas|candid|base/.test(normalized) && !asksRecentArrivals) return null;

    const criteria = buildQueryCriteria(message, stats);
    const genderBreakdownReply = getGenderBreakdownReply(message, stats);
    if (genderBreakdownReply) return genderBreakdownReply;

    const asksComplete = /\bcompletos?\b/.test(normalized);
    const asksIncomplete = /\bincompletos?\b/.test(normalized);
    if (asksComplete && asksIncomplete) {
        const matches = criteria.length
            ? (stats.candidateIndex || []).filter(candidate => criteria.every(criterion => criterion.test(candidate)))
            : (stats.candidateIndex || []);
        const complete = matches.filter(candidate => candidate.complete).length;
        const incomplete = matches.length - complete;
        const filterText = criteria.length ? ` con ${criteria.map(c => c.label).join(', ')}` : '';
        return `Hay ${matches.length} ${candidateWord(matches.length)}${filterText}: ${complete} completos y ${incomplete} incompletos.`;
    }

    if (!criteria.length && /candid|base/.test(normalized)) {
        return `Tenemos ${stats.candidates.total} candidatos en total: ${stats.candidates.complete} completos, ${stats.candidates.incomplete} incompletos y ${stats.candidates.unread} sin leer.`;
    }
    if (!criteria.length) return null;

    const matches = (stats.candidateIndex || []).filter(candidate =>
        criteria.every(criterion => criterion.test(candidate))
    );
    return `Hay ${matches.length} ${candidateWord(matches.length)} con ${criteria.map(c => c.label).join(', ')}.`;
}

function summarizeBolsaJobs(jobs) {
    return safeArray(jobs).reduce((acc, job) => {
        acc.total += 1;
        if (job?.active !== false) acc.active += 1;
        acc.applications += safeArray(job?.applications).length;
        acc.requests += safeArray(job?.requests).length;
        acc.comments += safeArray(job?.comments).length;
        acc.likes += toNumber(job?.likes);
        return acc;
    }, { total: 0, active: 0, applications: 0, requests: 0, comments: 0, likes: 0 });
}

function summarizeBulkState(state, history) {
    const candidates = safeArray(state?.candidates);
    const totalTargets = candidates.length || toNumber(state?.totalTargets);
    const currentIndex = Math.min(toNumber(state?.currentCandidateIndex), totalTargets || 0);
    return {
        active: state?.isRunning === true,
        aborted: state?.isAborted === true,
        campaignName: state?.campaignName || null,
        totalTargets,
        processed: currentIndex,
        totalSent: toNumber(state?.totalSent),
        progressPct: totalTargets ? Number(((currentIndex / totalTargets) * 100).toFixed(1)) : 0,
        historyCount: safeArray(history).length,
        completedHistory: safeArray(history).filter(item => item?.status === 'completed').length,
        runningHistory: safeArray(history).filter(item => item?.status === 'running').length
    };
}

function summarizeEndpointUsage(rows) {
    const totals = rows.reduce((acc, row) => {
        acc.calls += toNumber(row.calls);
        acc.cacheHits += toNumber(row.cacheHits);
        acc.cacheMisses += toNumber(row.cacheMisses);
        acc.redisReads += toNumber(row.redisReads);
        acc.candidateReads += toNumber(row.candidateReads);
        acc.messageReads += toNumber(row.messageReads);
        acc.responseBytes += toNumber(row.responseBytes);
        acc.estimatedRedisBytes += toNumber(row.estimatedRedisBytes);
        acc.fullScans += toNumber(row.fullScans);
        return acc;
    }, {
        calls: 0,
        cacheHits: 0,
        cacheMisses: 0,
        redisReads: 0,
        candidateReads: 0,
        messageReads: 0,
        responseBytes: 0,
        estimatedRedisBytes: 0,
        fullScans: 0
    });

    const top = rows
        .map(row => ({
            endpoint: row.endpoint,
            calls: toNumber(row.calls),
            responseBytes: toNumber(row.responseBytes),
            estimatedRedisBytes: toNumber(row.estimatedRedisBytes),
            candidateReads: toNumber(row.candidateReads),
            fullScans: toNumber(row.fullScans)
        }))
        .sort((a, b) =>
            (b.estimatedRedisBytes + b.responseBytes + b.candidateReads + b.calls) -
            (a.estimatedRedisBytes + a.responseBytes + a.candidateReads + a.calls)
        )
        .slice(0, 5);

    return { totals, top };
}

function summarizeAdsCache(rawAds, hiddenCount) {
    const data = safeParse(rawAds, null);
    const ads = safeArray(data?.ads);
    return {
        cached: !!data,
        totalLeads: toNumber(data?.totalAdsLeads),
        adsCount: ads.length,
        hidden: toNumber(hiddenCount),
        top: ads.slice(0, 5).map(ad => ({
            name: ad.adHeadline || ad.adName || ad.adId || 'Anuncio',
            leads: toNumber(ad.totalLeads),
            today: toNumber(ad.todayLeads)
        }))
    };
}

function summarizeRecruiterRows(rows) {
    const totals = rows.reduce((acc, row) => {
        acc.activeSeconds += toNumber(row.time);
        acc.messagesSent += toNumber(row.messages);
        acc.chatsVisited += toNumber(row.visited);
        acc.chatsResponded += toNumber(row.responded);
        acc.chatsIn24h += toNumber(row.win24);
        acc.chatsOut24h += toNumber(row.out24);
        return acc;
    }, {
        activeSeconds: 0,
        messagesSent: 0,
        chatsVisited: 0,
        chatsResponded: 0,
        chatsIn24h: 0,
        chatsOut24h: 0
    });

    return {
        recruitersWithActivity: rows.length,
        ...totals
    };
}

async function readEndpointUsage(redis, day) {
    const endpoints = await redis.smembers(`metrics:endpoint:${day}:index`).catch(() => []);
    if (!endpoints?.length) return { totals: {}, top: [] };

    const pipe = redis.pipeline();
    endpoints.slice(0, 80).forEach(endpoint => pipe.hgetall(`metrics:endpoint:${day}:${endpoint}`));
    const rows = await pipe.exec();
    return summarizeEndpointUsage(endpoints.slice(0, 80).map((endpoint, index) => ({
        endpoint,
        ...(rows[index]?.[1] || {})
    })));
}

async function readRecruiterStats(redis, day) {
    const userIds = await redis.smembers(`recruiter:ids:${day}`).catch(() => []);
    if (!userIds?.length) return summarizeRecruiterRows([]);

    const pipe = redis.pipeline();
    userIds.slice(0, 40).forEach(userId => {
        pipe.get(`recruiter:time:${userId}:${day}`);
        pipe.get(`recruiter:msgs:${userId}:${day}`);
        pipe.scard(`recruiter:visited:${userId}:${day}`);
        pipe.scard(`recruiter:chats:${userId}:${day}`);
        pipe.scard(`recruiter:win24:${userId}:${day}`);
        pipe.scard(`recruiter:out24:${userId}:${day}`);
    });
    const rows = await pipe.exec();
    const recruiterRows = userIds.slice(0, 40).map((userId, index) => {
        const base = index * 6;
        return {
            userId,
            time: rows[base]?.[1],
            messages: rows[base + 1]?.[1],
            visited: rows[base + 2]?.[1],
            responded: rows[base + 3]?.[1],
            win24: rows[base + 4]?.[1],
            out24: rows[base + 5]?.[1]
        };
    });
    return summarizeRecruiterRows(recruiterRows);
}

async function loadOperationalStats(redis) {
    const today = getMonterreyDateKey();
    const month = getMonterreyMonthKey();
    const now = Date.now();
    const dayEnd = now + (24 * 60 * 60 * 1000);

    const pipe = redis.pipeline();
    pipe.zcount('chat_locks:active', now, '+inf');
    pipe.zcard('direct_reminders');
    pipe.zcount('direct_reminders', '-inf', now);
    pipe.zcount('direct_reminders', now, dayEnd);
    pipe.zcard('candidatic:media_library');
    pipe.zcard('bypass:list');
    pipe.get('candidatic_categories');
    pipe.get('candidatic:quick_replies');
    pipe.get('candidatic:ad_labels');
    pipe.get('config:wa_numbers');
    pipe.get('candidatic_push_tokens');
    pipe.get('candidatic_notif_history');
    pipe.get('bulks:engine_state');
    pipe.get('bulks:history');
    pipe.get('reengagement:settings');
    pipe.llen('webhook:events');
    pipe.llen('debug:webhook_history');
    pipe.get(`stats:bandwidth:${month}:total`);
    pipe.get(`stats:bandwidth:${today}:total`);
    pipe.get('stats:ads:cached');
    pipe.scard('ads:hidden');
    pipe.get('candidatic_bolsa_empleo');
    pipe.get('candidatic_empresas');
    pipe.get('stats:bot:cached_result');

    const rows = await pipe.exec();
    const val = (index, fallback = null) => rows[index]?.[1] ?? fallback;

    const categories = safeParse(val(6), []);
    const quickReplies = safeParse(val(7), []);
    const adLabels = safeParse(val(8), []);
    const waNumbers = safeParse(val(9), []);
    const pushTokens = safeParse(val(10), []);
    const notificationHistory = safeParse(val(11), []);
    const bulkState = safeParse(val(12), null);
    const bulkHistory = safeParse(val(13), []);
    const reengagementSettings = safeParse(val(14), null);
    const bolsaJobs = safeParse(val(21), []);
    const empresas = safeParse(val(22), []);
    const botCached = safeParse(val(23), null);

    const [endpointUsage, recruiterStats, bandwidthTelemetry] = await Promise.all([
        readEndpointUsage(redis, today),
        readRecruiterStats(redis, today),
        readBandwidthTelemetry(redis).catch(() => null)
    ]);

    return {
        day: today,
        month,
        chat: {
            activeLocks: toNumber(val(0))
        },
        reminders: {
            scheduled: toNumber(val(1)),
            dueNow: toNumber(val(2)),
            next24h: toNumber(val(3))
        },
        media: {
            libraryItems: toNumber(val(4))
        },
        bypass: {
            rules: toNumber(val(5))
        },
        configuration: {
            categories: safeArray(categories).length,
            quickReplies: safeArray(quickReplies).length,
            adLabels: safeArray(adLabels).length,
            adIdsLabeled: safeArray(adLabels).reduce((sum, label) => sum + safeArray(label?.adIds || (label?.adId ? [label.adId] : [])).length, 0),
            waNumbers: safeArray(waNumbers).length,
            companies: safeArray(empresas).length
        },
        push: {
            totalTokens: safeArray(pushTokens).length,
            candidateTokens: safeArray(pushTokens).filter(token => token?.type === 'candidate').length,
            recruiterTokens: safeArray(pushTokens).filter(token => token?.type === 'recruiter').length,
            historyCount: safeArray(notificationHistory).length,
            lastSent: safeArray(notificationHistory)[0]?.sent || 0,
            lastTargetTotal: safeArray(notificationHistory)[0]?.total || 0
        },
        bulks: summarizeBulkState(bulkState, bulkHistory),
        reengagement: {
            enabled: reengagementSettings?.enabled === true,
            activeFrom: reengagementSettings?.activeFrom || null,
            silenceHours: toNumber(reengagementSettings?.silenceHours),
            intervalHours: toNumber(reengagementSettings?.intervalHours),
            maxAttempts: toNumber(reengagementSettings?.maxAttempts)
        },
        events: {
            webhookEvents: toNumber(val(15)),
            debugWebhookHistory: toNumber(val(16))
        },
        bandwidth: {
            month,
            usedBytes: toNumber(bandwidthTelemetry?.usedBytes || val(17)),
            todayBytes: toNumber(bandwidthTelemetry?.dataQuality?.todayDisplayedBytes || val(18)),
            limitBytes: 200 * 1024 * 1024 * 1024,
            dataQuality: bandwidthTelemetry?.dataQuality || null
        },
        ads: summarizeAdsCache(val(19), val(20)),
        bolsa: summarizeBolsaJobs(bolsaJobs),
        recruitersToday: recruiterStats,
        endpointUsageToday: endpointUsage,
        bot: botCached ? {
            proactiveToday: toNumber(botCached.today),
            proactiveTotalSent: toNumber(botCached.totalSent),
            proactiveRecovered: toNumber(botCached.totalRecovered)
        } : null
    };
}

export async function getPlatformStats({ forceRefresh = false, lightweight = false } = {}) {
    const cacheMode = lightweight ? 'light' : 'full';
    const cached = cachedStatsByMode[cacheMode];
    if (!forceRefresh && cached.stats && Date.now() - cached.at < CACHE_TTL_MS) {
        return { ...cached.stats, cache: 'hit', mode: cacheMode };
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
    let candidates = [];
    let recent = emptyCandidateBuckets();
    let facets = emptyFacets();
    let projects = [];
    let operational = null;

    if (lightweight) {
        // Light mode is for ops questions: no candidate scan, only counters and compact config blobs.
        operational = await loadOperationalStats(redis);
    } else {
        // Full mode is reserved for candidate/filter questions where cross-field counts are required.
        candidates = await loadCompactCandidates(redis, candidateFields);
        recent = buildCandidateBuckets(candidates);
        facets = buildFacets(candidates);
        [projects, operational] = await Promise.all([
            loadProjects(redis, candidates),
            loadOperationalStats(redis)
        ]);
    }

    const stats = {
        success: true,
        profile: {
            name: COPILOT_STATS_PROFILE_NAME,
            strategy: lightweight ? 'lightweight-ops' : 'full-candidate-analytics'
        },
        generatedAt: new Date().toISOString(),
        cache: 'miss',
        mode: cacheMode,
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
        operational,
        recentSample: recent,
        facets,
        candidateIndex: candidates
    };

    cachedStatsByMode[cacheMode] = { stats, at: Date.now() };
    return stats;
}

function getOperationalStatsReply(message, stats) {
    const normalized = normalizeText(message);
    const ops = stats.operational || {};

    if (/ancho de banda|bandwidth|consumo|\bgb\b|\bmb\b|redis bytes|servidor/.test(normalized)) {
        const used = formatBytes(ops.bandwidth?.usedBytes);
        const today = formatBytes(ops.bandwidth?.todayBytes);
        const limit = formatBytes(ops.bandwidth?.limitBytes);
        const endpointBytes = formatBytes(ops.endpointUsageToday?.totals?.estimatedRedisBytes || ops.endpointUsageToday?.totals?.responseBytes || 0);
        return `Ancho de banda ${ops.bandwidth?.month || ''}: ${used} de ${limit}. Hoy: ${today}. Uso medido de endpoints hoy: ${ops.endpointUsageToday?.totals?.calls || 0} llamadas, ${endpointBytes} estimados.`;
    }

    if (/endpoint|endpoints|\bapi\b|llamadas|cache|full scan|fullscan|lecturas/.test(normalized)) {
        const totals = ops.endpointUsageToday?.totals || {};
        const top = safeArray(ops.endpointUsageToday?.top)
            .slice(0, 3)
            .map(row => `${row.endpoint}: ${row.calls} llamadas`)
            .join('; ');
        return `Uso de endpoints hoy: ${totals.calls || 0} llamadas, ${totals.candidateReads || 0} lecturas de candidatos, ${totals.messageReads || 0} lecturas de mensajes, ${totals.fullScans || 0} full scans. Top: ${top || 'sin datos aun'}.`;
    }

    if (/reclutador|reclutadores|capturista|capturistas|actividad humana|actividad de usuarios/.test(normalized)) {
        const r = ops.recruitersToday || {};
        return `Actividad de reclutadores hoy: ${r.recruitersWithActivity || 0} usuarios activos, ${r.messagesSent || 0} mensajes enviados, ${r.chatsVisited || 0} chats visitados, ${r.chatsResponded || 0} chats respondidos.`;
    }

    if (/usuario|usuarios|rol|roles/.test(normalized)) {
        return `Usuarios: ${stats.users.total} registrados, ${stats.users.active} activos, ${stats.users.roles} roles configurados.`;
    }

    if (/vacante|vacantes/.test(normalized) && !/bolsa/.test(normalized)) {
        return `Vacantes internas: ${stats.vacancies.active} activas de ${stats.vacancies.total} totales. Bolsa de empleo: ${ops.bolsa?.active || 0} activas de ${ops.bolsa?.total || 0}.`;
    }

    if (/automatizacion|automatizaciones|reglas automaticas|reglas automáticas/.test(normalized)) {
        return `Automatizaciones: ${stats.automations.enabled} activas de ${stats.automations.total} configuradas. ByPass: ${ops.bypass?.rules || 0} reglas.`;
    }

    if (/envio masivo|envios masivos|bulk|campana|campaña|campanas|campañas/.test(normalized)) {
        const b = ops.bulks || {};
        const state = b.active ? 'hay una campaña activa' : 'no hay campaña activa';
        return `Envios masivos: ${state}. Historial: ${b.historyCount || 0} campanas. Campana actual: ${b.campaignName || 'ninguna'}, ${b.totalSent || 0}/${b.totalTargets || 0} enviados (${b.progressPct || 0}%).`;
    }

    if (/recordatorio|recordatorios|reminder|reminders/.test(normalized)) {
        const r = ops.reminders || {};
        return `Recordatorios directos: ${r.scheduled || 0} programados, ${r.dueNow || 0} vencidos/listos, ${r.next24h || 0} en las proximas 24h.`;
    }

    if (/notificacion|notificaciones|push|tokens? push/.test(normalized)) {
        const p = ops.push || {};
        return `Notificaciones push: ${p.totalTokens || 0} tokens (${p.candidateTokens || 0} candidatos, ${p.recruiterTokens || 0} reclutadores). Historial: ${p.historyCount || 0}; ultimo envio: ${p.lastSent || 0}/${p.lastTargetTotal || 0}.`;
    }

    if (/bolsa|empleo|postulaciones|postulacion|solicitudes|likes/.test(normalized)) {
        const b = ops.bolsa || {};
        return `Bolsa de empleo: ${b.total || 0} vacantes publicadas, ${b.active || 0} activas, ${b.applications || 0} postulaciones, ${b.requests || 0} solicitudes, ${b.likes || 0} likes. Empresas: ${ops.configuration?.companies || 0}.`;
    }

    if (/medio|medios|media|imagen|imagenes|biblioteca|archivo|archivos/.test(normalized)) {
        return `Biblioteca multimedia: ${ops.media?.libraryItems || 0} archivos indexados.`;
    }

    if (/bypass|puente|routing|enrutamiento/.test(normalized)) {
        return `ByPass/enrutamiento: ${ops.bypass?.rules || 0} reglas configuradas.`;
    }

    if (/categoria|categorias|categoría|categorías/.test(normalized) && !/candidat/.test(normalized)) {
        return `Categorias configuradas: ${ops.configuration?.categories || 0}. En candidatos, las categorias principales recientes estan en el resumen de filtros.`;
    }

    if (/respuesta rapida|respuestas rapidas|quick repl/.test(normalized)) {
        return `Respuestas rapidas configuradas: ${ops.configuration?.quickReplies || 0}.`;
    }

    if (/numero|numeros|número|números|wa number|whatsapp configurado|lineas|líneas/.test(normalized)) {
        return `Numeros WhatsApp configurados: ${ops.configuration?.waNumbers || 0}. Chats bloqueados/abiertos por humano ahora: ${ops.chat?.activeLocks || 0}.`;
    }

    if (/anuncio|anuncios|ads|meta|facebook/.test(normalized)) {
        const ads = ops.ads || {};
        const top = safeArray(ads.top).slice(0, 3).map(ad => `${ad.name}: ${ad.leads}`).join('; ');
        return ads.cached
            ? `Ads: ${ads.totalLeads || 0} leads cacheados en ${ads.adsCount || 0} anuncios, ${ads.hidden || 0} ocultos. Top: ${top || 'sin desglose'}.`
            : `Ads: no hay cache reciente de anuncios. Para ahorrar servidor, Brenda no dispara el escaneo pesado ni llamadas a Meta desde el copiloto.`;
    }

    if (/reenganche|reengagement|seguimiento automatico|seguimientos automaticos/.test(normalized)) {
        const r = ops.reengagement || {};
        return `Reenganche: ${r.enabled ? 'activo' : 'inactivo'}, silencio ${r.silenceHours || 0}h, intervalo ${r.intervalHours || 0}h, maximo ${r.maxAttempts || 0} intentos.`;
    }

    if (/evento|eventos|webhook|webhooks/.test(normalized)) {
        return `Eventos/webhooks: ${ops.events?.webhookEvents || 0} eventos recientes guardados y ${ops.events?.debugWebhookHistory || 0} entradas debug. Mensajes: ${stats.messages.incoming} entrantes, ${stats.messages.outgoing} salientes.`;
    }

    if (/bot ia|proactivo|proactivos|recuperados|recuperacion/.test(normalized) && ops.bot) {
        return `Bot IA proactivo: ${ops.bot.proactiveToday || 0} enviados hoy, ${ops.bot.proactiveTotalSent || 0} enviados historicos, ${ops.bot.proactiveRecovered || 0} recuperados.`;
    }

    if (/estadistica|estadisticas|metricas|resumen|dashboard|plataforma|reporte|datos/.test(normalized)) {
        return [
            `Resumen plataforma: ${stats.candidates.total} candidatos (${stats.candidates.complete} completos, ${stats.candidates.incomplete} incompletos, ${stats.candidates.unread} sin leer).`,
            `${stats.projects.total} proyectos, ${stats.vacancies.active}/${stats.vacancies.total} vacantes activas, ${stats.automations.enabled}/${stats.automations.total} automatizaciones activas.`,
            `Operacion: ${ops.bolsa?.active || 0} vacantes en bolsa, ${ops.media?.libraryItems || 0} medios, ${ops.reminders?.scheduled || 0} recordatorios, ${ops.endpointUsageToday?.totals?.calls || 0} llamadas API hoy.`
        ].join(' ');
    }

    return null;
}

export function isPlatformStatsIntent(message) {
    const normalized = String(message || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (/\d{4,}/.test(String(message || ''))) return true;
    if (/candid|base|telefono|whatsapp|burbuja|sin leer|no leido|proyecto|proyectos|kanban|etapa|pipeline|cumple|cumplen|cumpleanos|cumpleaños|anos|años|municipio|categoria|escolaridad|genero|origen|colonia|mujer|mujers|hombre|femenin|masculin|filtro|filtros|campos|plataforma|dashboard|reporte|anuncio|anuncios|ads|meta|facebook|bolsa|postulacion|postulaciones|solicitudes|empresa|empresas|medio|medios|media|biblioteca|archivo|archivos|recordatorio|recordatorios|reminder|notificacion|notificaciones|push|endpoint|endpoints|api|cache|full scan|ancho de banda|bandwidth|servidor|reclutador|reclutadores|capturista|capturistas|envio masivo|envios masivos|bulk|campana|campaña|campanas|campañas|bypass|puente|reenganche|reengagement|evento|eventos|webhook|webhooks|bot ia|proactivo|proactivos|recuperad|whatsapp configurado|lineas|líneas|respuesta rapida|respuestas rapidas|quick repl/.test(normalized)) {
        return true;
    }

    if (/\bhoy\b/.test(normalized) && /nuevo|nueva|nuevos|nuevas|llegaron|llego|llegó|entraron|entro|entró|registrad|alta|contacto/.test(normalized)) {
        return true;
    }

    const statsWords = [
        'cuantos', 'cuantas', 'estadistica', 'estadisticas', 'metricas', 'resumen',
        'dashboard', 'plataforma', 'datos', 'numeros', 'reporte'
    ];
    const platformWords = [
        'candid', 'candidato', 'candidatos', 'candiadtos', 'base', 'mujeres', 'mujers', 'hombres',
        'completo', 'completos', 'incompleto', 'incompletos',
        'sin leer', 'no leidos', 'unread', 'tag', 'tags', 'etiqueta', 'etiquetas',
        'filtro', 'filtros', 'vacante', 'vacantes', 'proyecto', 'proyectos',
        'automatizacion', 'automatizaciones', 'usuarios', 'mensajes',
        'plataforma', 'dashboard', 'reporte', 'metricas', 'estadisticas',
        'ads', 'anuncios', 'bolsa', 'notificaciones', 'push', 'endpoints',
        'bandwidth', 'servidor', 'reclutadores', 'bulk', 'bypass', 'webhooks'
    ];

    return statsWords.some(word => normalized.includes(word)) &&
        platformWords.some(word => normalized.includes(word));
}

export function isLightweightPlatformStatsIntent(message) {
    const normalized = normalizeText(message);
    const candidateTerms = /candid|base|telefono|whatsapp\b|burbuja|sin leer|no leido|proyecto|proyectos|kanban|etapa|pipeline|cumple|cumplen|cumpleanos|cumpleaños|anos|años|municipio|categoria de candidato|escolaridad|genero|origen|colonia|mujer|mujers|hombre|femenin|masculin|filtro|filtros|campos/.test(normalized);
    const whatsappConfigIntent = /whatsapp configurado|numeros whatsapp|números whatsapp|lineas whatsapp|líneas whatsapp/.test(normalized);
    const overviewTerms = /plataforma|dashboard|reporte general|resumen general|estadistica de la plataforma|estadisticas de la plataforma|metricas de la plataforma|métricas de la plataforma/.test(normalized);
    const operationalTerms = /anuncio|anuncios|ads|meta|facebook|bolsa|postulacion|postulaciones|solicitudes|empresa|empresas|medio|medios|media|biblioteca|archivo|archivos|recordatorio|recordatorios|reminder|notificacion|notificaciones|push|endpoint|endpoints|\bapi\b|cache|full scan|ancho de banda|bandwidth|servidor|reclutador|reclutadores|capturista|capturistas|envio masivo|envios masivos|bulk|campana|campaña|campanas|campañas|bypass|puente|reenganche|reengagement|evento|eventos|webhook|webhooks|bot ia|proactivo|proactivos|recuperad|whatsapp configurado|lineas|líneas|respuesta rapida|respuestas rapidas|quick repl|usuario|usuarios|rol|roles|vacante|vacantes|automatizacion|automatizaciones/.test(normalized);

    return operationalTerms && (!candidateTerms || whatsappConfigIntent) && !overviewTerms;
}

export function getDirectPlatformStatsReply(message, stats) {
    if (!stats?.success) return null;
    const normalized = String(message || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const candidateReply = getCandidateQuestionReply(message, stats);
    if (candidateReply) return candidateReply;

    const asksSimpleProject = /proyecto|proyectos|kanban|etapa|pipeline/.test(normalized) &&
        !/hoy|ayer|nuevo|nueva|nuevos|nuevas|llegaron|llego|llegó|entraron|entro|entró|sin leer|no leidos|no leido|completo|completos|incompleto|incompletos|tag|tags|mujer|mujers|hombre|femenin|masculin|municipio|categoria|origen|colonia|escolaridad|edad|anos|años/.test(normalized);
    if (asksSimpleProject) {
        const projectReply = getProjectQuestionReply(message, stats);
        if (projectReply) return projectReply;
    }

    const filteredCountReply = getFilteredCountReply(message, stats);
    if (filteredCountReply) return filteredCountReply;

    const birthdayReply = getBirthdayReply(message, stats);
    if (birthdayReply) return birthdayReply;

    const projectReply = getProjectQuestionReply(message, stats);
    if (projectReply) return projectReply;

    const asksCount = /cuantos|cuantas|numero|total/.test(normalized);
    const asksCandidates = /candid|base|completo|incompleto|sin leer|no leidos|unread|mujer|mujers|hombre|femenin|masculin/.test(normalized);
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

    const operationalReply = getOperationalStatsReply(message, stats);
    if (operationalReply) return operationalReply;

    return null;
}

export function formatPlatformStatsForPrompt(stats) {
    if (!stats?.success) return '';
    const compact = {
        profile: stats.profile,
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
        operational: {
            chat: stats.operational?.chat,
            reminders: stats.operational?.reminders,
            media: stats.operational?.media,
            bypass: stats.operational?.bypass,
            configuration: stats.operational?.configuration,
            push: stats.operational?.push,
            bulks: stats.operational?.bulks,
            reengagement: stats.operational?.reengagement,
            events: stats.operational?.events,
            bandwidth: {
                month: stats.operational?.bandwidth?.month,
                usedBytes: stats.operational?.bandwidth?.usedBytes,
                todayBytes: stats.operational?.bandwidth?.todayBytes,
                limitBytes: stats.operational?.bandwidth?.limitBytes
            },
            ads: stats.operational?.ads,
            bolsa: stats.operational?.bolsa,
            recruitersToday: stats.operational?.recruitersToday,
            endpointUsageToday: stats.operational?.endpointUsageToday,
            bot: stats.operational?.bot
        },
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
