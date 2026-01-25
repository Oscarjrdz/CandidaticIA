import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient, getMessages, saveMessage, updateCandidate } from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const DEFAULT_SYSTEM_PROMPT = `
Eres el asistente virtual de Candidatic, un experto en reclutamiento amigable y profesional.
Tu objetivo es ayudar a los candidatos a responder sus dudas sobre vacantes, estatus de postulación o información general.
IMPORTANTE: Siempre saluda al candidato por su nombre real si está disponible en la base de datos.
Revisa siempre el historial y los datos del candidato antes de responder.
Responde de forma concisa, empática y siempre en español latinoamericano.
No inventes información sobre vacantes específicas si no la tienes en el contexto.
`;

export const processMessage = async (candidateId, incomingMessage) => {
    try {
        console.log(`🧠 [AI Agent] Processing message for candidate ${candidateId}...`);

        const redis = getRedisClient();

        // 1. Get Candidate Data (Database Context)
        let candidateData = null;
        const candidateKey = `candidate:${candidateId}`;
        try {
            const rawData = await redis.get(candidateKey);
            if (rawData) candidateData = JSON.parse(rawData);
        } catch (e) {
            console.error('Error fetching candidate for context:', e);
        }

        // 2. Get History
        const allMessages = await getMessages(candidateId);

        // ... (Filter messages logic remains the same)
        const validMessages = allMessages.filter(m => m.content && (m.from === 'user' || m.from === 'bot' || m.from === 'me'));
        const historyMessages = validMessages.filter((m, index) => {
            const isLast = index === validMessages.length - 1;
            if (isLast && m.content === incomingMessage && m.from === 'user') return false;
            return true;
        });

        // Take last 15 messages for context
        let rawHistory = historyMessages.slice(-15).map(m => ({
            role: (m.from === 'user') ? 'user' : 'model',
            parts: [{ text: m.content }]
        }));

        while (rawHistory.length > 0 && rawHistory[0].role !== 'user') {
            rawHistory.shift();
        }
        const recentHistory = rawHistory;

        // 3. Configuration & Context Injection
        let apiKey = process.env.GEMINI_API_KEY;
        let systemInstruction = DEFAULT_SYSTEM_PROMPT;

        if (redis) {
            const customPrompt = await redis.get('bot_ia_prompt');
            if (customPrompt) systemInstruction = customPrompt;

            const aiConfig = await redis.get('ai_config');
            if (aiConfig) {
                const parsed = JSON.parse(aiConfig);
                if (parsed.geminiApiKey) apiKey = parsed.geminiApiKey;
            }
        }

        // INJECT DB CONTEXT INTO PROMPT
        if (candidateData) {
            systemInstruction += `\n\n[CONTEXTO DE BASE DE DATOS DEL CANDIDATO]:\n${JSON.stringify(candidateData, null, 2)}\nUsa esta información para personalizar tu respuesta (Nombre, Municipio, Vacante de interés, etc).`;
        }

        if (!apiKey) return 'ERROR: No API Key found in env or redis';

        // SANITIZE KEY (Important!)
        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];
        else apiKey = apiKey.replace(/^GEMINI_API_KEY\s*=\s*/i, '').trim();

        // 3. Initialize Gemini
        const genAI = new GoogleGenerativeAI(apiKey);

        // 4. Generate Content (With Fallback Strategy)
        const modelsToTry = [
            "gemini-2.5-flash",
            "gemini-flash-latest",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-pro"
        ];

        let result;
        let successModel = '';
        let lastError = '';

        for (const mName of modelsToTry) {
            try {
                // console.log(`🔍 [AI Agent] Trying model: ${mName}...`);
                const model = genAI.getGenerativeModel({
                    model: mName,
                    systemInstruction: systemInstruction
                });

                const chat = model.startChat({
                    history: recentHistory,
                    // systemInstruction moved to model init
                    generationConfig: {
                        maxOutputTokens: 300,
                        temperature: 0.7,
                    }
                });

                result = await chat.sendMessage(incomingMessage);
                successModel = mName;
                // console.log(`✅ [AI Agent] Success with ${mName}`);
                break;
            } catch (e) {
                lastError = e.message;
                console.warn(`⚠️ [AI Agent] ${mName} failed:`, e.message);
            }
        }

        if (!result) {
            console.error('❌ [AI Agent] All models failed. Last error:', lastError);
            return `ERROR: All models failed. Last: ${lastError}`;
        }

        const responseText = result.response.text();
        console.log(`🤖 [AI Agent] Response generated (${successModel}): "${responseText}"`);

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
        // 6. Send via UltraMsg
        const config = await getUltraMsgConfig();
        // Candidate Data strictly required for WhatsApp number
        // We already fetched 'candidateData' at the top.

        if (config && candidateData && candidateData.whatsapp) {
            await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseText);
            console.log(`✅ [AI Agent] Message sent to ${candidateData.whatsapp}`);
        } else {
            // Fallback if data was missing or fetch failed
            console.warn('⚠️ [AI Agent] could not send message using cached data. Re-checking...');
            const freshKey = `candidate:${candidateId}`;
            try {
                const freshRaw = await redis.get(freshKey);
                if (freshRaw) {
                    const freshData = JSON.parse(freshRaw);
                    if (freshData && freshData.whatsapp) {
                        await sendUltraMsgMessage(config.instanceId, config.token, freshData.whatsapp, responseText);
                        console.log(`✅ [AI Agent] Message sent (retry) to ${freshData.whatsapp}`);
                    }
                }
            } catch (e) { console.error('Retry failed', e); }
        }

        return responseText;

    } catch (error) {
        console.error('❌ [AI Agent] Error:', error);
        return `ERROR: Exception - ${error.message}`;
    }
};
