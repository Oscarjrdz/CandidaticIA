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

        // Solo el nombre REAL (registrado), nunca el "from" informal de WhatsApp — ese
        // suele traer apodos/emojis. Si no hay nombre real guardado, no se inyecta nada
        // (string vacio) en vez de caer al nombre informal o a un generico "Candidato".
        const _firstName = (candidate.nombreReal || '').trim().split(/\s+/)[0] || '';
        const mappings = {
            'candidato': _firstName,
            'nombre': _firstName,
            'name': _firstName,
            'nombrereal': (candidate.nombreReal || '').trim(),
            'whatsapp': candidate.whatsapp || '',
            'telefono': candidate.whatsapp || '',
            'phone': candidate.whatsapp || '',
            'tel': candidate.whatsapp || '',
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

// Marcador [burbuja] (tolerante a mayúsculas/espacios) que un reclutador escribe dentro
// de un texto — banco de respuestas, nodo "WhatsApp Personalizado" de Flujos, o una
// plantilla de recordatorio — para partirlo en varios mensajes de WhatsApp seguidos en
// vez de uno solo largo. Mismo regex que BUBBLE_SPLIT_REGEX en
// src/components/ChatSection.jsx — no lo dupliques con uno propio.
const BUBBLE_SPLIT_REGEX = /\[\s*burbuja\s*\]/gi;

/**
 * @param {string} text
 * @returns {string[]} trozos no vacíos, en orden. Si no hay marcador, devuelve [text] tal cual.
 */
export const splitBubbles = (text) => {
    const parts = String(text || '').split(BUBBLE_SPLIT_REGEX).map(s => s.trim()).filter(Boolean);
    return parts.length ? parts : [String(text || '')];
};
