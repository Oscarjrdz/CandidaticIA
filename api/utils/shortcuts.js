/**
 * Substitutes variables in a message string using candidate data.
 * Supports {{variable}} syntax, case-insensitive.
 * 
 * @param {string} text - The message template
 * @param {Object} candidate - The candidate object containing data
 * @returns {string} - The processed message
 */
export const substituteVariables = (text, candidate) => {
    if (!candidate || !text) return text;

    // Use a regex to find all matches of {{variableName}}
    // This is more robust than iterating over object keys
    return text.replace(/{{([^{}]+)}}/g, (match, key) => {
        const trimmedKey = key.trim();
        const lowerKey = trimmedKey.toLowerCase();

        // 1. Hardcoded Standard Aliases & Fallbacks
        if (lowerKey === 'nombre' || lowerKey === 'name') {
            return candidate.nombre || candidate.nombreReal || candidate.name || 'Candidato';
        }
        if (lowerKey === 'whatsapp' || lowerKey === 'phone' || lowerKey === 'telefono') {
            return candidate.whatsapp || candidate.phone || candidate.number || '';
        }

        // 2. Direct match (case sensitive)
        if (candidate[trimmedKey] !== undefined && candidate[trimmedKey] !== null) {
            return String(candidate[trimmedKey]);
        }

        // 3. Case-insensitive match by searching keys
        const foundKey = Object.keys(candidate).find(
            k => k.toLowerCase() === lowerKey
        );
        if (foundKey) {
            return String(candidate[foundKey]);
        }

        // Mapping for other common UI buttons (Explicit fallbacks)
        if (lowerKey === 'nombrereal') return candidate.nombreReal || candidate.nombre || 'Candidato';
        if (lowerKey === 'fechanacimiento') return candidate.fechaNacimiento || '';
        if (lowerKey === 'municipio') return candidate.municipio || '';

        // If no match found, return the original tag
        return match;
    });
};
