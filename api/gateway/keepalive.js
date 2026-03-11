/**
 * Vercel Cron Job — runs every hour to keep gateway instances alive.
 *
 * Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/gateway/keepalive",
 *     "schedule": "0 * * * *"
 *   }]
 * }
 */

import { getAllInstances, updateInstance, GW_STATE } from './session-engine.js';

export default async function handler(req, res) {
    // Accept Vercel cron token OR internal calls
    const authHeader = req.headers['authorization'] || '';
    const cronSecret = process.env.CRON_SECRET || '';
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const instances = await getAllInstances();
        const connected = instances.filter(i => i.state === GW_STATE.CONNECTED);
        const results = [];

        for (const inst of connected) {
            try {
                // Ping: just update lastPing timestamp to keep Redis key alive
                await updateInstance(inst.instanceId, {
                    lastPing: new Date().toISOString()
                });
                results.push({ instanceId: inst.instanceId, status: 'pinged' });
            } catch (e) {
                results.push({ instanceId: inst.instanceId, status: 'error', error: e.message });
            }
        }

        console.log(`[GATEWAY CRON] Pinged ${results.length} connected instances.`);
        return res.status(200).json({ success: true, pinged: results.length, results });

    } catch (err) {
        console.error('[GATEWAY CRON]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}
