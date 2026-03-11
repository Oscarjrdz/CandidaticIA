/**
 * POST /api/gateway/send/:instanceId/messages/:type
 * ──────────────────────────────────────────────────────────────────────────
 * SAME CONTRACT AS ULTRAMSG — drop-in compatible.
 *
 * Body: { token, to, body, priority }
 *
 * Supported types: chat | image | document | sticker | location
 */

import makeWASocket, {
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import {
    getInstance, validateToken, makeRedisAuthState,
    saveMessageToHistory, updateInstance, GW_STATE
} from './session-engine.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    try {
        // Parse instanceId and type from URL
        const urlParts = req.url.split('/');
        // URL pattern: /api/gateway/send/{instanceId}/messages/{type}
        const instanceId = urlParts[4] || req.query?.instanceId;
        const msgType = urlParts[6] || req.query?.type || 'chat';

        const { token, to, body, caption, filename, lat, lng, address, priority } = req.body || {};

        // ── Validation ────────────────────────────────────────────────────────
        if (!instanceId) return res.status(400).json({ success: false, error: 'instanceId requerido.' });
        if (!token) return res.status(401).json({ success: false, error: 'Token requerido.' });
        if (!to) return res.status(400).json({ success: false, error: 'Campo `to` requerido.' });

        const valid = await validateToken(instanceId, token);
        if (!valid) return res.status(403).json({ success: false, error: 'Token inválido.' });

        const instance = await getInstance(instanceId);
        if (!instance) return res.status(404).json({ success: false, error: 'Instancia no encontrada.' });

        if (instance.state !== GW_STATE.CONNECTED) {
            return res.status(503).json({
                success: false,
                error: `La instancia no está conectada. Estado actual: ${instance.state}`
            });
        }

        // ── Get active socket or recreate ─────────────────────────────────────
        const { state, saveCreds } = await makeRedisAuthState(instanceId);
        const { version } = await fetchLatestBaileysVersion();

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

        socket.ev.on('creds.update', saveCreds);

        // Normalize "to" field — same as UltraMsg behavior
        let formattedTo = String(to).trim();
        if (!formattedTo.includes('@')) {
            const cleanPhone = formattedTo.replace(/\D/g, '');
            formattedTo = `${cleanPhone}@c.us`;
        }

        // Wait for socket ready
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Socket timeout')), 15000);
            socket.ev.on('connection.update', ({ connection }) => {
                if (connection === 'open') { clearTimeout(timeout); resolve(); }
                if (connection === 'close') { clearTimeout(timeout); reject(new Error('Connection closed')); }
            });
            // If already connected (creds valid), resolve immediately
            setTimeout(resolve, 2000);
        }).catch(() => {});

        let sentMsg;

        // ── Send by type ──────────────────────────────────────────────────────
        switch (msgType) {
            case 'image':
                sentMsg = await socket.sendMessage(formattedTo, {
                    image: { url: body },
                    caption: caption || ''
                });
                break;
            case 'document':
                sentMsg = await socket.sendMessage(formattedTo, {
                    document: { url: body },
                    fileName: filename || 'document.pdf',
                    mimetype: 'application/pdf'
                });
                break;
            case 'sticker':
                sentMsg = await socket.sendMessage(formattedTo, {
                    sticker: { url: body }
                });
                break;
            case 'location':
                sentMsg = await socket.sendMessage(formattedTo, {
                    location: { degreesLatitude: lat, degreesLongitude: lng, name: address }
                });
                break;
            default: // chat
                sentMsg = await socket.sendMessage(formattedTo, { text: body });
        }

        // ── Record in history + counters ──────────────────────────────────────
        await saveMessageToHistory(instanceId, {
            direction: 'out',
            to: formattedTo,
            body: body || `[${msgType}]`,
            msgId: sentMsg?.key?.id
        });
        await updateInstance(instanceId, {
            messagesOut: (instance.messagesOut || 0) + 1
        });

        socket.end();

        return res.status(200).json({
            success: true,
            sent: true,
            msgId: sentMsg?.key?.id,
            to: formattedTo,
            type: msgType
        });

    } catch (err) {
        console.error('[GATEWAY /send]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}
