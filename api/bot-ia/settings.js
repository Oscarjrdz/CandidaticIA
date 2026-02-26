import { getRedisClient, getCandidates, isProfileComplete } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const redis = getRedisClient();
    if (!redis) {
        return res.status(500).json({ error: 'Redis no disponible' });
    }

    if (req.method === 'POST') {
        try {
            const {
                instanceId,
                token,
                systemPrompt,
                isActive,
                extractionRules,
                cerebro1Rules,
                cerebro2Context,
                aiModel
            } = req.body;

            // 1. WhatsApp Config (UltraMsg)
            if (instanceId !== undefined || token !== undefined) {
                const existingConfig = await redis.get('ultramsg_credentials');
                let config = existingConfig ? JSON.parse(existingConfig) : {};
                if (instanceId !== undefined) config.instanceId = instanceId;
                if (token !== undefined) config.token = token;
                await redis.set('ultramsg_credentials', JSON.stringify(config));
            }

            // 2. AI Prompt
            if (systemPrompt !== undefined) {
                await redis.set('bot_ia_prompt', systemPrompt);
            }

            // 3. Master Bot Switch (CRITICAL FIX)
            if (isActive !== undefined) {
                await redis.set('bot_ia_active', isActive ? 'true' : 'false');
            }

            // 7. Advanced Internal Protocols
            if (extractionRules !== undefined) await redis.set('bot_extraction_rules', extractionRules);
            if (cerebro1Rules !== undefined) await redis.set('bot_cerebro1_rules', cerebro1Rules);
            if (cerebro2Context !== undefined) await redis.set('bot_cerebro2_context', cerebro2Context);
            if (aiModel !== undefined) await redis.set('bot_ia_model', aiModel);

            return res.status(200).json({ success: true });

        } catch (error) {
            console.error('Error saving Bot IA settings:', error);
            return res.status(500).json({ error: 'Error interno' });
        }
    }

    // GET - Load settings
    if (req.method === 'GET') {
        try {
            const ultramsgConfig = await redis.get('ultramsg_credentials') || await redis.get('ultramsg_config');
            const systemPrompt = await redis.get('bot_ia_prompt');
            const isActive = await redis.get('bot_ia_active');
            const extractionRules = await redis.get('bot_extraction_rules');
            const cerebro1Rules = await redis.get('bot_cerebro1_rules');
            const cerebro2Context = await redis.get('bot_cerebro2_context');
            const aiModel = await redis.get('bot_ia_model');

            let instanceId = '';
            let token = '';

            if (ultramsgConfig) {
                try {
                    const parsed = JSON.parse(ultramsgConfig);
                    instanceId = parsed.instanceId || '';
                    token = parsed.token || '';
                } catch (e) {
                    console.error('⚠️ [Settings] Corrupted ultramsg_credentials JSON');
                }
            }

            return res.status(200).json({
                instanceId,
                token,
                systemPrompt: systemPrompt || '',
                isActive: isActive === 'true',
                extractionRules: extractionRules || '',
                cerebro1Rules: cerebro1Rules || '',
                cerebro2Context: cerebro2Context || '',
                aiModel: aiModel || 'gpt-4o-mini'
            });

        } catch (error) {
            console.error('❌ [Settings API] Fatal crash:', error);
            return res.status(500).json({ error: 'Error cargando config' });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
