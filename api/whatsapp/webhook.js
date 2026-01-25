import { saveMessage, getCandidateIdByPhone, saveCandidate, updateCandidate, getRedisClient } from '../utils/storage.js';
import { processMessage } from '../ai/agent.js';

export default async function handler(req, res) {
    if (req.method === 'POST') {
        const data = req.body; // UltraMsg payload

        console.log('📨 Webhook headers:', JSON.stringify(req.headers));
        console.log('📨 Webhook payload:', JSON.stringify(data).substring(0, 200));

        // Basic Validation
        if (!data || !data.data) {
            console.log('⚠️ Ignored: No data or invalid payload');
            return res.status(200).send('ok');
        }

        const messageData = data.data;
        const eventType = data.event_type;

        console.log(`TYPE: ${eventType}, FROM: ${messageData.from}, BODY: ${messageData.body}`);

        // Only process incoming messages
        if (eventType !== 'message_received') {
            console.log('⚠️ Ignored event type:', eventType);
            return res.status(200).send('ok');
        }

        try {
            const from = messageData.from; // e.g. "5218112345678@c.us"
            const body = messageData.body;
            const pushName = messageData.pushname;

            // Clean phone number (remove @c.us and non-digits)
            const phone = from.replace(/\D/g, '');

            console.log(`📩 [Webhook] PROCESSING Message from ${phone} (${pushName})`);

            // 1. Find or Create Candidate
            let candidateId = await getCandidateIdByPhone(phone);
            console.log(`🔍 Candidate ID found: ${candidateId}`);

            if (!candidateId) {
                console.log(`✨ New candidate detected: ${phone}`);
                const newCandidate = await saveCandidate({
                    whatsapp: phone,
                    nombre: pushName || 'Desconocido',
                    origen: 'whatsapp_v2'
                });
                candidateId = newCandidate.id;
                console.log(`✨ Created Candidate ID: ${candidateId}`);
            }

            // 2. Save Message to History
            const msgResult = await saveMessage(candidateId, {
                from: 'user',
                content: body,
                type: 'text',
                timestamp: new Date().toISOString()
            });
            console.log('💾 Message Saved Result:', msgResult);

            // Update candidate last activity
            await updateCandidate(candidateId, {
                ultimoMensaje: new Date().toISOString(),
                unread: true
            });
            console.log('⏱️ Updated Candidate Timestamp');

            // 3. Trigger AI Agent
            try {
                // Ensure we get a fresh client
                const redis = getRedisClient();

                let isActive = 'false';
                if (redis) {
                    isActive = await redis.get('bot_ia_active');
                } else {
                    console.warn('⚠️ [Webhook] Redis client not available for AI check, skipping.');
                }
                console.log(`🤖 AI Status Check: ${isActive} (Type: ${typeof isActive})`);

                // Default to TRUE if not set (for immediate testing) or if set to 'true'
                if (isActive !== 'false') {
                    console.log('🚀 Triggering AI Process...');
                    // Run in background (don't await to return 200 fast to webhook)
                    processMessage(candidateId, body)
                        .then(res => console.log('🤖 AI Background Process Result:', res))
                        .catch(err => console.error('❌ AI Background Process Error:', err));
                } else {
                    console.log('💤 Bot Internal AI is paused.');
                }

            } catch (aiErr) {
                console.error('Failed to trigger AI:', aiErr);
            }

            return res.status(200).send('success');

        } catch (error) {
            console.error('❌ Webhook Error:', error);
            // Return 200 anyway to prevent webhook retries loop
            return res.status(200).send('error_handled');
        }
    }

    return res.status(200).send('ok');
}
