/**
 * Gateway Session Engine
 * ──────────────────────────────────────────────────────────────────────────
 * Core Baileys session manager. Handles connect/disconnect/QR lifecycle.
 * Sessions are persisted in Redis so Vercel serverless can resume them.
 *
 * Architecture:
 *  - Each instance stores auth keys in Redis: gateway:auth:{instanceId}
 *  - QR code (base64 PNG) is stored in: gateway:qr:{instanceId}
 *  - Connection state in: gateway:state:{instanceId}  (DISCONNECTED | QR_PENDING | CONNECTED)
 *  - Message history in: gateway:history:{instanceId} (list, capped at 1000)
 */

import { getRedisClient } from '../utils/storage.js';
import crypto from 'crypto';
import qrcode from 'qrcode';

// ─── Constants ────────────────────────────────────────────────────────────────

export const GW_STATE = {
    DISCONNECTED: 'DISCONNECTED',
    QR_PENDING: 'QR_PENDING',
    CONNECTED: 'CONNECTED',
    ERROR: 'ERROR'
};

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days — long-lived auth
const QR_TTL = 60; // 60 seconds — QR validity window

// ─── Instance Registry ────────────────────────────────────────────────────────

export const createInstance = async ({ name, webhookUrl, createdBy }) => {
    const redis = getRedisClient();
    if (!redis) throw new Error('Redis not available');

    const instanceId = `gw_${crypto.randomBytes(6).toString('hex')}`;
    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();

    const instance = {
        instanceId,
        token,
        name: name.trim(),
        webhookUrl: webhookUrl?.trim() || '',
        createdBy: createdBy || 'admin',
        createdAt,
        state: GW_STATE.DISCONNECTED,
        phone: null,
        connectedAt: null,
        messagesIn: 0,
        messagesOut: 0
    };

    await redis.set(`gateway:instance:${instanceId}`, JSON.stringify(instance), 'EX', SESSION_TTL);
    await redis.lpush('gateway:instances', instanceId);

    return instance;
};

export const getInstance = async (instanceId) => {
    const redis = getRedisClient();
    if (!redis) return null;
    const raw = await redis.get(`gateway:instance:${instanceId}`);
    return raw ? JSON.parse(raw) : null;
};

export const getAllInstances = async () => {
    const redis = getRedisClient();
    if (!redis) return [];
    const ids = await redis.lrange('gateway:instances', 0, -1);
    if (!ids || ids.length === 0) return [];

    const instances = await Promise.all(
        ids.map(id => getInstance(id).catch(() => null))
    );
    return instances.filter(Boolean);
};

export const updateInstance = async (instanceId, updates) => {
    const redis = getRedisClient();
    if (!redis) return null;
    const existing = await getInstance(instanceId);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    await redis.set(`gateway:instance:${instanceId}`, JSON.stringify(updated), 'EX', SESSION_TTL);
    return updated;
};

export const deleteInstance = async (instanceId) => {
    const redis = getRedisClient();
    if (!redis) return;
    await Promise.all([
        redis.del(`gateway:instance:${instanceId}`),
        redis.del(`gateway:auth:${instanceId}`),
        redis.del(`gateway:qr:${instanceId}`),
        redis.del(`gateway:state:${instanceId}`),
        redis.del(`gateway:history:${instanceId}`),
        redis.lrem('gateway:instances', 0, instanceId)
    ]);
};

// ─── QR Management ────────────────────────────────────────────────────────────

export const storeQR = async (instanceId, qrString) => {
    const redis = getRedisClient();
    if (!redis) return null;
    const base64 = await qrcode.toDataURL(qrString, {
        width: 256,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' }
    });
    await redis.set(`gateway:qr:${instanceId}`, base64, 'EX', QR_TTL);
    await updateInstance(instanceId, { state: GW_STATE.QR_PENDING });
    return base64;
};

export const getQR = async (instanceId) => {
    const redis = getRedisClient();
    if (!redis) return null;
    return await redis.get(`gateway:qr:${instanceId}`);
};

// ─── Auth State for Baileys ───────────────────────────────────────────────────

export const makeRedisAuthState = async (instanceId) => {
    const redis = getRedisClient();
    const KEY = `gateway:auth:${instanceId}`;

    const readData = async (key) => {
        const val = await redis.get(`${KEY}:${key}`);
        return val ? JSON.parse(val) : null;
    };

    const writeData = async (key, data) => {
        await redis.set(`${KEY}:${key}`, JSON.stringify(data), 'EX', SESSION_TTL);
    };

    const removeData = async (key) => {
        await redis.del(`${KEY}:${key}`);
    };

    // Dynamically import Baileys to avoid top-level issues
    const { initAuthCreds, BufferJSON, proto } = await import('@whiskeysockets/baileys');

    let creds = await readData('creds');
    if (!creds) creds = initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            tasks.push(
                                value ? writeData(`${category}-${id}`, value) : removeData(`${category}-${id}`)
                            );
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeData('creds', creds);
        }
    };
};

// ─── Message History ─────────────────────────────────────────────────────────

const HISTORY_CAP = 200;

export const saveMessageToHistory = async (instanceId, entry) => {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.lpush(`gateway:history:${instanceId}`, JSON.stringify({
        ...entry,
        timestamp: new Date().toISOString()
    }));
    await redis.ltrim(`gateway:history:${instanceId}`, 0, HISTORY_CAP - 1);
};

export const getHistory = async (instanceId, limit = 50) => {
    const redis = getRedisClient();
    if (!redis) return [];
    const raw = await redis.lrange(`gateway:history:${instanceId}`, 0, limit - 1);
    return raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
};

// ─── Token Validation ─────────────────────────────────────────────────────────

export const validateToken = async (instanceId, token) => {
    const instance = await getInstance(instanceId);
    if (!instance) return false;
    return instance.token === token;
};
