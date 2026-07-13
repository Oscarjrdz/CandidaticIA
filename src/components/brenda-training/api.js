import { getSessionToken } from './session';

// Helper compartido de fetch para todos los paneles de Skills Candidatic.
// Centraliza el header de auth (Bearer del SuperAdmin) y el manejo de error,
// para que cada componente no repita el mismo boilerplate.
export async function apiFetch(url, { method = 'GET', body } = {}) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSessionToken()}` },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Error de red');
    }
    return data;
}
