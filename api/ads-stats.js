/**
 * Endpoint for Ads Statistics
 * GET /api/ads-stats
 * Combines Redis candidate data with live Meta Marketing API insights
 */

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        try {
            const { getAdsStatistics } = await import('./utils/storage.js');
            const data = await getAdsStatistics();
            
            // Enrich with Meta Marketing API insights if token is available
            const adsToken = process.env.META_ADS_TOKEN;
            if (adsToken && data.ads && data.ads.length > 0) {
                const adIds = data.ads
                    .map(a => a.adId)
                    .filter(Boolean);
                
                if (adIds.length > 0) {
                    try {
                        // Fetch insights for each ad in parallel
                        const insightResults = await Promise.allSettled(
                            adIds.map(adId =>
                                fetch(`https://graph.facebook.com/v21.0/${adId}/insights?fields=impressions,clicks,spend,cpc,cpm,ctr,reach,frequency,actions,cost_per_action_type&date_preset=maximum&access_token=${adsToken}`)
                                    .then(r => r.json())
                                    .then(json => ({ adId, data: json.data?.[0] || null, error: json.error || null }))
                            )
                        );

                        // Merge insights into ads data
                        const insightsMap = new Map();
                        for (const result of insightResults) {
                            if (result.status === 'fulfilled' && result.value.data) {
                                insightsMap.set(result.value.adId, result.value.data);
                            }
                        }

                        for (const ad of data.ads) {
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
