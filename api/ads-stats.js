/**
 * Endpoint for Ads Statistics
 * GET /api/ads-stats — returns aggregated ad stats
 * DELETE /api/ads-stats — hides an ad from the dashboard
 */

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const META_FETCH_TIMEOUT_MS = 8000;

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { validateAdminSession } = await import('./utils/storage.js');
    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    // ─── DELETE: Hide an ad from the dashboard ───────────────────────
    if (req.method === 'DELETE') {
        try {
            const { adKey } = req.body || {};
            if (!adKey) {
                return res.status(400).json({ success: false, error: 'adKey is required' });
            }

            const { getRedisClient } = await import('./utils/storage.js');
            const client = getRedisClient();
            if (!client) {
                return res.status(500).json({ success: false, error: 'Redis unavailable' });
            }

            await client.sadd('ads:hidden', adKey);
            return res.status(200).json({ success: true, message: 'Ad hidden successfully' });
        } catch (error) {
            console.error('Error hiding ad:', error);
            return res.status(500).json({ success: false, error: 'Error al ocultar anuncio' });
        }
    }

    // ─── GET: Return ad statistics ───────────────────────────────────
    if (req.method === 'GET') {
        try {
            const { getAdsStatistics, getRedisClient, validateAdminSession } = await import('./utils/storage.js');
            const userId = await validateAdminSession(req);
            if (!userId) return res.status(401).json({ success: false, error: 'No autorizado' });
            const data = await getAdsStatistics();

            // Filter out hidden ads
            const client = getRedisClient();
            let hiddenAds = new Set();
            if (client) {
                try {
                    const hidden = await client.smembers('ads:hidden');
                    if (hidden && hidden.length > 0) {
                        hiddenAds = new Set(hidden);
                    }
                } catch (e) {
                    // Non-fatal
                }
            }

            // Filter hidden from ads and recalculate total
            if (hiddenAds.size > 0 && data.ads) {
                const hiddenLeads = data.ads
                    .filter(a => {
                        const key = a.adId || a.adHeadline || 'unknown';
                        return hiddenAds.has(key);
                    })
                    .reduce((sum, a) => sum + (a.totalLeads || 0), 0);

                data.ads = data.ads.filter(a => {
                    const key = a.adId || a.adHeadline || 'unknown';
                    return !hiddenAds.has(key);
                });
                data.totalAdsLeads = Math.max(0, data.totalAdsLeads - hiddenLeads);
            }
            
            // Enrich with Meta Marketing API insights if token is available
            const adsToken = process.env.META_ADS_TOKEN;
            if (adsToken && data.ads && data.ads.length > 0) {
                const adIds = data.ads.map(a => a.adId).filter(Boolean);

                if (adIds.length > 0) {
                    try {
                        const { getRedisClient } = await import('./utils/storage.js');
                        const redis = getRedisClient();
                        const INSIGHTS_TTL = 3600; // 1 hora
                        const STATUS_TTL   = 3600;

                        // Fetch insights with bounded concurrency so one large account
                        // does not spike Graph API calls or exhaust the serverless window.
                        const insightResults = await allSettledWithConcurrency(
                            adIds,
                            5,
                            async adId => {
                                const cacheKey = `ads:insights:${adId}`;
                                const cached = redis ? await redis.get(cacheKey) : null;
                                if (cached) return { adId, data: JSON.parse(cached) };
                                const json = await fetchGraphJson(`${GRAPH_BASE_URL}/${adId}/insights?fields=impressions,clicks,spend,cpc,cpm,ctr,reach,frequency,actions,cost_per_action_type&date_preset=maximum&access_token=${encodeURIComponent(adsToken)}`);
                                const result = json.data?.[0] || null;
                                if (redis && result) await redis.set(cacheKey, JSON.stringify(result), 'EX', INSIGHTS_TTL);
                                return { adId, data: result, error: json.error || null };
                            }
                        );

                        // Fetch status with the same guardrail.
                        const statusResults = await allSettledWithConcurrency(
                            adIds,
                            5,
                            async adId => {
                                const cacheKey = `ads:status:${adId}`;
                                const cached = redis ? await redis.get(cacheKey) : null;
                                if (cached) return { adId, ...JSON.parse(cached) };
                                const json = await fetchGraphJson(`${GRAPH_BASE_URL}/${adId}?fields=effective_status,name&access_token=${encodeURIComponent(adsToken)}`);
                                const result = { status: json.effective_status || null, name: json.name || null };
                                if (redis && result.status) await redis.set(cacheKey, JSON.stringify(result), 'EX', STATUS_TTL);
                                return { adId, ...result };
                            }
                        );

                        // Build status map
                        const statusMap = new Map();
                        for (const result of statusResults) {
                            if (result.status === 'fulfilled' && result.value.status) {
                                statusMap.set(result.value.adId, result.value);
                            }
                        }

                        // Merge insights into ads data
                        const insightsMap = new Map();
                        for (const result of insightResults) {
                            if (result.status === 'fulfilled' && result.value.data) {
                                insightsMap.set(result.value.adId, result.value.data);
                            }
                        }

                        for (const ad of data.ads) {
                            // Merge status
                            if (ad.adId && statusMap.has(ad.adId)) {
                                const st = statusMap.get(ad.adId);
                                ad.effectiveStatus = st.status;
                                if (st.name) ad.adName = st.name;
                            }
                            if (ad.adId && insightsMap.has(ad.adId)) {
                                const insight = insightsMap.get(ad.adId);
                                ad.impressions = insight.impressions || null;
                                ad.clicks = insight.clicks || null;
                                ad.spend = insight.spend || null;
                                ad.cpc = insight.cpc || null;
                                ad.cpm = insight.cpm || null;
                                ad.ctr = insight.ctr || null;
                                ad.reach = insight.reach || null;
                                ad.frequency = insight.frequency || null;
                                
                                // Extract key actions
                                if (insight.actions) {
                                    for (const action of insight.actions) {
                                        if (action.action_type === 'onsite_conversion.messaging_first_reply') {
                                            ad.messagingReplies = action.value;
                                        }
                                        if (action.action_type === 'onsite_conversion.total_messaging_connection') {
                                            ad.messagingConnections = action.value;
                                        }
                                        if (action.action_type === 'link_click') {
                                            ad.linkClicks = action.value;
                                        }
                                        if (action.action_type === 'post_engagement') {
                                            ad.postEngagement = action.value;
                                        }
                                        if (action.action_type === 'post_reaction') {
                                            ad.reactions = action.value;
                                        }
                                    }
                                }
                                
                                // Extract cost per messaging connection
                                if (insight.cost_per_action_type) {
                                    for (const cost of insight.cost_per_action_type) {
                                        if (cost.action_type === 'onsite_conversion.total_messaging_connection') {
                                            ad.costPerConversation = cost.value;
                                        }
                                        if (cost.action_type === 'link_click') {
                                            ad.costPerLinkClick = cost.value;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (metaError) {
                        console.error('Meta Marketing API error (non-fatal):', metaError.message);
                        // Non-fatal: we still return Redis data even if Meta API fails
                    }
                }
            }

            res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
            return res.status(200).json({
                success: true,
                ads: data.ads,
                totalAdsLeads: data.totalAdsLeads
            });
        } catch (error) {
            console.error('Error fetching ads stats:', error);
            return res.status(500).json({
                success: false,
                error: 'Error al obtener estadísticas de anuncios'
            });
        }
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
}

async function fetchGraphJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, { signal: controller.signal });
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function allSettledWithConcurrency(items, limit, iteratee) {
    const results = new Array(items.length);
    let index = 0;

    async function worker() {
        while (index < items.length) {
            const current = index++;
            try {
                results[current] = { status: 'fulfilled', value: await iteratee(items[current], current) };
            } catch (reason) {
                results[current] = { status: 'rejected', reason };
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
