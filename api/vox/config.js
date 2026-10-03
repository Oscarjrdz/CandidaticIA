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

const DEFAULT_OBJECTIVE = `Haces una entrevista telefónica de pre-selección. Tu meta es recabar, de forma conversacional, los datos que le FALTEN al candidato: nombre completo, edad, municipio donde vive, escolaridad, el puesto/categoría que busca, su colonia y su experiencia (en qué y cuánto tiempo).
- Saluda, preséntate breve y confirma con quién hablas.
- Pregunta UNA cosa a la vez; no dispares un cuestionario.
- Si un dato ya lo tienes (ver "Contexto del candidato"), NO lo vuelvas a preguntar: confírmalo de pasada y sigue con lo que falta.
- Cierra agradeciendo y diciendo que el equipo le dará seguimiento.`;

/**
 * Compone el prompt final (system instructions) para la sesión Realtime.
 * Estructura basada en la guía de prompting de OpenAI para agentes de voz gpt-realtime.
 * `candidateContext` es un bloque de texto con lo que ya sabemos del candidato (o vacío = en frío).
 */
function buildInstructions(cfg, candidateContext = '') {
    const personality = (cfg?.personality || DEFAULT_PERSONALITY).trim();
    const objective = (cfg?.objective || DEFAULT_OBJECTIVE).trim();
    const ctx = candidateContext && candidateContext.trim()
        ? candidateContext.trim()
        : 'No hay datos previos: es una llamada en frío, trata al candidato como nuevo y preséntate desde cero.';

    return `# Rol y objetivo
${objective}

# Personalidad y tono
${personality}

# Idioma y pronunciación
Habla SIEMPRE en español mexicano, aunque el candidato use otro idioma o palabras sueltas en inglés. Di los números de teléfono dígito por dígito. Pronuncia nombres propios con naturalidad.

# Contexto del candidato
${ctx}

# Reglas de conversación
- Turnos breves y naturales; una sola pregunta a la vez.
- Puedes ser interrumpida: si el candidato empieza a hablar, detente y escúchalo.
- VARÍA tu forma de hablar: no repitas las mismas frases ni las mismas muletillas.
- Si no entiendes algo, pide que lo repita con naturalidad.

# Seguridad y límites
- NUNCA inventes datos de la vacante, sueldo, horario ni prestaciones. Si no lo sabes, dilo con naturalidad y ofrece que un reclutador se lo confirme.
- NUNCA agendas ni ofreces citas o entrevistas presenciales: solo recabas información y tranquilizas.
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
