/**
 * Timer States API - Manage timer states in Redis using Sets
 * POST /api/timer-states { whatsapp, state: 'green'|'red' }
 * GET /api/timer-states?whatsapp=XXX
 * DELETE /api/timer-states (cleanup expired)
 */

import { getRedisClient } from './utils/storage.js';

const TIMER_STATES_KEY = 'timer_states:green';
const TTL_SECONDS = 86400; // 24 hours

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const redis = getRedisClient();

    if (!redis) {
        return res.status(500).json({
            error: 'Redis not available',
            message: 'REDIS_URL not configured'
        });
    }

    try {
        // GET - Check if candidate timer is green
        if (req.method === 'GET') {
            const { whatsapp } = req.query;

            if (!whatsapp) {
                return res.status(400).json({ error: 'Missing whatsapp parameter' });
            }

            const isGreen = await redis.sismember(TIMER_STATES_KEY, whatsapp);

            return res.status(200).json({
                success: true,
                whatsapp,
                isGreen: isGreen === 1
            });
        }

        // POST - Set timer state
        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const { whatsapp, state } = body;

            if (!whatsapp || !state) {
                return res.status(400).json({ error: 'Missing whatsapp or state' });
            }

            if (state === 'green') {
                // Add to green set
                await redis.sadd(TIMER_STATES_KEY, whatsapp);
                // Set TTL on the set (refreshes on each add)
                await redis.expire(TIMER_STATES_KEY, TTL_SECONDS);

                console.log(`✅ Timer state set to green for ${whatsapp}`);

                return res.status(200).json({
                    success: true,
                    message: 'Timer state updated'
                });
            }

            if (state === 'red') {
                // Remove from green set
                await redis.srem(TIMER_STATES_KEY, whatsapp);

                console.log(`✅ Timer state set to red for ${whatsapp}`);

                return res.status(200).json({
                    success: true,
                    message: 'Timer state updated'
                });
            }

            return res.status(400).json({ error: 'Invalid state (must be green or red)' });
        }

        // DELETE - Cleanup (can be called by cron)
        if (req.method === 'DELETE') {
            const count = await redis.scard(TIMER_STATES_KEY);

            return res.status(200).json({
                success: true,
                message: 'Timer states managed by TTL',
                count
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('❌ Timer States API error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}

/**
 * Parse JSON body from request
 */
async function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}
