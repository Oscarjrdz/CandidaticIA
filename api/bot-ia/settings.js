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

            // 2.5 Proactive Hook Prompt
            if (req.body.proactivePrompt !== undefined) {
                await redis.set('bot_proactive_prompt', req.body.proactivePrompt);
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
            const proactivePrompt = await redis.get('bot_proactive_prompt');
            const isActive = await redis.get('bot_ia_active');

            // Default Stats state (Safe fallback)
            let stats = {
                today: 0,
                totalSent: 0,
                totalRecovered: 0,
                pending: 0
            };

            try {
                // Dynamic import to avoid top-level issues and match api/candidates logic
                const { getCandidates, isProfileComplete } = await import('../utils/storage.js');

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

                // DIRECT COUNTER - NUCLEAR CHUNKED PIXELS (Nivel 9/10)
                let pendingCount = 0;
                let completeCount = 0;
                let debugInfo = "";

                try {
                    const { isProfileComplete } = await import('../utils/storage.js');
                    const customFieldsJson = await redis.get('custom_fields');
                    const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];

                    // 1. Get ALL IDs from the main index
                    const allIds = await redis.zrevrange('candidates:list', 0, -1);

                    if (allIds && allIds.length > 0) {
                        debugInfo = `Scanning ${allIds.length} IDs from ZSET. `;

                        // 2. Chunked Pipeline Processing (Resilient)
                        const CHUNK_SIZE = 100;
                        for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
                            const chunk = allIds.slice(i, i + CHUNK_SIZE);
                            const pipeline = redis.pipeline();
                            chunk.forEach(id => pipeline.get(`candidate:${id}`));
                            const results = await pipeline.exec();

                            results.forEach(([err, res]) => {
                                if (!err && res) {
                                    try {
                                        const c = JSON.parse(res);
                                        if (isProfileComplete(c, customFields)) {
                                            completeCount++;
                                        } else {
                                            pendingCount++;
                                        }
                                    } catch (parseErr) {
                                        // Skip corrupted JSON
                                    }
                                }
                            });
                        }
                        debugInfo += `Found ${pendingCount} pending, ${completeCount} complete.`;
                    } else {
                        // FALLBACK: Keys scan
                        const keys = await redis.keys('candidate:*');
                        debugInfo = `ZSET empty. Keys scan found ${keys.length} keys. `;
                        if (keys.length > 0) {
                            const pipeline = redis.pipeline();
                            keys.slice(0, 500).forEach(k => pipeline.get(k));
                            const results = await pipeline.exec();
                            results.forEach(([err, res]) => {
                                if (!err && res) {
                                    const c = JSON.parse(res);
                                    if (isProfileComplete(c, customFields)) completeCount++;
                                    else pendingCount++;
                                }
                            });
                        }
                    }
                } catch (e) {
                    console.error('❌ [Stats Nuclear] Fatal count error:', e);
                    debugInfo = `Error: ${e.message}`;
                }

                stats = {
                    today: parseInt(todayCount),
                    totalSent: parseInt(totalSent),
                    totalRecovered: parseInt(totalRecovered),
                    pending: pendingCount,
                    complete: completeCount,
                    _debug: debugInfo
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
                proactivePrompt: proactivePrompt || '',
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
