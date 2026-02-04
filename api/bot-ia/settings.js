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
            const { instanceId, token, systemPrompt, isActive } = req.body;

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
            const ultramsgConfig = await redis.get('ultramsg_credentials') || await redis.get('ultramsg_config');
            const systemPrompt = await redis.get('bot_ia_prompt');
            const isActive = await redis.get('bot_ia_active');

            // Default Stats state (Safe fallback)
            let stats = {
                today: 0,
                totalSent: 0,
                totalRecovered: 0,
                pending: 0
            };

            try {
                // Proactive Stats
                const todayStr = new Date().toISOString().split('T')[0];
                const todayCount = await redis.get(`ai:proactive:count:${todayStr}`) || '0';
                let totalSent = await redis.get('ai:proactive:total_sent') || '0';
                const totalRecovered = await redis.get('ai:proactive:total_recovered') || '0';

                // Sync: If total is 0 but we already have sends today, homologate
                if (totalSent === '0' && parseInt(todayCount) > 0) {
                    totalSent = todayCount;
                    await redis.set('ai:proactive:total_sent', todayCount);
                }

                // Calculate Pending (Incomplete Profiles - Optimized and Protected)
                let pendingCount = 0;
                try {
                    const customFieldsJson = await redis.get('custom_fields');
                    const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];

                    // Limit scan to 500 for the dashboard to avoid timeouts
                    const { candidates } = await getCandidates(500, 0);
                    pendingCount = (candidates || []).filter(c => !isProfileComplete(c, customFields)).length;
                } catch (e) {
                    console.warn('⚠️ [Stats] Error calculating pending count:', e.message);
                }

                stats = {
                    today: parseInt(todayCount),
                    totalSent: parseInt(totalSent),
                    totalRecovered: parseInt(totalRecovered),
                    pending: pendingCount
                };
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
                isActive: isActive === 'true',
                stats
            });

        } catch (error) {
            console.error('❌ [Settings API] Fatal crash:', error);
            return res.status(500).json({ error: 'Error cargando config' });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
