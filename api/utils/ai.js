// Utils AI

/**
 * Detects gender (Hombre/Mujer) based on a name using Gemini AI
 * @param {string} name - The name to analyze
 * @returns {Promise<string>} - "Hombre" | "Mujer" | "Desconocido"
 */
export async function detectGender(name) {
    if (!name || name === 'Sin nombre' || name.length < 2) return 'Desconocido';

    try {
        const { getOpenAIResponse } = await import('./openai.js');
        const prompt = `Dime si el nombre "${name}" es de un hombre o de una mujer.
Responde únicamente con una palabra: "Hombre", "Mujer" o "Desconocido" (si es totalmente ambiguo o no es un nombre).
Ignora apellidos si los hay.
Respuesta:`;

        const result = await getOpenAIResponse([], prompt, 'gpt-4o-mini');
        const text = result?.content?.trim().replace(/[.]/g, '') || '';

        if (text.includes('Hombre')) return 'Hombre';
        if (text.includes('Mujer')) return 'Mujer';

        return 'Desconocido';

    } catch (error) {
        console.error('❌ detectGender error:', error.message);
        return 'Desconocido';
    }
}

export async function cleanNameWithAI(name) {
    if (!name || name === 'Sin nombre' || name.length < 2) return null;

    try {
        const { getOpenAIResponse } = await import('./openai.js');
        const prompt = `Analiza si el siguiente texto es un NOMBRE DE PERSONA REAL válido: "${name}".

REGLAS DE IDENTIFICACIÓN DE HIERRO:
1. NO debe ser un apodo obvio (ej: "Goku", "Naruto", "Tu Bebe").
2. NO debe ser un nombre genérico o de empresa (ej: "Usuario", "WhatsApp", "Taller").
3. NO debe ser una frase de cortesía, afirmación o relleno conversacional (ej: "Si", "Claro", "Ok", "Buenas noches", "Sin problema").
4. Si el texto tiene menos de 3 letras (ej: "Si") y no es un nombre real como "Li", es inválido.
5. El texto DEBE parecer un nombre o apellido humano real.

FORMATO DE RESPUESTA:
Debes responder ESTRICTAMENTE con un JSON con la siguiente estructura:
{
  "isValidName": boolean,
  "correctedName": "string | null",
  "reason": "Breve explicación de por qué es válido o inválido"
}

- Si es válido: pon \`isValidName: true\` y devuelve el nombre formateado en Title Case en \`correctedName\`.
- Si NO es válido (ej: "Si claro"): pon \`isValidName: false\` y \`correctedName: null\`.`;

        const result = await getOpenAIResponse([], prompt, 'gpt-4o-mini', null, { type: 'json_object' });

        if (result && result.content) {
            const parsed = JSON.parse(result.content);
            if (parsed.isValidName === true && parsed.correctedName) {
                // Extra safety for Title Case
                return parsed.correctedName.split(' ')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                    .join(' ');
            } else {
                console.log(`[NameValidator] 🛑 Name rejected: "${name}". Reason: ${parsed.reason}`);
                return null; // Signals the engine that no name was provided
            }
        }
        return null;

    } catch (error) {
        console.error('❌ cleanNameWithAI error:', error.message);
        return null; // Fail closed to prevent garbage data
    }
}

export async function cleanMunicipioWithAI(municipio) {
    if (!municipio || municipio.length < 2) return municipio;

    try {
        const { getOpenAIResponse } = await import('./openai.js');
        const prompt = `Corrige la ortografía y devuelve el nombre OFICIAL y COMPLETO del municipio: "${municipio}".
REGLAS IMPORTANTES:
1. Prioriza municipios del estado de Nuevo León, México.
2. Si el usuario dice un nombre corto o informal, conviértelo al oficial.
   - Ejemplo: "Escobedo" -> "General Mariano Escobedo"
   - Ejemplo: "San Pedro" -> "San Pedro Garza García"
   - Ejemplo: "San Nicolás" -> "San Nicolás de los Garza"
   - Ejemplo: "Apodaca" -> "Ciudad Apodaca"
   - Ejemplo: "Santa" -> "Santa Catarina"
3. Si es de otro estado de México, también corrígelo a su nombre oficial.
4. Si no es un municipio o es ambiguo, devuélvelo corregido ortográficamente en Title Case.
Responde únicamente con el nombre oficial del municipio, sin estados, sin puntos ni explicaciones.
Respuesta:`;

        const result = await getOpenAIResponse([], prompt, 'gpt-4o-mini');
        const cleaned = result?.content?.trim().replace(/[.]/g, '');
        return cleaned || municipio;

    } catch (error) {
        console.error('❌ cleanMunicipioWithAI error:', error.message);
        return municipio;
    }
}

export async function cleanCategoryWithAI(category) {
    if (!category || category.length < 2) return category;

    try {
        const { getOpenAIResponse } = await import('./openai.js');
        const prompt = `Analiza y homogeniza la categoría de empleo: "${category}".

REGLAS DE HOMOGENEIZACIÓN (MÉTODO GOOGLE):
1. PRECISIÓN: Si el usuario específicamente se identifica como "Ayudante" (General, de Almacén, de Ventas), respeta el término "Ayudante".
2. REGLA MONTACARGAS: Si el rol principal es operar maquinaria ("Montacargas"), la categoría ES: "Montacarguista".
3. REGLA ALMACENISTA: Usa "Almacenista" solo si el rol se centra exclusivamente en gestión de inventarios y bodega sin mención de ser "Ayudante".
4. Responde ÚNICAMENTE con el término limpio (máximo 2 palabras).
5. Usa SIEMPRE acentos correctos.

Respuesta (Únicamente el término):`;

        const result = await getOpenAIResponse([], prompt, 'gpt-4o-mini');
        const cleaned = result?.content?.trim().replace(/[.]/g, '');
        return cleaned || category;

    } catch (error) {
        console.error('❌ cleanCategoryWithAI error:', error.message);
        return category;
    }
}

export async function cleanEmploymentStatusWithAI(statusPhrase) {
    if (!statusPhrase || statusPhrase.length < 1) return statusPhrase;

    try {
        const { getOpenAIResponse } = await import('./openai.js');
        const prompt = `Analiza la siguiente frase sobre estatus laboral: "${statusPhrase}".
Determina de forma binaria si la persona TIENE empleo o NO TIENE empleo.
REGLAS ESTRICTAS:
1. Tu respuesta DEBE ser ÚNICAMENTE la palabra "Sí" o la palabra "No".
2. Si la persona menciona que tiene trabajo, está laborando, es empleado, o similar -> "Sí".
3. Si la persona dice que está desempleada, buscando, que no tiene trabajo, o es estudiante/ama de casa sin empleo -> "No".
4. Si la frase NO ES CLARA (ej: "hola", "info"), asume "No" por defecto para limpieza, o intenta inferir.
5. JAMÁS devuelvas la frase original. Solo "Sí" o "No".

Respuesta (Sí/No):`;

        const apiResult = await getOpenAIResponse([], prompt, 'gpt-4o-mini');
        const text = apiResult?.content?.trim().replace(/[.]/g, '') || statusPhrase;

        let result = statusPhrase;
        if (text.toLowerCase().includes('sí') || text.toLowerCase().includes('si')) {
            result = 'Sí';
        } else if (text.toLowerCase().includes('no')) {
            result = 'No';
        }

        if (result.length > 5) {
            return 'No';
        }

        return result;

    } catch (error) {
        console.error('❌ cleanEmploymentStatusWithAI error:', error.message);
        return statusPhrase;
    }
}
export async function cleanDateWithAI(dateStr) {
    if (!dateStr || dateStr.length < 1) return dateStr;

    try {
        const { getOpenAIResponse } = await import('./openai.js');
        const prompt = `Analiza la siguiente fecha proporcionada por un usuario: "${dateStr}".

CONTEXTO: Estamos en MÉXICO. El formato estándar es Día/Mes/Año (DD/MM/YYYY).

REGLAS:
1. Devuelve la fecha en formato estandarizado: "DD/MM/YYYY".
2. Si el usuario solo dice el año o es ambiguo (ej: "06/05/90"), asume el formato de MÉXICO (Día/Mes/Año).
3. Si el usuario solo da el año, intenta inferir o pide el dato completo.
4. Si el texto NO contiene una fecha válida o es basura, responde únicamente con "INVALID".
5. Escribe únicamente la fecha formateada, sin puntos ni explicaciones.

Ejemplos:
- "9 de mayo del 83" -> "09/05/1983"
- "06/12/1990" -> "06/12/1990"
- "83" -> "INVALID" (falta día y mes)
- "mayo 19" -> "INVALID" (falta año)

Respuesta:`;

        const result = await getOpenAIResponse([], prompt, 'gpt-4o-mini');
        const cleaned = result?.content?.trim().replace(/[.]/g, '');
        return cleaned || dateStr;

    } catch (error) {
        console.error('❌ cleanDateWithAI error:', error.message);
        return dateStr;
    }
}
export async function cleanEscolaridadWithAI(escolaridad) {
    if (!escolaridad || escolaridad.length < 1) return escolaridad;

    try {
        const { getOpenAIResponse } = await import('./openai.js');
        const prompt = `Analiza la siguiente descripción de escolaridad: "${escolaridad}".
Tu objetivo es clasificar este valor en una sola palabra o término estándar.

REGLAS DE HOMOGENEIZACIÓN (ESTRICTAS):
- "primaria", "elemental" -> "Primaria"
- "secundaria", "secu", "middle school", "secundaria trunca" -> "Secundaria"
- "preparatoria", "bachillerato", "prepa", "high school", "prepa trunca", "prepa terminada" -> "Preparatoria"
- "licenciatura", "ingeniería", "profesional", "universidad", "carrera", "lic trunca" -> "Licenciatura"
- "técnica", "carrera técnica", "conalep", "tecnico" -> "Técnica"
- "maestría", "doctorado", "especialidad" -> "Posgrado"
- Si es ambiguo o no menciona estudios -> "N/A"

CRÍTICO: Responde ÚNICAMENTE con una de las palabras del catálogo anterior. NO agregues "trunca", "terminada", ni ninguna otra palabra extra. Solo el término raíz.
Ejemplo: "Preparatoria trunca" -> "Preparatoria"
Ejemplo: "Ingeniería en sistemas" -> "Licenciatura"

Respuesta (UNA SOLA PALABRA):`;

        const result = await getOpenAIResponse([], prompt, 'gpt-4o-mini');
        const cleaned = result?.content?.trim().replace(/[.]/g, '');
        return cleaned || escolaridad;

    } catch (error) {
        console.error('❌ cleanEscolaridadWithAI error:', error.message);
        return escolaridad;
    }
}
