// Regla ÚNICA de visibilidad de candidatos por usuario (backend).
// Espejo de src/utils/chatUnreadCount.js → passesChatRBACFilter. Si cambias una, cambia la otra.
//
//   visible = (número permitido)  Y  (etiqueta permitida)
//
// - Número: filtro duro. Con números asignados, el candidato debe haber entrado por uno de ellos.
// - Etiqueta: decide QUÉ candidatos ve (aplica en Candidatos, Chat y dentro de tableros CRM;
//   el proyecto CRM NO agrega candidatos).
//     · tags_own_mode ON → ve candidatos que traigan AL MENOS una etiqueta creada por él
//       (los chats "propios" siguen a sus etiquetas). Sin etiquetas propias = no ve a NADIE.
//       Ignora allowed_labels/'__all__' (el modo propias manda).
//     · allowed_labels con '__all__'        → ve todos (incluidos los SIN etiqueta).
//     · allowed_labels sin etiquetas reales → no ve a NADIE (deny por defecto).
//     · allowed_labels con etiquetas        → ve candidatos con AL MENOS una (permisivo);
//       los candidatos sin etiqueta NO se ven.
// Solo SuperAdmin queda exento.

export const ALL_LABELS = '__all__';

// Set (en minúscula) de nombres de etiqueta que pertenecen al usuario (createdBy === user.id),
// a partir del registro de etiquetas (candidatic:chat_tags). Devuelve null cuando el usuario no
// está en modo "solo sus propias etiquetas" (o es SuperAdmin) — el caller usa allowed_labels.
export function ownedLabelSetFromRegistry(user, registry) {
    if (!user?.tags_own_mode || user.role === 'SuperAdmin') return null;
    const list = Array.isArray(registry) ? registry : [];
    const set = new Set();
    for (const t of list) {
        if (t && typeof t === 'object' && t.createdBy === user.id && t.name) {
            set.add(String(t.name).trim().toLowerCase());
        }
    }
    return set;
}

// Normaliza la visibilidad por etiqueta del usuario a { seeAll, labelSet }.
// ownedLabelSet: Set de nombres (minúscula) de sus etiquetas propias, solo relevante cuando
// tags_own_mode está ON (lo produce ownedLabelSetFromRegistry). En ese modo manda ese set.
export function resolveAllowedLabels(user, ownedLabelSet = null) {
    if (user?.tags_own_mode && user.role !== 'SuperAdmin') {
        return { seeAll: false, labelSet: ownedLabelSet instanceof Set ? ownedLabelSet : new Set() };
    }
    const allowed = Array.isArray(user?.allowed_labels) ? user.allowed_labels : [];
    if (allowed.includes(ALL_LABELS)) return { seeAll: true, labelSet: null };
    const real = allowed.filter(l => typeof l === 'string' && l && l !== ALL_LABELS && l !== '__none__');
    return { seeAll: false, labelSet: new Set(real.map(l => l.trim().toLowerCase())) };
}

// tagsLower: array de nombres de etiqueta ya en minúscula. phoneId: incomingPhoneNumberId.
// ownedLabelSet: ver resolveAllowedLabels (solo se usa en tags_own_mode).
export function candidatePassesUserFilter({ tagsLower = [], phoneId = null }, user, ownedLabelSet = null) {
    if (!user || user.role === 'SuperAdmin') return true;

    const allowedWa = user?.allowed_wa_numbers;
    if (Array.isArray(allowedWa) && allowedWa.length > 0) {
        if (!phoneId || !allowedWa.includes(phoneId)) return false;
    }

    const { seeAll, labelSet } = resolveAllowedLabels(user, ownedLabelSet);
    if (seeAll) return true;
    if (labelSet.size === 0) return false;
    if (!tagsLower || tagsLower.length === 0) return false;
    return tagsLower.some(t => labelSet.has(t));
}
