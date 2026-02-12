/**
 * Settings API - Manage UltraMsg credentials and export timer in Redis
 * GET /api/settings?type=credentials|timer
 * POST /api/settings { type, data }
 */

import { getRedisClient } from './utils/storage.js';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_ASSISTANT_PROMPT } from './ai/agent.js';

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
                value = await redis.get('ultramsg_credentials');
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

            if (type === 'ai_config') {
                value = await redis.get('ai_config');
                return res.status(200).json({
                    success: true,
                    data: value ? JSON.parse(value) : { geminiApiKey: '' }
                });
            }

            if (type === 'ai_prompt') {
                value = await redis.get('bot_ia_prompt');
                return res.status(200).json({
                    success: true,
                    data: value || DEFAULT_SYSTEM_PROMPT
                });
            }

            if (type === 'assistant_ai_prompt') {
                value = await redis.get('assistant_ia_prompt');
                return res.status(200).json({
                    success: true,
                    data: value || DEFAULT_ASSISTANT_PROMPT
                });
            }

            if (type === 'bot_proactive_enabled') {
                value = await redis.get('bot_proactive_enabled');
                return res.status(200).json({
                    success: true,
                    data: value === 'true'
                });
            }

            return res.status(400).json({ error: 'Invalid type' });
        }

        // POST - Save settings
        if (req.method === 'POST') {
            const body = req.body;
            const { type, data } = body;

            if (!type || data === undefined) {
                return res.status(400).json({ error: 'Missing type or data' });
            }

            if (type === 'credentials') {
                // Validate UltraMsg credentials structure
                if (!data.instanceId || !data.token) {
                    return res.status(400).json({ error: 'Invalid credentials format (instanceId and token required)' });
                }

                await redis.set('ultramsg_credentials', JSON.stringify(data));

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

                return res.status(200).json({
                    success: true,
                    message: 'Timer saved'
                });
            }

            if (type === 'ai_config') {
                if (!data || typeof data !== 'object') {
                    return res.status(400).json({ error: 'Invalid AI config format' });
                }

                const existing = await redis.get('ai_config');
                const merged = existing ? { ...JSON.parse(existing), ...data } : data;
                await redis.set('ai_config', JSON.stringify(merged));

                return res.status(200).json({
                    success: true,
                    message: 'AI config saved and merged'
                });
            }

            if (type === 'ai_prompt') {
                // 'data' is the prompt string
                if (typeof data !== 'string') {
                    return res.status(400).json({ error: 'Invalid prompt format' });
                }

                await redis.set('bot_ia_prompt', data);

                return res.status(200).json({
                    success: true,
                    message: 'AI prompt saved'
                });
            }

            if (type === 'assistant_ai_prompt') {
                if (typeof data !== 'string') {
                    return res.status(400).json({ error: 'Invalid prompt format' });
                }

                await redis.set('assistant_ia_prompt', data);

                return res.status(200).json({
                    success: true,
                    message: 'Assistant AI prompt saved'
                });
            }

            if (type === 'bot_proactive_enabled') {
                await redis.set('bot_proactive_enabled', data ? 'true' : 'false');
                return res.status(200).json({
                    success: true,
                    message: 'Proactive status saved'
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

