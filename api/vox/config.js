/**
 * GET/PUT /api/vox/config
 *
 * El "cerebro de voz" de Vox vive AQUÍ (en Redis `vox:config`), NO en el frontend.
 * Esto es a propósito: en la Etapa 2 (llamadas por el gateway WCH/SIP) no hay navegador,
 * así que la persona, la voz, el modelo, la detección de turnos (VAD) y las tarifas de costo
 * tienen que vivir server-side para reusarse igual en el navegador y en el teléfono.
 *
 * El frontend solo LEE esta config para mostrarla/editarla; la sesión real (api/vox/session.js)
 * la vuelve a leer del servidor al acuñar el token efímero — el navegador nunca decide la persona.
 */

const CONFIG_KEY = 'vox:config';

// El cerebro se edita en DOS espacios (personalidad y objetivo). El prompt final que recibe
// OpenAI lo COMPONE buildInstructions() siguiendo la estructura recomendada por OpenAI para
// voz Realtime (rol/objetivo → personalidad/tono → idioma → contexto → reglas → seguridad).
// Cortos a propósito: turnos breves = más natural + más barato.
const DEFAULT_PERSONALITY = `Eres Brenda, reclutadora de Candidatic en Monterrey, Nuevo León.
- Hablas español mexicano natural y cálido, con acento neutro del norte. Tuteas.
- Suenas humana: muletillas naturales ("mira", "oye", "va", "perfecto"), nunca robótica ni acartonada.
- Turnos CORTOS: una o dos frases por vez. Es una conversación, no un monólogo.
- Ritmo tranquilo y empático; haces sentir cómodo al candidato.
- Si te interrumpen, te detienes de inmediato y escuchas.`;

const DEFAULT_OBJECTIVE = `Llamas a un candidato que YA completó su registro por WhatsApp (sus datos ya los tenemos). NO le vuelvas a pedir sus datos.
Tu meta en esta llamada es:
1. Saluda por su nombre, preséntate breve y confirma que es buen momento para hablar.
2. Cuéntale de forma clara y atractiva sobre la vacante (ver "Información de la vacante"): puesto, empresa y lo más importante para él.
3. Resuelve sus dudas usando SOLO la información de la vacante.
4. Invítalo a una ENTREVISTA: confirma su interés y pregúntale qué día y en qué horario le acomoda; dile que le confirmaremos la cita por WhatsApp.
- Sé breve y cálida: una idea a la vez, turnos cortos.
- Si no está interesado, agradece amablemente y cierra sin presionar.`;

/**
 * Compone el prompt final (system instructions) para la sesión Realtime.
 * Estructura basada en la guía de prompting de OpenAI para agentes de voz gpt-realtime.
 * `candidateContext` es un bloque de texto con lo que ya sabemos del candidato (o vacío = en frío).
 */
function buildInstructions(cfg, candidateContext = '', vacancyInfo = '') {
    const personality = (cfg?.personality || DEFAULT_PERSONALITY).trim();
    const objective = (cfg?.objective || DEFAULT_OBJECTIVE).trim();
    const ctx = candidateContext && candidateContext.trim()
        ? candidateContext.trim()
        : 'Candidato de prueba (sin datos reales). Trátalo como un candidato completo genérico para ensayar la llamada.';
    const vac = vacancyInfo && vacancyInfo.trim()
        ? vacancyInfo.trim()
        : 'No se especificó una vacante. Discúlpate con naturalidad y di que un reclutador le llamará con los detalles del puesto.';

    return `# Rol y objetivo
${objective}

# Personalidad y tono
${personality}

# Idioma y pronunciación
Habla SIEMPRE en español mexicano, aunque el candidato use otro idioma o palabras sueltas en inglés. Di los números de teléfono dígito por dígito. Pronuncia nombres propios con naturalidad.

# Información de la vacante
${vac}

# Contexto del candidato
${ctx}

# Reglas de conversación
- Turnos breves y naturales; una sola idea o pregunta a la vez (frases cortas; no monólogos largos).
- Puedes ser interrumpida: si el candidato empieza a hablar, detente y escúchalo.
- VARÍA tu forma de hablar: no repitas las mismas frases ni las mismas muletillas.
- Si no entiendes algo, pide que lo repita con naturalidad.

# Seguridad y límites
- Habla de la vacante USANDO SOLO la "Información de la vacante" de arriba. NUNCA inventes sueldo, horario, prestaciones ni requisitos que no estén ahí; si te preguntan algo que no sabes, dilo con naturalidad y ofrece que un reclutador se lo confirme.
- No pidas datos sensibles (contraseñas, datos bancarios, NSS).`;
}

// Tarifas por defecto (USD por 1,000,000 de tokens) para gpt-realtime-mini — octubre 2026.
// Editables desde la UI. Sirven para el calculador de costo en vivo.
const DEFAULT_PRICING = {
    audioInput: 10,          // audio de entrada (lo que dice el candidato)
    audioInputCached: 0.30,  // audio de entrada cacheado (historial re-enviado)
    audioOutput: 20,         // audio de salida (lo que dice Brenda)
    textInput: 0.60,         // texto de entrada (instrucciones/eventos)
    textInputCached: 0.06,   // texto de entrada cacheado
    textOutput: 2.40,        // texto de salida
};

const DEFAULTS = {
    model: 'gpt-realtime-mini',
    voice: 'marin',
    personality: DEFAULT_PERSONALITY,
    objective: DEFAULT_OBJECTIVE,
    // Detección de turnos del lado del servidor de OpenAI (server VAD) — permite interrumpir.
    turnDetection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 600,
        interrupt_response: true,
        create_response: true,
    },
    transcriptionModel: 'gpt-4o-mini-transcribe', // para ver en texto lo que dice el candidato
    pricing: DEFAULT_PRICING,
    fxRate: 18.5,            // MXN por USD (editable)
    budgetMxnPerMin: 1,      // límite objetivo: 1 peso / minuto
    updatedAt: null,
    updatedBy: null,
};

function mergeWithDefaults(stored) {
    if (!stored || typeof stored !== 'object') return { ...DEFAULTS };
    return {
        ...DEFAULTS,
        ...stored,
        turnDetection: { ...DEFAULTS.turnDetection, ...(stored.turnDetection || {}) },
        pricing: { ...DEFAULTS.pricing, ...(stored.pricing || {}) },
    };
}

export default async function handler(req, res) {
    try {
        const { getRedisClient, validateAdminSession } = await import('../utils/storage.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        if (req.method === 'GET') {
            const raw = await redis.get(CONFIG_KEY);
            let stored = null;
            try { stored = raw ? JSON.parse(raw) : null; } catch { stored = null; }
            return res.status(200).json({ success: true, config: mergeWithDefaults(stored) });
        }

        if (req.method === 'PUT') {
            const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
            const raw = await redis.get(CONFIG_KEY);
            let current = null;
            try { current = raw ? JSON.parse(raw) : null; } catch { current = null; }

            // Merge superficial sobre lo guardado (mandar solo lo que cambió es seguro).
            const next = mergeWithDefaults({
                ...(current || {}),
                ...body,
                turnDetection: { ...(current?.turnDetection || {}), ...(body.turnDetection || {}) },
                pricing: { ...(current?.pricing || {}), ...(body.pricing || {}) },
            });
            next.updatedAt = new Date().toISOString();
            next.updatedBy = userId;

            await redis.set(CONFIG_KEY, JSON.stringify(next));
            return res.status(200).json({ success: true, config: next });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('[vox/config] error:', error.message);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}

export { DEFAULTS as VOX_DEFAULTS, CONFIG_KEY as VOX_CONFIG_KEY, mergeWithDefaults, buildInstructions };
