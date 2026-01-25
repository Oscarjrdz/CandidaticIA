import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'POST') {
        try {
            const { instanceId, token, systemPrompt, isActive } = req.body;
            const redis = getRedisClient();

            if (!redis) {
                return res.status(500).json({ error: 'Redis no disponible' });
            }

            // 1. WhatsApp Config (UltraMsg)
            if (instanceId !== undefined || token !== undefined) {
                const existingConfig = await redis.get('ultramsg_config');
                let config = existingConfig ? JSON.parse(existingConfig) : {};
                if (instanceId !== undefined) config.instanceId = instanceId;
                if (token !== undefined) config.token = token;
                await redis.set('ultramsg_config', JSON.stringify(config));
            }

            // 2. AI Prompt
            if (systemPrompt !== undefined) {
                await redis.set('bot_ia_prompt', systemPrompt);
            }

            // 3. Bot Status
            if (isActive !== undefined) {
                await redis.set('bot_ia_active', String(isActive));
            }

            return res.status(200).json({ success: true });

        } catch (error) {
            console.error('Error saving Bot IA settings:', error);
            return res.status(500).json({ error: 'Error interno' });
        }
    }

    // GET - Load settings
    if (req.method === 'GET') {
        try {
            const redis = getRedisClient();
            if (!redis) return res.status(500).json({ error: 'Redis no disponible' });

            const ultramsgConfig = await redis.get('ultramsg_config');
            const systemPrompt = await redis.get('bot_ia_prompt');
            const isActive = await redis.get('bot_ia_active');

            let instanceId = '';
            let token = '';

            if (ultramsgConfig) {
                const parsed = JSON.parse(ultramsgConfig);
                instanceId = parsed.instanceId;
                token = parsed.token;
            }

            return res.status(200).json({
                instanceId,
                token,
                systemPrompt: systemPrompt || '',
                isActive: isActive === 'true'
            });

        } catch (error) {
            return res.status(500).json({ error: 'Error cargando config' });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
