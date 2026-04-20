import axios from 'axios';

/**
 * GET /api/whatsapp/meta-status
 * Returns connection status + pricing analytics from Meta Cloud API.
 * 
 * PRICING MODEL (post July 2025 — "Per-Message Pricing" / PMP):
 *   - Service messages (non-template replies within 24h window) = FREE
 *   - Utility templates within CSW = FREE
 *   - Marketing templates = PAID (per message delivered)
 *   - Utility templates outside CSW = PAID
 *   - Authentication templates = PAID
 *   
 * Mexico rates (MXN, Tier 0 baseline):
 *   Marketing:      ~$0.4042 MXN per msg
 *   Utility:        ~$0.1529 MXN per msg  
 *   Authentication: ~$0.2718 MXN per msg
 *   Service:        FREE
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    const wabaId = process.env.META_WABA_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
        return res.status(200).json({
            connected: false,
            error: 'META_PHONE_NUMBER_ID or META_ACCESS_TOKEN not configured'
        });
    }

    const headers = { 'Authorization': `Bearer ${accessToken}` };

    try {
        // 1. Phone number status
        const phoneRes = await axios.get(
            `https://graph.facebook.com/v21.0/${phoneNumberId}`,
            { headers, timeout: 10000 }
        );
        const phone = phoneRes.data;

        // 2. Pricing analytics (current month)
        let analytics = null;
        if (wabaId) {
            try {
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

                const since = Math.floor(startOfMonth.getTime() / 1000);
                const until = Math.floor(endOfDay.getTime() / 1000);

                // Use pricing_analytics for per-message billing model
                const analyticsRes = await axios.get(
                    `https://graph.facebook.com/v21.0/${wabaId}`,
                    {
                        headers,
                        timeout: 15000,
                        params: {
                            fields: `conversation_analytics.start(${since}).end(${until}).granularity(MONTHLY).phone_numbers([${phoneNumberId}]).dimensions(["CONVERSATION_CATEGORY","CONVERSATION_TYPE","COUNTRY","PHONE"])`
                        }
                    }
                );

                const rawAnalytics = analyticsRes.data?.conversation_analytics;

                // Mexico per-message rates (MXN) - Tier 0 / list price
                // Source: Meta official rate card (MXN) as of Q2 2026
                const MXN_RATES = {
                    MARKETING: 0.4042,
                    UTILITY: 0.1529,
                    AUTHENTICATION: 0.2718,
                    SERVICE: 0 // Free
                };

                let totalConversations = 0;
                let freeMessages = 0;
                let paidMessages = 0;
                const byCategory = {};
                let estimatedCostMXN = 0;

                if (rawAnalytics?.data) {
                    const dataPoints = rawAnalytics.data[0]?.data_points || [];

                    for (const dp of dataPoints) {
                        const category = dp.CONVERSATION_CATEGORY || 'UNKNOWN';
                        const type = dp.CONVERSATION_TYPE || 'REGULAR';
                        const count = dp.conversation || 0;

                        totalConversations += count;
                        byCategory[category] = (byCategory[category] || 0) + count;

                        if (type === 'FREE_TIER' || type === 'FREE_ENTRY_POINT' || category === 'SERVICE') {
                            freeMessages += count;
                        } else {
                            paidMessages += count;
                            estimatedCostMXN += count * (MXN_RATES[category] || 0.15);
                        }
                    }
                }

                const USD_RATE = 17.5; // Approximate MXN/USD

                analytics = {
                    period: startOfMonth.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
                    totalConversations,
                    freeMessages,
                    paidMessages,
                    byCategory,
                    estimatedCostMXN: Math.round(estimatedCostMXN * 100) / 100,
                    estimatedCostUSD: Math.round((estimatedCostMXN / USD_RATE) * 100) / 100,
                    pricingModel: 'PMP', // Per-Message Pricing
                    rates: MXN_RATES,
                    note: 'Mensajes de servicio (respuestas dentro de 24h) son GRATIS. Solo se cobra por templates de marketing/utilidad/auth entregados.'
                };
            } catch (analyticsError) {
                console.warn('Analytics fetch failed (non-critical):', analyticsError.response?.data?.error?.message || analyticsError.message);
                analytics = { error: analyticsError.response?.data?.error?.message || 'No se pudieron obtener analytics' };
            }
        }

        return res.status(200).json({
            connected: true,
            verifiedName: phone.verified_name,
            displayName: phone.verified_name || 'Candidatic IA',
            phoneNumber: phone.display_phone_number,
            qualityRating: phone.quality_rating,
            platformType: phone.platform_type,
            throughput: phone.throughput?.level,
            codeVerification: phone.code_verification_status,
            phoneNumberId: phone.id,
            webhookUrl: phone.webhook_configuration?.application,
            analytics
        });
    } catch (error) {
        return res.status(200).json({
            connected: false,
            error: error.response?.data?.error?.message || error.message
        });
    }
}
