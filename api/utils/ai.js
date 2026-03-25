// Utils AI

// ─────────────────────────────────────────────────────────────────
// 🏷️ GENDER DICTIONARY — Capa 1 (instantánea, sin costo de IA)
// ~350 nombres femeninos y masculinos más frecuentes en México
// ─────────────────────────────────────────────────────────────────
const FEMALE_NAMES = new Set([
    // A
    'abigail','abril','ada','adela','adelina','adriana','agustina','aida','aide',
    'alejandra','alexia','alicia','alma','alondra','amada','amalia','ambar',
    'amelia','amparo','ana','anabell','anahi','anais','andrea','angeles','angelica',
    'angie','antonia','ariadna','ariana','araceli','ashley','astrid','aurora','azucena',
    // B
    'beatriz','belen','berenice','blanca','brenda','briseyda','bricia',
    // C
    'camila','carla','carmen','carolina','catalina','cecilia','celeste','celia',
    'citlali','citlaly','claudia','concepcion','consuelo','corina','cristal','cristina',
    // D
    'daisy','dalila','daniela','dania','daphne','diana','dolores',
    // E
    'edith','elena','elisa','elizabeth','elsa','elvira','emily','emma','esmeralda',
    'esperanza','estela','estefania','esther','estrella','eugenia','eva',
    // F
    'fabiola','fatima','felicia','fernanda','flor','florencia','frida',
    // G
    'gabriela','genesis','giovanna','gloria','graciela','guadalupe',
    // H
    'haydee','hilda','hortensia',
    // I
    'iliana','imelda','ingrid','irene','iris','isabel','isadora','itzel','ivette','ivonne',
    // J
    'jacqueline','jacinta','janeth','jasmine','jazmin','jessica','johanna','josefina','julieta',
    // K
    'karina','karen','karla','katia','keila','kelly','kenya','kristal','kristina',
    // L
    'laura','leonora','leslie','leticia','lilia','liliana','lisa','lizbeth','lizeth',
    'lorena','lourdes','lucia','luisa','lupita','luz',
    // M
    'magali','magdalena','maite','marcela','margarita','maria','maricela','mariana',
    'marisol','marlene','martha','mercedes','michelle','miriam','monica',
    // N
    'nadia','nancy','natalia','nayeli','noemi','nora','norma',
    // O
    'ofelia','olivia','oralia',
    // P
    'pamela','paola','patricia','paulina','penelope','perla','pilar','priscila',
    // R
    'raquel','rebeca','regina','reyna','renata','rocio','rosa','rosario','rosaura','ruth',
    // S
    'sabrina','samantha','sandra','sara','selena','silvia','sofia','soledad','sonia',
    'stephanie','susana',
    // T
    'tania','tatiana','teresa',
    // U
    'ursula',
    // V
    'valentina','valeria','vanessa','velia','veronica','victoria','violeta','virginia','viviana',
    // W
    'wendy',
    // X
    'xochitl','ximena',
    // Y
    'yajaira','yareli','yesenia','yolanda','yuliana',
    // Z
    'zara','zuleyma',
]);

const MALE_NAMES = new Set([
    'aaron','abel','abraham','adalberto','adan','adolfo','agustin','alberto',
    // A
    'aaron','abel','abelardo','abraham','adalberto','adan','adolfo','agustin',
    'alberto','aldair','aldo','alejandro','alexis','alfredo','alonso','alvaro',
    'andres','angel','antonio','arcadio','armando','arnulfo','arturo','augusto','aurelio','axel',
    // B
    'baltazar','benjamin','bernardo','beto','brandon','braulio','brian',
    // C
    'camilo','carlos','cayetano','cesar','christian','christopher','cirilo','ciro',
    'claudio','clemente','cristian','cristobal',
    // D
    'dagoberto','daniel','dario','david','demetrio','diego','donato',
    // E
    'edgar','eduardo','efrain','eleazar','elias','eliseo','eloy','emiliano',
    'emilio','emmanuel','enrique','ernesto','esteban','eugenio','everardo','ezequiel',
    // F
    'fabian','felipe','felix','fernando','fidel','florentino','francisco','frank','freddy',
    // G
    'gabino','gabriel','genaro','gerardo','german','gilberto','giovanni',
    'gonzalo','gregorio','guadalupe','guillermo','gustavo',
    // H
    'hector','heriberto','hernan','hilario','homero','horacio','hugo',
    // I
    'ignacio','isidro','ismael','israel','ivan',
    // J
    'jacobo','jaime','javier','jesus','joel','jonathan','jorge','jose','josue',
    'juan','julian','julio',
    // K
    'kevin',
    // L
    'leandro','leonardo','leodan','leonel','leopoldo','luis',
    // M
    'manuel','marcos','mario','martin','mauricio','maximiliano','miguel','misael','moises',
    // N
    'neftali','nicolas',
    // O
    'omar','oscar',
    // P
    'pablo','pedro','porfirio',
    // R
    'rafael','ramiro','ramon','raul','rene','reynaldo','ricardo','rigoberto',
    'roberto','rodrigo','rogelio','rolando','roman','ruben',
    // S
    'salvador','samuel','santiago','saul','sergio','simon',
    // T
    'teodoro','tomas',
    // U
    'ulises',
    // V
    'valentin','victor','vicente',
    // W
    'wilfredo','william',
    // X
    'xavier',
    // Y
    'yael',
    // Z
    'zacarias',
]);

/**
 * Capa 1: Diccionario local (gratis, instantáneo)
 * Capa 2: OpenAI GPT (para nombres no reconocidos)
 */
export async function detectGender(name) {
    if (!name || name === 'Sin nombre' || name.length < 2) return 'Desconocido';

    // Extraer solo el primer nombre (ignorar apellidos)
    const firstName = name.trim().split(/\s+/)[0].toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quitar acentos para comparar

    if (FEMALE_NAMES.has(firstName)) return 'Mujer';
    if (MALE_NAMES.has(firstName)) return 'Hombre';

    // Capa 2: IA para nombres no encontrados en el diccionario
    try {
        const { getOpenAIResponse } = await import('./openai.js');
        const prompt = `Dime si el nombre "${name}" es de un hombre o de una mujer.
Responde únicamente con una palabra: "Hombre", "Mujer" o "Desconocido" (si es totalmente ambiguo o no es un nombre).
Ignora apellidos si los hay.
Respuesta:`;

        const result = await getOpenAIResponse([], prompt, 'gpt-4o-mini');
        const text = (result?.content?.trim().replace(/[.]/g, '') || '').toLowerCase();

        if (text.includes('mujer')) return 'Mujer';
        if (text.includes('hombre')) return 'Hombre';

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

// ─────────────────────────────────────────────────────────────────
// 🗺️ MUNICIPIO DICTIONARY — Nuevo León + estados frecuentes
// Capa 1: instantánea, sin costo de IA. Nombres cortos canónicos.
// ─────────────────────────────────────────────────────────────────
const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const MUNICIPIO_MAP = new Map(Object.entries({
    // ── MONTERREY ÁREA METROPOLITANA ──
    'monterrey': 'Monterrey', 'mty': 'Monterrey', 'mtyrrey': 'Monterrey',
    'guadalupe': 'Guadalupe', 'gdlpe': 'Guadalupe', 'guada': 'Guadalupe',
    'apodaca': 'Apodaca', 'ciudad apodaca': 'Apodaca', 'cd apodaca': 'Apodaca',
    'escobedo': 'Escobedo', 'gral escobedo': 'Escobedo', 'general escobedo': 'Escobedo',
    'general mariano escobedo': 'Escobedo', 'gral mariano escobedo': 'Escobedo',
    'san nicolas': 'San Nicolás', 'san nicolas de los garza': 'San Nicolás',
    'san nico': 'San Nicolás', 'sn nicolas': 'San Nicolás',
    'san pedro': 'San Pedro', 'san pedro garza garcia': 'San Pedro',
    'spgg': 'San Pedro', 'san pedro garza garcía': 'San Pedro',
    'santa catarina': 'Santa Catarina', 'santa': 'Santa Catarina', 'sta catarina': 'Santa Catarina',
    'juarez': 'Juárez', 'ciudad juarez nl': 'Juárez', 'cd juarez nl': 'Juárez',
    'garcia': 'García', 'ciudad garcia': 'García', 'cd garcia': 'García',
    'pesqueria': 'Pesquería', 'pesqueria nl': 'Pesquería',
    'zuazua': 'Zuazua', 'general zuazua': 'Zuazua', 'gral zuazua': 'Zuazua',
    'santiago': 'Santiago', 'santiago nl': 'Santiago',
    // ── NUEVO LEÓN — RESTO ──
    'abasolo': 'Abasolo', 'agualeguas': 'Agualeguas', 'aldama': 'Aldama',
    'allende': 'Allende', 'anahuac': 'Anáhuac', 'anahuac nl': 'Anáhuac',
    'aramberri': 'Aramberri', 'bustamante': 'Bustamante',
    'cadereyta': 'Cadereyta', 'cadereyta jimenez': 'Cadereyta',
    'carmen': 'Carmen', 'cerralvo': 'Cerralvo', 'china': 'China',
    'cienega': 'Ciénega', 'cienega de flores': 'Ciénega',
    'doctor arroyo': 'Doctor Arroyo', 'dr arroyo': 'Doctor Arroyo',
    'doctor coss': 'Doctor Coss', 'dr coss': 'Doctor Coss',
    'doctor gonzalez': 'Doctor González', 'dr gonzalez': 'Doctor González',
    'galeana': 'Galeana',
    'general bravo': 'General Bravo', 'gral bravo': 'General Bravo',
    'general teran': 'General Terán', 'gral teran': 'General Terán',
    'general trevino': 'General Treviño', 'gral trevino': 'General Treviño',
    'general zaragoza': 'General Zaragoza', 'gral zaragoza': 'General Zaragoza',
    'los herreras': 'Los Herreras', 'herreras': 'Los Herreras',
    'higueras': 'Higueras', 'hualahuises': 'Hualahuises',
    'iturbide': 'Iturbide', 'lampazos': 'Lampazos', 'lampazos de naranjo': 'Lampazos',
    'linares': 'Linares', 'marin': 'Marín',
    'melchor ocampo': 'Melchor Ocampo', 'mier y noriega': 'Mier y Noriega',
    'mina': 'Mina', 'montemorelos': 'Montemorelos',
    'paras': 'Parás', 'los ramones': 'Los Ramones', 'ramones': 'Los Ramones',
    'rayones': 'Rayones', 'sabinas hidalgo': 'Sabinas', 'sabinas': 'Sabinas',
    'salinas victoria': 'Salinas', 'salinas': 'Salinas',
    'hidalgo': 'Hidalgo', 'vallecillo': 'Vallecillo', 'villaldama': 'Villaldama',
    // ── OTROS ESTADOS FRECUENTES ──
    // CDMX / Estado de México
    'cdmx': 'CDMX', 'ciudad de mexico': 'CDMX', 'df': 'CDMX', 'ciudad mexico': 'CDMX',
    'ecatepec': 'Ecatepec', 'naucalpan': 'Naucalpan', 'tlalnepantla': 'Tlalnepantla',
    'nezahualcoyotl': 'Neza', 'neza': 'Neza', 'toluca': 'Toluca',
    // Tamaulipas
    'matamoros': 'Matamoros', 'reynosa': 'Reynosa', 'nuevo laredo': 'Nuevo Laredo',
    'tampico': 'Tampico', 'ciudad victoria': 'Ciudad Victoria',
    // Coahuila
    'torreon': 'Torreón', 'saltillo': 'Saltillo', 'monclova': 'Monclova',
    // San Luis Potosí
    'san luis potosi': 'San Luis Potosí', 'slp': 'San Luis Potosí',
    // Jalisco
    'guadalajara': 'Guadalajara', 'gdl': 'Guadalajara', 'zapopan': 'Zapopan',
    // Otros
    'tijuana': 'Tijuana', 'mexicali': 'Mexicali', 'culiacan': 'Culiacán',
    'hermosillo': 'Hermosillo', 'chihuahua': 'Chihuahua', 'durango': 'Durango',
    'leon': 'León', 'irapuato': 'Irapuato', 'celaya': 'Celaya',
    'queretaro': 'Querétaro', 'puebla': 'Puebla', 'veracruz': 'Veracruz',
    'merida': 'Mérida', 'cancun': 'Cancún', 'acapulco': 'Acapulco',
    'morelia': 'Morelia', 'aguascalientes': 'Aguascalientes', 'oaxaca': 'Oaxaca',
}));

export async function cleanMunicipioWithAI(municipio) {
    if (!municipio || municipio.length < 2) return municipio;

    // Capa 1: Diccionario instantáneo
    const key = normalize(municipio);
    if (MUNICIPIO_MAP.has(key)) return MUNICIPIO_MAP.get(key);

    // Búsqueda parcial: si el input contiene una clave conocida (ej: "vivo en escobedo")
    for (const [k, v] of MUNICIPIO_MAP.entries()) {
        if (key.includes(k) && k.length > 4) return v;
    }

    // Capa 2: IA para municipios no en el diccionario
    try {
        const { getOpenAIResponse } = await import('./openai.js');
        const prompt = `Identifica el nombre del municipio o ciudad en: "${municipio}".
Devuelve SOLO el nombre corto y común del municipio en Title Case, sin estado, sin puntos.
Si no parece un municipio, devuélvelo con ortografía corregida en Title Case.
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

    const normCat = normalize(category); // reuse normalize() from municipio section

    try {
        // ── Capa 1: Cargar lista real de categorías desde Redis ──
        const { getRedisClient } = await import('./storage.js');
        const redis = getRedisClient();
        let officialCategories = [];

        if (redis) {
            const raw = await redis.get('candidatic_categories');
            if (raw) {
                const parsed = JSON.parse(raw);
                officialCategories = parsed.map(c => c.name || c).filter(Boolean);
            }
        }

        // ── Capa 2: Matching normalizado contra la lista oficial ──
        if (officialCategories.length > 0) {
            // 2a. Match exacto (sin acentos, lowercase)
            const exactMatch = officialCategories.find(c => normalize(c) === normCat);
            if (exactMatch) return exactMatch;

            // 2b. Match de raíz: el input CONTIENE el nombre de una categoría oficial
            // Ej: "ayudante general" contiene "ayudante" → "Ayudante"
            const rootMatch = officialCategories.find(c => {
                const normOfficial = normalize(c);
                return normCat.includes(normOfficial) || normOfficial.includes(normCat);
            });
            if (rootMatch) return rootMatch;

            // 2c. Match por similaridad de primeras letras (tolera typos como "ayduante")
            // Compara los primeros 5 chars normalizados
            const typoMatch = officialCategories.find(c => {
                const normOfficial = normalize(c);
                const prefix = Math.min(5, normOfficial.length);
                return normCat.substring(0, prefix) === normOfficial.substring(0, prefix);
            });
            if (typoMatch) return typoMatch;
        }

        // ── Capa 3: IA con la lista exacta como contexto ──
        const { getOpenAIResponse } = await import('./openai.js');
        const categoriesContext = officialCategories.length > 0
            ? `\nCATEGORÍAS OFICIALES DISPONIBLES:\n${officialCategories.map(c => `- ${c}`).join('\n')}\n\nElige la categoría más cercana de la lista anterior. Si ninguna aplica, elige la más genérica.`
            : `\nDevuelve únicamente el término limpio (máximo 2 palabras) con acentos correctos.`;

        const prompt = `Determina la categoría de empleo para: "${category}".${categoriesContext}
Responde ÚNICAMENTE con el nombre exacto de la categoría (copia exacta de la lista si aplica).`;

        const result = await getOpenAIResponse([], prompt, 'gpt-4o-mini');
        const cleaned = result?.content?.trim().replace(/[.]/g, '');

        // Validate AI picked an official category (exact or normalized match)
        if (cleaned && officialCategories.length > 0) {
            const aiNorm = normalize(cleaned);
            const confirmed = officialCategories.find(c => normalize(c) === aiNorm);
            if (confirmed) return confirmed; // Return the correctly-cased official name
        }

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
