import axios from 'axios';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        let { apiKey } = req.body;

        if (!apiKey) {
            // Try to get from Redis if not in body
            const { getRedisClient } = await import('../utils/storage.js');
            const redis = getRedisClient();
            if (redis) {
                const config = await redis.get('ai_config');
                if (config) {
                    apiKey = JSON.parse(config).openaiApiKey;
                }
            }
        }

        if (!apiKey) {
            return res.status(400).json({ success: false, error: 'No se proporcionó una llave de API (OpenAI)' });
        }

        const cleanKey = String(apiKey).trim();

        // Validate via a simple chat completion call
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'OK' }],
            max_tokens: 5
        }, {
            headers: {
                'Authorization': `Bearer ${cleanKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        if (response.data && response.data.choices) {
            return res.status(200).json({
                success: true,
                message: 'Conexión con OpenAI exitosa',
                model: 'gpt-4o-mini'
            });
        } else {
            throw new Error('Respuesta inesperada de OpenAI');
        }

    } catch (error) {
        console.error('❌ [OpenAI Validation] Failed:', error.response?.data || error.message);

        let errorMessage = 'Llave de OpenAI inválida o error de conexión';
        const apiError = error.response?.data?.error?.message;

        if (apiError) {
            errorMessage = `Error de OpenAI: ${apiError}`;
        } else if (error.message.includes('timeout')) {
            errorMessage = 'Tiempo de espera agotado al conectar con OpenAI';
        }

        return res.status(200).json({
            success: false,
            error: errorMessage
        });
    }
}
