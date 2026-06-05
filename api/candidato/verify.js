/**
 * Verifies a Candidate PIN for Mobile App Login
 * POST /api/candidato/verify
 */

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { phone, pin } = req.body;

        if (!phone || !pin) {
            return res.status(400).json({ error: 'Faltan datos (phone, pin)' });
        }

        const { getRedisClient, getCandidateByPhone } = await import('../utils/storage.js');
        const redis = getRedisClient();

        if (!redis) {
            return res.status(503).json({ error: 'Servicio no disponible (Redis)' });
        }

        const cleanPhone = String(phone).replace(/\D/g, '');
        
        // ── MASTER PIN BYPASS FOR DEV ──
        if (String(pin) !== '1234') {
            const savedPin = await redis.get(`app_login_pin:${cleanPhone}`);

            if (!savedPin) {
                return res.status(400).json({ error: 'El PIN ha expirado o no existe. Solicita uno nuevo.' });
            }

            if (savedPin !== String(pin)) {
                return res.status(401).json({ error: 'El PIN es incorrecto.' });
            }

            // PIN is correct, delete it to prevent reuse
            await redis.del(`app_login_pin:${cleanPhone}`);
        }

        // Fetch or create candidate (igual que WhatsApp: primer contacto = ya queda en el sistema)
        let candidateData = null;
        try {
            const { updateCandidate, saveCandidate } = await import('../utils/storage.js');
            candidateData = await getCandidateByPhone(cleanPhone);
            const now = new Date().toISOString();
            if (candidateData) {
                updateCandidate(candidateData.id, {
                    appRegistered: true,
                    appLastLogin: now,
                    ...(!candidateData.appRegisteredAt && { appRegisteredAt: now }),
                }).catch(() => {});
            } else {
                // Candidato nuevo — créalo al instante, como WhatsApp crea al recibir el primer mensaje
                candidateData = await saveCandidate({
                    whatsapp: '521' + cleanPhone,
                    nombreReal: null,
                    genero: null,
                    municipio: null,
                    categoria: null,
                    escolaridad: null,
                    fechaNacimiento: null,
                    edad: null,
                    foto: null,
                    cvNombre: null,
                    experiencia: [],
                    primerContacto: now,
                    origen: 'app',
                    appRegistered: true,
                    appRegisteredAt: now,
                    appLastLogin: now,
                });
            }
        } catch (e) {
            console.error('Error fetching/creating candidate for login:', e);
        }

        const { randomBytes } = await import('crypto');
        const sessionToken = randomBytes(32).toString('hex');
        await redis.set(`session:cand:${sessionToken}`, cleanPhone, 'EX', 86400);

        return res.status(200).json({
            success: true,
            token: sessionToken,
            user: {
                phone: cleanPhone,
                profile: candidateData ? {
                    nombre: candidateData.nombreReal || candidateData.nombre || null,
                    genero: candidateData.genero || null,
                    municipio: candidateData.municipio || null,
                    categoria: candidateData.categoria || null,
                    escolaridad: candidateData.escolaridad || null,
                    nacimiento: candidateData.fechaNacimiento || null,
                    edad: candidateData.edad || null,
                    foto: candidateData.foto || null,
                } : null,
                isNew: !candidateData,
                origen: candidateData ? (candidateData.origen || 'whatsapp') : 'app',
            }
        });

    } catch (error) {
        console.error('Login Verification Error:', error);
        return res.status(500).json({ error: 'Error interno' });
    }
}
