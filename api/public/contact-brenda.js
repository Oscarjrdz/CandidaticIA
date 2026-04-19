import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

/**
 * 🌟 PUBLIC ENDPOINT — Contact Brenda via WhatsApp
 * Sends a first message from Brenda to the visitor's phone.
 * The visitor enters the system as a real candidate — Brenda's bot
 * picks them up from the webhook on their first reply.
 * No auth required.
 */
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        const { phone } = body || {};

        if (!phone || typeof phone !== 'string') {
            return res.status(400).json({ error: 'Falta el número de teléfono' });
        }

        // Clean phone: only digits, ensure 10 digits for Mexico
        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return res.status(400).json({ error: 'Número inválido (mínimo 10 dígitos)' });
        }

        // Format: add 52 country code if needed (Mexico mobile)
        let fullPhone = cleanPhone;
        if (cleanPhone.length === 10) {
            fullPhone = `521${cleanPhone}`;
        } else if (cleanPhone.length === 12 && cleanPhone.startsWith('52')) {
            // Already has country code, add 1 for mobile
            fullPhone = cleanPhone;
        }

        // Get Meta Cloud API config
        const config = await getUltraMsgConfig();
        if (!config) {
            return res.status(500).json({ error: 'WhatsApp no configurado' });
        }

        // Send the first contact message — Brenda initiates as if the candidate just reached out
        // The bot webhook will pick up their reply and handle them as a real candidate
        const firstMsg = `¡Hola! 👋 Soy *Brenda*, reclutadora virtual de *Candidatic IA*.\n\nVi que te interesa conocer la plataforma. Me encantaría platicarte cómo funciona ✨\n\n¿Cómo te llamas y en qué te puedo ayudar?`;

        const result = await sendUltraMsgMessage(
            config.instanceId,
            config.token,
            fullPhone,
            firstMsg,
            'chat',
            { priority: 1 }
        );

        if (result.success) {
            return res.status(200).json({
                success: true,
                message: '¡Listo! Revisa tu WhatsApp, Brenda te está escribiendo.'
            });
        } else {
            throw new Error(result.error || 'Error al enviar mensaje');
        }

    } catch (error) {
        console.error('❌ [Contact Brenda] Error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'No pudimos enviar el mensaje. Intenta de nuevo.'
        });
    }
}
