/**
 * Endpoint for Ads Statistics
 * GET /api/ads-stats — returns aggregated ad stats
 * DELETE /api/ads-stats — hides an ad from the dashboard
 */

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const META_FETCH_TIMEOUT_MS = 20000; // lotes de 50 anuncios con insights tardan mas que una llamada suelta

// Respuesta ya enriquecida con Meta, cacheada completa: cargas repetidas = 1 GET de Redis.
// Se guarda ANTES de filtrar ocultos para que ocultar/mostrar un anuncio aplique al instante.
// STALE: copia de larga vida para responder INSTANTANEO cuando el cache fresco expiro —
// el frontend detecta stale:true y dispara un refresh en segundo plano (?refresh=true).
const ENRICHED_CACHE_KEY = 'ads:stats:enriched:v1';
const ENRICHED_STALE_KEY = 'ads:stats:enriched:stale';
const ENRICHED_TTL_SECONDS = 5 * 60;
const ENRICHED_STALE_TTL_SECONDS = 60 * 60 * 24;

// Campos pedidos por anuncio en UNA sola sub-request del Batch API (antes eran 2 llamadas
// sueltas por anuncio: insights + status = ~146 llamadas para 73 anuncios; ahora ~2 lotes).
// creative.thumbnail: imagen fresca del creativo — las URLs de referral guardadas expiran
// (CDN firmado de Meta), por eso habia imagenes rotas; el thumbnail se renueva en cada lote.
const AD_FIELDS = 'effective_status,name,creative.thumbnail_width(512).thumbnail_height(512){thumbnail_url},insights.date_preset(maximum){impressions,clicks,spend,cpc,cpm,ctr,reach,frequency,actions,cost_per_action_type}';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { validateAdminSession } = await import('./utils/storage.js');
    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    // ─── DELETE: Archivar (o restaurar) un anuncio del dashboard ─────
    // El set ads:hidden funciona como archivo: sadd = archivar, srem = restaurar.
    if (req.method === 'DELETE') {
        try {
            const { adKey, restore } = req.body || {};
            if (!adKey) {
                return res.status(400).json({ success: false, error: 'adKey is required' });
            }

            const { getRedisClient } = await import('./utils/storage.js');
            const client = getRedisClient();
            if (!client) {
                return res.status(500).json({ success: false, error: 'Redis unavailable' });
            }

            if (restore) {
                await client.srem('ads:hidden', adKey);
                return res.status(200).json({ success: true, message: 'Ad restored successfully' });
            }
            await client.sadd('ads:hidden', adKey);
            return res.status(200).json({ success: true, message: 'Ad archived successfully' });
        } catch (error) {
            console.error('Error archiving ad:', error);
            return res.status(500).json({ success: false, error: 'Error al archivar anuncio' });
        }
    }

    // ─── GET: Return ad statistics ───────────────────────────────────
    if (req.method === 'GET') {
        try {
            const { getAdsStatistics, getRedisClient } = await import('./utils/storage.js');
            const client = getRedisClient();

            const forceRefresh = req.query?.refresh === 'true';

            // 1) Cache de respuesta enriquecida completa (5 min): carga repetida = instantanea.
            let data = null;
            let servedStale = false;
            if (client && !forceRefresh) {
                try {
                    const cached = await client.get(ENRICHED_CACHE_KEY);
                    if (cached) data = JSON.parse(cached);
                } catch { /* cache miss */ }

                // 1b) Fresco expirado: servir la copia stale AL INSTANTE (el frontend ve
                //     stale:true y dispara ?refresh=true en segundo plano). Solo se paga
                //     la reconstruccion completa cuando ni siquiera hay copia stale.
                if (!data) {
                    try {
                        const stale = await client.get(ENRICHED_STALE_KEY);
                        if (stale) { data = JSON.parse(stale); servedStale = true; }
                    } catch { /* sin stale */ }
                }
            }

            // 2) Miss total o refresh forzado: agregado local + UN solo Batch API a Meta
            //    (50 anuncios por lote, sub-requests aisladas — un anuncio borrado no
            //    tumba el lote). Antes: 2 llamadas por anuncio (~146 para 73 anuncios).
            if (!data) {
                // 🔒 Lock anti-estampida: un solo request reconstruye (índice + Batch a Meta)
                //    a la vez. Los demás esperan corto y sirven lo que ese publique, en vez de
                //    disparar N reconstrucciones full en paralelo.
                const REBUILD_LOCK_KEY = 'ads:stats:rebuild:lock';
                let haveRebuildLock = true;
                if (client) {
                    try { haveRebuildLock = (await client.set(REBUILD_LOCK_KEY, '1', 'EX', 45, 'NX')) === 'OK'; }
                    catch { haveRebuildLock = true; }
                }
                if (!haveRebuildLock) {
                    // Otro request ya reconstruye: espera ~3s a que publique cache (fresco/stale).
                    for (let i = 0; i < 20 && !data; i++) {
                        await new Promise(r => setTimeout(r, 150));
                        try {
                            const c2 = (await client.get(ENRICHED_CACHE_KEY)) || (await client.get(ENRICHED_STALE_KEY));
                            if (c2) { data = JSON.parse(c2); servedStale = true; }
                        } catch { /* seguir esperando al que reconstruye */ }
                    }
                    // Si tras ~3s sigue sin nada (primer build lento), construimos igual (evita deadlock).
                }

              if (!data) {
                try {
                // Refresh explicito: tambien renovar el agregado local (leads/conteos),
                // no solo las metricas de Meta.
                if (forceRefresh && client) await client.del('stats:ads:cached').catch(() => {});
                data = await getAdsStatistics();
                const adsToken = process.env.META_ADS_TOKEN;
                const adIds = (data.ads || []).map(a => a.adId).filter(Boolean);

                if (adsToken && adIds.length > 0) {
                    try {
                        const chunks = [];
                        for (let i = 0; i < adIds.length; i += 50) chunks.push(adIds.slice(i, i + 50));
                        const batchResponses = await Promise.all(chunks.map(chunk => fetchGraphBatch(chunk, adsToken)));

                        // Las sub-respuestas llegan en el MISMO orden que las sub-requests
                        // (garantia del Batch API) — mapear por indice, no por body.id.
                        const metaById = new Map();
                        batchResponses.forEach((arr, ci) => {
                            if (!Array.isArray(arr)) return;
                            arr.forEach((sub, i) => {
                                if (sub?.code !== 200 || !sub.body) return; // anuncio borrado/sin permiso: aislado
                                try {
                                    metaById.set(String(chunks[ci][i]), JSON.parse(sub.body));
                                } catch { /* sub-request malformada, ignorar */ }
                            });
                        });

                        for (const ad of data.ads) {
                            const meta = ad.adId ? metaById.get(String(ad.adId)) : null;
                            if (!meta) continue;
                            ad.effectiveStatus = meta.effective_status || null;
                            if (meta.name) ad.adName = meta.name;
                            // Imagen fresca del creativo (la URL de referral guardada expira)
                            const thumb = meta.creative?.thumbnail_url || null;
                            if (thumb) ad.adImageUrl = thumb;

                            const insight = meta.insights?.data?.[0];
                            if (insight) {
                                ad.impressions = insight.impressions || null;
                                ad.clicks = insight.clicks || null;
                                ad.spend = insight.spend || null;
                                ad.cpc = insight.cpc || null;
                                ad.cpm = insight.cpm || null;
                                ad.ctr = insight.ctr || null;
                                ad.reach = insight.reach || null;
                                ad.frequency = insight.frequency || null;

                                if (insight.actions) {
                                    for (const action of insight.actions) {
                                        if (action.action_type === 'onsite_conversion.messaging_first_reply') ad.messagingReplies = action.value;
                                        if (action.action_type === 'onsite_conversion.total_messaging_connection') ad.messagingConnections = action.value;
                                        if (action.action_type === 'link_click') ad.linkClicks = action.value;
                                        if (action.action_type === 'post_engagement') ad.postEngagement = action.value;
                                        if (action.action_type === 'post_reaction') ad.reactions = action.value;
                                    }
                                }
                                if (insight.cost_per_action_type) {
                                    for (const cost of insight.cost_per_action_type) {
                                        if (cost.action_type === 'onsite_conversion.total_messaging_connection') ad.costPerConversation = cost.value;
                                        if (cost.action_type === 'link_click') ad.costPerLinkClick = cost.value;
                                    }
                                }
                            }
                        }

                        // Solo cachear si Meta respondio algo — un fallo total se reintenta
                        // en la proxima visita en vez de congelar datos sin enriquecer 5 min.
                        if (client && metaById.size > 0) {
                            const blob = JSON.stringify(data);
                            client.set(ENRICHED_CACHE_KEY, blob, 'EX', ENRICHED_TTL_SECONDS).catch(() => {});
                            client.set(ENRICHED_STALE_KEY, blob, 'EX', ENRICHED_STALE_TTL_SECONDS).catch(() => {});
                        }
                    } catch (metaError) {
                        console.error('Meta Marketing API error (non-fatal):', metaError.message);
                        // Non-fatal: we still return Redis data even if Meta API fails
                    }
                }
                } finally {
                    if (haveRebuildLock && client) client.del(REBUILD_LOCK_KEY).catch(() => {});
                }
              } else if (haveRebuildLock && client) {
                // El otro request publicó el cache mientras esperábamos: soltamos el lock.
                client.del(REBUILD_LOCK_KEY).catch(() => {});
              }
            }

            // 3) Archivados SIEMPRE al final (sobre el cache o lo fresco), para que
            //    archivar/restaurar aplique de inmediato sin esperar TTL.
            //    - Normal: se excluyen del listado y del total.
            //    - ?includeArchived=true: se incluyen todos, marcados con archived: true.
            const includeArchived = req.query?.includeArchived === 'true';
            let hiddenAds = new Set();
            if (client) {
                try {
                    const hidden = await client.smembers('ads:hidden');
                    if (hidden && hidden.length > 0) hiddenAds = new Set(hidden);
                } catch (e) {
                    // Non-fatal
                }
            }
            if (hiddenAds.size > 0 && data.ads) {
                if (includeArchived) {
                    for (const a of data.ads) {
                        a.archived = hiddenAds.has(a.adId || a.adHeadline || 'unknown');
                    }
                } else {
                    const hiddenLeads = data.ads
                        .filter(a => hiddenAds.has(a.adId || a.adHeadline || 'unknown'))
                        .reduce((sum, a) => sum + (a.totalLeads || 0), 0);
                    data.ads = data.ads.filter(a => !hiddenAds.has(a.adId || a.adHeadline || 'unknown'));
                    data.totalAdsLeads = Math.max(0, data.totalAdsLeads - hiddenLeads);
                }
            }

            res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
            return res.status(200).json({
                success: true,
                ads: data.ads,
                totalAdsLeads: data.totalAdsLeads,
                stale: servedStale
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

/**
 * Meta Graph Batch API: hasta 50 sub-requests (una por anuncio) en UNA llamada HTTP.
 * Cada sub-request esta aislada — un anuncio borrado regresa su propio code=400 sin
 * afectar a los demas (verificado contra la API real con un ID falso mezclado).
 * Regresa el array de sub-respuestas [{ code, body }] en el mismo orden que adIds.
 */
async function fetchGraphBatch(adIds, adsToken) {
    const batch = JSON.stringify(adIds.map(id => ({
        method: 'GET',
        relative_url: `${id}?fields=${encodeURIComponent(AD_FIELDS)}`
    })));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(`${GRAPH_BASE_URL}/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ batch, access_token: adsToken, include_headers: 'false' }),
            signal: controller.signal
        });
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}
