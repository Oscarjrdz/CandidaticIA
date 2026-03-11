/**
 * POST /api/gateway/connect  — Start Baileys session, stays alive until CONNECTED or timeout
 * GET  /api/gateway/connect?instanceId=xxx — Poll current state/QR (for frontend)
 *
 * Key architecture:
 * - POST keeps the Vercel function alive (up to 55s) until WhatsApp auth completes.
 *   It stores the QR in Redis as soon as Baileys emits it, then keeps waiting for CONNECTED.
 * - Frontend calls POST (async, no await on result), then polls GET every 3s to show QR.
 *   When GET returns CONNECTED, the frontend shows the success screen.
 * - This prevents Vercel from killing the socket before the user has scanned the QR.
 */

import {
    getInstance, updateInstance, storeQR, getQR, clearQR, clearAuthState,
    makeRedisAuthState, saveMessageToHistory,
    GW_STATE
} from './session-engine.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // ── GET: Poll current QR / state (called by frontend every 3s) ─────────
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

        // ── POST: Start Baileys — stays alive until CONNECTED or 55s timeout ───
        if (req.method === 'POST') {
            const { instanceId } = req.body || {};
            if (!instanceId) {
                return res.status(400).json({ success: false, error: 'instanceId requerido.' });
            }

            const instance = await getInstance(instanceId);
            if (!instance) return res.status(404).json({ success: false, error: 'Instancia no encontrada.' });

            // Already connected — nothing to do
            if (instance.state === GW_STATE.CONNECTED) {
                return res.status(200).json({
                    success: true,
                    state: GW_STATE.CONNECTED,
                    phone: instance.phone
                });
            }

            await updateInstance(instanceId, { state: GW_STATE.QR_PENDING });

            // Clear stale credentials so Baileys generates a fresh QR
            await clearAuthState(instanceId);
            await clearQR(instanceId);

            // Wait for CONNECTED (or timeout at 55s)
            const result = await _connectAndWait(instanceId, instance.webhookUrl);

            if (result.connected) {
                return res.status(200).json({
                    success: true,
                    state: GW_STATE.CONNECTED,
                    phone: result.phone,
                    message: '¡Número vinculado exitosamente!'
                });
            }

            // Check if QR was at least generated (user can poll GET for it)
            const qr = await getQR(instanceId);
            if (qr) {
                return res.status(200).json({
                    success: true,
                    state: GW_STATE.QR_PENDING,
                    qr,
                    message: 'Escanea el QR con WhatsApp. Sigue el estado con el botón Actualizar.'
                });
            }

            return res.status(504).json({
                success: false,
                error: 'Timeout: No se pudo generar el QR. Intenta de nuevo.'
            });
        }

        return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    } catch (err) {
        console.error('[GATEWAY /connect]', err.message, err.stack);
        return res.status(500).json({ success: false, error: err.message });
    }
}

// ─── Connect Baileys and wait up to 55s for CONNECTED ─────────────────────────
async function _connectAndWait(instanceId, webhookUrl) {
    return new Promise(async (resolve) => {
        // Resolve after 55s no matter what (Vercel max 60s)
        const timeout = setTimeout(() => resolve({ connected: false }), 55000);

        try {
            const {
                default: makeWASocket,
                DisconnectReason,
                fetchLatestBaileysVersion,
                makeCacheableSignalKeyStore
            } = await import('@whiskeysockets/baileys');

            const { version } = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await makeRedisAuthState(instanceId);

            const socket = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, { level: () => {} })
                },
                printQRInTerminal: false,
                browser: ['Candidatic Gateway', 'Chrome', '120.0'],
                syncFullHistory: false,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 8000,
                retryRequestDelayMs: 2000
            });

            socket.ev.on('creds.update', saveCreds);

            socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

                // QR generated → store in Redis so frontend can poll it via GET
                if (qr) {
                    try {
                        await storeQR(instanceId, qr);
                        await updateInstance(instanceId, { state: GW_STATE.QR_PENDING });
                        // DON'T resolve here — keep socket alive for the scan!
                    } catch (e) {
                        console.error('[GATEWAY] storeQR error:', e.message);
                    }
                }

                // Connection established (user scanned QR) 🎉
                if (connection === 'open') {
                    const phone = socket.user?.id?.split(':')[0] || null;
                    await updateInstance(instanceId, {
                        state: GW_STATE.CONNECTED,
                        phone,
                        connectedAt: new Date().toISOString()
                    }).catch(() => {});

                    clearTimeout(timeout);

                    // Start listening for incoming messages in background
                    _listenForMessages(socket, instanceId, webhookUrl, saveCreds);

                    resolve({ connected: true, phone });
                }

                // Connection closed before CONNECTED
                if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    const isLoggedOut = code === DisconnectReason.loggedOut;

                    await updateInstance(instanceId, {
                        state: isLoggedOut ? GW_STATE.DISCONNECTED : GW_STATE.QR_PENDING,
                        ...(isLoggedOut ? { phone: null } : {})
                    }).catch(() => {});

                    clearTimeout(timeout);
                    resolve({ connected: false });
                }
            });

        } catch (err) {
            console.error('[GATEWAY] _connectAndWait error:', err.message);
            clearTimeout(timeout);
            resolve({ connected: false });
        }
    });
}

// ─── Keep listening for messages after CONNECTED ───────────────────────────────
// This runs inside the same Vercel function invocation (after resolve, before function exits)
function _listenForMessages(socket, instanceId, webhookUrl, saveCreds) {
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.key?.fromMe && msg.message) {
                const from = msg.key.remoteJid;
                const body = msg.message?.conversation
                    || msg.message?.extendedTextMessage?.text
                    || '[Media]';

                await saveMessageToHistory(instanceId, {
                    direction: 'in', from, body, msgId: msg.key.id
                }).catch(() => {});

                const inst = await getInstance(instanceId).catch(() => null);
                if (inst) {
                    await updateInstance(instanceId, {
                        messagesIn: (inst.messagesIn || 0) + 1
                    }).catch(() => {});
                }

                if (webhookUrl) {
                    try {
                        const { default: axios } = await import('axios');
                        await axios.post(webhookUrl, {
                            instanceId, event: 'message.received',
                            data: { from, body, msgId: msg.key.id, timestamp: new Date().toISOString() }
                        }, { timeout: 8000 });
                    } catch (e) {
                        console.warn(`[GATEWAY:${instanceId}] Webhook failed:`, e.message);
                    }
                }
            }
        }
    });
}
