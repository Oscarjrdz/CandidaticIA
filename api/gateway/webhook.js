/**
 * api/gateway/webhook.js
 * ──────────────────────────────────────────────────────────────────────────
 * Receives messages FROM any Gateway instance and routes them through the
 * same bot pipeline as the UltraMsg webhook.
 *
 * KEY FEATURE: Stores `gwInstanceId` → phone mapping in Redis so that
 * when the bot sends a reply, messenger.js routes it back through the
 * correct Gateway instance number instead of UltraMsg.
 *
 * Payload sent by Gateway (connect.js _keepSocketAlive):
 * {
 *   instanceId: "gw_abc123",
 *   event: "message.received",
 *   data: { from: "521XXXXXXXXXX@c.us", body: "Hola", msgId: "...", timestamp: "..." }
 * }
 */

import {
    saveMessage,
    getCandidateIdByPhone,
    saveCandidate,
    updateCandidate,
    getRedisClient,
    isMessageProcessed,
    addToWaitlist,
    getCandidateById,
    saveWebhookTransaction,
    getUsers
} from '../utils/storage.js';
import { notifyNewCandidate } from '../utils/sse-notify.js';
import { logTelemetry } from '../utils/telemetry.js';

// Key format: gw_channel:{phone} → instanceId
export const GW_CHANNEL_KEY = (phone) => `gw_channel:${phone}`;
const GW_CHANNEL_TTL = 60 * 60 * 24 * 7; // 7 days — persist the channel preference

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const payload = req.body || {};
        const { instanceId, event, data } = payload;

        // Only handle incoming messages
        if (event !== 'message.received' || !data) {
            return res.status(200).json({ success: true, message: 'Event ignored' });
        }

        const { from, body, msgId } = data;
        if (!from || !body || !msgId) {
            return res.status(200).json({ success: true, message: 'Incomplete payload' });
        }

        // Normalize phone number
        const phone = from.replace(/[^0-9]/g, '');

        // ── Deduplication ─────────────────────────────────────────────────────
        if (await isMessageProcessed(msgId)) {
            await logTelemetry('gw_ingress_duplicate', { msgId, from, instanceId });
            return res.status(200).send('duplicate_ignored');
        }

        // ── Store gateway channel mapping ──────────────────────────────────────
        // This tells messenger.js to reply through this gateway instance
        const redis = getRedisClient();
        await redis.set(GW_CHANNEL_KEY(phone), instanceId, 'EX', GW_CHANNEL_TTL);

        await logTelemetry('gw_ingress', {
            instanceId, msgId, from,
            text: body?.substring(0, 50)
        });

        // ── Candidate lookup / creation ───────────────────────────────────────
        let candidateId = await getCandidateIdByPhone(phone);
        let candidate = null;

        if (candidateId) {
            candidate = await getCandidateById(candidateId);
            if (!candidate) candidateId = null;
        }

        if (!candidateId) {
            candidate = await saveCandidate({
                whatsapp: phone,
                nombre: data.pushname || 'Desconocido',
                origen: `gateway_${instanceId}`,
                esNuevo: 'SI',
                primerContacto: new Date().toISOString()
            });
            candidateId = candidate.id;
            notifyNewCandidate(candidate).catch(() => {});
        }

        // ── Persist message ───────────────────────────────────────────────────
        const msgToSave = {
            id: msgId, from: 'user',
            content: body, type: 'text',
            timestamp: new Date().toISOString()
        };

        await saveWebhookTransaction({
            candidateId,
            message: msgToSave,
            candidateUpdates: {
                ...candidate,
                ultimoMensaje: new Date().toISOString(),
                lastUserMessageAt: new Date().toISOString(),
                unread: true
            },
            eventData: payload,
            statsType: 'incoming'
        });

        // ── Bot AI Processing ─────────────────────────────────────────────────
        const botActive = await redis?.get('bot_ia_active');
        if (botActive !== 'false' && candidate?.blocked !== true) {
            await addToWaitlist(candidateId, { text: body, msgId });
            const { runTurboEngine } = await import('../workers/process-message.js');
            await runTurboEngine(candidateId, phone);
        }

        return res.status(200).send('success');

    } catch (err) {
        console.error('[GATEWAY WEBHOOK]', err.message, err.stack);
        return res.status(200).send('error'); // Always 200 to avoid retries
    }
}
