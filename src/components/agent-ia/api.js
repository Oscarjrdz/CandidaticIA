// Helper de fetch para Agent IA. Centraliza el token de sesión del SuperAdmin.
function getSessionToken() {
    try {
        const raw = localStorage.getItem('candidatic_user_session');
        const user = raw ? JSON.parse(raw) : null;
        return user?.sessionToken || '';
    } catch {
        return '';
    }
}

export async function agentIAFetch(url, { method = 'GET', body } = {}) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSessionToken()}` },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || 'Error de red');
    return data;
}
