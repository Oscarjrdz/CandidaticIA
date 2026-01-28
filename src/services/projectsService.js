
const API_URL = '/api/projects';

export const getProjects = async () => {
    try {
        const res = await fetch(API_URL);
        return await res.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const getProjectDetail = async (id) => {
    try {
        const res = await fetch(`${API_URL}?id=${id}`);
        return await res.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const createProject = async (name) => {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'create', name })
        });
        return await res.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const deleteProject = async (id) => {
    try {
        const res = await fetch(`${API_URL}?id=${id}`, {
            method: 'DELETE'
        });
        return await res.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const addCandidateToProject = async (projectId, candidateId) => {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add-candidate', projectId, candidateId })
        });
        return await res.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const addMultipleToProject = async (projectId, candidateIds) => {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add-multiple', projectId, candidateIds })
        });
        return await res.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const removeCandidateFromProject = async (projectId, candidateId) => {
    try {
        const res = await fetch(API_URL, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove-candidate', projectId, candidateId })
        });
        return await res.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
};
