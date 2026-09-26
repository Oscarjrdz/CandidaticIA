import { isProfileComplete } from './profileUtils';
import { checkIfUnread } from '../components/chat/chatUtils';

// Sentinela: acceso total por etiqueta (ve todos los candidatos, incluidos los sin etiqueta).
export const ALL_LABELS = '__all__';

// ¿Este usuario puede ver a ESTE candidato? Regla única de visibilidad (Candidatos, Chat Web
// y dentro de tableros CRM). Ver docs del modelo de permisos.
//
//   visible = (número permitido)  Y  (etiqueta permitida)
//
// - Número: filtro duro. Si el usuario tiene números asignados, el candidato debe haber
//   entrado por uno de ellos.
// - Etiqueta: decide QUÉ candidatos ve. El proyecto CRM NO agrega candidatos (solo abre el
//   tablero; adentro sigue mandando la etiqueta).
//     · allowed_labels con '__all__'  → ve todos (incluidos los SIN etiqueta).
//     · allowed_labels sin etiquetas reales → no ve a NADIE (deny por defecto).
//     · allowed_labels con etiquetas   → ve candidatos con AL MENOS una de esas etiquetas
//       (permisivo); los candidatos sin etiqueta NO se ven.
// Solo SuperAdmin queda exento de todo.
export const passesChatRBACFilter = (candidate, user) => {
    if (!user || user.role === 'SuperAdmin') return true;

    // ── Número: filtro duro (Y). ──
    const allowedWa = user?.allowed_wa_numbers;
    if (Array.isArray(allowedWa) && allowedWa.length > 0) {
        const phoneId = candidate?.incomingPhoneNumberId;
        if (!phoneId || !allowedWa.includes(phoneId)) return false;
    }

    // ── Etiqueta: candado de visibilidad de candidatos. ──
    const allowedLabels = Array.isArray(user?.allowed_labels) ? user.allowed_labels : [];
    if (allowedLabels.includes(ALL_LABELS)) return true; // Ver TODAS
    const realLabels = allowedLabels.filter(l => typeof l === 'string' && l && l !== ALL_LABELS && l !== '__none__');
    if (realLabels.length === 0) return false; // sin etiquetas asignadas = nadie

    const tags = Array.isArray(candidate?.tags)
        ? candidate.tags.map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean).map(s => s.trim().toLowerCase())
        : [];
    if (tags.length === 0) return false; // candidato sin etiqueta: solo SuperAdmin / 'Ver TODAS'
    const allowedSet = new Set(realLabels.map(l => l.trim().toLowerCase()));
    return tags.some(t => allowedSet.has(t));
};

export const canSeeIncompleteChats = (user, rolePermissions) => (
    user?.role === 'SuperAdmin' ||
    !rolePermissions ||
    Object.keys(rolePermissions).length === 0 ||
    rolePermissions.view_incomplete_candidates === true
);

export const countVisibleUnreadChats = (candidates = [], user, rolePermissions) => {
    const canSeeIncomplete = canSeeIncompleteChats(user, rolePermissions);

    return candidates.reduce((count, candidate) => {
        if (!passesChatRBACFilter(candidate, user)) return count;
        if (!isProfileComplete(candidate) && !canSeeIncomplete) return count;
        return checkIfUnread(candidate) ? count + 1 : count;
    }, 0);
};
