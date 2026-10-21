/**
 * Profile completeness checker — Shared across CandidatesSection & ChatSection
 * Single source of truth. META AUDIT: eliminates code duplication.
 */

const valToStr = (v) => v ? String(v).trim().toLowerCase() : '-';

const JUNK_EDUCATION = ['kinder', 'ninguna', 'sin estudios', 'no tengo', 'no curse', 'preescolar', 'maternal'];
const EMPTY_VALS = new Set(['-', 'null', 'n/a', 'na', 'ninguno', 'ninguna', 'none', 'desconocido']);

export const isProfileComplete = (c) => {
    if (!c) return false;
    // Fast-path: Use pre-calculated backend audit flag if available
    if (c.statusAudit) return c.statusAudit === 'complete';

    // Fallback for legacy candidates not yet re-synced
    // Completo = paso 1 (datos) + paso 2 completo
    if (c.paso2Estado !== 'completo') return false;
    const coreFields = ['nombreReal', 'municipio', 'escolaridad', 'categoria', 'genero'];
    const hasCoreData = coreFields.every(f => {
        const val = valToStr(c[f]);
        if (EMPTY_VALS.has(val) || val.includes('proporcionado') || val.length < 2) return false;
        if (f === 'escolaridad' && JUNK_EDUCATION.some(j => val.includes(j))) return false;
        return true;
    });
    const ageVal = valToStr(c.edad || c.fechaNacimiento);
    const hasAgeData = !EMPTY_VALS.has(ageVal);
    return hasCoreData && hasAgeData;
};

// Orden de captura de Brenda (paso 1 → paso 2). Cada entrada: key interna + etiqueta corta.
// Se usa para el desglose "¿en qué paso se atoraron los incompletos?" de la sección Candidatos.
// `short` = abreviatura de 3 letras para que el desglose de "atorados" quepa en UNA sola línea
// dentro de la tarjeta de CTR (son hasta 8 pasos; con el nombre completo no caben y se truncan).
export const STUCK_STEPS = [
    { key: 'nombre', label: 'Nombre', short: 'Nom' },
    { key: 'nacimiento', label: 'Nacimiento', short: 'Nac' },
    { key: 'municipio', label: 'Municipio', short: 'Mun' },
    { key: 'escolaridad', label: 'Escolaridad', short: 'Esc' },
    { key: 'categoria', label: 'Categoría', short: 'Cat' },
    { key: 'colonia', label: 'Colonia', short: 'Col' },
    { key: 'experiencia', label: 'Experiencia', short: 'Exp' },
    { key: 'meses', label: 'Meses exp.', short: 'Mes' },
];

const isFieldEmpty = (v) => {
    const val = valToStr(v);
    return EMPTY_VALS.has(val) || val.includes('proporcionado') || val.length < 2;
};

/**
 * Devuelve la `key` del PRIMER paso faltante de un candidato incompleto (orden de captura),
 * o `null` si el perfil ya está completo. Mismas reglas de validez que isProfileComplete /
 * computePaso2Estado. Alimenta el desglose de "atorados" en la tarjeta de CTR.
 */
export const firstMissingStep = (c) => {
    if (!c || isProfileComplete(c)) return null;
    // --- Paso 1 (en orden) ---
    if (isFieldEmpty(c.nombreReal)) return 'nombre';
    if (EMPTY_VALS.has(valToStr(c.edad || c.fechaNacimiento))) return 'nacimiento';
    if (isFieldEmpty(c.municipio)) return 'municipio';
    const esc = valToStr(c.escolaridad);
    if (isFieldEmpty(c.escolaridad) || JUNK_EDUCATION.some(j => esc.includes(j))) return 'escolaridad';
    if (isFieldEmpty(c.categoria)) return 'categoria';
    // --- Paso 2 ---
    // Preferir el estado precalculado por el backend cuando sea un esperando_* conocido.
    const estado = c.paso2Estado;
    if (estado === 'esperando_colonia') return 'colonia';
    if (estado === 'esperando_experiencia') return 'experiencia';
    if (estado === 'esperando_meses_experiencia') return 'meses';
    // Fallback: derivar de los campos crudos (mismas reglas que computePaso2Estado).
    if (isFieldEmpty(c.colonia)) return 'colonia';
    const exp = c.experiencia;
    if (!Array.isArray(exp)) {
        const expStr = valToStr(exp);
        if (expStr === 'sí' || expStr === 'si') {
            const m = parseInt(c.meses, 10);
            if (isNaN(m) || m <= 0) return 'meses';
        } else if (expStr !== 'no') {
            return 'experiencia';
        }
    }
    // Incompleto por una razón que no mapea a un paso de captura (ej. género derivado).
    return 'nombre';
};

/**
 * Checks if a candidate's chat is empty (no messages exchanged).
 */
export const isChatEmpty = (c) => {
    if (!c) return false;
    return !c.lastUserMessageAt && !c.ultimoMensajeBot && !c.lastBotMessageAt && !(c.unreadMsgCount > 0);
};
