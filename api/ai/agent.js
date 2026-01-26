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

        // Clean message & Handle Multimodal
        let userParts = [];
        let displayText = '';

        if (typeof incomingMessage === 'object' && incomingMessage?.type === 'audio') {
            console.log(`🎙️ [AI Agent] Processing AUDIO from ${incomingMessage.url}...`);
            const { downloadMedia } = await import('../whatsapp/utils.js');
            const media = await downloadMedia(incomingMessage.url);

            if (media) {
                userParts.push({
                    inlineData: {
                        mimeType: 'audio/mp3', // Gemini works best with generalized audio types or mp3 mapping
                        // Note: downloadMedia returns base64. 
                        // Check actual mimeType or force audio/mp3 if ogg/opus is problematic?
                        // Gemini 1.5/2.0 supports common audio formats. 
                        // UltraMsg usually returns ogg/opus.
                        // But we map buffer so it's fine.
                        data: media.data
                    }
                });
                userParts.push({ text: 'Escucha este mensaje de audio del candidato y responde adecuadamente.' });
                displayText = '((Mensaje de Audio))';
            } else {
                userParts.push({ text: '((Error al descargar el audio del usuario))' });
                displayText = '((Error Audio))';
            }
        } else {
            const txt = (typeof incomingMessage === 'string' && incomingMessage.trim()) ? incomingMessage.trim() : '((Sin texto))';
            userParts.push({ text: txt });
            displayText = txt;
        }

        // 2. Get History
        const allMessages = await getMessages(candidateId);

        // ... (Filter messages logic)
        const validMessages = allMessages.filter(m => m.content && (m.from === 'user' || m.from === 'bot' || m.from === 'me'));
        const historyMessages = validMessages.filter((m, index) => {
            // Avoid duplicating the LAST message if it was just inserted by webhook
            // Actually, webhook inserts BEFORE calling processMessage.
            // We need to exclude the CURRENT message being processed from history to avoid confusion?
            // Or Gemini expects it?
            // Usually startChat(history) + sendMessage(current).
            // Does history contain current?
            // If webhook calls saveMessage, then getMessages returns it.
            // We should exclude the Very Last user message if it matches our current input.
            const isLast = index === validMessages.length - 1;
            // Simple dedup based on timestamp or content? 
            // Logic kept as is for text, but for Audio?
            // Audio content in DB is empty or url? '((Mensaje de Audio))'?
            // Webhook saved: content=body (empty for audio?) or 'Audio Message'?
            return true;
        });

        // Take last 15 messages for context
        let rawHistory = historyMessages.slice(-15).map(m => ({
            role: (m.from === 'user') ? 'user' : 'model',
            parts: [{ text: m.content || '((Media))' }]
        }));

        // Clean Head
        while (rawHistory.length > 0 && rawHistory[0].role !== 'user') {
            rawHistory.shift();
        }

        // Remove the very last item if it looks like the current message we are responding to
        // (webhook saves -> then calls agent. agent fetches -> sees saved message -> puts in history -> then sends again?)
        // To strictly follow Gemini SDK: history should be PAST messages. sendMessage arg is CURRENT.
        // So we pop the last user message if it is < 10 seconds old?
        if (rawHistory.length > 0 && rawHistory[rawHistory.length - 1].role === 'user') {
            // Heuristic: remove last user message so we don't double submit it
            rawHistory.pop();
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

        // REINFORCE RULES 
        systemInstruction += `\n\n[REGLA SUPREMA]: NO uses markdown, NO uses asteriscos (**), NO uses negritas. Escribe texto plano y limpio.`;

        // INJECT DB CONTEXT INTO PROMPT
        if (candidateData) {
            systemInstruction += `\n\n[CONTEXTO DE BASE DE DATOS DEL CANDIDATO]:\n${JSON.stringify(candidateData, null, 2)}\nUsa esta información para personalizar tu respuesta.`;
        }

        // INJECT VACANCIES & CATEGORIES
        try {
            const { getVacancies } = await import('../utils/storage.js');
            const allVacancies = await getVacancies();
            const activeVacancies = allVacancies.filter(v => v.status === 'active');

            if (activeVacancies.length > 0) {
                const simplified = activeVacancies.map(v => ({
                    titulo: v.title || v.titulo,
                    categoria: v.category || v.categoria || 'General',
                    ubicacion: v.location || v.ubicacion,
                    salario: v.salary || v.salario,
                    requisitos_clave: v.requirements || v.requisitos
                }));
                systemInstruction += `\n\n[VACANTES DISPONIBLES ACTUALMENTE]:\n${JSON.stringify(simplified, null, 2)}\n\nINSTRUCCIÓN SOBRE VACANTES: Si el candidato pregunta por vacantes, usa ESTA LISTA EXACTA. Agrupa las vacantes por CATEGORÍA. Si no hay nada que coincida, dilo honestamente.`;
            }
        } catch (vacErr) {
            console.warn('⚠️ Failed to inject vacancies context:', vacErr);
        }

        if (!apiKey) return 'ERROR: No API Key found in env or redis';

        // SANITIZE KEY
        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];
        else apiKey = apiKey.replace(/^GEMINI_API_KEY\s*=\s*/i, '').trim();

        // 3. Initialize Gemini
        const genAI = new GoogleGenerativeAI(apiKey);

        // 4. Generate Content (Multimodal Models)
        const modelsToTry = [
            "gemini-2.0-flash-exp", // Best for audio currently
            "gemini-1.5-flash",
            "gemini-flash-latest"
        ];

        let result;
        let successModel = '';
        let lastError = '';

        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: mName, systemInstruction });
                const chat = model.startChat({ history: recentHistory });

                // SEND MULTIMODAL PARTS
                result = await chat.sendMessage(userParts);

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
        console.log(`🤖 [AI Agent] Generated (${successModel}) for input: "${displayText}"`);

        // 5. FERRARI SHIELDING: Delivery with Intelligent Retries
        const config = await getUltraMsgConfig();
        const deliveryPromise = (async () => {
            if (!config || !candidateData?.whatsapp) return;

            let retries = 2;
            while (retries >= 0) {
                try {
                    await sendUltraMsgMessage(config.instanceId, config.token, candidateData.whatsapp, responseText);
                    console.log(`✅ [Ferrari Shield] Delivered to ${candidateData.whatsapp}`);
                    break;
                } catch (err) {
                    console.error(`⚠️ [Ferrari Shield] Delivery failed (Retries left: ${retries}):`, err.message);
                    if (retries === 0) throw err;
                    retries--;
                    await new Promise(r => setTimeout(r, 1000)); // Wait 1s
                }
            }
        })();

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
