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

/**
 * Checks if a candidate's chat is empty (no messages exchanged).
 */
export const isChatEmpty = (c) => {
    if (!c) return false;
    return !c.lastUserMessageAt && !c.ultimoMensajeBot && !c.lastBotMessageAt && !(c.unreadMsgCount > 0);
};
