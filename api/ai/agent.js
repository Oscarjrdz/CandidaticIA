import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient, getMessages, saveMessage, updateCandidate } from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const DEFAULT_SYSTEM_PROMPT = `
Eres el asistente virtual de Candidatic, un experto en reclutamiento amigable y profesional.
Tu objetivo es ayudar a los candidatos a responder sus dudas sobre vacantes, estatus de postulación o información general.
IMPORTANTE: Siempre saluda al candidato por su nombre real si está disponible en la base de datos.
IMPORTANTE: NO USES ASTERISCOS (*) para resaltar nombres ni texto. Escribe el nombre limpiamente (ej: "Hola Juan" y NO "Hola *Juan*").
Revisa siempre el historial y los datos del candidato antes de responder.
Responde de forma concisa, empática y siempre en español latinoamericano.
REGLA ANTI-ALUCINACIÓN: Si no conoces el nombre del candidato o su edad (porque no aparecen en el contexto), NO los inventes. Pregunta amablemente por ellos si es necesario para el proceso.
No inventes información sobre vacantes específicas si no la tienes en el contexto.
NUNCA CUENTES CHISTES, mantén un tono profesional.
`;

export const processMessage = async (candidateId, incomingMessage) => {
    try {
        console.log(`🧠 [AI Agent] Processing message for candidate ${candidateId}...`);

        const redis = getRedisClient();

        // 1. Get Candidate Data (Database Context)
        let candidateData = null;
        try {
            const freshKey = `candidate:${candidateId}`;
            const rawData = await redis?.get(freshKey);
            if (rawData) {
                candidateData = JSON.parse(rawData);
            } else {
                console.log(`🔍 [AI Agent] Candidate ${candidateId} not in cache, fetching from DB...`);
                const { getCandidateById } = await import('../utils/storage.js');
                candidateData = await getCandidateById(candidateId);
            }
        } catch (e) {
            console.error('Error fetching candidate for context:', e);
        }

        if (!candidateData) {
            console.error(`❌ [AI Agent] FATAL: Candidate ${candidateId} not found in storage.`);
            return 'ERROR: Candidate not found';
        }

        // Clean message
        const userMessage = (typeof incomingMessage === 'string' && incomingMessage.trim()) ? incomingMessage.trim() : '((Mensaje de voz o sin texto))';

        // 2. Get History
        const allMessages = await getMessages(candidateId);

        // ... (Filter messages logic remains the same)
        const validMessages = allMessages.filter(m => m.content && (m.from === 'user' || m.from === 'bot' || m.from === 'me'));
        const historyMessages = validMessages.filter((m, index) => {
            const isLast = index === validMessages.length - 1;
            if (isLast && m.content === userMessage && m.from === 'user') return false;
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
        const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        let systemInstruction = `${DEFAULT_SYSTEM_PROMPT}\nHOY ES: ${today}. Usa esta fecha para calcular edades o tiempos relativos.`;

        if (redis) {
            const customPrompt = await redis.get('bot_ia_prompt');
            if (customPrompt) systemInstruction = customPrompt;

            const aiConfig = await redis.get('ai_config');
            if (aiConfig) {
                const parsed = JSON.parse(aiConfig);
                if (parsed.geminiApiKey) apiKey = parsed.geminiApiKey;
            }
        }

        // REINFORCE RULES (Append at the end to override any other instruction)
        systemInstruction += `\n\n[REGLA SUPREMA]: NO uses markdown, NO uses asteriscos (**), NO uses negritas. Escribe texto plano y limpio.`;

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

        // 4. Generate Content
        // Verified working models for this project: 2.5-flash and flash-latest
        const modelsToTry = [
            "gemini-2.5-flash",
            "gemini-flash-latest",
            "gemini-2.0-flash-exp",
            "gemini-1.5-flash",
            "gemini-pro"
        ];

        let result;
        let successModel = '';
        let lastError = '';

        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: mName, systemInstruction });
                const chat = model.startChat({ history: recentHistory });
                result = await chat.sendMessage(userMessage);
                successModel = mName;
                break;
            } catch (e) {
                lastError = e.message;
                console.warn(`⚠️ [AI Agent] ${mName} failed:`, e.message);
            }
        }

        if (!result) {
            console.error('❌ [AI Agent] All models failed. Last error:', lastError);
            return `ERROR: Gemini failure - ${lastError}`;
        }

        const responseText = result.response.text();
        console.log(`🤖 [AI Agent] Generated (${successModel})`);

        // 5. IMMEDIATE DELIVERY (Priority 1)
        const config = await getUltraMsgConfig();
        const deliveryPromise = (config && candidateData?.whatsapp)
            ? sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseText)
            : Promise.resolve();

        // 6. BACKGROUND TASKS (Non-blocking)
        const backgroundPromise = (async () => {
            try {
                await Promise.allSettled([
                    saveMessage(candidateId, {
                        from: 'bot',
                        content: responseText,
                        type: 'text',
                        timestamp: new Date().toISOString()
                    }),
                    updateCandidate(candidateId, {
                        lastBotMessageAt: new Date().toISOString(),
                        ultimoMensaje: new Date().toISOString()
                    })
                ]);

                // Run Automations
                const { processBotResponse } = await import('../utils/automations.js');
                await processBotResponse(candidateId, responseText);
            } catch (bgErr) {
                console.error('⚠️ [AI Agent] Background Task Error:', bgErr);
            }
        })();

        // Await delivery to ensure message is sent
        await deliveryPromise;

        // Return while background tasks finish (optional in serverless but safe)
        return responseText;

    } catch (error) {
        console.error('❌ [AI Agent] Error:', error);
        const redis = getRedisClient();
        if (redis) {
            await redis.set(`debug:error:ai:${candidateId}`, JSON.stringify({
                timestamp: new Date().toISOString(),
                error: error.message,
                stack: error.stack
            }), 'EX', 3600);
        }
        return `ERROR: Exception - ${error.message}`;
    }
};
