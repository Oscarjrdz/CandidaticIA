/**
 * Settings API - Manage BuilderBot credentials and export timer in Redis
 * GET /api/settings?type=credentials|timer
 * POST /api/settings { type, data }
 */

import { getRedisClient } from './utils/storage.js';

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
        // GET - Read settings
        if (req.method === 'GET') {
            const { type } = req.query;

            if (!type) {
                return res.status(400).json({ error: 'Missing type parameter' });
            }

            let value;

            if (type === 'credentials') {
                value = await redis.get('builderbot_credentials');
                return res.status(200).json({
                    success: true,
                    data: value ? JSON.parse(value) : null
                });
            }

            if (type === 'timer') {
                value = await redis.get('export_timer');
                return res.status(200).json({
                    success: true,
                    data: value ? parseInt(value) : null
                });
            }

            return res.status(400).json({ error: 'Invalid type' });
        }

        // POST - Save settings
        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const { type, data } = body;

            if (!type || data === undefined) {
                return res.status(400).json({ error: 'Missing type or data' });
            }

            if (type === 'credentials') {
                // Validate credentials structure
                if (!data.botId || !data.answerId || !data.apiKey) {
                    return res.status(400).json({ error: 'Invalid credentials format' });
                }

                await redis.set('builderbot_credentials', JSON.stringify(data));
                console.log('✅ BuilderBot credentials saved to Redis');

                return res.status(200).json({
                    success: true,
                    message: 'Credentials saved'
                });
            }

            if (type === 'timer') {
                const minutes = parseInt(data);

                if (isNaN(minutes) || minutes < 0) {
                    return res.status(400).json({ error: 'Invalid timer value' });
                }

                await redis.set('export_timer', minutes.toString());
                console.log(`✅ Export timer saved to Redis: ${minutes} minutes`);

                return res.status(200).json({
                    success: true,
                    message: 'Timer saved'
                });
            }

            return res.status(400).json({ error: 'Invalid type' });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('❌ Settings API error:', error);
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
