/* global process, Buffer */
/**
 * /api/cron/paso2-trigger
 * Vercel Cron — runs every minute.
 *
 * Busca candidatos que completaron el paso básico hace ~1 minuto
 * y aún no han recibido el mensaje proactivo de paso 2.
 * Envía el opener de colonia + ruta de transporte.
 */
import { getRedisClient, updateCandidate, saveMessage } from '../utils/storage.js';
import { getUltraMsgConfig, sendUltraMsgMessage } from '../whatsapp/utils.js';

const PROGRESS_TTL_SECONDS = 60 * 60 * 24;

function assertSuccessfulSend(result, context) {
    if (!result?.success) {
        throw new Error(result?.error || `No se pudo enviar ${context}`);
    }
}

function progressKeyForTrigger(key, candidateId) {
    const id = candidateId || key;
    return `paso2_trigger_progress:${Buffer.from(String(id)).toString('base64url')}`;
}

function parseProgress(raw) {
    if (!raw) return {};
    try {
        return JSON.parse(raw) || {};
    } catch {
        return {};
    }
}

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Redis unavailable' });

    try {
        // Scan for pending paso 2 triggers — uses SCAN instead of KEYS to avoid blocking Redis
        const keys = [];
        let cursor = '0';
        do {
            const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', 'paso2_pendiente:*', 'COUNT', 100);
            cursor = nextCursor;
            if (batch.length) keys.push(...batch);
        } while (cursor !== '0');

        if (!keys.length) return res.status(200).json({ ok: true, fired: 0 });

        let fired = 0;

        for (const key of keys) {
            try {
                const raw = await redis.get(key);
                if (!raw) continue;

                const { phone, instanceId, nombre, candidateId, fireAfter } = JSON.parse(raw);

                // Respect minimum delay — skip until fireAfter timestamp passes
                if (fireAfter && Date.now() < fireAfter) continue;

                // Prefer incomingPhoneNumberId from candidate (most recent number used)
                let resolvedInstanceId = instanceId;
                if (candidateId) {
                    try {
                        const { getCandidateById } = await import('../utils/storage.js');
                        const cand = await getCandidateById(candidateId);
                        if (cand?.incomingPhoneNumberId) resolvedInstanceId = cand.incomingPhoneNumberId;
                    } catch {
                        // Best effort: use the instance stored in the trigger if candidate lookup fails.
                    }
                }
                const config = await getUltraMsgConfig(resolvedInstanceId);
                if (!config?.token) {
                    console.warn(`[paso2-trigger] No config for instance ${instanceId}`);
                    continue;
                }

                const firstName = (nombre || '').split(' ')[0] || '';

                const burbuja1 = firstName
                    ? `Oye ${firstName}, estoy revisando mi sistema y encontré algo para ti 👀`
                    : `Oye, estoy revisando mi sistema y encontré algo para ti 👀`;
                const burbuja2 = `Compárteme porfi ¿cómo se llama tu colonia? Es para validar si te queda una ruta de transporte 🚌🏘️`;

                const progressKey = progressKeyForTrigger(key, candidateId);
                const progress = parseProgress(await redis.get(progressKey));
                if (!progress.burbuja1Sent) {
                    const firstResult = await sendUltraMsgMessage(config.instanceId, config.token, phone, burbuja1, 'chat', { priority: 0 });
                    assertSuccessfulSend(firstResult, 'paso 2 burbuja 1');
                    progress.burbuja1Sent = true;
                    await redis.set(progressKey, JSON.stringify(progress), 'EX', PROGRESS_TTL_SECONDS);
                }
                if (!progress.burbuja2Sent) {
                    const secondResult = await sendUltraMsgMessage(config.instanceId, config.token, phone, burbuja2, 'chat', { priority: 1 });
                    assertSuccessfulSend(secondResult, 'paso 2 burbuja 2');
                    progress.burbuja2Sent = true;
                    await redis.set(progressKey, JSON.stringify(progress), 'EX', PROGRESS_TTL_SECONDS);
                }

                // Save messages to history
                const ts = new Date().toISOString();
                await saveMessage(candidateId, { from: 'bot', text: burbuja1, timestamp: ts });
                await saveMessage(candidateId, { from: 'bot', text: burbuja2, timestamp: ts });

                // Advance state — must persist before candidate replies
                const stateResult = await updateCandidate(candidateId, { paso2Estado: 'esperando_colonia' });
                if (!stateResult) {
                    console.error(`[paso2-trigger] updateCandidate returned null for ${candidateId} — state NOT persisted, colonia flow will break`);
                }

                // Delete the trigger key so cron doesn't fire again
                await redis.del(key);
                await redis.del(progressKey);

                fired++;
            } catch (err) {
                console.error(`[paso2-trigger] Error processing ${key}:`, err.message);
            }
        }

        return res.status(200).json({ ok: true, fired });
    } catch (err) {
        console.error('[paso2-trigger] Fatal:', err.message);
        return res.status(500).json({ error: err.message });
    }
}
