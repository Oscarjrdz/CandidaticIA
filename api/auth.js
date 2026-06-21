// NO TOP LEVEL IMPORTS to prevent boot crashes

const ADMIN_NUMBER = '5218116038195';

export default async function handler(req, res) {

    // Config CORS manually just in case
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // DYNAMIC IMPORTS: Load modules safely inside try-catch
        const { getUsers, saveUser, saveAuthToken, getAuthToken, deleteAuthToken } = await import('./utils/storage.js');
        const { sendMessage } = await import('./utils/messenger.js');
        const { sendMetaMessage } = await import('./whatsapp/utils.js');

        const { action, phone, pin, name, role } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'Phone is required' });
        }

        // --- 521 HANDLING LOGIC ---
        // Clean non-digits
        const cleanPhone = phone.replace(/\D/g, '');
        let whatsappNumber = cleanPhone;

        // Caso 1: 10 dígitos (8116038195) -> Agregar 521
        if (cleanPhone.length === 10) {
            whatsappNumber = '521' + cleanPhone;
        }
        // Caso 2: 12 dígitos (528116038195) -> Agregar 1 (Standard MX WhatsApp)
        else if (cleanPhone.length === 12 && cleanPhone.startsWith('52')) {
            // Check if it already has the 1? No, 52 + 10 digits = 12.
            // WhatsApp needs 52 + 1 + 10 digits = 13.
            whatsappNumber = '521' + cleanPhone.substring(2);
        }
        // Caso 3: 13 dígitos (5218116038195) -> Listo.


        // Check storage
        const users = await getUsers();
        // Sensitive log: do not log full user list in prod, just count

        const user = users.find(u => u.whatsapp === whatsappNumber);
        const redis = (await import('./utils/storage.js')).getRedisClient();

        if (action === 'request-pin') {
            // Rate limit por IP: máx 10 solicitudes por hora
            const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
            const ipKey = `auth:ip:${ip}`;
            const ipCount = await redis.incr(ipKey);
            if (ipCount === 1) await redis.expire(ipKey, 3600);
            if (ipCount > 10) {
                return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' });
            }

            // Rate limit por número: máx 3 solicitudes cada 15 min
            const reqKey = `auth:req:${whatsappNumber}`;
            const reqCount = await redis.incr(reqKey);
            if (reqCount === 1) await redis.expire(reqKey, 900);
            if (reqCount > 3) {
                return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
            }

            const generatedPin = Math.floor(100000 + Math.random() * 900000).toString();
            await saveAuthToken(whatsappNumber, generatedPin);

            // Send via WhatsApp template candidatic_pin
            const msgResult = await sendMetaMessage(whatsappNumber, 'candidatic_pin', 'template', {
                templateName: 'candidatic_pin',
                languageCode: 'es_MX',
                components: [
                    { type: 'body', parameters: [{ type: 'text', text: generatedPin }] },
                    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: generatedPin }] }
                ]
            });

            if (!msgResult.success) {
                console.warn('⚠️ Error enviando PIN:', msgResult);
                const errorText = typeof msgResult.error === 'object' ? JSON.stringify(msgResult.error) : msgResult.error;
                return res.status(500).json({
                    error: `Error enviando WhatsApp: ${errorText || 'Revisa Configuración'}`,
                    details: msgResult
                });
            }

            // Return 'exists' boolean so frontend knows if it's Login or Register flow next
            return res.status(200).json({ exists: !!user });
        }

        if (action === 'verify-pin') {
            // Rate limit: max 5 intentos fallidos → bloqueo 30 min
            const failKey = `auth:fail:${whatsappNumber}`;
            const blocked = await redis.get(`auth:block:${whatsappNumber}`);
            if (blocked) {
                return res.status(429).json({ error: 'Cuenta bloqueada temporalmente. Intenta en 30 minutos.' });
            }

            const validPin = await getAuthToken(whatsappNumber);

            // Check PIN validity
            if (!validPin || validPin !== pin) {
                const fails = await redis.incr(failKey);
                if (fails === 1) await redis.expire(failKey, 1800);
                if (fails >= 5) {
                    await redis.set(`auth:block:${whatsappNumber}`, '1', 'EX', 1800);
                    await redis.del(failKey);
                }
                return res.status(401).json({ error: 'PIN inválido o expirado' });
            }

            await redis.del(failKey);
            await deleteAuthToken(whatsappNumber);

            // If user exists, check status and login
            if (user) {
                if (user.status !== 'Active') {
                    return res.status(403).json({ error: 'Cuenta pendiente de activación.' });
                }
                // Generar sesión firmada en Redis (24h TTL)
                const { randomBytes } = await import('crypto');
                const { getRedisClient } = await import('./utils/storage.js');
                const sessionToken = randomBytes(32).toString('hex');
                const redisCli = getRedisClient();
                if (redisCli) await redisCli.set(`session:admin:${sessionToken}`, user.id, 'EX', 86400);
                return res.status(200).json({ success: true, user: { ...user, sessionToken } });
            }

            // No user found — silent reject, no registration allowed
            return res.status(401).json({ error: 'PIN inválido o expirado' });
        }

        if (action === 'register') {
            if (user) return res.status(400).json({ error: 'El usuario ya existe' });
            if (!name) return res.status(400).json({ error: 'Nombre es requerido' });

            const newUser = {
                id: `user_${Date.now()}`,
                name,
                whatsapp: whatsappNumber,
                role: 'Recruiter',
                status: 'Pending',
                createdAt: new Date().toISOString()
            };

            await saveUser(newUser);

            // 1. Notify Admin
            const adminMsg = `🔔 SOLICITUD DE NUEVA CUENTA\n\n👤 Nombre: ${name}\n📱 WhatsApp: ${cleanPhone}\n\nPara activar, responde con:\nsimon${cleanPhone}`;
            const adminRes = await sendMessage(ADMIN_NUMBER, adminMsg);

            // 2. Notify User (Confirmation)
            const userMsg = `👋 Hola ${name}, hemos recibido tu solicitud.\n\nTu cuenta está pendiente de aprobación por el administrador. Te avisaremos por aquí cuando quede activa. ⏳`;
            await sendMessage(whatsappNumber, userMsg);

            if (!adminRes.success) {
                console.warn('⚠️ Admin notification failed:', adminRes.error);
                // We still return success to frontend because the account WAS created
                return res.status(200).json({
                    success: true,
                    message: 'Solicitud enviada, pero falló la notificación al admin.',
                    debug_admin_error: adminRes.error
                });
            }

            return res.status(200).json({ success: true, message: 'Solicitud enviada.' });
        }

        return res.status(400).json({ error: 'Invalid action' });

    } catch (error) {
        console.error('🔥 CRITICAL AUTH ERROR:', error);
        // FORCE JSON RESPONSE even on crash
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
