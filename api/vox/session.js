/**
 * POST /api/vox/session
 *
 * Acuña un TOKEN EFÍMERO (client secret) de la Realtime API de OpenAI para que el navegador
 * se conecte por WebRTC directo a OpenAI — el audio NUNCA pasa por nuestro servidor
 * (cero ancho de banda nuestro). La API key real jamás sale del backend.
 *
 * El cerebro (persona/voz/VAD/modelo) se lee server-side de Redis `vox:config` — el navegador
 * no decide nada, solo recibe el token. Misma config se reusará en la Etapa 2 (gateway WCH/SIP).
 *
 * Flujo (doc oficial, 2026):
 *   servidor → POST https://api.openai.com/v1/realtime/client_secrets  (Bearer OPENAI_API_KEY)
 *   navegador → POST https://api.openai.com/v1/realtime/calls          (Bearer <token efímero>, SDP)
 */

import axios from 'axios';

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

// Construye el bloque "Contexto del candidato" a partir de un candidato de Redis.
// Marca lo que YA sabemos (para que Brenda no lo re-pregunte) y lo que FALTA.
function buildCandidateContext(c) {
    if (!c) return '';
    const known = [];
    const missing = [];
    const push = (label, val, missingLabel) => {
        const v = (val === 0 || val) ? String(val).trim() : '';
        if (v && v.toLowerCase() !== 'undefined') known.push(`- ${label}: ${v}`);
        else missing.push(missingLabel);
    };
    push('Nombre', c.nombreReal || c.nombre, 'nombre completo');
    push('Edad / fecha de nacimiento', c.edad || c.fechaNacimiento, 'edad');
    push('Municipio', c.municipio, 'municipio');
    push('Escolaridad', c.escolaridad, 'escolaridad');
    push('Puesto / categoría de interés', c.categoria || c.vacanteActual, 'puesto o categoría');
    push('Colonia', c.colonia, 'colonia');
    push('Experiencia', c.experiencia, 'experiencia');

    const lines = [];
    lines.push('Llamas a este candidato, que YA completó su registro por WhatsApp. Trátalo como alguien conocido; NO le vuelvas a pedir sus datos.');
    if (c.vacanteActual) lines.push(`La vacante por la que escribió originalmente es: ${c.vacanteActual}.`);
    if (known.length) {
        lines.push('Datos que YA tenemos:');
        lines.push(...known);
    }
    return lines.join('\n');
}

// Bloque "Información de la vacante" a partir de una vacante de Redis.
function buildVacancyContext(v) {
    if (!v) return '';
    const lines = [];
    if (v.name) lines.push(`Puesto: ${v.name}`);
    if (v.company) lines.push(`Empresa: ${v.company}`);
    if (v.category) lines.push(`Categoría: ${v.category}`);
    const desc = (v.messageDescription || v.description || '').trim();
    if (desc) lines.push(`Descripción / detalles:\n${desc}`);
    return lines.join('\n');
}

// Resuelve la key igual que api/utils/openai.js: env primero, luego ai_config en Redis.
async function resolveOpenAIKey(redis) {
    let apiKey = process.env.OPENAI_API_KEY;
    if ((!apiKey || !apiKey.trim()) && redis) {
        try {
            const raw = await redis.get('ai_config');
            if (raw) apiKey = JSON.parse(raw).openaiApiKey;
        } catch { /* sin config, se maneja abajo */ }
    }
    if (!apiKey || apiKey === 'undefined' || !apiKey.trim()) return null;
    return apiKey.trim();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { getRedisClient, validateAdminSession, getCandidateById, getVacancyById, isProfileComplete } = await import('../utils/storage.js');
        const { VOX_CONFIG_KEY, mergeWithDefaults, buildInstructions } = await import('./config.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        const apiKey = await resolveOpenAIKey(redis);
        if (!apiKey) return res.status(400).json({ error: 'OPENAI_API_KEY no configurada (Settings → GPT).' });

        // Lee el cerebro server-side.
        const raw = await redis.get(VOX_CONFIG_KEY);
        let stored = null;
        try { stored = raw ? JSON.parse(raw) : null; } catch { stored = null; }
        const cfg = mergeWithDefaults(stored);

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

        // --- Candidato: Brenda Vox SOLO llama a completos ---
        let candidateContext = '';
        let candidateName = null;
        let candObj = null;
        if (body.candidateId) {
            let cand = null;
            try { cand = await getCandidateById(String(body.candidateId)); }
            catch (e) { console.warn('[vox/session] candidate load failed:', e.message); }
            if (!cand) return res.status(404).json({ error: 'Candidato no encontrado.' });
            if (!isProfileComplete(cand)) {
                return res.status(403).json({ error: 'Ese candidato no tiene el perfil COMPLETO. Brenda Vox solo llama a completos.' });
            }
            candObj = cand;
            candidateContext = buildCandidateContext(cand);
            candidateName = cand.nombreReal || cand.nombre || null;
        } else if (!body.testMode) {
            // Sin candidato y sin modo prueba explícito → no se permite.
            return res.status(400).json({ error: 'Elige un candidato completo (o activa el modo prueba).' });
        }

        // --- Vacante: requerida (es de lo que va a hablar) ---
        let vacancyInfo = '';
        let vacancyName = null;
        if (body.vacancyId) {
            try {
                const vac = await getVacancyById(String(body.vacancyId));
                if (vac) { vacancyInfo = buildVacancyContext(vac); vacancyName = vac.name || null; }
            } catch (e) { console.warn('[vox/session] vacancy load failed:', e.message); }
        }
        if (!vacancyInfo) return res.status(400).json({ error: 'Elige una vacante para la llamada.' });

        // --- Info de la cita: un mensaje del banco de respuestas (el que se envía por WhatsApp) ---
        let appointmentInfo = '';
        if (body.citaReplyId) {
            try {
                const raw2 = await redis.get('candidatic:quick_replies');
                const replies = raw2 ? JSON.parse(raw2) : [];
                const reply = Array.isArray(replies) ? replies.find(r => r.id === body.citaReplyId) : null;
                if (reply?.message) {
                    const { substituteVariables } = await import('../utils/shortcuts.js');
                    // Resuelve {{nombre}}, {{municipio}}, etc. con los datos reales del candidato (si hay).
                    appointmentInfo = candObj ? substituteVariables(reply.message, candObj) : reply.message;
                }
            } catch (e) { console.warn('[vox/session] cita reply load failed:', e.message); }
        }

        // Arma la config de sesión Realtime (shape GA 2026).
        const sessionConfig = {
            type: 'realtime',
            model: cfg.model,
            instructions: buildInstructions(cfg, candidateContext, vacancyInfo, appointmentInfo),
            audio: {
                input: {
                    transcription: { model: cfg.transcriptionModel },
                    turn_detection: cfg.turnDetection,
                },
                output: { voice: cfg.voice },
            },
        };

        let resp;
        try {
            resp = await axios.post(
                CLIENT_SECRETS_URL,
                { session: sessionConfig },
                {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        // Identificador hasheado del reclutador (no PII) para safety de OpenAI.
                        'OpenAI-Safety-Identifier': `vox_${String(userId).slice(0, 24)}`,
                    },
                    timeout: 15000,
                },
            );
        } catch (apiErr) {
            const detail = apiErr.response?.data?.error?.message || apiErr.message;
            console.error('[vox/session] OpenAI error:', detail);
            return res.status(502).json({ error: 'OpenAI rechazó la sesión', details: detail });
        }

        const token = resp.data?.value || resp.data?.client_secret?.value;
        const expiresAt = resp.data?.expires_at || resp.data?.client_secret?.expires_at || null;
        if (!token) {
            return res.status(502).json({ error: 'OpenAI no devolvió token efímero' });
        }

        // Devuelve SOLO el token + eco NO secreto de la config (para mostrar en la UI).
        return res.status(200).json({
            success: true,
            token,
            expiresAt,
            model: cfg.model,
            voice: cfg.voice,
            candidateName,
            vacancyName,
            // el navegador usa esto para el intercambio SDP
            callsUrl: 'https://api.openai.com/v1/realtime/calls',
        });
    } catch (error) {
        console.error('[vox/session] error:', error.message);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
