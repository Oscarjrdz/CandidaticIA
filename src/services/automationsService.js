/**
 * Service for managing automation rules
 */

/**
 * Get all automation rules
 */
export const getAutomationRules = async () => {
    try {
        const res = await fetch('/api/automations');
        const data = await res.json();
        if (data.success) {
            return { success: true, rules: data.rules };
        }
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Create new automation rule
 */
export const createAutomationRule = async (ruleData) => {
    try {
        const res = await fetch('/api/automations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ruleData)
        });
        const data = await res.json();
        if (data.success) {
            return { success: true, rule: data.rule };
        }
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Update existing automation rule
 */
export const updateAutomationRule = async (id, updates) => {
    try {
        const res = await fetch(`/api/automations?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        const data = await res.json();
        if (data.success) {
            return { success: true, rule: data.rule };
        }
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Delete automation rule
 */
export const deleteAutomationRule = async (id) => {
    try {
        const res = await fetch(`/api/automations?id=${id}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            return { success: true };
        }
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Available fields for capture
 */
export const AVAILABLE_FIELDS = [
    { value: 'nombreReal', label: 'Nombre Real' },
    { value: 'fechaNacimiento', label: 'Fecha Nacimiento' },
    { value: 'municipio', label: 'Municipio' },
    { value: 'categoria', label: 'Categoría' },
    { value: 'tieneEmpleo', label: 'Tiene empleo' }
];
