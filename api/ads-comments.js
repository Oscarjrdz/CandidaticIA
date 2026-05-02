/**
 * Endpoint for Ads Comments (Facebook Graph API)
 * GET  /api/ads-comments?adId=xxx  — returns comments for a specific ad's post
 * POST /api/ads-comments           — reply to a comment
 */

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const adsToken = process.env.META_ADS_TOKEN;
    if (!adsToken) {
        return res.status(500).json({ success: false, error: 'META_ADS_TOKEN not configured' });
    }

    // ─── GET: Fetch comments for an ad ──────────────────────────────
    if (req.method === 'GET') {
        const { adId } = req.query;
        if (!adId) {
            return res.status(400).json({ success: false, error: 'adId is required' });
        }

        try {
            // Step 1: Get the post ID from the ad creative
            const adRes = await fetch(
                `https://graph.facebook.com/v21.0/${adId}?fields=creative{effective_object_story_id}&access_token=${adsToken}`
            );
            const adData = await adRes.json();

            if (adData.error) {
                console.error('[Ads Comments] Graph API error fetching ad:', adData.error);
                return res.status(400).json({ success: false, error: adData.error.message || 'Error fetching ad data' });
            }

            const postId = adData?.creative?.effective_object_story_id;
            if (!postId) {
                return res.status(200).json({ success: true, comments: [], postId: null, message: 'No post linked to this ad' });
            }

            // Step 2: Fetch comments from the post
            const commentsRes = await fetch(
                `https://graph.facebook.com/v21.0/${postId}/comments?fields=id,message,from,created_time,comment_count,like_count,attachment,parent&limit=50&order=reverse_chronological&access_token=${adsToken}`
            );
            const commentsData = await commentsRes.json();

            if (commentsData.error) {
                console.error('[Ads Comments] Graph API error fetching comments:', commentsData.error);
                return res.status(400).json({ success: false, error: commentsData.error.message || 'Error fetching comments' });
            }

            // Step 3: For each comment with replies, fetch the replies
            const comments = commentsData.data || [];
            const enrichedComments = [];

            for (const comment of comments) {
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
                            `https://graph.facebook.com/v21.0/${comment.id}/comments?fields=id,message,from,created_time,like_count&limit=10&access_token=${adsToken}`
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

                enrichedComments.push(enriched);
            }

            return res.status(200).json({
                success: true,
                postId,
                comments: enrichedComments,
                totalComments: enrichedComments.length
            });

        } catch (error) {
            console.error('[Ads Comments] Error:', error);
            return res.status(500).json({ success: false, error: 'Error al obtener comentarios' });
        }
    }

    // ─── POST: Reply to a comment ───────────────────────────────────
    if (req.method === 'POST') {
        const { commentId, message } = req.body || {};

        if (!commentId || !message) {
            return res.status(400).json({ success: false, error: 'commentId and message are required' });
        }

        try {
            const replyRes = await fetch(
                `https://graph.facebook.com/v21.0/${commentId}/comments`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message,
                        access_token: adsToken
                    })
                }
            );
            const replyData = await replyRes.json();

            if (replyData.error) {
                console.error('[Ads Comments] Reply error:', replyData.error);
                return res.status(400).json({ success: false, error: replyData.error.message || 'Error al responder' });
            }

            return res.status(200).json({
                success: true,
                replyId: replyData.id,
                message: 'Respuesta enviada exitosamente'
            });

        } catch (error) {
            console.error('[Ads Comments] Reply error:', error);
            return res.status(500).json({ success: false, error: 'Error al enviar respuesta' });
        }
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
}
