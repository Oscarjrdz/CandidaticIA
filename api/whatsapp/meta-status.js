import axios from 'axios';

/**
 * GET /api/whatsapp/meta-status
 * Returns the connection status of the Meta Cloud API line.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
        return res.status(200).json({
            connected: false,
            error: 'META_PHONE_NUMBER_ID or META_ACCESS_TOKEN not configured'
        });
    }

    try {
        const response = await axios.get(
            `https://graph.facebook.com/v21.0/${phoneNumberId}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                timeout: 10000
            }
        );

        const data = response.data;

        return res.status(200).json({
            connected: true,
            verifiedName: data.verified_name,
            displayName: data.verified_name || 'Candidatic IA',
            phoneNumber: data.display_phone_number,
            qualityRating: data.quality_rating,
            platformType: data.platform_type,
            throughput: data.throughput?.level,
            codeVerification: data.code_verification_status,
            phoneNumberId: data.id,
            webhookUrl: data.webhook_configuration?.application
        });
    } catch (error) {
        return res.status(200).json({
            connected: false,
            error: error.response?.data?.error?.message || error.message
        });
    }
}
