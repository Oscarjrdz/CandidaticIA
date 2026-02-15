import { getUltraMsgConfig } from '../whatsapp/utils.js';

export default async function handler(req, res) {
    try {
        const config = await getUltraMsgConfig();

        return res.status(200).json({
            hasConfig: !!config,
            hasInstanceId: !!config?.instanceId,
            hasToken: !!config?.token,
            instanceIdLength: config?.instanceId?.length || 0,
            tokenLength: config?.token?.length || 0,
            // Don't expose actual values for security
            preview: config ? {
                instanceId: config.instanceId?.substring(0, 8) + '...',
                token: config.token?.substring(0, 8) + '...'
            } : null
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
