/**
 * Service for managing Flows (constructor visual de automatizaciones)
 */

export const getFlows = async () => {
    try {
        const res = await fetch('/api/flows');
        const data = await res.json();
        if (data.success) return { success: true, flows: data.flows };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const getFlow = async (id) => {
    try {
        const res = await fetch(`/api/flows?id=${id}`);
        const data = await res.json();
        if (data.success) return { success: true, flow: data.flow };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const getFlowCounters = async (id) => {
    try {
        const res = await fetch(`/api/flows?id=${id}&mode=counters`);
        const data = await res.json();
        if (data.success) return { success: true, counters: data.counters };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const getFlowsMeta = async () => {
    try {
        const res = await fetch('/api/flows?meta=1');
        const data = await res.json();
        if (data.success) {
            return {
                success: true,
                municipios: data.municipios,
                categorias: data.categorias,
                escolaridades: data.escolaridades,
                tags: data.tags,
                vacantes: data.vacantes
            };
        }
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// rootType: undefined/'live' → flujo en vivo (nodo "inicio"); 'lista' → flujo manual,
// no en vivo, con nodo "inicio_lista" (filtros + lista + Run uno por uno).
export const createFlow = async (name, rootType) => {
    try {
        const res = await fetch('/api/flows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, rootType })
        });
        const data = await res.json();
        if (data.success) return { success: true, flow: data.flow };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const updateFlow = async (id, updates) => {
    try {
        const res = await fetch(`/api/flows?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        const data = await res.json();
        if (data.success) return { success: true, flow: data.flow };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const deleteFlow = async (id) => {
    try {
        const res = await fetch(`/api/flows?id=${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) return { success: true };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// Nodo "test": corre el flujo completo contra un candidato real por teléfono.
export const testFlow = async (flowId, whatsapp) => {
    try {
        const res = await fetch(`/api/flows?id=${flowId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'test', whatsapp })
        });
        const data = await res.json();
        if (data.success) return { success: true, candidate: data.candidate, passed: data.passed || {} };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// Nodo "inicio_lista": trae la lista de candidatos que matchean el filtro configurado
// en el nodo, cada uno con `executed` (si ya se le corrió el flujo — ver flow-engine.js).
export const getFilteredFlowCandidates = async (flowId, { profileFilter, tags, within24h } = {}) => {
    try {
        const params = new URLSearchParams({ id: flowId, mode: 'filtered_candidates', profileFilter: profileFilter || 'todos' });
        if (Array.isArray(tags) && tags.length) params.set('tags', tags.join(','));
        if (within24h) params.set('within24h', '1');
        const res = await fetch(`/api/flows?${params.toString()}`);
        const data = await res.json();
        if (data.success) return { success: true, candidates: data.candidates || [], total: data.total || 0 };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// Nodo "inicio_lista", botón Run: corre el flujo real para UN candidato de la lista.
// Respeta el dedupe de producción — repetir la llamada para el mismo candidato no
// vuelve a mandarle nada (alreadyExecuted: true).
export const runFlowListItem = async (flowId, candidateId) => {
    try {
        const res = await fetch(`/api/flows?id=${flowId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'run_list_item', candidateId })
        });
        const data = await res.json();
        if (data.success) return { success: true, alreadyExecuted: !!data.alreadyExecuted };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// Banco de respuestas — reusado tal cual por el nodo "accion_whatsapp" para elegir mensaje.
export const getQuickReplies = async () => {
    try {
        const res = await fetch('/api/quick_replies');
        const data = await res.json();
        if (data.success) return { success: true, replies: data.replies };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// Plantillas de recordatorio — reusadas tal cual por el nodo "accion_recordatorio".
export const getReminderTemplates = async () => {
    try {
        const res = await fetch('/api/reminder-templates');
        const data = await res.json();
        if (data.success) return { success: true, templates: data.templates };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// Proyectos (CRM Kanban) — reusados tal cual por el nodo "accion_proyecto".
export const getManualProjects = async () => {
    try {
        const res = await fetch('/api/manual_projects');
        const data = await res.json();
        if (data.success) return { success: true, projects: data.data };
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
