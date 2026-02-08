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
            const { instanceId, token, systemPrompt, isActive, proactiveEnabled, operativeConfig, inactiveStages } = req.body;

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

            // 2.5 Proactive Hook Prompt
            if (req.body.proactivePrompt !== undefined) {
                await redis.set('bot_proactive_prompt', req.body.proactivePrompt);
            }

            // 4. Proactive Status (Follow-up)
            if (proactiveEnabled !== undefined) {
                await redis.set('bot_proactive_enabled', String(proactiveEnabled));
            }

            // 5. Operative Config (Hours, Limits)
            if (operativeConfig !== undefined) {
                await redis.set('bot_operative_config', JSON.stringify(operativeConfig));
            }

            // 6. Inactive Stages (Timeline)
            if (inactiveStages !== undefined) {
                await redis.set('bot_inactive_stages', JSON.stringify(inactiveStages));
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
            const ultramsgConfig = await redis.get('ultramsg_credentials') || await redis.get('ultramsg_config');
            const systemPrompt = await redis.get('bot_ia_prompt');
            const proactivePrompt = await redis.get('bot_proactive_prompt');
            const isActive = await redis.get('bot_ia_active');
            const proactiveEnabled = await redis.get('bot_proactive_enabled');
            const operativeConfigJson = await redis.get('bot_operative_config');
            const inactiveStagesJson = await redis.get('bot_inactive_stages');

            const operativeConfig = operativeConfigJson ? JSON.parse(operativeConfigJson) : {
                startHour: 7,
                endHour: 23,
                dailyLimit: 300
            };

            const inactiveStages = inactiveStagesJson ? JSON.parse(inactiveStagesJson) : [
                { hours: 24, label: 'Recordatorio (Lic. Brenda)' },
                { hours: 48, label: 'Re-confirmación interés' },
                { hours: 72, label: 'Último aviso de vacante' },
                { hours: 168, label: 'Limpieza de base' }
            ];

            // Default Stats state (Safe fallback)
            let stats = {
                today: 0,
                totalSent: 0,
                totalRecovered: 0,
                pending: 0
            };

            try {
                const { calculateBotStats } = await import('../utils/bot-stats.js');
                const calculatedStats = await calculateBotStats();
                if (calculatedStats) {
                    stats = calculatedStats;
                }
            } catch (statsError) {
                console.error('⚠️ [Stats] Minor failure fetching stats:', statsError.message);
                // We let it continue with default 0s so the UI doesn't break
            }

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
                proactivePrompt: proactivePrompt || '',
                isActive: isActive === 'true',
                proactiveEnabled: proactiveEnabled === 'true',
                operativeConfig,
                inactiveStages,
                stats
            });

        } catch (error) {
            console.error('❌ [Settings API] Fatal crash:', error);
            return res.status(500).json({ error: 'Error cargando config' });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
