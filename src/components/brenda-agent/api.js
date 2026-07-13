// Helper de fetch para Brenda Agent (agente nativo de Claude). Centraliza el token
// de sesión del SuperAdmin y el manejo de error.
function getSessionToken() {
    try {
        const raw = localStorage.getItem('candidatic_user_session');
        const user = raw ? JSON.parse(raw) : null;
        return user?.sessionToken || '';
    } catch {
        return '';
    }
}

export async function agentFetch(url, { method = 'GET', body } = {}) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSessionToken()}` },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || 'Error de red');
    return data;
}
