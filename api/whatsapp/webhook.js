import { saveMessage, getCandidateIdByPhone, createCandidate, updateCandidate } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method === 'POST') {
        const data = req.body; // UltraMsg payload

        // Basic Validation
        if (!data || !data.data) {
            return res.status(200).send('ok'); // Always 200 to satisfy webhook
        }

        const messageData = data.data;
        const eventType = data.event_type;

        // Only process incoming messages
        if (eventType !== 'message_received') {
            return res.status(200).send('ok');
        }

        try {
            const from = messageData.from; // e.g. "5218112345678@c.us"
            const body = messageData.body;
            const pushName = messageData.pushname;

            // Clean phone number (remove @c.us and non-digits)
            const phone = from.replace(/\D/g, '');

            console.log(`📩 [Webhook] Message from ${phone} (${pushName}): ${body}`);

            // 1. Find or Create Candidate
            let candidateId = await getCandidateIdByPhone(phone);

            if (!candidateId) {
                console.log(`✨ New candidate detected: ${phone}`);
                const newCandidate = await createCandidate({
                    whatsapp: phone,
                    nombre: pushName || 'Desconocido',
                    origen: 'whatsapp_v2'
                });
                candidateId = newCandidate.id;
            }

            // 2. Save Message to History
            await saveMessage(candidateId, {
                from: 'user',
                content: body,
                type: 'text',
                timestamp: new Date().toISOString()
            });

            // Update candidate last activity
            await updateCandidate(candidateId, {
                ultimoMensaje: new Date().toISOString(),
                unread: true
            });

            // TODO: Trigger AI Agent (Phase 3)

            return res.status(200).send('success');

        } catch (error) {
            console.error('❌ Webhook Error:', error);
            // Return 200 anyway to prevent webhook retries loop
            return res.status(200).send('error_handled');
        }
    }

    return res.status(200).send('ok');
}
