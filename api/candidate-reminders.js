/**
 * /api/candidate-reminders
 * CRUD para recordatorios directos programados por candidato.
 *
 * GET  ?candidateId=xxx  → lista los recordatorios de ese candidato
 * POST { candidateId, whatsapp, nombre, message, scheduledAt }  → crea uno
 * DELETE ?id=xxx         → cancela uno
 */
import { getRedisClient, validateAdminSession } from './utils/storage.js';

const ZSET_KEY = 'direct_reminders';

function makeId() {
    return `dr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    // ── GET: listar recordatorios de un candidato ─────────────────────────────
    if (req.method === 'GET') {
        const candidateId = req.query.candidateId;
        if (!candidateId) return res.status(400).json({ error: 'candidateId required' });

        try {
            const ids = await redis.smembers(`direct_reminders:candidate:${candidateId}`);
            if (!ids.length) return res.json({ success: true, reminders: [] });

            const pipeline = redis.pipeline();
            ids.forEach(id => pipeline.get(`direct_reminder:${id}`));
            const results = await pipeline.exec();

            const reminders = results
                .map(([, raw]) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } })
                .filter(Boolean)
                .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

            return res.json({ success: true, reminders });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ── POST: crear recordatorio ──────────────────────────────────────────────
    if (req.method === 'POST') {
        const { candidateId, whatsapp, nombre, message, scheduledAt } = req.body || {};
        if (!candidateId || !whatsapp || !message || !scheduledAt) {
            return res.status(400).json({ error: 'candidateId, whatsapp, message y scheduledAt son requeridos' });
        }

        const sendTs = new Date(scheduledAt).getTime();
        if (isNaN(sendTs) || sendTs <= Date.now()) {
            return res.status(400).json({ error: 'scheduledAt debe ser una fecha futura válida' });
        }

        try {
            const id = makeId();
            const reminder = {
                id,
                candidateId,
                whatsapp,
                nombre: nombre || whatsapp,
                message,
                scheduledAt,
                createdAt: new Date().toISOString(),
                status: 'pending',
            };

            await redis.pipeline()
                .set(`direct_reminder:${id}`, JSON.stringify(reminder), 'EX', 60 * 60 * 24 * 30) // 30 días TTL
                .zadd(ZSET_KEY, sendTs, id)
                .sadd(`direct_reminders:candidate:${candidateId}`, id)
                .exec();

            return res.status(201).json({ success: true, reminder });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ── DELETE: cancelar recordatorio ─────────────────────────────────────────
    if (req.method === 'DELETE') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ error: 'id required' });

        try {
            const raw = await redis.get(`direct_reminder:${id}`);
            if (!raw) return res.status(404).json({ error: 'Recordatorio no encontrado' });

            const reminder = JSON.parse(raw);
            await redis.pipeline()
                .del(`direct_reminder:${id}`)
                .zrem(ZSET_KEY, id)
                .srem(`direct_reminders:candidate:${reminder.candidateId}`, id)
                .exec();

            return res.json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).end();
}
