/**
 * POST /api/gateway/connect  — Initiate Baileys connection, WAITS for QR before returning
 * GET  /api/gateway/connect?instanceId=xxx — Poll current state/QR
 *
 * Key fix: POST now awaits QR generation (up to 45s) before responding.
 * This prevents Vercel from killing the process before Baileys emits the QR.
 */

import {
    getInstance, updateInstance, storeQR, getQR,
    makeRedisAuthState, saveMessageToHistory,
    GW_STATE
} from './session-engine.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // ── GET: Poll current QR / state ──────────────────────────────────────
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

        // ── POST: Start connection and WAIT for QR ────────────────────────────
        if (req.method === 'POST') {
            const { instanceId } = req.body || {};
            if (!instanceId) {
                return res.status(400).json({ success: false, error: 'instanceId requerido.' });
            }

            const instance = await getInstance(instanceId);
            if (!instance) return res.status(404).json({ success: false, error: 'Instancia no encontrada.' });

            if (instance.state === GW_STATE.CONNECTED) {
                return res.status(200).json({
                    success: true,
                    message: 'Ya conectado.',
                    state: GW_STATE.CONNECTED,
                    phone: instance.phone
                });
            }

            await updateInstance(instanceId, { state: GW_STATE.QR_PENDING });

            // ── Start Baileys and WAIT for QR up to 45 seconds ───────────────
            const qrBase64 = await _startAndWaitForQR(instanceId, instance.webhookUrl);

            if (!qrBase64) {
                // Check if we connected without QR (existing session)
                const updated = await getInstance(instanceId);
                if (updated?.state === GW_STATE.CONNECTED) {
                    return res.status(200).json({
                        success: true,
                        state: GW_STATE.CONNECTED,
                        phone: updated.phone
                    });
                }
                return res.status(504).json({
                    success: false,
                    error: 'Timeout generando QR. Intenta de nuevo.',
                });
            }

            return res.status(200).json({
                success: true,
                state: GW_STATE.QR_PENDING,
                qr: qrBase64,
                message: 'Escanea el QR con WhatsApp. Expira en 60 segundos.'
            });
        }

        return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    } catch (err) {
        console.error('[GATEWAY /connect]', err.message, err.stack);
        return res.status(500).json({ success: false, error: err.message });
    }
}

// ─── Start Baileys and return QR Promise ─────────────────────────────────────

async function _startAndWaitForQR(instanceId, webhookUrl) {
    return new Promise(async (resolve) => {
        const timeout = setTimeout(() => resolve(null), 45000);

        try {
            const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = await import('@whiskeysockets/baileys');
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
                keepAliveIntervalMs: 10000,
                retryRequestDelayMs: 2000
            });

            socket.ev.on('creds.update', saveCreds);

            socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

                // ── QR received → store and resolve ──────────────────────────
                if (qr) {
                    try {
                        const base64 = await storeQR(instanceId, qr);
                        clearTimeout(timeout);

                        // Keep socket alive in background for when user scans
                        _keepSocketAlive(socket, instanceId, webhookUrl, saveCreds);

                        resolve(base64);
                    } catch (e) {
                        console.error('[GATEWAY] storeQR error:', e.message);
                        resolve(null);
                    }
                }

                // ── Connection opened (existing session restored) ─────────────
                if (connection === 'open') {
                    const phone = socket.user?.id?.split(':')[0] || null;
                    await updateInstance(instanceId, {
                        state: GW_STATE.CONNECTED,
                        phone,
                        connectedAt: new Date().toISOString()
                    });
                    clearTimeout(timeout);
                    resolve(null); // No QR needed — already connected
                }

                // ── Connection closed ─────────────────────────────────────────
                if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    if (code !== DisconnectReason.loggedOut) {
                        await updateInstance(instanceId, { state: GW_STATE.QR_PENDING });
                    } else {
                        await updateInstance(instanceId, { state: GW_STATE.DISCONNECTED, phone: null });
                    }
                    clearTimeout(timeout);
                    resolve(null);
                }
            });

        } catch (err) {
            console.error('[GATEWAY] _startAndWaitForQR error:', err.message);
            clearTimeout(timeout);
            resolve(null);
        }
    });
}

// ─── Keep socket alive in background for post-scan events ────────────────────

function _keepSocketAlive(socket, instanceId, webhookUrl, saveCreds) {
    socket.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            const phone = socket.user?.id?.split(':')[0] || null;
            await updateInstance(instanceId, {
                state: GW_STATE.CONNECTED, phone, connectedAt: new Date().toISOString()
            }).catch(() => {});
        }
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            await updateInstance(instanceId, {
                state: code !== 401 ? GW_STATE.QR_PENDING : GW_STATE.DISCONNECTED
            }).catch(() => {});
        }
    });

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
                    await updateInstance(instanceId, { messagesIn: (inst.messagesIn || 0) + 1 }).catch(() => {});
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
