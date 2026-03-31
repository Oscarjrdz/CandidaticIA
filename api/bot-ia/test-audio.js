import { generateTTS } from '../utils/openai.js';
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, phone } = req.body;

        if (!message || !phone) {
            return res.status(400).json({ error: 'Missing message or phone parameters' });
        }

        console.log(`[TEST-AUDIO] Synthesizing TTS for message: "${message}"`);
        const base64Audio = await generateTTS(message, 'nova');

        // Fetch whatsapp configuration
        const config = await getUltraMsgConfig();
        if (!config || !config.instanceId || !config.token) {
            return res.status(500).json({ error: 'WhatsApp integration not configured.' });
        }

        console.log(`[TEST-AUDIO] Sending voice note to ${phone}`);
        const result = await sendUltraMsgMessage(config.instanceId, config.token, phone, base64Audio, 'audio');

        if (!result.success) {
            console.error('[TEST-AUDIO] Failed to send WhatsApp Audio:', result.error);
            return res.status(500).json({ error: result.error });
        }

        console.log('[TEST-AUDIO] 🚀 Voice note sent successfully');
        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('[TEST-AUDIO] Error:', error.message);
        return res.status(500).json({ error: error.message });
    }
}
