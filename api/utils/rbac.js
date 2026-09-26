// Regla ÚNICA de visibilidad de candidatos por usuario (backend).
// Espejo de src/utils/chatUnreadCount.js → passesChatRBACFilter. Si cambias una, cambia la otra.
//
//   visible = (número permitido)  Y  (etiqueta permitida)
//
// - Número: filtro duro. Con números asignados, el candidato debe haber entrado por uno de ellos.
// - Etiqueta: decide QUÉ candidatos ve (aplica en Candidatos, Chat y dentro de tableros CRM;
//   el proyecto CRM NO agrega candidatos).
//     · allowed_labels con '__all__'        → ve todos (incluidos los SIN etiqueta).
//     · allowed_labels sin etiquetas reales → no ve a NADIE (deny por defecto).
//     · allowed_labels con etiquetas        → ve candidatos con AL MENOS una (permisivo);
//       los candidatos sin etiqueta NO se ven.
// Solo SuperAdmin queda exento.

export const ALL_LABELS = '__all__';

// Normaliza allowed_labels del usuario a { seeAll, labelSet }.
export function resolveAllowedLabels(user) {
    const allowed = Array.isArray(user?.allowed_labels) ? user.allowed_labels : [];
    if (allowed.includes(ALL_LABELS)) return { seeAll: true, labelSet: null };
    const real = allowed.filter(l => typeof l === 'string' && l && l !== ALL_LABELS && l !== '__none__');
    return { seeAll: false, labelSet: new Set(real.map(l => l.trim().toLowerCase())) };
}

// tagsLower: array de nombres de etiqueta ya en minúscula. phoneId: incomingPhoneNumberId.
export function candidatePassesUserFilter({ tagsLower = [], phoneId = null }, user) {
    if (!user || user.role === 'SuperAdmin') return true;

    const allowedWa = user?.allowed_wa_numbers;
    if (Array.isArray(allowedWa) && allowedWa.length > 0) {
        if (!phoneId || !allowedWa.includes(phoneId)) return false;
    }

    const { seeAll, labelSet } = resolveAllowedLabels(user);
    if (seeAll) return true;
    if (labelSet.size === 0) return false;
    if (!tagsLower || tagsLower.length === 0) return false;
    return tagsLower.some(t => labelSet.has(t));
}
