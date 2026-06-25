/**
 * Endpoint for Ads Comments (Facebook Graph API)
 * GET  /api/ads-comments?adId=xxx  — returns comments for a specific ad's post
 * POST /api/ads-comments           — reply to a comment
 * 
 * Uses META_ADS_TOKEN for Marketing API (ad → post resolution)
 * Falls back to META_ACCESS_TOKEN (Page Token) for reading/writing comments
 */

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const COMMENTS_CACHE_TTL = 60;
const POST_ID_CACHE_TTL = 6 * 60 * 60;
const PAGE_TOKEN_CACHE_TTL = 30 * 60;

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { validateAdminSession, getRedisClient } = await import('./utils/storage.js');
    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const adsToken = process.env.META_ADS_TOKEN;
    const pageToken = process.env.META_ACCESS_TOKEN;
    const redis = getRedisClient();

    if (!adsToken && !pageToken) {
        return res.status(500).json({ success: false, error: 'No Meta tokens configured' });
    }

    const commentsToken = await resolveCommentsToken({ pageToken, adsToken, redis });

    // ─── GET: Fetch comments for an ad ──────────────────────────────
    if (req.method === 'GET') {
        const { adId } = req.query;
        if (!adId) {
            return res.status(400).json({ success: false, error: 'adId is required' });
        }

        try {
            const cacheKey = `ads:comments:${adId}`;
            const cached = redis ? await redis.get(cacheKey).catch(() => null) : null;
            if (cached) {
                res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
                return res.status(200).json(JSON.parse(cached));
            }

            // Step 1: Get the post ID from the ad creative (needs ads token)
            const postId = adsToken ? await resolveAdPostId({ adId, adsToken, redis }) : null;

            if (!postId) {
                return res.status(200).json({ success: true, comments: [], postId: null, message: 'No se encontró el post vinculado a este anuncio' });
            }

            // Step 2: Fetch comments from the post (use page token)
            const commentsRes = await fetch(
                `${GRAPH_BASE_URL}/${postId}/comments?fields=id,message,from,created_time,comment_count,like_count,attachment&limit=50&order=reverse_chronological&access_token=${encodeURIComponent(commentsToken)}`
            );
            const commentsData = await commentsRes.json();

            if (commentsData.error) {
                // If page token failed, try ads token as fallback
                if (commentsToken !== adsToken && adsToken) {
                    const retryRes = await fetch(
                        `${GRAPH_BASE_URL}/${postId}/comments?fields=id,message,from,created_time,comment_count,like_count,attachment&limit=50&order=reverse_chronological&access_token=${encodeURIComponent(adsToken)}`
                    );
                    const retryData = await retryRes.json();
                    if (!retryData.error) {
                        const payload = await processComments(retryData.data || [], adsToken, postId);
                        if (redis) await redis.set(cacheKey, JSON.stringify(payload), 'EX', COMMENTS_CACHE_TTL).catch(() => {});
                        return res.status(200).json(payload);
                    }
                }
                console.error('[Ads Comments] Graph API error:', commentsData.error);
                return res.status(400).json({ success: false, error: commentsData.error.message || 'Error al cargar comentarios. Verifica los permisos del token.' });
            }

            const payload = await processComments(commentsData.data || [], commentsToken, postId);
            if (redis) await redis.set(cacheKey, JSON.stringify(payload), 'EX', COMMENTS_CACHE_TTL).catch(() => {});
            res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
            return res.status(200).json(payload);

        } catch (error) {
            console.error('[Ads Comments] Error:', error);
            return res.status(500).json({ success: false, error: 'Error al obtener comentarios' });
        }
    }

    // ─── POST: Reply to a comment ───────────────────────────────────
    if (req.method === 'POST') {
        const { commentId, message, adId } = req.body || {};

        if (!commentId || !message) {
            return res.status(400).json({ success: false, error: 'commentId and message are required' });
        }

        try {
            // Page token is required for posting replies
            const replyToken = commentsToken;

            const replyRes = await fetch(
                `${GRAPH_BASE_URL}/${commentId}/comments`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message,
                        access_token: replyToken
                    })
                }
            );
            const replyData = await replyRes.json();

            if (replyData.error) {
                console.error('[Ads Comments] Reply error:', replyData.error);
                return res.status(400).json({ success: false, error: replyData.error.message || 'Error al responder' });
            }

            if (redis && adId) await redis.del(`ads:comments:${adId}`).catch(() => {});

            return res.status(200).json({
                success: true,
                replyId: replyData.id,
                reply: {
                    id: replyData.id,
                    message,
                    from: { name: 'Página', id: '' },
                    createdTime: new Date().toISOString(),
                    likeCount: 0
                },
                message: 'Respuesta enviada exitosamente'
            });

        } catch (error) {
            console.error('[Ads Comments] Reply error:', error);
            return res.status(500).json({ success: false, error: 'Error al enviar respuesta' });
        }
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
}

/**
 * Process and enrich comments with replies
 */
async function processComments(comments, token, postId) {
    const enrichedComments = await mapWithConcurrency(comments, 6, async (comment) => {
        const enriched = {
            id: comment.id,
            message: comment.message || '',
            from: comment.from || { name: 'Usuario', id: '' },
            createdTime: comment.created_time,
            likeCount: comment.like_count || 0,
            replyCount: comment.comment_count || 0,
            attachment: comment.attachment || null,
            replies: []
        };

        // Fetch replies if comment has any
        if (comment.comment_count > 0) {
            try {
                const repliesRes = await fetch(
                    `${GRAPH_BASE_URL}/${comment.id}/comments?fields=id,message,from,created_time,like_count&limit=10&access_token=${encodeURIComponent(token)}`
                );
                const repliesData = await repliesRes.json();
                if (repliesData.data) {
                    enriched.replies = repliesData.data.map(r => ({
                        id: r.id,
                        message: r.message || '',
                        from: r.from || { name: 'Usuario', id: '' },
                        createdTime: r.created_time,
                        likeCount: r.like_count || 0
                    }));
                }
            } catch (e) {
                // Non-fatal: replies fetch failed
            }
        }

        return enriched;
    });

    return {
        success: true,
        postId,
        comments: enrichedComments,
        totalComments: enrichedComments.length
    };
}

async function resolveCommentsToken({ pageToken, adsToken, redis }) {
    const directPageToken = process.env.META_PAGE_TOKEN || process.env.MESSENGER_PAGE_TOKEN;
    if (directPageToken) return directPageToken;

    const cacheKey = 'meta:page-token:ads-comments';
    const cached = redis ? await redis.get(cacheKey).catch(() => null) : null;
    if (cached) return cached;

    let commentsToken = pageToken || adsToken;

    try {
        if (pageToken) {
            const accountsRes = await fetch(`${GRAPH_BASE_URL}/me/accounts?access_token=${encodeURIComponent(pageToken)}`);
            const accountsData = await accountsRes.json();
            if (accountsData?.data?.[0]?.access_token) {
                commentsToken = accountsData.data[0].access_token;
                if (redis) await redis.set(cacheKey, commentsToken, 'EX', PAGE_TOKEN_CACHE_TTL).catch(() => {});
            }
        }
    } catch (e) {
        console.error('[Ads Comments] Failed to fetch Page Token fallback', e);
    }

    return commentsToken;
}

async function resolveAdPostId({ adId, adsToken, redis }) {
    const cacheKey = `ads:post-id:${adId}`;
    const cached = redis ? await redis.get(cacheKey).catch(() => null) : null;
    if (cached) return cached === '__none__' ? null : cached;

    let postId = null;

    const adRes = await fetch(
        `${GRAPH_BASE_URL}/${adId}?fields=creative{effective_object_story_id}&access_token=${encodeURIComponent(adsToken)}`
    );
    const adData = await adRes.json();

    if (!adData.error) {
        postId = adData?.creative?.effective_object_story_id;
    }

    // Some dynamic/legacy creatives expose story IDs only through the adcreatives edge.
    if (!postId) {
        const creativesRes = await fetch(
            `${GRAPH_BASE_URL}/${adId}/adcreatives?fields=effective_object_story_id&access_token=${encodeURIComponent(adsToken)}`
        );
        const creativesData = await creativesRes.json();
        postId = creativesData.data?.[0]?.effective_object_story_id || null;
    }

    if (redis) {
        await redis
            .set(cacheKey, postId || '__none__', 'EX', postId ? POST_ID_CACHE_TTL : COMMENTS_CACHE_TTL)
            .catch(() => {});
    }

    return postId;
}

async function mapWithConcurrency(items, limit, iteratee) {
    const results = new Array(items.length);
    let index = 0;

    async function worker() {
        while (index < items.length) {
            const current = index++;
            results[current] = await iteratee(items[current], current);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
