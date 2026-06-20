/**
 * Colonia Normalizer — fuzzy matches a raw colonia against the official directory
 * stored in Redis (imported from SEPOMEX data).
 */

const STOP_WORDS = new Set([
    'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'a', 'en', 'con',
    'colonia', 'fraccionamiento', 'barrio', 'unidad', 'habitacional',
    'residencial', 'conjunto', 'zona', 'industrial', 'parque', 'ejido',
    'hacienda', 'rancho', 'pueblo', 'congregacion', 'villa', 'ciudad',
    'ampliacion', 'privada', 'privadas', 'predio', 'sector', 'etapa',
    'secc', 'seccion', 'infonavit', 'fomerrey', 'provileon'
]);

export const normalizeForMatch = (str) => {
    return str
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(w => w.length > 1 && !STOP_WORDS.has(w))
        .join(' ');
};

const jaccardScore = (a, b) => {
    const ta = new Set(a.split(' ').filter(Boolean));
    const tb = new Set(b.split(' ').filter(Boolean));
    if (ta.size === 0 || tb.size === 0) return 0;
    const intersection = [...ta].filter(x => tb.has(x)).length;
    const union = new Set([...ta, ...tb]).size;
    return intersection / union;
};

/**
 * Normalize a colonia name against the official directory for a given municipio.
 * @param {string} rawColonia - what the candidate said
 * @param {string} municipio - candidate's municipio (used to filter the list)
 * @param {object} redis - ioredis client
 * @returns {Promise<string|null>} normalized colonia name, or null if no match
 */
export async function normalizeColonia(rawColonia, municipio, redis) {
    if (!rawColonia || !municipio || !redis) return null;

    try {
        const muniKey = municipio
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .trim();

        const raw = await redis.get(`colonia_dir:${muniKey}`);
        if (!raw) return null;

        const colonias = JSON.parse(raw); // [{name, nameNorm}]
        const inputNorm = normalizeForMatch(rawColonia);

        if (!inputNorm) return null;

        let bestName = null;
        let bestScore = 0;

        for (const c of colonias) {
            // Exact normalized match
            if (c.nameNorm === inputNorm) return c.name;

            const score = jaccardScore(inputNorm, c.nameNorm);
            if (score > bestScore) {
                bestScore = score;
                bestName = c.name;
            }
        }

        // Only return if confidence is reasonable
        return bestScore >= 0.5 ? bestName : null;
    } catch {
        return null;
    }
}
