import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient, getMessages, saveMessage, updateCandidate } from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const DEFAULT_SYSTEM_PROMPT = `
Eres el asistente virtual de Candidatic, un experto en reclutamiento amigable y profesional.
Tu objetivo es ayudar a los candidatos a responder sus dudas sobre vacantes, estatus de postulación o información general.
Responde de forma concisa, empática y siempre en español latinoamericano.
No inventes información sobre vacantes específicas si no la tienes en el contexto.
`;

export const processMessage = async (candidateId, incomingMessage) => {
    try {
        console.log(`🧠 [AI Agent] Processing message for candidate ${candidateId}...`);

        const redis = getRedisClient();

        // 1. Get History
        const messages = await getMessages(candidateId);
        // Take last 10 messages for context window
        const recentHistory = messages.slice(-10).map(m => ({
            role: m.from === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }));

        // 2. Get Configuration (API Key & System Prompt)
        let apiKey = process.env.GEMINI_API_KEY;
        let systemInstruction = DEFAULT_SYSTEM_PROMPT;
        let isActive = false;

        if (redis) {
            // Check if Bot is Active
            // For MVP we assume active if this function is called, 
            // but webhook should check 'bot_ia_active' flag.

            // Get Custom Prompt
            const customPrompt = await redis.get('bot_ia_prompt');
            if (customPrompt) systemInstruction = customPrompt;

            const aiConfig = await redis.get('ai_config');
            if (aiConfig) {
                const parsed = JSON.parse(aiConfig);
                if (parsed.geminiApiKey) apiKey = parsed.geminiApiKey;
            }
        }

        if (!apiKey) {
            console.error('❌ [AI Agent] No Gemini API Key found.');
            return;
        }

        // 3. Initialize Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // 4. Generate Content
        // Gemini SDK handles history better with startChat, 
        // but for stateless serverless functions, we rebuild history each time.

        const chat = model.startChat({
            history: recentHistory,
            systemInstruction: systemInstruction,
            generationConfig: {
                maxOutputTokens: 300,
                temperature: 0.7,
            }

        });

        const result = await chat.sendMessage(incomingMessage);
        const responseText = result.response.text();

        console.log(`🤖 [AI Agent] Response generated: "${responseText}"`);

        // 5. Save AI Response to Storage
        await saveMessage(candidateId, {
            from: 'bot',
            content: responseText,
            type: 'text',
            timestamp: new Date().toISOString()
        });

        await updateCandidate(candidateId, {
            lastBotMessageAt: new Date().toISOString(),
            ultimoMensaje: new Date().toISOString()
        });

        // 6. Send via UltraMsg
        const config = await getUltraMsgConfig();
        // Ideally we need the user's phone number here. 
        // We can fetch candidate again or pass it as param.
        // For efficiency, let's assume we can retrieve it or it was passed.

        // REFACTOR: We need candidate phone. getMessages doesn't give phone.
        // Let's rely on the caller to handle the SENDING, or fetch candidate here.
        // Let's fetch candidate here to be self-contained.

        // Note: processMessage is called from webhook usually.
        // Let's modify signature to accept phone or candidate object if optimizing.
        // For now, let's fetch candidate from storage to get phone.
        // Wait... getCandidateIdByPhone was used to get ID. storage.js may not have getCandidateById exposed easily?
        // Let's check storage.js... it uses Redis HGETALL `candidate:${id}`.

        const candidateKey = `candidate:${candidateId}`;
        const candidateData = await redis.hgetall(candidateKey);

        if (config && candidateData && candidateData.whatsapp) {
            await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseText);
            console.log(`✅ [AI Agent] Message sent to ${candidateData.whatsapp}`);
        } else {
            console.warn('⚠️ [AI Agent] Could not send message: Missing config or candidate phone');
        }

        return responseText;

    } catch (error) {
        console.error('❌ [AI Agent] Error:', error);
        return null;
    }
};
