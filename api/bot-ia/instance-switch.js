/**
 * /api/bot-ia/instance-switch
 * 
 * Switch Instancia — Failover Control API
 * 
 * GET  → Read current switch state
 * POST → Activate/deactivate switch (does NOT scan or modify candidates)
 * 
 * The actual re-routing ("tattooing") happens lazily in messenger.js
 * at the moment a message is sent to a candidate on the dead instance.
 */
import { getRedisClient } from '../utils/storage.js';

const KEYS = {
    ACTIVE: 'instance_switch_active',
    FROM: 'instance_switch_from',
    TO: 'instance_switch_to',
    COUNT: 'instance_switch_tattoo_count',
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    try {
        // ─── GET: Read switch state ────────────────────────────────────────
        if (req.method === 'GET') {
            const [active, from, to, count] = await redis.mget(
                KEYS.ACTIVE, KEYS.FROM, KEYS.TO, KEYS.COUNT
            );

            return res.status(200).json({
                active: active === 'true',
                fromInstanceId: from || null,
                toInstanceId: to || null,
                tattooCount: parseInt(count) || 0
            });
        }

        // ─── POST: Set switch state ────────────────────────────────────────
        if (req.method === 'POST') {
            const { active, fromInstanceId, toInstanceId } = req.body;

            if (typeof active !== 'boolean') {
                return res.status(400).json({ error: 'Missing "active" boolean field' });
            }

            if (active) {
                // Validate required fields when activating
                if (!fromInstanceId || !toInstanceId) {
                    return res.status(400).json({
                        error: 'When activating, "fromInstanceId" and "toInstanceId" are required'
                    });
                }

                if (fromInstanceId === toInstanceId) {
                    return res.status(400).json({
                        error: 'Source and destination instances cannot be the same'
                    });
                }

                // Save atomically
                const pipeline = redis.pipeline();
                pipeline.set(KEYS.ACTIVE, 'true');
                pipeline.set(KEYS.FROM, fromInstanceId);
                pipeline.set(KEYS.TO, toInstanceId);
                // Reset counter on fresh activation
                pipeline.set(KEYS.COUNT, '0');
                await pipeline.exec();

                console.log(`[INSTANCE-SWITCH] ✅ Activated: ${fromInstanceId} → ${toInstanceId}`);

                return res.status(200).json({
                    success: true,
                    active: true,
                    fromInstanceId,
                    toInstanceId,
                    tattooCount: 0
                });
            } else {
                // Deactivate — does NOT revert tattooed candidates
                await redis.set(KEYS.ACTIVE, 'false');

                console.log(`[INSTANCE-SWITCH] ⏹️ Deactivated (tattoos preserved)`);

                // Read current count for response
                const count = await redis.get(KEYS.COUNT);

                return res.status(200).json({
                    success: true,
                    active: false,
                    tattooCount: parseInt(count) || 0,
                    note: 'Previously tattooed candidates remain on the destination instance'
                });
            }
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('[INSTANCE-SWITCH] Error:', error);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
