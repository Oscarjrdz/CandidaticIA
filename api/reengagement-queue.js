/**
 * GET /api/reengagement-queue
 * Devuelve candidatos pendientes, enviados y saltados para el panel de control.
 */
import { getRedisClient } from './utils/storage.js';

const SETTINGS_KEY = 'reengagement:settings';

// Campos requeridos en orden de prioridad
export const FIELD_PRIORITY = ['nombreReal', 'fechaNacimiento', 'municipio', 'categoria', 'escolaridad'];
export const FIELD_LABELS = {
    nombreReal:      'nombre y apellidos',
    fechaNacimiento: 'fecha de nacimiento',
    municipio:       'municipio donde vives',
    categoria:       'tipo de trabajo que buscas',
    escolaridad:     'nivel de escolaridad',
};

export function getMissingFields(candidate) {
    return FIELD_PRIORITY.filter(f => {
        const val = candidate[f];
        if (val === null || val === undefined) return true;
        const s = String(val).trim().toLowerCase();
        return s === '' || s === 'null' || s === 'undefined' || s === 'n/a' || s === '-' || s === 'none';
    });
}

function humanEta(ms) {
    if (ms <= 0) return 'Ahora';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h >= 24) return `~${Math.floor(h / 24)}d`;
    if (h > 0) return `~${h}h ${m}m`;
    return `~${m}m`;
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    try {
        const raw = await redis.get(SETTINGS_KEY);
        const settings = raw ? JSON.parse(raw) : null;

        if (!settings?.activeFrom) {
            return res.status(200).json({ success: true, pending: [], sent: [], skipped: [], stats: { pendingCount: 0, sentToday: 0, skippedCount: 0 } });
        }

        // Usar índice de pendientes — evita cargar los 3500+ candidatos completos
        const pendingIds = await redis.smembers('stats:list:pending');
        let candidates = [];
        if (pendingIds.length > 0) {
            const pipeline = redis.pipeline();
            pendingIds.forEach(id => pipeline.get(`candidate:${id}`));
            const pResults = await pipeline.exec();
            candidates = pResults
                .map(([err, raw]) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } })
                .filter(Boolean);
        }
        const now = Date.now();
        const activeFromMs  = new Date(settings.activeFrom).getTime();
        const silenceMs     = (settings.silenceHours  || 2)  * 3_600_000;
        const intervalMs    = (settings.intervalHours || 24) * 3_600_000;
        const maxSilenceMs  = (settings.maxSilenceDays || 7) * 86_400_000;
        const maxAttempts   = settings.maxAttempts || 2;

        const pending  = [];
        const sent     = [];
        const skipped  = [];
        let sentToday  = 0;

        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

        for (const c of candidates) {
            const lastMsgTs = c.lastUserMessageAt ? new Date(c.lastUserMessageAt).getTime() : 0;

            // Solo candidatos que interactuaron DESPUÉS de activar el feature
            if (!lastMsgTs || lastMsgTs < activeFromMs) continue;

            const missing = getMissingFields(c);
            if (missing.length === 0) continue;   // perfil completo
            if (c.blocked) continue;               // IA silenciada

            const meta = {
                id: c.id,
                whatsapp: c.whatsapp,
                nombre: c.nombreReal || c.nombre || c.whatsapp,
                missingFields: missing.map(f => FIELD_LABELS[f]),
                attempts: Number(c.reengagement_attempts) || 0,
                lastSent: c.reengagement_last_sent || null,
            };
            const lastSentTs = meta.lastSent ? new Date(meta.lastSent).getTime() : 0;

            // ── Saltados manualmente ──────────────────────────────────────────
            if (c.reengagement_skip) {
                skipped.push(meta);
                continue;
            }

            // ── Ya alcanzó el máximo de intentos ─────────────────────────────
            if (meta.attempts >= maxAttempts) {
                if (lastSentTs > 0) {
                    if (lastSentTs >= todayStart.getTime()) sentToday++;
                    sent.push({ ...meta, status: 'maxed' });
                }
                continue;
            }

            // ── Silencio demasiado largo — ya no vale la pena ────────────────
            if ((now - lastMsgTs) > maxSilenceMs) continue;

            // Construir estado pending
            let etaMs = 0;
            let readyToSend = false;

            if (lastSentTs === 0) {
                // Primer intento: esperar silenceHours desde lastUserMessageAt
                const waitedMs = now - lastMsgTs;
                etaMs = Math.max(0, silenceMs - waitedMs);
                readyToSend = etaMs === 0;
            } else {
                // Intentos siguientes: esperar intervalHours desde lastSent
                etaMs = Math.max(0, intervalMs - (now - lastSentTs));
                readyToSend = etaMs === 0;
                // Contar enviados hoy
                if (lastSentTs >= todayStart.getTime()) sentToday++;
                sent.push({ ...meta, status: 'sent' });
            }

            pending.push({
                ...meta,
                etaMs,
                etaHuman: humanEta(etaMs),
                silenceMs: now - lastMsgTs,
                readyToSend,
            });
        }

        return res.status(200).json({
            success: true,
            pending,
            sent,
            skipped,
            stats: {
                pendingCount:  pending.length,
                sentToday,
                skippedCount:  skipped.length,
            }
        });
    } catch (e) {
        console.error('[REENGAGEMENT-QUEUE]', e);
        return res.status(500).json({ error: e.message });
    }
}
