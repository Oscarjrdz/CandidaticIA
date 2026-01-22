// NO TOP LEVEL IMPORTS to prevent boot crashes

const ADMIN_NUMBER = '5218116038195';

export default async function handler(req, res) {
    console.log('🔹 /api/auth Request received');

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
        console.log('🔹 Loading storage and messenger modules...');
        const { getUsers, saveUser, saveAuthToken, getAuthToken, deleteAuthToken } = await import('./utils/storage.js');
        const { sendMessage } = await import('./utils/messenger.js');
        console.log('✅ Modules loaded.');

        const { action, phone, pin, name, role } = req.body;
        console.log(`📩 Auth Action: ${action}`, { phone });

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

        console.log(`🔢 Phone Parsing: Input="${phone}" Clean="${cleanPhone}" Final="${whatsappNumber}"`);

        // Check storage
        const users = await getUsers();
        // Sensitive log: do not log full user list in prod, just count
        console.log(`📂 Users in memory: ${users.length}`);

        const user = users.find(u => u.whatsapp === whatsappNumber);

        if (action === 'request-pin') {
            // ALWAYS Allow PIN generation for any valid number (Existing OR New)
            console.log(`✅ Proceso de solicitud de PIN para: ${whatsappNumber}`);

            // ⚡️ ADMIN BYPASS: Skip SMS for Super Admin
            if (whatsappNumber === ADMIN_NUMBER) {
                console.log('⚡️ ADMIN LOGIN DETECTADO: Saltando envío de SMS.');
                // Simplemente guardamos un token dummy (aunque el admin usa '1234' hardcoded en verify)
                // Esto permite que el frontend proceda sin esperar el SMS.
                return res.status(200).json({ exists: true, adminBypass: true });
            }

            const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
            await saveAuthToken(whatsappNumber, generatedPin);

            // Send via WhatsApp
            console.log('📤 Enviando PIN a:', whatsappNumber);
            const msgResult = await sendMessage(whatsappNumber, `🔐 Tu PIN de acceso Candidatic IA es: *${generatedPin}*`);
            console.log('📤 Resultado envío PIN:', msgResult);

            if (!msgResult.success) {
                console.warn('⚠️ Error enviando PIN:', msgResult);
                return res.status(500).json({
                    error: `Error enviando WhatsApp: ${msgResult.error || 'Revisa BOT_ID'}`,
                    details: msgResult
                });
            }

            // Return 'exists' boolean so frontend knows if it's Login or Register flow next
            return res.status(200).json({ exists: !!user });
        }

        if (action === 'verify-pin') {
            const validPin = await getAuthToken(whatsappNumber);

            // Check PIN validity first
            if (!validPin || validPin !== pin) {
                // If using default admin password mechanism as backup
                if (whatsappNumber === '5218116038195' && pin === '1234') {
                    // Allow default hardcoded PIN for Super Admin as backup
                } else {
                    return res.status(401).json({ error: 'PIN inválido o expirado' });
                }
            }

            await deleteAuthToken(whatsappNumber);

            // If user exists, check status and login
            if (user) {
                if (user.status !== 'Active') {
                    return res.status(403).json({ error: 'Cuenta pendiente de activación.' });
                }
                return res.status(200).json({ success: true, user });
            }

            // If user does NOT exist, signal frontend to proceed to Registration
            return res.status(200).json({ success: true, newUser: true });
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
            console.log(`📤 Sending Admin Notification to ${ADMIN_NUMBER}...`);
            const adminRes = await sendMessage(ADMIN_NUMBER, adminMsg);
            console.log('📤 Admin Notif Result:', adminRes);

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
        return res.status(500).json({ error: 'Internal Server Error', details: error.message, stack: error.stack });
    }
}
