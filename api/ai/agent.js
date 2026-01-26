import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient, getMessages, saveMessage, updateCandidate } from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const DEFAULT_SYSTEM_PROMPT = `
Eres el asistente virtual de Candidatic, un experto en reclutamiento amigable y profesional.
Tu objetivo es ayudar a los candidatos a responder sus dudas sobre vacantes, estatus de postulación o información general.
IMPORTANTE: Siempre saluda al candidato por su nombre real si está disponible en la base de datos.
IMPORTANTE: NO USES ASTERISCOS (*) ni markdown en exceso. Escribe texto limpio.
REGLA DE ORO (MEMORIA): Eres el mismo asistente que habló con el candidato en el pasado. Revisa el historial y el [DNA DEL CANDIDATO].
REGLA DE CAPTURA (IMPORTANTE): Aunque veas el "Nombre WhatsApp" en el DNA, ese dato NO es oficial. Si el "Nombre Real" dice "No proporcionado", DEBES preguntarle su nombre al candidato.
Para que el sistema registre los datos en las columnas, debes CONFIRMAR la información usando estas frases exactas:
- Para el nombre: "Mucho gusto, tu nombre es [Nombre]"
- Para el municipio: "Entendido, vives en [Municipio]"
- Para la categoría: "Te he anotado buscando empleo de [Categoría]"
- Para el empleo: "Entonces [Sí/No] tienes empleo actualmente"
- Para la fecha: "Tu fecha de nacimiento es [Fecha]"
Responde de forma concisa, empática y siempre en español latinoamericano.
REGLA ANTI-ALUCINACIÓN: Si no conoces un dato (porque no aparece en el DNA), NO lo inventes. Pregunta amablemente.
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

        // Take last 100 messages for deeper context (Internal Memory)
        let rawHistory = historyMessages.slice(-100).map(m => ({
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

        let customPrompt = '';
        if (redis) {
            customPrompt = await redis.get('bot_ia_prompt') || '';
            const aiConfig = await redis.get('ai_config');
            if (aiConfig) {
                const parsed = JSON.parse(aiConfig);
                if (parsed.geminiApiKey) apiKey = parsed.geminiApiKey;
            }
        }

        // ASSEMBLE SYSTEM INSTRUCTION WITH PRIORITY
        let systemInstruction = `${DEFAULT_SYSTEM_PROMPT}\n`;

        if (customPrompt) {
            systemInstruction += `\n[DIRECTIVA SUPREMA DEL ADMINISTRADOR - PRIORIDAD MÁXIMA]:\n${customPrompt}\n\n`;
        }

        systemInstruction += `FECHA DE HOY: ${today}. Usa esto para cálculos de tiempo.\n`;

        // Optional: Reinforce basic rules if needed
        // systemInstruction += `\n\n[REGLA]: Escribe texto plano y limpio.`;

        // INJECT DB CONTEXT INTO PROMPT (DNA PROFILE)
        if (candidateData) {
            // Extract a bit more context from previous messages
            const lastUserMessages = validMessages.filter(m => m.from === 'user').slice(-10).map(m => m.content).filter(Boolean);
            const themes = lastUserMessages.length > 0 ? lastUserMessages.join(' | ') : 'Inicio de conversación';

            const dnaProfile = `
[CONTEXTO DE MEMORIA ADN - ESTADO ACTUAL EXCLUSIVO]:
- Nombre WhatsApp: ${candidateData.nombre || 'Desconocido'}
- Nombre Real: ${candidateData.nombreReal || 'No proporcionado'}
- WhatsApp: ${candidateData.whatsapp}
- Edad: ${candidateData.edad || 'No proporcionada'}
- Municipio/Ciudad: ${candidateData.municipio || 'No proporcionado'}
- Categoría de Interés: ${candidateData.categoria || 'Consulta General'}
- Estatus de Postulación: ${candidateData.status || 'Interesado'}
- Última Interacción: ${candidateData.ultimoMensaje || 'Reciente'} (Primer contacto: ${candidateData.primerContacto || 'N/A'})
- Hilo Reciente (Últimos 10 prompts): ${themes}
`.trim();

            systemInstruction += `\n\n${dnaProfile}\n\n[INSTRUCCIONES DE IDENTIDAD Y CAPTURA]:
1. Eres un humano con memoria; usa el ADN de arriba para personalizar el trato.
2. Si el "Nombre Real" del ADN dice "No proporcionado", DEBES preguntar por él aunque el "Nombre WhatsApp" tenga valor.
3. Para GUARDAR datos en el sistema, usa estas frases exactas si estás confirmando:
   - "Mucho gusto, tu nombre es [Nombre]"
   - "Entendido, vives en [Municipio]"
   - "Te he anotado buscando empleo de [Categoría]"
   - "Entonces [Sí/No] tienes empleo actualmente"
4. RESPETA SIEMPRE la [DIRECTIVA SUPREMA] arriba mencionada por sobre cualquier otro dato.
`;
        }

        // INJECT VACANCIES & CATEGORIES (Conditional)
        const hideVacancies = systemInstruction.includes('[OCULTAR_VACANTES]');

        if (!hideVacancies) {
            try {
                const { getVacancies } = await import('../utils/storage.js');
                const allVacancies = await getVacancies();
                const activeVacancies = allVacancies.filter(v => v.active === true || v.status === 'active');

                if (activeVacancies.length > 0) {
                    const simplified = activeVacancies.map(v => ({
                        titulo: v.name || v.title || v.titulo,
                        empresa: v.company || v.empresa,
                        categoria: v.category || v.categoria || 'General',
                        descripcion: v.description || v.descripcion,
                        requisitos: v.requirements || v.requisitos
                    }));
                    systemInstruction += `\n\n[BASE DE CONOCIMIENTO (VACANTES Y CATEGORÍAS)]:\n${JSON.stringify(simplified, null, 2)}`;
                }
            } catch (vacErr) {
                console.warn('⚠️ Failed to inject vacancies context:', vacErr);
            }
        } else {
            console.log('🔇 [AI Agent] Vacancies hidden by [OCULTAR_VACANTES] instruction.');
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
