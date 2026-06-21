/**
 * POST /api/admin/send-pin-template
 * Manda el template candidatic_pin a un número de WhatsApp.
 * Solo para pruebas — úsalo desde curl o Postman antes de integrarlo en la app.
 *
 * Body: { phone: "521XXXXXXXXXX", pin: "123456" }
 */
import { sendMetaMessage } from '../whatsapp/utils.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { phone, pin } = req.body || {};
    if (!phone || !pin) return res.status(400).json({ error: 'phone y pin son requeridos' });

    const result = await sendMetaMessage(phone, 'candidatic_pin', 'template', {
        templateName: 'candidatic_pin',
        languageCode: 'es_MX',
        components: [
            {
                type: 'body',
                parameters: [{ type: 'text', text: String(pin) }]
            },
            {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: String(pin) }]
            }
        ]
    });

    return res.json({ success: true, phone, pin, result });
}
