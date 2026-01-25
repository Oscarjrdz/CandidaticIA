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

        // prioritize specific field mappings first
        const mappings = {
            'nombre': candidate.nombre || candidate.nombreReal || 'Candidato',
            'nombrereal': candidate.nombreReal || candidate.nombre || 'Candidato',
            'whatsapp': candidate.whatsapp || '',
            'telefono': candidate.whatsapp || '',
            'phone': candidate.whatsapp || '',
            'municipio': candidate.municipio || 'No especificado',
            'fechanacimiento': candidate.fechaNacimiento || 'No especificada',
            'tieneempleo': candidate.tieneEmpleo || 'No especificado',
            'aspiracionsalarial': candidate.aspiracionSalarial || 'No especificada',
            'categoria': candidate.categoria || 'No especificada'
        };

        if (mappings[lowerKey] !== undefined) {
            return String(mappings[lowerKey]);
        }

        // 1. Direct match (case sensitive)
        if (candidate[trimmedKey] !== undefined && candidate[trimmedKey] !== null) {
            return String(candidate[trimmedKey]);
        }

        // 2. Case-insensitive match by searching keys
        const foundKey = Object.keys(candidate).find(
            k => k.toLowerCase() === lowerKey
        );
        if (foundKey) {
            return String(candidate[foundKey]);
        }

        // If no match found, return the original tag
        return match;
    });
};
