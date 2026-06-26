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

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

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
                    } catch (e) {}
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

                await sendUltraMsgMessage(config.instanceId, config.token, phone, burbuja1, 'chat', { priority: 0 });
                await sendUltraMsgMessage(config.instanceId, config.token, phone, burbuja2, 'chat', { priority: 1 });

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
