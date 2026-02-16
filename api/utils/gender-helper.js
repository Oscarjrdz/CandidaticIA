
/**
 * Deterministic Gender Inference from Name
 * Focused on Spanish/Mexican names
 */

const FEMALE_NAMES = new Set([
    'maria', 'ana', 'rosa', 'martha', 'brenda', 'elena', 'patricia', 'leticia',
    'guadalupe', 'gabriela', 'rocio', 'claudia', 'beatriz', 'alejandra', 'carmen',
    'juana', 'isabel', 'angelica', 'daniela', 'monica', 'veronica', 'silvia',
    'adriana', 'teresa', 'margarita', 'gloria', 'maricela', 'karina', 'susana',
    'norma', 'fabiola', 'yolanda', 'blanca', 'estela', 'itzel', 'karla', 'luz'
]);

const MALE_NAMES = new Set([
    'oscar', 'juan', 'jose', 'luis', 'carlos', 'mario', 'jesus', 'francisco',
    'pedro', 'javier', 'ricardo', 'miguel', 'angel', 'sergio', 'alejandro',
    'fernando', 'roberto', 'raul', 'david', 'jorge', 'enrique', 'victor',
    'ramon', 'arturo', 'gerardo', 'manuel', 'antonio', 'alfredo', 'alberto',
    'pablo', 'eduardo', 'andres', 'ivan', 'adrian', 'martin', 'gustavo', 'hugo'
]);

/**
 * Infers gender (Hombre/Mujer) from a full name or single name
 * @param {string} name - The name to analyze
 * @returns {string|null} - "Hombre", "Mujer" or null
 */
export function inferGender(name) {
    if (!name || typeof name !== 'string') return null;

    const tokens = name.toLowerCase().replace(/[^a-zñ\s]/g, '').split(/\s+/).filter(t => t.length > 2);
    if (tokens.length === 0) return null;

    // Use the first relevant name token
    const firstToken = tokens[0];

    // 1. Direct match with common names
    if (MALE_NAMES.has(firstToken)) return 'Hombre';
    if (FEMALE_NAMES.has(firstToken)) return 'Mujer';

    // 2. Suffix heuristics (-o is usually male, -a is usually female)
    if (firstToken.endsWith('o') && !['lucio', 'rocio', 'rosario'].includes(firstToken)) return 'Hombre';
    if (firstToken.endsWith('a') && !['luca', 'josue', 'josefa'].includes(firstToken)) return 'Mujer';

    // 3. Exception handling for compound names
    if (tokens.length > 1) {
        if (tokens[0] === 'maria' && tokens[1] === 'jose') return 'Mujer';
        if (tokens[0] === 'jose' && tokens[1] === 'maria') return 'Hombre';
    }

    return null;
}
