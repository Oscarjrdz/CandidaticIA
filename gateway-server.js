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
// instanceId → Baileys socket (kept in memory for the lifetime of the process)
const activeSockets = new Map();

async function startBaileys(instanceId, webhookUrl) {
    if (activeSockets.has(instanceId)) {
        console.log(`[GW] Socket already active for ${instanceId}`);
        return;
    }

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
            keepAliveIntervalMs: 15000,
        });

        activeSockets.set(instanceId, socket);
        socket.ev.on('creds.update', saveCreds);

        socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (qr) {
                try {
                    const base64 = await qrcode.toDataURL(qr, { width: 256, margin: 2 });
                    await redis.set(`gateway:qr:${instanceId}`, base64, 'EX', QR_TTL);
                    await updateInstance(instanceId, { state: 'QR_PENDING' });
                } catch (e) {
                    console.error(`[GW:${instanceId}] QR error:`, e.message);
                }
            }

            if (connection === 'open') {
                const phone = socket.user?.id?.split(':')[0] || null;
                await updateInstance(instanceId, { state: 'CONNECTED', phone, connectedAt: new Date().toISOString() });
                await redis.del(`gateway:qr:${instanceId}`);
                console.log(`[GW:${instanceId}] ✅ Connected — ${phone}`);
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = code === DisconnectReason.loggedOut;
                await updateInstance(instanceId, {
                    state: loggedOut ? 'DISCONNECTED' : 'QR_PENDING',
                    ...(loggedOut ? { phone: null } : {})
                });
                activeSockets.delete(instanceId);
                console.log(`[GW:${instanceId}] ❌ Closed (code ${code}). loggedOut=${loggedOut}`);
                // Auto-reconnect if not logged out
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

                // Forward to Candidatic webhook
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
        console.error(`[GW:${instanceId}] startBaileys error:`, err.message);
        activeSockets.delete(instanceId);
    }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => res.json({ ok: true, sockets: activeSockets.size }));

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

// Connect — start socket + return QR
app.post('/connect/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const instance = await getInstance(instanceId);
    if (!instance) return res.status(404).json({ success: false, error: 'Not found.' });

    if (instance.state === 'CONNECTED') {
        return res.json({ success: true, state: 'CONNECTED', phone: instance.phone });
    }

    // Start socket (async — won't block response)
    startBaileys(instanceId, instance.webhookUrl).catch(console.error);

    // Wait up to 25s for QR to appear in Redis
    let qr = null;
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const fresh = await getInstance(instanceId);
        if (fresh?.state === 'CONNECTED') {
            return res.json({ success: true, state: 'CONNECTED', phone: fresh.phone });
        }
        qr = await redis.get(`gateway:qr:${instanceId}`);
        if (qr) break;
    }

    if (!qr) return res.status(504).json({ success: false, error: 'QR timeout — try again.' });
    res.json({ success: true, state: 'QR_PENDING', qr });
});

// Poll QR / state
app.get('/qr/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const instance = await getInstance(instanceId);
    if (!instance) return res.status(404).json({ success: false, error: 'Not found.' });
    const qr = await redis.get(`gateway:qr:${instanceId}`);
    res.json({ success: true, state: instance.state, qr: qr || null, phone: instance.phone });
});

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
