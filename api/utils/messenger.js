import { getUltraMsgConfig, sendUltraMsgMessage, sendUltraMsgPresence } from '../whatsapp/utils.js';
import { getRedisClient } from './storage.js';

/**
 * 🚀 SMART MESSENGER v2 — Multi-Instance Aware
 *
 * Routes replies through the correct GatewayWapp instance based on:
 *   1. Explicit instanceId passed in options (_instanceId)
 *   2. Candidate's assigned instanceId (Redis: candidate_instance:{phone})
 *   3. Deterministic default (instances[0]) if no assignment found
 *
 * All sends go through the unified GatewayWapp API layer (sendUltraMsgMessage).
 * Instance assignment is organic: the GatewayWapp webhook captures the instanceId
 * from the line that received the first message. NO rotation, NO round-robin.
 */
export const sendMessage = async (number, message, type = 'chat', extraParams = {}) => {
    try {
        // Normalize phone
        const phone = String(number).replace(/\D/g, '');

        // Determine instanceId: explicit > Redis lookup > deterministic default
        let targetInstanceId = extraParams._instanceId || null;

        // If no explicit instanceId, try to look up the candidate's assigned instance
        if (!targetInstanceId) {
            try {
                const redis = getRedisClient();
                if (redis) {
                    // Quick Redis lookup: candidate's instance is stored on their hash
                    const candidateInstanceId = await redis.get(`candidate_instance:${phone}`);
                    if (candidateInstanceId) targetInstanceId = candidateInstanceId;
                }
            } catch (e) {
                // Redis lookup failed — fall through to deterministic default
            }
        }

        // Resolve config (returns exact match or instances[0] as safe default)
        const config = await getUltraMsgConfig(targetInstanceId);

        if (!config || !config.instanceId || !config.token) {
            console.error('❌ Missing WhatsApp Configuration (Checked Env & Redis)');
            return { success: false, error: 'Configuration missing: instanceId or TOKEN' };
        }

        const result = await sendUltraMsgMessage(config.instanceId, config.token, number, message, type, extraParams);

        if (!result.success) {
            if (result.data?.error === 'El número no existe en WhatsApp') {
                try {
                    const { getCandidateIdByPhone, updateCandidate } = await import('./storage.js');
                    const candidateId = await getCandidateIdByPhone(phone);
                    if (candidateId) {
                        await updateCandidate(candidateId, { 
                            status: 'Incontactable', 
                            incontactable: true, 
                            blocked: true 
                        });
                        console.log(`[🔗 Gateway] Número inválido interceptado: ${phone} -> Marcado como Incontactable.`);
                    }
                } catch (e) {
                    console.error('Error al marcar candidato incontactable:', e.message);
                }
            }
            return { success: false, error: result.error || result.data?.error || 'WhatsApp Send Error' };
        }

        return { success: true, data: result.data, via: 'gateway', instanceId: config.instanceId };

    } catch (error) {
        console.error('❌ Error sending message:', error.message);
        return { success: false, error: error.message };
    }
};

// ─── Send typing presence via GatewayWapp ────────────────────────────────────
export const sendGatewayPresence = async (phone, status = 'composing') => {
    try {
        const cleanPhone = String(phone).replace(/\D/g, '');

        // Try to find the candidate's assigned instance
        let targetInstanceId = null;
        try {
            const redis = getRedisClient();
            const candidateInstanceId = await redis?.get(`candidate_instance:${cleanPhone}`);
            if (candidateInstanceId) targetInstanceId = candidateInstanceId;
        } catch (e) { }

        const config = await getUltraMsgConfig(targetInstanceId);
        if (!config) return;

        await sendUltraMsgPresence(config.instanceId, config.token, cleanPhone, status);
    } catch (e) {
        // Presence is best-effort — never block message delivery
    }
};
