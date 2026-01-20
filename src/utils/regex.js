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
        let core = pattern;

        // 1. Remove ANY capture group at the end (conservative but effective for this UI)
        // Matches things like: ... [:?]? ([^...]+) or ... (.*)
        // We look for an opening parenthesis that starts the last capture group
        const lastParenIndex = core.lastIndexOf('(');
        if (lastParenIndex > 0) {
            const suffix = core.substring(lastParenIndex);
            // Verify if it looks like a capture group (contains [^ or .)
            if (suffix.includes('[') || suffix.includes('.')) {
                // Also remove preceding optional colon and spaces
                // Check what's before the paren
                const prefix = core.substring(0, lastParenIndex);
                // remove trailing \s*[:]?\s*
                core = prefix.replace(/\\s\*\[\:\?\]\?\\s\*$/, '').trim();
            }
        }

        let phrases = [];

        // 2. Handle OR groups
        // If it starts with (?: and ends with ), it's a wrapper group -> unwrap
        if (core.startsWith('(?:') && core.endsWith(')')) {
            // Check nesting balance implies safe split?
            // Simplification: just unwrap
            core = core.slice(3, -1);
        }

        // If top-level pipes exist, split them. 
        // Note: This might split nested groups like "hola (tu|ud)", but for a "keyword" UI, 
        // "hola (tu" and "ud)" is bad.
        // Better heuristic: Only split by | if they are not enclosed in parenthesis.

        // Simple split for now, assuming user created rules are mostly flat lists of phrases
        // If the regex is complex manual, visual might break slightly, but readable text is better.
        phrases = core.split('|');

        // 3. Clean up each phrase
        return phrases.map(p => {
            let s = p;

            // Remove remaining regex syntax
            s = s.replace(/\(\?\:/g, '');      // (?:
            s = s.replace(/\[\:\?\]\?/g, '');  // [:?]?
            s = s.replace(/\[\^.*?\]\+/g, ''); // [^...]+
            s = s.replace(/\(\.\*\)/g, '');    // (.*)

            // Remove loose brackets and parens
            s = s.replace(/[\[\]\(\)\{\}\?\^\$\+\*]/g, ''); // remove [ ] ( ) { } ? ^ $ + *

            // Remove backslashes
            s = s.replace(/\\/g, '');

            // Normalize spaces
            s = s.replace(/\s+/g, ' ');

            return s.trim();
        }).filter(p => p.length > 0 && p !== 's'); // Filter empty or artifacts like 's' (from \s)

    } catch (error) {
        console.warn('Could not parse pattern to phrases:', error);
        return [pattern];
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
