/**
 * Service for Scheduled Messages Rules
 */

export const getScheduledRules = async () => {
    try {
        const res = await fetch('/api/scheduled-messages');
        const data = await res.json();
        return data.success ? { success: true, rules: data.rules } : { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const createScheduledRule = async (ruleData) => {
    try {
        const res = await fetch('/api/scheduled-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ruleData)
        });
        const data = await res.json();
        return data.success ? { success: true, rule: data.rule } : { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const updateScheduledRule = async (id, updates) => {
    try {
        const res = await fetch(`/api/scheduled-messages?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        const data = await res.json();
        return data.success ? { success: true, rule: data.rule } : { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

export const deleteScheduledRule = async (id) => {
    try {
        const res = await fetch(`/api/scheduled-messages?id=${id}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        return data.success ? { success: true } : { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
