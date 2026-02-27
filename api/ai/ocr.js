import { getOpenAIResponse } from '../utils/openai.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { image } = req.body; // Expects base64 string data:image/...;base64,...

        if (!image) {
            return res.status(400).json({ error: 'No image provided for OCR' });
        }

        const systemPrompt = `Eres un sistema experto en OCR (Reconocimiento Óptico de Caracteres). 
Tu única misión es extraer TODO el texto visible en la imagen proporcionada.
Organiza la información extraída de forma lógica y clara usando formato Markdown (listas, tablas si aplica, texto plano).
No inventes información, no agregues saludos, ni explicaciones adicionales. Extrae pura y exclusivamente lo que ves en la imagen.`;

        // We format the multimodal message
        const messages = []; // Empty since we use the system prompt for instructions

        const multimodalArray = [
            {
                type: "image_url",
                image_url: { url: image } // GPT-4o supports base64 data URLs here
            }
        ];

        console.log('[OCR] Processing image extraction...');
        const response = await getOpenAIResponse(
            messages,
            systemPrompt,
            'gpt-4o-mini', // Mini is fast and cheap, has vision
            null,
            null,
            multimodalArray
        );

        if (response && response.content) {
            console.log('[OCR] Extraction successful');
            return res.status(200).json({ success: true, text: response.content.trim() });
        } else {
            throw new Error('No content returned from OpenAI Vision');
        }

    } catch (error) {
        console.error('[OCR] Error during extraction:', error);
        return res.status(500).json({ error: 'Failed to extract text from image' });
    }
}
