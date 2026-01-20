/**
 * Utilities for converting between user-friendly phrases and regex patterns
 */

/**
 * Escape special regex characters in a phrase
 */
function escapeRegex(phrase) {
    return phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert array of phrases to regex pattern
 * Example: ["tu nombre es", "su nombre es"] 
 * → "(?:tu nombre es|su nombre es)\\s*[:]?\\s*([^.!?\\n]+)"
 */
export function phrasesToPattern(phrases) {
    if (!phrases || phrases.length === 0) {
        return '';
    }

    // Escape each phrase and join with | (OR operator)
    const escapedPhrases = phrases.map(p => escapeRegex(p.trim())).filter(Boolean);

    if (escapedPhrases.length === 0) {
        return '';
    }

    // Create pattern: (?:phrase1|phrase2)\s*[:]?\s*([^.!?\n]+)
    const phrasesGroup = escapedPhrases.length === 1
        ? escapedPhrases[0]
        : `(?:${escapedPhrases.join('|')})`;

    return `${phrasesGroup}\\s*[:]?\\s*([^.!?\\n]+)`;
}

/**
 * Extract phrases from regex pattern (reverse operation)
 * Attempts to parse pattern back into phrases
 * Returns empty array if pattern doesn't match expected format
 */
export function patternToPhrases(pattern) {
    if (!pattern) {
        return [];
    }

    try {
        // Remove the capture group suffix: \s*[:]?\s*([^.!?\n]+)
        const withoutSuffix = pattern.replace(/\\s\*\[:]\?\\s\*\(\[\^\.!\?\\n]\+\)$/, '');

        // Remove non-capturing group wrapper: (?:...)
        let core = withoutSuffix;
        if (core.startsWith('(?:') && core.endsWith(')')) {
            core = core.slice(3, -1);
        }

        // Split by | and unescape
        const phrases = core.split('|').map(p => {
            // Unescape common characters
            return p.replace(/\\(.)/g, '$1');
        });

        return phrases.filter(Boolean);
    } catch (error) {
        console.warn('Could not parse pattern to phrases:', error);
        return [];
    }
}

/**
 * Validate that phrases are non-empty
 */
export function validatePhrases(phrases) {
    if (!Array.isArray(phrases) || phrases.length === 0) {
        return { valid: false, error: 'Debes agregar al menos una frase' };
    }

    const hasEmpty = phrases.some(p => !p || !p.trim());
    if (hasEmpty) {
        return { valid: false, error: 'Las frases no pueden estar vacías' };
    }

    return { valid: true };
}
