/**
 * POST /api/vox/transcript
 *
 * Guarda el transcript de una llamada de Vox para poder REVISAR la calidad después
 * (qué dijo Brenda, dónde se repitió, etc.). El audio va directo navegador↔OpenAI, así que
 * el único lugar donde existe el texto es el navegador: éste lo reporta aquí, utterance por
 * utterance (fire-and-forget), y lo acumulamos en una lista Redis por sesión.
 *
 * Llaves:
 *   vox:transcript:<sessionId>        → lista (RPUSH) de {role, text, at}
 *   vox:transcript:<sessionId>:meta   → hash con candidato/vacante/modelo/voz
 * Ambas con TTL de 30 días (son datos de prueba/depuración, no permanentes).
 */

const TTL = 30 * 24 * 60 * 60;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { getRedisClient, validateAdminSession } = await import('../utils/storage.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const sessionId = String(body.sessionId || '').slice(0, 64);
        if (!sessionId) return res.status(400).json({ error: 'sessionId requerido' });

        const key = `vox:transcript:${sessionId}`;
        const metaKey = `${key}:meta`;
        const pipe = redis.pipeline();

        // Meta (una vez, al inicio de la llamada).
        if (body.meta && typeof body.meta === 'object') {
            const m = body.meta;
            pipe.hset(metaKey,
                'candidateName', String(m.candidateName || ''),
                'vacancyName', String(m.vacancyName || ''),
                'model', String(m.model || ''),
                'voice', String(m.voice || ''),
                'userId', String(userId),
                'startedAt', String(m.startedAt || new Date().toISOString()),
            );
            pipe.expire(metaKey, TTL);
        }

        // Línea de transcript.
        if (typeof body.text === 'string' && body.text.trim()) {
            const role = body.role === 'user' ? 'user' : 'assistant';
            pipe.rpush(key, JSON.stringify({ role, text: body.text.slice(0, 4000), at: Date.now() }));
            pipe.expire(key, TTL);
        }

        await pipe.exec();
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('[vox/transcript] error:', error.message);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
