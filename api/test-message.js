import { sendUltraMsgMessage, getUltraMsgConfig } from './whatsapp/utils.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'Missing phone or message' });
    }

    try {
        const config = await getUltraMsgConfig();
        if (!config || !config.instanceId || !config.token) {
            return res.status(503).json({ success: false, error: 'UltraMsg config missing' });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        console.log(`🧪 Sending TEST message to ${cleanPhone}: "${message}"`);

        await sendUltraMsgMessage(config.instanceId, config.token, cleanPhone, message);

        return res.status(200).json({ success: true, message: 'Test message sent' });

    } catch (error) {
        console.error('❌ Test Message Error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}
