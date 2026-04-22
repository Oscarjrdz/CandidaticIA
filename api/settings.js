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
                // Meta Cloud API — credentials are in environment variables
                return res.status(200).json({
                    success: true,
                    data: {
                        phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
                        wabaId: process.env.META_WABA_ID || '',
                        configured: !!(process.env.META_PHONE_NUMBER_ID && process.env.META_ACCESS_TOKEN)
                    }
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
                    data: value ? JSON.parse(value) : { openaiApiKey: '' }
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


            if (type === 'bypass_enabled') {
                value = await redis.get('bypass_enabled');
                return res.status(200).json({
                    success: true,
                    data: value === 'true'
                });
            }

            if (type === 'catcher_tag') {
                value = await redis.get('catcher_tag');
                return res.status(200).json({
                    success: true,
                    data: value || 'CATCHER'
                });
            }

            // Gateway credentials (Catcher + Instance)
            if (type === 'catcher_credentials') {
                const id = await redis.get('catcher_instance_id') || '';
                const token = await redis.get('catcher_instance_token') || '';
                return res.status(200).json({ success: true, data: { instanceId: id, token } });
            }

            if (type === 'gateway_credentials') {
                const id = await redis.get('gateway_instance_id') || '';
                const token = await redis.get('gateway_instance_token') || '';
                return res.status(200).json({ success: true, data: { instanceId: id, token } });
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
                // Meta Cloud API credentials are managed via environment variables
                return res.status(200).json({
                    success: true,
                    message: 'Credentials are managed via environment variables (META_PHONE_NUMBER_ID, META_ACCESS_TOKEN)'
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
                let merged = {};
                try {
                    const parsed = existing ? JSON.parse(existing) : {};
                    // Safety: Ensure we only spread if it's a plain object
                    const safeParsed = (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) ? parsed : {};
                    merged = { ...safeParsed, ...data };
                } catch (e) {
                    console.error('⚠️ [API] Corrupted JSON in ai_config, using incoming data only');
                    merged = data;
                }

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


            if (type === 'bypass_enabled') {
                await redis.set('bypass_enabled', data ? 'true' : 'false');
                return res.status(200).json({
                    success: true,
                    message: 'ByPass system status saved'
                });
            }

            if (type === 'catcher_tag') {
                if (typeof data !== 'string') {
                    return res.status(400).json({ error: 'Invalid tag format' });
                }
                await redis.set('catcher_tag', data);
                return res.status(200).json({
                    success: true,
                    message: 'Catcher tag saved'
                });
            }

            // Gateway credentials (Catcher + Instance)
            if (type === 'catcher_credentials') {
                if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid format' });
                if (data.instanceId) await redis.set('catcher_instance_id', data.instanceId);
                if (data.token) await redis.set('catcher_instance_token', data.token);
                return res.status(200).json({ success: true, message: 'Catcher credentials saved' });
            }

            if (type === 'gateway_credentials') {
                if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid format' });
                if (data.instanceId) await redis.set('gateway_instance_id', data.instanceId);
                if (data.token) await redis.set('gateway_instance_token', data.token);
                return res.status(200).json({ success: true, message: 'Gateway credentials saved' });
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

