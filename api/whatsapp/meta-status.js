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
        // 1. Phone numbers — un WABA puede tener VARIOS números conectados.
        //    Se listan todos con /{wabaId}/phone_numbers; si no hay wabaId,
        //    caemos al fetch de un solo número (/{phoneNumberId}).
        const mapNumber = (n, primary) => ({
            phoneNumberId: n.id,
            phoneNumber: n.display_phone_number,
            verifiedName: n.verified_name,
            qualityRating: n.quality_rating,
            platformType: n.platform_type,
            throughput: n.throughput?.level,
            codeVerification: n.code_verification_status,
            nameStatus: n.name_status,
            status: n.status,
            webhookUrl: n.webhook_configuration?.application,
            isPrimary: primary
        });

        let numbers = [];
        if (wabaId) {
            try {
                const listRes = await axios.get(
                    `https://graph.facebook.com/v25.0/${wabaId}/phone_numbers`,
                    {
                        headers,
                        timeout: 10000,
                        params: {
                            fields: 'id,display_phone_number,verified_name,quality_rating,platform_type,throughput,code_verification_status,name_status,status,webhook_configuration',
                            limit: 50
                        }
                    }
                );
                numbers = (listRes.data?.data || []).map(n => mapNumber(n, n.id === phoneNumberId));
            } catch (e) {
                console.warn('phone_numbers list failed, fallback a número único:', e.response?.data?.error?.message || e.message);
            }
        }

        // Fallback: número único si no se pudo listar (o no hay wabaId)
        if (numbers.length === 0) {
            const phoneRes = await axios.get(
                `https://graph.facebook.com/v25.0/${phoneNumberId}`,
                { headers, timeout: 10000 }
            );
            numbers = [mapNumber(phoneRes.data, true)];
        }

        // Ordena: el principal (META_PHONE_NUMBER_ID) primero
        numbers.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
        const phone = numbers.find(n => n.isPrimary) || numbers[0];

        // 2. Pricing analytics (current month)
        let analytics = null;
        if (wabaId) {
            try {
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

                const since = Math.floor(startOfMonth.getTime() / 1000);
                const until = Math.floor(endOfDay.getTime() / 1000);

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
                const _byCategory = {};
                let estimatedCostMXN = 0;

                // ── Strategy 1: analytics (messaging counts - PMP model) ──
                let totalSent = 0;
                let totalDelivered = 0;
                try {
                    const msgRes = await axios.get(
                        `https://graph.facebook.com/v25.0/${wabaId}`,
                        {
                            headers,
                            timeout: 15000,
                            params: {
                                fields: `analytics.start(${since}).end(${until}).granularity(DAY)`
                            }
                        }
                    );
                    const rawMsg = msgRes.data?.analytics;
                    // Structure: { phone_numbers, granularity, data_points: [{start,end,sent,delivered}] }
                    if (rawMsg?.data_points) {
                        for (const dp of rawMsg.data_points) {
                            totalSent += (dp.sent || 0);
                            totalDelivered += (dp.delivered || 0);
                        }
                    }
                    totalConversations = totalSent;
                } catch (e) {
                    console.warn('analytics field failed:', e.response?.data?.error?.message || e.message);
                }

                // ── Strategy 2: pricing_analytics (real cost from Meta billing) ──
                let totalCost = 0;
                let _paidVolume = 0;
                try {
                    const priceRes = await axios.get(
                        `https://graph.facebook.com/v25.0/${wabaId}`,
                        {
                            headers,
                            timeout: 15000,
                            params: {
                                fields: `pricing_analytics.start(${since}).end(${until}).granularity(DAILY)`
                            }
                        }
                    );
                    const rawPrice = priceRes.data?.pricing_analytics;
                    if (rawPrice?.data) {
                        const dataPoints = rawPrice.data[0]?.data_points || [];
                        for (const dp of dataPoints) {
                            const vol = dp.volume || 0;
                            const cost = dp.cost || 0;
                            _paidVolume += vol;
                            totalCost += cost;
                            if (cost > 0) paidMessages += vol;
                            else freeMessages += vol;
                        }
                    }
                    estimatedCostMXN = totalCost;
                } catch (e) {
                    console.warn('pricing_analytics failed:', e.response?.data?.error?.message || e.message);
                    // Fallback: assume all service = free
                    freeMessages = totalSent;
                }

                const USD_RATE = 17.5; // Approximate MXN/USD

                analytics = {
                    period: startOfMonth.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
                    totalConversations,
                    totalSent,
                    totalDelivered,
                    freeMessages,
                    paidMessages,
                    totalCost: Math.round(totalCost * 100) / 100,
                    estimatedCostMXN: Math.round(estimatedCostMXN * 100) / 100,
                    estimatedCostUSD: Math.round((estimatedCostMXN / USD_RATE) * 100) / 100,
                    pricingModel: 'PMP',
                    rates: MXN_RATES,
                    note: 'Costos reales de Meta. Los mensajes de servicio (dentro de 24h) son GRATIS.'
                };
            } catch (analyticsError) {
                console.warn('Analytics fetch failed (non-critical):', analyticsError.response?.data?.error?.message || analyticsError.message);
                analytics = { error: analyticsError.response?.data?.error?.message || 'No se pudieron obtener analytics' };
            }
        }

        return res.status(200).json({
            connected: true,
            // Compat: campos del número principal (para UI existente)
            verifiedName: phone.verifiedName,
            displayName: phone.verifiedName || 'Candidatic IA',
            phoneNumber: phone.phoneNumber,
            qualityRating: phone.qualityRating,
            platformType: phone.platformType,
            throughput: phone.throughput,
            codeVerification: phone.codeVerification,
            phoneNumberId: phone.phoneNumberId,
            webhookUrl: phone.webhookUrl,
            // Todos los números conectados al WABA (principal primero)
            numbers,
            analytics
        });
    } catch (error) {
        return res.status(200).json({
            connected: false,
            error: error.response?.data?.error?.message || error.message
        });
    }
}
