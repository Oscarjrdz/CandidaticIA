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

        // ═══ LAZY TATTOO: Reroute if instance switch is active ═══
        // When the switch is ON and this candidate's instance matches the dead one,
        // reroute to the destination instance and permanently tattoo the candidate.
        // "Candidato que contacto, candidato que tatúo."
        if (targetInstanceId) {
            try {
                const redis = getRedisClient();
                if (redis) {
                    const switchActive = await redis.get('instance_switch_active');
                    if (switchActive === 'true') {
                        const switchFrom = await redis.get('instance_switch_from');
                        const switchTo = await redis.get('instance_switch_to');
                        const normalize = (id) => String(id || '').replace(/^instance/, '');

                        if (switchTo && normalize(targetInstanceId) === normalize(switchFrom)) {
                            console.log(`[LAZY-TATTOO] 🔄 Rerouting ${phone}: ${targetInstanceId} → ${switchTo}`);
                            targetInstanceId = switchTo;

                            // TATTOO: Persist permanently (fire-and-forget, non-blocking)
                            redis.set(`candidate_instance:${phone}`, switchTo, 'EX', 7776000).catch(() => {});

                            // Also tattoo the candidate hash so chat.js, cron, etc. respect it
                            try {
                                const { getCandidateIdByPhone, updateCandidate } = await import('./storage.js');
                                const candId = await getCandidateIdByPhone(phone);
                                if (candId) {
                                    updateCandidate(candId, {
                                        instanceId: switchTo,
                                        instanceTattoo: true
                                    }).catch(() => {});
                                }
                            } catch (e) { /* non-critical */ }

                            // Increment tattoo counter for dashboard visibility
                            redis.incr('instance_switch_tattoo_count').catch(() => {});
                        }
                    }
                }
            } catch (e) { /* non-critical — proceed with original instance */ }
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
