/**
 * AGENT CRM — acceso del agente al CRM manual (proyectos, pasos y candidatos).
 *
 * Modelo (igual que api/manual_projects.js):
 *   candidatic_manual_projects = JSON [{ id, name, steps: [{id, name}] }]
 *   crm_links:<projectId>      = JSON [{ candidateId, stepId, linkedAt }]
 *   candidate.manualProjectId / manualProjectStepId (espejo en el candidato)
 *
 * Reglas replicadas del endpoint: un candidato vive en UN solo proyecto (al mover se
 * desliga de los demás), el paso por defecto es 'step_inicio', y cada cambio publica
 * en 'channel:sse:updates' para que el tablero CRM se actualice en vivo.
 */
import { getRedisClient, updateCandidate } from './storage.js';
import { findCandidateByPhone } from './agent-ia.js';

const KEY = 'candidatic_manual_projects';
const LINKS_PREFIX = 'crm_links:';

const safeParse = (raw) => {
    if (!raw) return [];
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
};

const publishCrm = (redis, action, payload) => {
    redis.publish('channel:sse:updates', JSON.stringify({
        type: 'crm:candidate', action, ...payload, timestamp: new Date().toISOString()
    })).catch(() => {});
};

export async function getProjects() {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
        const raw = await redis.get(KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

export async function getProjectByName(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    const list = await getProjects();
    return list.find((p) => String(p.name || '').trim().toLowerCase() === q)
        || list.find((p) => String(p.name || '').trim().toLowerCase().includes(q))
        || null;
}

// Nombres de una lista de candidatos (para pintar quién está en cada paso).
async function namesFor(ids) {
    const redis = getRedisClient();
    const map = {};
    if (!redis || !ids.length) return map;
    const pipe = redis.pipeline();
    ids.forEach((id) => pipe.get(`candidate:${id}`));
    const results = await pipe.exec();
    ids.forEach((id, idx) => {
        const [, raw] = results[idx] || [];
        try {
            const c = raw ? JSON.parse(raw) : null;
            map[id] = c ? (c.nombreReal || c.nombre || id) : id;
        } catch {
            map[id] = id;
        }
    });
    return map;
}

// Panorama: todos los proyectos con sus pasos y cuántos candidatos hay en cada paso.
export async function getProjectsOverview() {
    const redis = getRedisClient();
    if (!redis) return [];
    const projects = await getProjects();
    const out = [];
    for (const p of projects) {
        const links = safeParse(await redis.get(`${LINKS_PREFIX}${p.id}`));
        const steps = (p.steps || []).map((s) => ({
            id: s.id,
            name: s.name,
            count: links.filter((l) => (l.stepId || 'step_inicio') === s.id).length
        }));
        out.push({ id: p.id, name: p.name, steps, total: links.length });
    }
    return out;
}

// Detalle de un proyecto: cada paso con los NOMBRES de los candidatos que contiene.
export async function getProjectDetail(nombre) {
    const project = await getProjectByName(nombre);
    if (!project) return null;
    const redis = getRedisClient();
    const links = safeParse(await redis.get(`${LINKS_PREFIX}${project.id}`));
    const names = await namesFor(links.map((l) => l.candidateId));
    const steps = (project.steps || []).map((s) => ({
        id: s.id,
        name: s.name,
        candidates: links
            .filter((l) => (l.stepId || 'step_inicio') === s.id)
            .map((l) => names[l.candidateId] || l.candidateId)
    }));
    return { id: project.id, name: project.name, steps, total: links.length };
}

// Desliga a un candidato de todos los proyectos MENOS el que se conserva.
async function unlinkFromOtherProjects(redis, candidateId, keepProjectId) {
    const projects = await getProjects();
    const removed = [];
    for (const p of projects) {
        if (!p?.id || p.id === keepProjectId) continue;
        const links = safeParse(await redis.get(`${LINKS_PREFIX}${p.id}`));
        if (!links.some((l) => l.candidateId === candidateId)) continue;
        await redis.set(`${LINKS_PREFIX}${p.id}`, JSON.stringify(links.filter((l) => l.candidateId !== candidateId)));
        publishCrm(redis, 'unlinkCandidate', { projectId: p.id, candidateId });
        removed.push(p.id);
    }
    return removed;
}

// Mueve/agrega a UN candidato (por teléfono o id) a un proyecto + paso (por nombre).
// Replica la acción linkCandidate del endpoint. { success, ... } | { error }.
export async function moveCandidateToProject({ telefono, candidateId, proyecto, paso }) {
    const redis = getRedisClient();
    if (!redis) return { error: 'Redis no disponible' };

    // Resolver candidato
    let candId = candidateId;
    let candName = null;
    if (!candId && telefono) {
        const found = await findCandidateByPhone(telefono);
        if (found?.error) return { error: found.error };
        if (found?.notFound) return { error: `No encontré ningún candidato con el teléfono ${telefono}.` };
        candId = found.candidate.id;
        candName = found.candidate.name;
    }
    if (!candId) return { error: 'Falta identificar al candidato (manda su teléfono).' };

    // Resolver proyecto
    const project = await getProjectByName(proyecto);
    if (!project) return { error: `No encontré un proyecto llamado "${proyecto}". Usa listar_proyectos para ver los reales.` };

    // Resolver paso (por nombre; por defecto el primero / 'step_inicio')
    const steps = project.steps || [];
    let stepId = steps[0]?.id || 'step_inicio';
    let stepName = steps[0]?.name || 'Inicio';
    if (paso) {
        const norm = String(paso).trim().toLowerCase();
        const step = steps.find((s) => String(s.name || '').trim().toLowerCase() === norm)
            || steps.find((s) => String(s.name || '').trim().toLowerCase().includes(norm));
        if (!step) {
            return { error: `No encontré el paso "${paso}" en el proyecto "${project.name}". Pasos disponibles: ${steps.map((s) => s.name).join(', ') || '(ninguno)'}.` };
        }
        stepId = step.id;
        stepName = step.name;
    }

    // Link (replica linkCandidate)
    const removedProjectIds = await unlinkFromOtherProjects(redis, candId, project.id);
    const links = safeParse(await redis.get(`${LINKS_PREFIX}${project.id}`));
    const existing = links.find((l) => l.candidateId === candId);
    const next = existing
        ? links.map((l) => (l.candidateId === candId ? { ...l, stepId } : l))
        : [...links, { candidateId: candId, stepId, linkedAt: new Date().toISOString() }];
    await redis.set(`${LINKS_PREFIX}${project.id}`, JSON.stringify(next));
    await updateCandidate(candId, { manualProjectId: project.id, manualProjectStepId: stepId });
    publishCrm(redis, 'linkCandidate', { projectId: project.id, candidateId: candId, stepId, removedProjectIds });

    return {
        success: true,
        candidateId: candId,
        candidateName: candName,
        projectName: project.name,
        stepName,
        moved: !existing,
        removedFromOthers: removedProjectIds.length
    };
}
