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

        const { getRedisClient, getCandidateIdByPhone, getCandidateById } = await import('../utils/storage.js');
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

        // Fetch candidate and update app tracking fields
        let candidateData = null;
        try {
            const { updateCandidate } = await import('../utils/storage.js');
            const candidateId = await getCandidateIdByPhone(cleanPhone);
            if (candidateId) {
                candidateData = await getCandidateById(candidateId);
                // Registrar login desde la app
                const now = new Date().toISOString();
                updateCandidate(candidateId, {
                    appRegistered: true,
                    appLastLogin: now,
                    ...(!candidateData?.appRegisteredAt && { appRegisteredAt: now }),
                }).catch(() => {});
            }
        } catch (e) {
            console.error('Error fetching candidate for login:', e);
        }

        const sessionToken = Buffer.from(`${cleanPhone}:${Date.now()}`).toString('base64');

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
