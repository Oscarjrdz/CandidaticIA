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
                tags: data.tags
            };
        }
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const createFlow = async (name) => {
    try {
        const res = await fetch('/api/flows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
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
