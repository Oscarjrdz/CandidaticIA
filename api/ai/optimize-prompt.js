import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const instruction = `
            Eres un experto en Reclutamiento y Psicología Organizacional. 
            Tu tarea es convertir una instrucción simple de un reclutador en un "System Prompt" optimizado para Brenda, una reclutadora IA que contactará candidatos por WhatsApp.

            REGLAS:
            1. El prompt resultante debe ser en SEGUNDA PERSONA (Como Brenda).
            2. Debe ser amable, profesional pero adaptable.
            3. Debe incluir el uso estratégico de variables: {{Candidato}} y {{Vacante}}.
            4. El tono debe ser humano, no robótico. No uses saludos excesivamente formales si la instrucción es casual.
            5. Mantén la brevedad (máximo 400 caracteres) porque es para WhatsApp.

            INSTRUCCIÓN DEL RECLUTADOR:
            "${prompt}"

            RESPONDE SOLO CON EL PROMPT OPTIMIZADO:
        `;

        const result = await model.generateContent(instruction);
        const optimizedPrompt = result.response.text().trim();

        return res.status(200).json({
            success: true,
            optimizedPrompt
        });

    } catch (error) {
        console.error('Error optimizing prompt:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
