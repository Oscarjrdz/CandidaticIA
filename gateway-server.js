/**
 * gateway-server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Persistent Express server for Railway deployment.
 * Runs Baileys WhatsApp sessions 24/7 and exposes REST API for the
 * Candidatic dashboard and bot to control instances.
 *
 * Endpoints:
 *   GET    /health                      — health check
 *   GET    /instances                   — list all instances
 *   POST   /instances                   — create instance
 *   DELETE /instances/:instanceId       — delete instance
 *   PATCH  /instances/:instanceId       — update webhook url / name
 *   POST   /connect/:instanceId         — connect / get QR
 *   GET    /qr/:instanceId              — poll QR + state
 *   POST   /send/:instanceId            — send message
 *   GET    /status/:instanceId          — get instance status
 *   GET    /history/:instanceId         — message history
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import qrcode from 'qrcode';
import IORedis from 'ioredis';

// ─── Redis ────────────────────────────────────────────────────────────────────
const redis = new IORedis(process.env.REDIS_URL || '', {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
});

// ─── Constants ────────────────────────────────────────────────────────────────
const SESSION_TTL = 60 * 60 * 24 * 30;   // 30 days
const QR_TTL      = 60;                   // 60 s
const HISTORY_CAP = 200;
const CANDIDATIC_WEBHOOK = process.env.CANDIDATIC_WEBHOOK_URL || '';

// ─── App ─────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ─── Instance helpers ─────────────────────────────────────────────────────────
async function createInstance({ name, webhookUrl }) {
    const instanceId = `gw_${crypto.randomBytes(6).toString('hex')}`;
    const token = crypto.randomBytes(32).toString('hex');
    const obj = {
        instanceId, token, name: name.trim(),
        webhookUrl: webhookUrl?.trim() || '',
        createdAt: new Date().toISOString(),
        state: 'DISCONNECTED', phone: null,
        messagesIn: 0, messagesOut: 0,
    };
    await redis.set(`gateway:instance:${instanceId}`, JSON.stringify(obj), 'EX', SESSION_TTL);
    await redis.lpush('gateway:instances', instanceId);
    return obj;
}

async function getInstance(instanceId) {
    const raw = await redis.get(`gateway:instance:${instanceId}`);
    return raw ? JSON.parse(raw) : null;
}

async function getAllInstances() {
    const ids = await redis.lrange('gateway:instances', 0, -1);
    const results = await Promise.all(ids.map(id => getInstance(id).catch(() => null)));
    return results.filter(Boolean);
}

async function updateInstance(instanceId, updates) {
    const existing = await getInstance(instanceId);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    await redis.set(`gateway:instance:${instanceId}`, JSON.stringify(updated), 'EX', SESSION_TTL);
    return updated;
}

async function deleteInstanceData(instanceId) {
    const keys = await redis.keys(`gateway:auth:${instanceId}:*`);
    await Promise.all([
        redis.del(`gateway:instance:${instanceId}`),
        redis.del(`gateway:qr:${instanceId}`),
        redis.del(`gateway:history:${instanceId}`),
        redis.lrem('gateway:instances', 0, instanceId),
        ...(keys.length ? [redis.del(...keys)] : []),
    ]);
}

async function saveHistory(instanceId, entry) {
    await redis.lpush(`gateway:history:${instanceId}`, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }));
    await redis.ltrim(`gateway:history:${instanceId}`, 0, HISTORY_CAP - 1);
}

// Auth state for Baileys stored in Redis
async function makeRedisAuthState(instanceId) {
    const KEY = `gateway:auth:${instanceId}`;
    const read  = async (k) => { const v = await redis.get(`${KEY}:${k}`); return v ? JSON.parse(v) : null; };
    const write = async (k, d) => redis.set(`${KEY}:${k}`, JSON.stringify(d), 'EX', SESSION_TTL);
    const remove = async (k) => redis.del(`${KEY}:${k}`);

    const { initAuthCreds, proto } = await import('@whiskeysockets/baileys');
    let creds = await read('creds');
    if (!creds) creds = initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async id => {
                        let v = await read(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
                        data[id] = v;
                    }));
                    return data;
                },
                set: async (d) => {
                    const tasks = [];
                    for (const cat in d) for (const id in d[cat])
                        tasks.push(d[cat][id] ? write(`${cat}-${id}`, d[cat][id]) : remove(`${cat}-${id}`));
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => write('creds', creds)
    };
}

// ─── Active sockets map ───────────────────────────────────────────────────────
const activeSockets = new Map();
// pendingQR: instanceId → { resolveQR, rejectQR } so connect endpoint is notified immediately
const pendingQR = new Map();

// Stable fallback Baileys version in case fetch fails
const BAILEYS_VERSION_FALLBACK = [2, 3000, 1017531287];

async function getBaileysVersion() {
    try {
        const { fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');
        const result = await Promise.race([
            fetchLatestBaileysVersion(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
        ]);
        console.log(`[GW] Baileys version: ${result.version}`);
        return result.version;
    } catch {
        console.warn('[GW] fetchLatestBaileysVersion failed, using fallback version');
        return BAILEYS_VERSION_FALLBACK;
    }
}

async function startBaileys(instanceId, webhookUrl) {
    if (activeSockets.has(instanceId)) {
        console.log(`[GW] Socket already active for ${instanceId}`);
        // If a connect endpoint is waiting, resolve with existing state
        const fresh = await getInstance(instanceId);
        const pending = pendingQR.get(instanceId);
        if (pending && fresh?.state === 'CONNECTED') { pending.resolveQR({ connected: true, phone: fresh.phone }); pendingQR.delete(instanceId); }
        return;
    }

    try {
        const {
            default: makeWASocket,
            DisconnectReason,
            makeCacheableSignalKeyStore
        } = await import('@whiskeysockets/baileys');

        const version = await getBaileysVersion();
        const { state, saveCreds } = await makeRedisAuthState(instanceId);

        const socket = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, { level: () => {} })
            },
            printQRInTerminal: true,
            browser: ['Candidatic Gateway', 'Chrome', '120.0'],
            syncFullHistory: false,
            connectTimeoutMs: 40000,
            keepAliveIntervalMs: 15000,
            defaultQueryTimeoutMs: 30000,
        });

        activeSockets.set(instanceId, socket);
        socket.ev.on('creds.update', saveCreds);

        socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (qr) {
                try {
                    const base64 = await qrcode.toDataURL(qr, { width: 256, margin: 2 });
                    await redis.set(`gateway:qr:${instanceId}`, base64, 'EX', QR_TTL);
                    await updateInstance(instanceId, { state: 'QR_PENDING' });
                    console.log(`[GW:${instanceId}] 📱 QR generated and stored in Redis`);
                    // Signal any waiting connect endpoint
                    const pending = pendingQR.get(instanceId);
                    if (pending) { pending.resolveQR({ qr: base64 }); pendingQR.delete(instanceId); }
                } catch (e) {
                    console.error(`[GW:${instanceId}] QR error:`, e.message);
                    const pending = pendingQR.get(instanceId);
                    if (pending) { pending.rejectQR(e); pendingQR.delete(instanceId); }
                }
            }

            if (connection === 'open') {
                const phone = socket.user?.id?.split(':')[0] || null;
                await updateInstance(instanceId, { state: 'CONNECTED', phone, connectedAt: new Date().toISOString() });
                await redis.del(`gateway:qr:${instanceId}`);
                console.log(`[GW:${instanceId}] ✅ Connected — ${phone}`);
                // Signal if still pending (connected without QR scan — session resumed)
                const pending = pendingQR.get(instanceId);
                if (pending) { pending.resolveQR({ connected: true, phone }); pendingQR.delete(instanceId); }
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = code === DisconnectReason.loggedOut;
                // Only act if THIS socket is still the current active one
                // (avoids stale close events from dead sockets polluting pendingQR)
                const isCurrentSocket = activeSockets.get(instanceId) === socket;
                if (!isCurrentSocket) {
                    console.log(`[GW:${instanceId}] Stale socket closed, ignoring`);
                    return;
                }
                await updateInstance(instanceId, {
                    state: loggedOut ? 'DISCONNECTED' : 'QR_PENDING',
                    ...(loggedOut ? { phone: null } : {})
                });
                activeSockets.delete(instanceId);
                console.log(`[GW:${instanceId}] ❌ Closed (code ${code}). loggedOut=${loggedOut}`);
                const pending = pendingQR.get(instanceId);
                if (pending) { pending.rejectQR(new Error(`Connection closed (code ${code})`)); pendingQR.delete(instanceId); }
                if (!loggedOut) {
                    console.log(`[GW:${instanceId}] 🔄 Reconnecting in 5s...`);
                    setTimeout(() => startBaileys(instanceId, webhookUrl).catch(console.error), 5000);
                }
            }
        });

        // Incoming messages
        socket.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                if (msg.key?.fromMe || !msg.message) continue;
                const from = msg.key.remoteJid;
                const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[Media]';
                await saveHistory(instanceId, { direction: 'in', from, body, msgId: msg.key.id });
                const inst = await getInstance(instanceId);
                if (inst) await updateInstance(instanceId, { messagesIn: (inst.messagesIn || 0) + 1 });

                const wh = webhookUrl || inst?.webhookUrl || CANDIDATIC_WEBHOOK;
                if (wh) {
                    try {
                        const { default: axios } = await import('axios');
                        await axios.post(wh, {
                            instanceId, event: 'message.received',
                            data: { from, body, msgId: msg.key.id, timestamp: new Date().toISOString() }
                        }, { timeout: 10000 });
                    } catch (e) {
                        console.warn(`[GW:${instanceId}] Webhook failed:`, e.message);
                    }
                }
            }
        });

    } catch (err) {
        console.error(`[GW:${instanceId}] startBaileys error:`, err.message, err.stack);
        activeSockets.delete(instanceId);
        const pending = pendingQR.get(instanceId);
        if (pending) { pending.rejectQR(err); pendingQR.delete(instanceId); }
    }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => res.json({ ok: true, sockets: activeSockets.size }));

// Diagnostics — test if Railway can reach WhatsApp servers
app.get('/diag', async (_, res) => {
    const results = {};
    try {
        const { fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');
        const { version } = await Promise.race([
            fetchLatestBaileysVersion(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout after 8s')), 8000))
        ]);
        results.baileysVersion = version;
        results.baileysVersionOk = true;
    } catch (e) {
        results.baileysVersionOk = false;
        results.baileysVersionError = e.message;
    }
    try {
        const { default: axios } = await import('axios');
        const r = await axios.get('https://web.whatsapp.com/', { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        results.whatsappReachable = r.status === 200;
    } catch (e) {
        results.whatsappReachable = false;
        results.whatsappError = e.message;
    }
    results.sockets = activeSockets.size;
    results.env = { redis: !!process.env.REDIS_URL, webhook: !!process.env.CANDIDATIC_WEBHOOK_URL };
    res.json(results);
});

// List instances
app.get('/instances', async (req, res) => {
    const instances = await getAllInstances();
    const safe = instances.map(i => ({ ...i, token: i.token ? `${i.token.substring(0, 8)}••••` : null }));
    res.json({ success: true, instances: safe });
});

// Create instance
app.post('/instances', async (req, res) => {
    const { name, webhookUrl } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required.' });
    const instance = await createInstance({ name, webhookUrl });
    res.status(201).json({ success: true, instance });
});

// Delete instance
app.delete('/instances/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const existing = await getInstance(instanceId);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found.' });
    const socket = activeSockets.get(instanceId);
    if (socket) { try { await socket.end(); } catch {} activeSockets.delete(instanceId); }
    await deleteInstanceData(instanceId);
    res.json({ success: true });
});

// Update webhook / name
app.patch('/instances/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const { webhookUrl, name } = req.body || {};
    const updates = {};
    if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl.trim();
    if (name?.trim()) updates.name = name.trim();
    const updated = await updateInstance(instanceId, updates);
    if (!updated) return res.status(404).json({ success: false, error: 'Not found.' });
    res.json({ success: true, instance: { ...updated, token: `${updated.token.substring(0, 8)}••••` } });
});

// Connect — start socket + return QR (promise-based, no polling)
app.post('/connect/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const instance = await getInstance(instanceId);
    if (!instance) return res.status(404).json({ success: false, error: 'Not found.' });

    if (instance.state === 'CONNECTED' && activeSockets.has(instanceId)) {
        return res.json({ success: true, state: 'CONNECTED', phone: instance.phone });
    }

    // Clear stale auth so WhatsApp always sees a fresh QR session
    try {
        const authKeys = await redis.keys(`gateway:auth:${instanceId}:*`);
        if (authKeys.length) await redis.del(...authKeys);
        await redis.del(`gateway:qr:${instanceId}`);
        console.log(`[GW:${instanceId}] Auth state cleared for fresh QR`);
    } catch (e) {
        console.warn(`[GW:${instanceId}] Could not clear auth:`, e.message);
    }

    // Remove stale socket reference WITHOUT calling .end() — calling end() fires an async
    // close event that would race with the new pendingQR we're about to register.
    activeSockets.delete(instanceId);

    // Promise that resolves when Baileys emits QR or 'open'
    const qrPromise = new Promise((resolveQR, rejectQR) => {
        pendingQR.set(instanceId, { resolveQR, rejectQR });
    });

    // Start Baileys (non-blocking)
    startBaileys(instanceId, instance.webhookUrl).catch(err => {
        const pending = pendingQR.get(instanceId);
        if (pending) { pending.rejectQR(err); pendingQR.delete(instanceId); }
    });

    try {
        const result = await Promise.race([
            qrPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('QR timeout after 45s')), 45000))
        ]);
        if (result.connected) {
            return res.json({ success: true, state: 'CONNECTED', phone: result.phone });
        }
        return res.json({ success: true, state: 'QR_PENDING', qr: result.qr });
    } catch (err) {
        pendingQR.delete(instanceId);
        return res.status(504).json({ success: false, error: err.message || 'QR timeout — try again.' });
    }
});

// Poll QR / state (also returns pairingCode if in pairing mode)
app.get('/qr/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const instance = await getInstance(instanceId);
    if (!instance) return res.status(404).json({ success: false, error: 'Not found.' });
    const qr = await redis.get(`gateway:qr:${instanceId}`);
    const pairingCode = await redis.get(`gateway:paircode:${instanceId}`);
    res.json({ success: true, state: instance.state, qr: qr || null, pairingCode: pairingCode || null, phone: instance.phone });
});

// ─── Pairing Code — alternative to QR, works from datacenter IPs ──────────────
// WhatsApp > Linked Devices > Link with phone number > enter 8-digit code
app.post('/pair/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ success: false, error: 'phone number required (e.g. 5218112345678)' });

    const instance = await getInstance(instanceId);
    if (!instance) return res.status(404).json({ success: false, error: 'Not found.' });

    if (instance.state === 'CONNECTED' && activeSockets.has(instanceId)) {
        return res.json({ success: true, state: 'CONNECTED', phone: instance.phone });
    }

    // Clear stale auth + dead sockets
    try {
        const authKeys = await redis.keys(`gateway:auth:${instanceId}:*`);
        if (authKeys.length) await redis.del(...authKeys);
        await redis.del(`gateway:qr:${instanceId}`, `gateway:paircode:${instanceId}`);
    } catch (e) { console.warn(`[GW:${instanceId}] clear auth error:`, e.message); }
    // Remove stale reference WITHOUT calling .end() to avoid the stale close event race
    activeSockets.delete(instanceId);

    // Start Baileys in pairing-code mode (no QR printed)
    const pairPromise = new Promise((resolve, reject) => {
        pendingQR.set(instanceId, { resolveQR: resolve, rejectQR: reject });
    });

    (async () => {
        try {
            const {
                default: makeWASocket,
                DisconnectReason,
                makeCacheableSignalKeyStore
            } = await import('@whiskeysockets/baileys');
            const version = await getBaileysVersion();
            const { state, saveCreds } = await makeRedisAuthState(instanceId);

            const socket = makeWASocket({
                version,
                auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, { level: () => {} }) },
                printQRInTerminal: false,
                browser: ['Candidatic Gateway', 'Chrome', '120.0'],
                syncFullHistory: false,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 15000,
            });

            activeSockets.set(instanceId, socket);
            socket.ev.on('creds.update', saveCreds);

            socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
                // Ignore QR — we only want pairing code
                if (connection === 'open') {
                    const ph = socket.user?.id?.split(':')[0] || null;
                    await updateInstance(instanceId, { state: 'CONNECTED', phone: ph, connectedAt: new Date().toISOString() });
                    await redis.del(`gateway:paircode:${instanceId}`);
                    console.log(`[GW:${instanceId}] ✅ Paired! Connected as ${ph}`);
                    const pending = pendingQR.get(instanceId);
                    if (pending) { pending.resolveQR({ connected: true, phone: ph }); pendingQR.delete(instanceId); }
                    _listenMessages(socket, instanceId, instance.webhookUrl);
                }
                if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    const loggedOut = code === DisconnectReason.loggedOut;
                    // Identity check — only act if this socket is still the current one
                    if (activeSockets.get(instanceId) !== socket) return;
                    await updateInstance(instanceId, { state: loggedOut ? 'DISCONNECTED' : 'ERROR' });
                    activeSockets.delete(instanceId);
                    const pending = pendingQR.get(instanceId);
                    if (pending) { pending.rejectQR(new Error(`Pairing failed (code ${code})`)); pendingQR.delete(instanceId); }
                }
            });

            // Request pairing code — wait until socket is ready
            await new Promise(r => setTimeout(r, 3000));
            const cleanPhone = String(phone).replace(/\D/g, '');
            const code = await socket.requestPairingCode(cleanPhone);
            // Format as XXXX-XXXX for readability
            const formatted = code.match(/.{1,4}/g)?.join('-') || code;
            await redis.set(`gateway:paircode:${instanceId}`, formatted, 'EX', 120);
            await updateInstance(instanceId, { state: 'QR_PENDING' });
            console.log(`[GW:${instanceId}] 🔑 Pairing code: ${formatted}`);
            const pending = pendingQR.get(instanceId);
            if (pending) { pending.resolveQR({ pairingCode: formatted }); pendingQR.delete(instanceId); }

        } catch (err) {
            console.error(`[GW:${instanceId}] pair error:`, err.message);
            activeSockets.delete(instanceId);
            const pending = pendingQR.get(instanceId);
            if (pending) { pending.rejectQR(err); pendingQR.delete(instanceId); }
        }
    })();

    try {
        const result = await Promise.race([
            pairPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Pairing code timeout (30s)')), 30000))
        ]);
        if (result.connected) return res.json({ success: true, state: 'CONNECTED', phone: result.phone });
        return res.json({ success: true, pairingCode: result.pairingCode, message: 'Ingresa este código en WhatsApp > Dispositivos vinculados > Vincular con número' });
    } catch (err) {
        pendingQR.delete(instanceId);
        return res.status(504).json({ success: false, error: err.message });
    }
});

// Internal helper: attach incoming message listener to a socket
function _listenMessages(socket, instanceId, webhookUrl) {
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (msg.key?.fromMe || !msg.message) continue;
            const from = msg.key.remoteJid;
            const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[Media]';
            await saveHistory(instanceId, { direction: 'in', from, body, msgId: msg.key.id });
            const inst = await getInstance(instanceId);
            if (inst) await updateInstance(instanceId, { messagesIn: (inst.messagesIn || 0) + 1 });
            const wh = webhookUrl || inst?.webhookUrl || CANDIDATIC_WEBHOOK;
            if (wh) {
                try {
                    const { default: axios } = await import('axios');
                    await axios.post(wh, { instanceId, event: 'message.received', data: { from, body, msgId: msg.key.id, timestamp: new Date().toISOString() } }, { timeout: 10000 });
                } catch (e) { console.warn(`[GW:${instanceId}] webhook failed:`, e.message); }
            }
        }
    });
}

// Status
app.get('/status/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const instance = await getInstance(instanceId);
    if (!instance) return res.status(404).json({ success: false, error: 'Not found.' });
    res.json({ success: true, state: instance.state, phone: instance.phone, messagesIn: instance.messagesIn, messagesOut: instance.messagesOut });
});

// History
app.get('/history/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const limit = parseInt(req.query.limit || '50');
    const raw = await redis.lrange(`gateway:history:${instanceId}`, 0, limit - 1);
    const history = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
    res.json({ success: true, history });
});

// Send message
app.post('/send/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const { to, message, type = 'text' } = req.body || {};
    if (!to || !message) return res.status(400).json({ success: false, error: 'to and message required.' });

    const socket = activeSockets.get(instanceId);
    if (!socket) return res.status(503).json({ success: false, error: 'Socket not connected. Call POST /connect first.' });

    try {
        const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        await socket.sendMessage(jid, { text: message });
        const instance = await getInstance(instanceId);
        if (instance) await updateInstance(instanceId, { messagesOut: (instance.messagesOut || 0) + 1 });
        await saveHistory(instanceId, { direction: 'out', to: jid, body: message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Boot: reconnect all previously CONNECTED instances ───────────────────────
async function boot() {
    console.log('[GW] Booting gateway server...');
    try {
        const instances = await getAllInstances();
        const toReconnect = instances.filter(i => i.state === 'CONNECTED' || i.state === 'QR_PENDING');
        console.log(`[GW] Reconnecting ${toReconnect.length} instance(s)...`);
        for (const inst of toReconnect) {
            startBaileys(inst.instanceId, inst.webhookUrl).catch(e => console.error(`[GW] Boot reconnect failed ${inst.instanceId}:`, e.message));
            await new Promise(r => setTimeout(r, 1000)); // stagger reconnects
        }
    } catch (e) {
        console.error('[GW] Boot error:', e.message);
    }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
    console.log(`[GW] 🚀 Gateway server running on port ${PORT}`);
    await boot();
});
