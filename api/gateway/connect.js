/**
 * POST /api/gateway/connect  — Initiate WhatsApp connection via Baileys
 * GET  /api/gateway/connect?instanceId=xxx — Poll current state/QR
 *
 * Architecture for Vercel serverless:
 * 1. POST: Start Baileys, wait up to 30s for QR, respond immediately with QR.
 *    Then keep running in background (Vercel allows this up to maxDuration) to
 *    catch the connection.update 'open' event AFTER the user scans the QR.
 * 2. GET: Returns current state + QR from Redis (for frontend polling every 3s).
 *
 * This solves the "QR shows but doesn't connect" problem by ensuring the
 * Baileys socket stays alive after the HTTP response is sent.
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
        // ── GET: Poll state/QR (called by frontend every 3s) ─────────────────
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

        // ── POST: Start connection ─────────────────────────────────────────────
        if (req.method === 'POST') {
            const { instanceId } = req.body || {};
            if (!instanceId) return res.status(400).json({ success: false, error: 'instanceId requerido.' });

            const instance = await getInstance(instanceId);
            if (!instance) return res.status(404).json({ success: false, error: 'Instancia no encontrada.' });

            // Already connected
            if (instance.state === GW_STATE.CONNECTED) {
                return res.status(200).json({
                    success: true,
                    state: GW_STATE.CONNECTED,
                    phone: instance.phone
                });
            }

            await updateInstance(instanceId, { state: GW_STATE.QR_PENDING });
            await clearAuthState(instanceId);
            await clearQR(instanceId);

            // ── Start Baileys and wait for QR (up to 30s) ─────────────────────
            let resolveQR, resolveConn;
            const qrPromise = new Promise(r => { resolveQR = r; });
            const connPromise = new Promise(r => { resolveConn = r; });

            _startBaileys(instanceId, instance.webhookUrl, resolveQR, resolveConn);

            // Wait for QR (max 30s)
            const qrData = await Promise.race([
                qrPromise,
                new Promise(r => setTimeout(() => r(null), 30000))
            ]);

            if (!qrData) {
                // Check if we connected without QR (existing session)
                const fresh = await getInstance(instanceId);
                if (fresh?.state === GW_STATE.CONNECTED) {
                    return res.status(200).json({
                        success: true, state: GW_STATE.CONNECTED, phone: fresh.phone
                    });
                }
                return res.status(504).json({ success: false, error: 'No se pudo generar el QR. Intenta de nuevo.' });
            }

            // ── Send QR to frontend immediately ───────────────────────────────
            res.status(200).json({
                success: true,
                state: GW_STATE.QR_PENDING,
                qr: qrData,
                message: 'Escanea el QR con WhatsApp.'
            });

            // ── Keep running in background to catch the post-scan connection ──
            // Vercel Node.js runtime continues executing after res.json() up to maxDuration
            await Promise.race([
                connPromise,
                new Promise(r => setTimeout(r, 28000)) // 28s more (~58s total)
            ]);

            return; // Function ends gracefully
        }

        return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    } catch (err) {
        console.error('[GATEWAY /connect]', err.message, err.stack);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
}

// ─── Start Baileys, call resolveQR when QR is ready, resolveConn when connected ──
async function _startBaileys(instanceId, webhookUrl, resolveQR, resolveConn) {
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
            browser: ['Candidatic', 'Chrome', '120.0'],
            syncFullHistory: false,
            connectTimeoutMs: 25000,
            keepAliveIntervalMs: 8000,
            retryRequestDelayMs: 2000,
            defaultQueryTimeoutMs: 20000
        });

        socket.ev.on('creds.update', saveCreds);

        socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

            // QR received → store in Redis, resolve for immediate response
            if (qr) {
                try {
                    const base64 = await storeQR(instanceId, qr);
                    await updateInstance(instanceId, { state: GW_STATE.QR_PENDING });
                    resolveQR(base64); // Allows POST to respond with QR
                } catch (e) {
                    console.error('[GATEWAY] storeQR error:', e.message);
                    resolveQR(null);
                }
            }

            // Connected (user scanned) 🎉
            if (connection === 'open') {
                const phone = socket.user?.id?.split(':')[0] || null;
                await updateInstance(instanceId, {
                    state: GW_STATE.CONNECTED,
                    phone,
                    connectedAt: new Date().toISOString()
                }).catch(() => {});

                resolveConn({ connected: true, phone });

                // Start listening for incoming messages
                _listenForMessages(socket, instanceId, webhookUrl, saveCreds);
            }

            // Connection closed
            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                await updateInstance(instanceId, {
                    state: code === DisconnectReason.loggedOut ? GW_STATE.DISCONNECTED : GW_STATE.QR_PENDING,
                    ...(code === DisconnectReason.loggedOut ? { phone: null } : {})
                }).catch(() => {});
                resolveConn({ connected: false });
            }
        });

    } catch (err) {
        console.error('[GATEWAY] _startBaileys error:', err.message);
        resolveQR(null);
        resolveConn({ connected: false });
    }
}

// ─── Listen for incoming messages once connected ───────────────────────────────
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
