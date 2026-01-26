import { saveMessage, getCandidateIdByPhone, saveCandidate, updateCandidate, getRedisClient, updateMessageStatus } from '../utils/storage.js';
import { processMessage } from '../ai/agent.js';
import { getUltraMsgConfig, getUltraMsgContact, markUltraMsgAsRead } from './utils.js';

// Helper for timeouts
const timeout = (ms) => new Promise(resolve => setTimeout(() => resolve('TIMEOUT'), ms));

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const data = req.body;
    if (!data || !data.event_type) {
        return res.status(200).json({ success: true, message: 'Heartbeat or invalid payload' });
    }

    const eventType = data.event_type;
    const messageData = data.data;

    console.log(`📨 [Webhook] Event: ${eventType} | From: ${messageData?.from || 'N/A'}`);

    try {
        // 1. Handle Message Acknowledgments (Lifecycle Tracking)
        if (eventType === 'message_ack') {
            const { id, status, to } = messageData;
            try {
                const phone = to?.replace(/\D/g, '');
                const candidateId = await getCandidateIdByPhone(phone);
                if (candidateId) await updateMessageStatus(candidateId, id, status);
            } catch (ackErr) { /* Silent fail for ACKs */ }
            return res.status(200).send('ok');
        }

        // 2. Handle Incoming Messages
        if (eventType === 'message_received') {
            const from = messageData.from;
            const body = messageData.body || '';
            const pushName = messageData.pushname;
            const phone = from.replace(/\D/g, '');

            // Find or Create Candidate
            let candidateId = await getCandidateIdByPhone(phone);
            if (!candidateId) {
                const newCandidate = await saveCandidate({
                    whatsapp: phone,
                    nombre: pushName || 'Desconocido',
                    origen: 'whatsapp_v2',
                    primerContacto: new Date().toISOString()
                });
                candidateId = newCandidate.id;
            }

            // Save Message to History
            const msgToSave = {
                from: 'user',
                content: body,
                type: messageData.type || 'text',
                timestamp: new Date().toISOString()
            };
            if (messageData.media) msgToSave.mediaUrl = messageData.media;

            await saveMessage(candidateId, msgToSave);

            // Update activity
            await updateCandidate(candidateId, {
                ultimoMensaje: new Date().toISOString(),
                unread: true
            });

            // Trigger parallel background tasks
            const config = await getUltraMsgConfig();

            // AI Integration (Main logic)
            const aiPromise = (async () => {
                try {
                    const redis = getRedisClient();
                    const isActive = await redis?.get('bot_ia_active');
                    if (isActive !== 'false') {
                        await processMessage(candidateId, body);
                    }
                } catch (e) {
                    console.error('🤖 AI Error:', e);
                }
            })();

            // Misc Background Tasks
            const miscPromise = (async () => {
                if (!config) return;
                await Promise.allSettled([
                    markUltraMsgAsRead(config.instanceId, config.token, from),
                    (async () => {
                        try {
                            const info = await getUltraMsgContact(config.instanceId, config.token, from);
                            const url = info?.success || info?.image;
                            if (url?.startsWith('http')) await updateCandidate(candidateId, { profilePic: url });
                        } catch (e) { }
                    })()
                ]);
            })();

            // Return quickly
            Promise.allSettled([aiPromise, miscPromise])
                .then(() => console.log(`🏁 [Webhook] Done for ${phone}`));

            return res.status(200).send('success');
        }

        return res.status(200).send('ignored');

    } catch (error) {
        console.error('❌ [Webhook] Fatal Error:', error);
        return res.status(200).send('error_handled');
    }
}
