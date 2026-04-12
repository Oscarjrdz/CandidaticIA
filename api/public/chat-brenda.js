import { getOpenAIResponse } from '../utils/openai.js';

/**
 * 🌟 PUBLIC ENDPOINT — Chat with Brenda (Landing Page Demo)
 * Stateless conversational endpoint for landing page visitors.
 * No auth required. Rate-limited by design (small history).
 */
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        const { message, history = [] } = body || {};

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ error: 'Falta el mensaje' });
        }

        // Cap history to 10 messages to prevent abuse
        const safeHistory = Array.isArray(history) ? history.slice(-10) : [];

        const systemPrompt = `Eres Brenda, una reclutadora virtual de Candidatic IA. Eres amigable, profesional pero cercana, y usas emojis con moderación (1-2 por mensaje). Tu tono es como una chica joven mexicana profesional.

TU PERSONALIDAD:
- Eres cálida y empática
- Hablas en español mexicano casual-profesional
- Usas emojis de manera natural (🌟, 💼, ✨, 😊) pero sin exagerar
- Eres directa y concisa (mensajes cortos, como en WhatsApp)
- NUNCA generes mensajes de más de 3 líneas

TU CONTEXTO:
- Trabajas para Candidatic IA, una plataforma de reclutamiento con IA
- Tu trabajo es mostrar cómo funciona la plataforma a visitantes del sitio web
- Puedes explicar las funcionalidades: Bot IA, búsqueda semántica, envíos masivos, bypass intelligence, vacantes, proyectos
- Si te preguntan por empleo, diles que pueden registrarse en la plataforma
- Si preguntan por precios, menciona los planes (Starter $1,499/mes, Pro $3,499/mes, Enterprise custom)

REGLAS:
- Responde SIEMPRE en español
- Mantén respuestas MUY cortas (estilo WhatsApp, 1-3 líneas max)
- NO uses markdown ni formato especial, solo texto plano
- Si alguien es grosero, responde con profesionalismo y redirige la conversación`;

        const formattedHistory = safeHistory.map(m => ({
            role: m.from === 'brenda' ? 'assistant' : 'user',
            content: m.text
        }));

        // Add current message
        formattedHistory.push({ role: 'user', content: message.trim() });

        const result = await getOpenAIResponse(
            formattedHistory,
            systemPrompt,
            'gpt-4o-mini',
            null,
            null,
            null,
            200 // Short responses
        );

        if (!result || !result.content) {
            throw new Error('No response from AI');
        }

        return res.status(200).json({
            success: true,
            reply: result.content.trim()
        });

    } catch (error) {
        console.error('❌ [Brenda Chat] Error:', error.message);
        return res.status(500).json({
            success: false,
            reply: '¡Ups! Parece que tengo un problemita técnico 😅 ¿Puedes intentar de nuevo?'
        });
    }
}
