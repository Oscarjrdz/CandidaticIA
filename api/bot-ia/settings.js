import { getRedisClient, getCandidates } from '../utils/storage.js';

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
            const redis = getRedisClient();
            if (!redis) return res.status(500).json({ error: 'Redis no disponible' });

            const ultramsgConfig = await redis.get('ultramsg_credentials') || await redis.get('ultramsg_config');
            const systemPrompt = await redis.get('bot_ia_prompt');
            const isActive = await redis.get('bot_ia_active');

            // Proactive Stats
            const todayStr = new Date().toISOString().split('T')[0];
            const todayCount = await redis.get(`ai:proactive:count:${todayStr}`) || '0';
            let totalSent = await redis.get('ai:proactive:total_sent') || '0';
            const totalRecovered = await redis.get('ai:proactive:total_recovered') || '0';

            // Calculate Pending (Incomplete Profiles)
            const { candidates } = await getCandidates(1000, 0); // Scan up to 1000
            const pendingCount = (candidates || []).filter(c => !c.nombreReal || !c.municipio).length;

            // Sync: If total is 0 but we already have sends today, homologate
            if (totalSent === '0' && parseInt(todayCount) > 0) {
                totalSent = todayCount;
                await redis.set('ai:proactive:total_sent', todayCount);
            }

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
                isActive: isActive === 'true',
                stats: {
                    today: parseInt(todayCount),
                    totalSent: parseInt(totalSent),
                    totalRecovered: parseInt(totalRecovered),
                    pending: pendingCount
                }
            });

        } catch (error) {
            return res.status(500).json({ error: 'Error cargando config' });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
