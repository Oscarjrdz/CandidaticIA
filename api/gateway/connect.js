/**
 * POST /api/gateway/connect  — Initiate Baileys connection (generates QR)
 * GET  /api/gateway/connect?instanceId=xxx — Get current QR (base64 PNG)
 *
 * Flow:
 *  1. POST triggers Baileys socket init
 *  2. Baileys emits QR → stored in Redis (gateway:qr:{id}) with 60s TTL
 *  3. Frontend polls GET every 5s to refresh the QR image
 *  4. On successful scan → state becomes CONNECTED, phone stored
 */

import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import {
    getInstance, updateInstance, storeQR, getQR,
    makeRedisAuthState, validateToken, saveMessageToHistory,
    GW_STATE
} from './session-engine.js';

const activeSockets = {}; // In-memory map for this serverless invocation

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // ── GET QR ────────────────────────────────────────────────────────────
        if (req.method === 'GET') {
            const { instanceId } = req.query;
            if (!instanceId) return res.status(400).json({ success: false, error: 'instanceId requerido.' });

            const instance = await getInstance(instanceId);
            if (!instance) return res.status(404).json({ success: false, error: 'Instancia no encontrada.' });

            const qr = await getQR(instanceId);
            return res.status(200).json({
                success: true,
                state: instance.state,
                qr: qr || null,
                phone: instance.phone || null
            });
        }

        // ── CONNECT ───────────────────────────────────────────────────────────
        if (req.method === 'POST') {
            const { instanceId, token } = req.body || {};
            if (!instanceId || !token) {
                return res.status(400).json({ success: false, error: 'instanceId y token requeridos.' });
            }

            const valid = await validateToken(instanceId, token);
            if (!valid) return res.status(401).json({ success: false, error: 'Token inválido.' });

            const instance = await getInstance(instanceId);
            if (!instance) return res.status(404).json({ success: false, error: 'Instancia no encontrada.' });

            if (instance.state === GW_STATE.CONNECTED) {
                return res.status(200).json({ success: true, message: 'Ya conectado.', state: GW_STATE.CONNECTED });
            }

            // Update state immediately so frontend knows connection is starting
            await updateInstance(instanceId, { state: GW_STATE.QR_PENDING });

            // Fire-and-forget: Baileys connects async. Frontend polls GET /connect for QR.
            _startBaileysSession(instanceId, instance.webhookUrl).catch(e => {
                console.error(`[GATEWAY] Baileys error on ${instanceId}:`, e.message);
            });

            return res.status(200).json({
                success: true,
                message: 'Iniciando conexión. Escanea el QR en los próximos 60 segundos.',
                state: GW_STATE.QR_PENDING
            });
        }

        return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    } catch (err) {
        console.error('[GATEWAY /connect]', err.message);
        return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
}

// ─── Baileys Session (private) ────────────────────────────────────────────────

async function _startBaileysSession(instanceId, webhookUrl) {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await makeRedisAuthState(instanceId);

    const socket = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, console)
        },
        printQRInTerminal: false,
        browser: ['Candidatic Gateway', 'Chrome', '1.0.0'],
        syncFullHistory: false
    });

    activeSockets[instanceId] = socket;

    // ── QR Event ──────────────────────────────────────────────────────────────
    socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log(`[GATEWAY:${instanceId}] QR generado`);
            await storeQR(instanceId, qr);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`[GATEWAY:${instanceId}] Conexión cerrada. Reconectar: ${shouldReconnect}`);
            await updateInstance(instanceId, {
                state: shouldReconnect ? GW_STATE.QR_PENDING : GW_STATE.DISCONNECTED
            });
            delete activeSockets[instanceId];
            if (shouldReconnect) {
                setTimeout(() => _startBaileysSession(instanceId, webhookUrl), 3000);
            }
        }

        if (connection === 'open') {
            const phone = socket.user?.id?.split(':')[0] || null;
            console.log(`[GATEWAY:${instanceId}] ✅ Conectado. Número: ${phone}`);
            await updateInstance(instanceId, {
                state: GW_STATE.CONNECTED,
                phone,
                connectedAt: new Date().toISOString()
            });
        }
    });

    // ── Save Credentials on Update ────────────────────────────────────────────
    socket.ev.on('creds.update', saveCreds);

    // ── Incoming Messages → Forward to Webhook ────────────────────────────────
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.key?.fromMe && msg.message) {
                const from = msg.key.remoteJid;
                const body = msg.message?.conversation
                    || msg.message?.extendedTextMessage?.text
                    || '[Media]';

                // Save to history
                await saveMessageToHistory(instanceId, {
                    direction: 'in',
                    from,
                    body,
                    msgId: msg.key.id
                });

                // Increment counter
                const instance = await getInstance(instanceId);
                if (instance) {
                    await updateInstance(instanceId, { messagesIn: (instance.messagesIn || 0) + 1 });
                }

                // Forward to webhook if configured
                if (webhookUrl) {
                    try {
                        const { default: axios } = await import('axios');
                        await axios.post(webhookUrl, {
                            instanceId,
                            event: 'message.received',
                            data: {
                                from,
                                body,
                                msgId: msg.key.id,
                                timestamp: new Date().toISOString()
                            }
                        }, { timeout: 10000 });
                    } catch (e) {
                        console.warn(`[GATEWAY:${instanceId}] Webhook failed:`, e.message);
                    }
                }
            }
        }
    });

    return socket;
}
