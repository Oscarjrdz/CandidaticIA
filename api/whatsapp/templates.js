import axios from 'axios';
import { getMetaConfig } from './utils.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const config = getMetaConfig();
        if (!config.wabaId || !config.accessToken) {
            return res.status(400).json({ error: 'Falta configurar META_WABA_ID o META_ACCESS_TOKEN' });
        }

        const url = `https://graph.facebook.com/v21.0/${config.wabaId}/message_templates`;
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${config.accessToken}`
            }
        });

        // Map and extract the useful fields
        const templates = (response.data?.data || []).map(t => ({
            id: t.id,
            name: t.name,
            category: t.category,
            language: t.language,
            status: t.status,
            components: t.components
        }));

        return res.status(200).json({ success: true, data: templates });

    } catch (error) {
        console.error('❌ Error fetching templates:', error.response?.data || error.message);
        return res.status(500).json({ 
            success: false, 
            error: error.response?.data?.error?.message || error.message 
        });
    }
}
