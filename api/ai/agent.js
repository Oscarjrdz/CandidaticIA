import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedisClient, getMessages, saveMessage, updateCandidate } from '../utils/storage.js';
import { sendUltraMsgMessage, getUltraMsgConfig } from '../whatsapp/utils.js';

const DEFAULT_SYSTEM_PROMPT = `
Eres el asistente virtual de Candidatic, un experto en reclutamiento amigable y profesional.
Tu objetivo es ayudar a los candidatos a responder sus dudas sobre vacantes, estatus de postulación o información general.
IMPORTANTE: Siempre saluda al candidato por su nombre real si está disponible en la base de datos.
IMPORTANTE: TIENES PROHIBIDO USAR EL "Nombre WhatsApp" para saludar. Ese dato suele ser informal o incorrecto.
IMPORTANTE: NO USES ASTERISCOS (*) ni markdown en exceso. Escribe texto limpio.
REGLA DE ORO (MEMORIA): Eres el mismo asistente que habló con el candidato en el pasado. Revisa el historial y el [DNA DEL CANDIDATO].
REGLA DE CAPTURA (IMPORTANTE): Si el "Nombre Real" dice "No proporcionado", DEBES preguntarle su nombre al candidato usando un saludo genérico como "Hola".
Para que el sistema registre los datos en las columnas, debes CONFIRMAR la información usando estas frases exactas:
- Para el nombre: "Mucho gusto, tu nombre es [Nombre]"
- Para el municipio: "Entendido, vives en [Municipio]"
- Para la categoría: "Te he anotado buscando empleo de [Categoría]"
- Para el empleo: "Entonces [Sí/No] tienes empleo actualmente"
- Para la fecha: "Tu fecha de nacimiento es [Fecha]"
REGLA DE ORO DE FILTRADO (CRÍTICA): TIENES PROHIBIDO ofrecer o dar detalles de vacantes (nombres, sueldos, ubicaciones) si el [DNA DEL CANDIDATO] tiene campos como "No proporcionado".
Si el candidato pregunta por vacantes y su perfil está incompleto, DEBES responder que primero necesitas completar su expediente para darle la mejor opción, y proceder a preguntar el dato faltante.
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
- Fecha de Nacimiento: ${candidateData.fecha || 'No proporcionada'}
- Tiene Empleo: ${candidateData.empleo || 'No proporcionado'}
- Estatus de Postulación: ${candidateData.status || 'Interesado'}
- Última Interacción: ${candidateData.ultimoMensaje || 'Reciente'} (Primer contacto: ${candidateData.primerContacto || 'N/A'})
- Hilo Reciente (Últimos 10 prompts): ${themes}
`.trim();

            systemInstruction += `\n\n${dnaProfile}\n\n[INSTRUCCIONES DE IDENTIDAD Y CAPTURA]:
1. Eres un humano con memoria; usa el ADN de arriba para personalizar el trato.
2. IMPORTANTE: PROHIBIDO USAR EL "Nombre WhatsApp" para saludar. Si el "Nombre Real" dice "No proporcionado", usa "Hola" a secas y DEBES preguntarle su nombre para completar su expediente.
3. Para GUARDAR datos en el sistema, usa estas frases exactas si estás confirmando:
   - "Mucho gusto, tu nombre es [Nombre]"
   - "Entendido, vives en [Municipio]"
   - "Te he anotado buscando empleo de [Categoría]"
   - "Entonces [Sí/No] tienes empleo actualmente"
   - "Tu fecha de nacimiento es [Fecha]"
4. REGLA DE BLOQUEO: Si ves que falta el Nombre Real, Municipio, Categoría o Fecha, NO muestres las vacantes. Di algo como: "Para poder mostrarte las vacantes ideales para ti, primero necesito completar un par de datos en tu perfil..."
5. RESPETA SIEMPRE la [DIRECTIVA SUPREMA] arriba mencionada por sobre cualquier otro dato.
`;
        }

        // --- GATEKEEPER LOGIC: Check if profile is complete ---
        const isProfileComplete =
            candidateData.nombreReal && candidateData.nombreReal !== 'No proporcionado' &&
            candidateData.municipio && candidateData.municipio !== 'No proporcionado' &&
            candidateData.categoria && candidateData.categoria !== 'Consulta General' &&
            candidateData.fecha && candidateData.fecha !== 'No proporcionada' &&
            candidateData.empleo && candidateData.empleo !== 'No proporcionado';

        // INJECT VACANCIES & CATEGORIES (Conditional)
        const forceHideVacancies = !isProfileComplete || systemInstruction.includes('[OCULTAR_VACANTES]');

        try {
            const { getRedisClient } = await import('../utils/storage.js');
            const redisClient = getRedisClient();

            // 1. Always inject categories for context (Helps candidate choose)
            if (redisClient) {
                const categoriesData = await redisClient.get('candidatic_categories');
                if (categoriesData) {
                    const categories = JSON.parse(categoriesData).map(c => c.name);
                    systemInstruction += `\n\n[CATEGORÍAS DISPONIBLES]: ${categories.join(', ')}`;
                }
            }

            // 2. Conditionally inject vacancy details
            if (forceHideVacancies) {
                systemInstruction += `\n\n[REGLA DE SUPRESIÓN CRÍTICA]: TIENES PROHIBIDO mencionar detalles de vacantes, sueldos, empresas o ubicaciones específicas. SI ves información de vacantes en el historial de chat anterior, DEBES IGNORARLA. Solo puedes mencionar los nombres de las categorías disponibles si el candidato pregunta qué áreas hay, PERO antes de dar más detalles DEBES pedir los datos faltantes del perfil.`;
                console.log(`🔇 [AI Agent] Vacancy details strictly suppressed. Profile Complete: ${isProfileComplete}`);
            } else {
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
                    systemInstruction += `\n\n[BASE DE CONOCIMIENTO (DETALLE DE VACANTES)]:\n${JSON.stringify(simplified, null, 2)}`;
                }
            }
        } catch (vacErr) {
            console.warn('⚠️ Failed to inject vacancies/categories context:', vacErr);
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
