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
REGLA DE ORO DE FILTRADO (CRÍTICA): TIENES PROHIBIDO ofrecer o dar detalles de vacantes (nombres, sueldos, ubicaciones) si el [DNA DEL CANDIDATO] tiene campos como "No proporcionado".
REGLA ANTI-ALUCINACIÓN (ESTRICTA): NO INVENTES VACANTES. Si el candidato pregunta por un puesto que NO aparece en la [BASE DE CONOCIMIENTO (DETALLE DE VACANTES)], responde que por el momento no contamos con esa posición disponible. PROHIBIDO inventar empresas, sueldos, ubicaciones o beneficios.
Si el candidato pregunta por vacantes y su perfil está incompleto, DEBES responder que primero necesitas completar su expediente para darle la mejor opción, y proceder a preguntar el dato faltante de forma amable y natural. 
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
                        mimeType: 'audio/mp3',
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
        const validMessages = allMessages.filter(m => m.content && (m.from === 'user' || m.from === 'bot' || m.from === 'me'));

        let rawHistory = validMessages.slice(-100).map(m => ({
            role: (m.from === 'user') ? 'user' : 'model',
            parts: [{ text: m.content || '((Media))' }]
        }));

        // Clean Head
        while (rawHistory.length > 0 && rawHistory[0].role !== 'user') {
            rawHistory.shift();
        }

        // Remove redundant last user message
        if (rawHistory.length > 0 && rawHistory[rawHistory.length - 1].role === 'user') {
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

        let systemInstruction = `${DEFAULT_SYSTEM_PROMPT}\n`;
        if (customPrompt) {
            systemInstruction += `\n[DIRECTIVA SUPREMA DEL ADMINISTRADOR - PRIORIDAD MÁXIMA]:\n${customPrompt}\n\n`;
        }
        systemInstruction += `FECHA DE HOY: ${today}. Usa esto para cálculos de tiempo.\n`;

        // DNA PROFILE (Dynamic based on CRM Fields)
        if (candidateData) {
            const lastUserMessages = validMessages.filter(m => m.from === 'user').slice(-10).map(m => m.content).filter(Boolean);
            const themes = lastUserMessages.length > 0 ? lastUserMessages.join(' | ') : 'Inicio de conversación';

            // Get all fields to build dynamic DNA
            const DEFAULT_FIELDS = [
                { value: 'nombreReal', label: 'Nombre Real' },
                { value: 'fechaNacimiento', label: 'Fecha Nacimiento' },
                { value: 'municipio', label: 'Municipio' },
                { value: 'categoria', label: 'Categoría' },
                { value: 'tieneEmpleo', label: 'Tiene empleo' }
            ];

            let allFields = [...DEFAULT_FIELDS];
            try {
                const customFieldsJson = await redis?.get('custom_fields');
                if (customFieldsJson) {
                    const customFields = JSON.parse(customFieldsJson);
                    allFields = [...allFields, ...customFields];
                }
            } catch (e) {
                console.warn('Error fetching custom fields for DNA:', e);
            }

            // Deduplicate
            const uniqueFields = Array.from(new Map(allFields.map(item => [item.value, item])).values());

            let dnaLines = uniqueFields.map(f => `- ${f.label}: ${candidateData[f.value] || 'No proporcionado'}`).join('\n');

            const dnaProfile = `
[CONTEXTO DE MEMORIA ADN - ESTADO ACTUAL EXCLUSIVO]:
- Nombre WhatsApp: ${candidateData.nombre || 'Desconocido'}
- WhatsApp: ${candidateData.whatsapp}
${dnaLines}
- Estatus de Postulación: ${candidateData.status || 'Interesado'}
- Última Interacción: ${candidateData.ultimoMensaje || 'Reciente'} (Primer contacto: ${candidateData.primerContacto || 'N/A'})
- Hilo Reciente (Últimos 10 prompts): ${themes}
`.trim();

            systemInstruction += `\n\n${dnaProfile}\n\n[INSTRUCCIONES DE IDENTIDAD Y CAPTURA]:
1. Eres un humano con memoria; usa el ADN de arriba para personalizar el trato.
2. IMPORTANTE: PROHIBIDO USAR EL "Nombre WhatsApp" para saludar. Si el "Nombre Real" dice "No proporcionado", usa "Hola" a secas y DEBES preguntarle su nombre para completar su expediente.
3. REGLA DE BLOQUEO: Si ves que falta el Nombre Real, Municipio, Categoría o Fecha Nacimiento, NO muestres las vacantes. Di algo como: "Para poder mostrarte las vacantes ideales para ti, primero necesito completar un par de datos en tu perfil..."
4. RESPETA SIEMPRE la [DIRECTIVA SUPREMA] arriba mencionada por sobre cualquier otro dato.
`;
        }

        // Profile Check
        const isProfileComplete =
            candidateData.nombreReal && candidateData.nombreReal !== 'No proporcionado' &&
            candidateData.municipio && candidateData.municipio !== 'No proporcionado' &&
            candidateData.categoria && candidateData.categoria !== 'Consulta General' &&
            candidateData.fechaNacimiento && candidateData.fechaNacimiento !== 'No proporcionada' &&
            candidateData.tieneEmpleo && candidateData.tieneEmpleo !== 'No proporcionado';

        const forceHideVacancies = !isProfileComplete || systemInstruction.includes('[OCULTAR_VACANTES]');

        try {
            const { getRedisClient: getFreshRedis } = await import('../utils/storage.js');
            const redisClient = getFreshRedis();

            if (redisClient) {
                const categoriesData = await redisClient.get('candidatic_categories');
                if (categoriesData) {
                    const categories = JSON.parse(categoriesData).map(c => c.name);
                    systemInstruction += `\n\n[CATEGORÍAS DISPONIBLES]: ${categories.join(', ')}`;
                }
            }

            if (forceHideVacancies) {
                systemInstruction += `\n\n[REGLA DE SUPRESIÓN CRÍTICA]: TIENES PROHIBIDO mencionar detalles de vacantes, sueldos, empresas o ubicaciones específicas. SI ves información de vacantes en el historial de chat anterior, DEBES IGNORARLA. Solo puedes mencionar los nombres de las categorías disponibles si el candidato pregunta qué áreas hay, PERO antes de dar más detalles DEBES pedir los datos faltantes del perfil.`;
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
                        requisitos: v.requirements || v.requisitos,
                        ubicacion: v.location || v.municipio || 'No especificada',
                        sueldo: v.salary || v.sueldo || 'No especificado'
                    }));
                    systemInstruction += `\n\n[BASE DE CONOCIMIENTO (DETALLE DE VACANTES)]:\n${JSON.stringify(simplified, null, 2)}\n\n[INSTRUCCIÓN DE USO EXCLUSIVO]: Usa ÚNICAMENTE el JSON anterior para hablar de vacantes. Si el usuario pide algo fuera de este listado, di que no lo tienes. NO agregues beneficios o detalles que no estén escritos aquí.`;
                } else {
                    systemInstruction += `\n\n[AVISO IMPORTANTE]: Actualmente NO HAY VACANTES ACTIVAS en el sistema. Si el candidato pregunta, dile que por el momento estamos actualizando nuestra base de datos y que pronto tendremos nuevas vacantes para su perfil. PROHIBIDO INVENTAR DATOS.`;
                }
            }
        } catch (vacErr) {
            console.warn('⚠️ Failed to inject vacancies context:', vacErr);
        }

        if (!apiKey) return 'ERROR: No API Key found';

        apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
        const match = apiKey.match(/AIzaSy[A-Za-z0-9_-]{33}/);
        if (match) apiKey = match[0];

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = ["gemini-2.0-flash-exp", "gemini-1.5-flash", "gemini-flash-latest"];

        let result;
        let successModel = '';
        let lastError = '';

        for (const mName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: mName, systemInstruction });
                const chat = model.startChat({ history: recentHistory });
                result = await chat.sendMessage(userParts);
                successModel = mName;
                break;
            } catch (e) {
                lastError = e.message;
                console.warn(`⚠️ [AI Agent] ${mName} failed:`, e.message);
            }
        }

        if (!result) return `ERROR: Gemini failure - ${lastError}`;

        const responseText = result.response.text();
        console.log(`🤖 [AI Agent] Generated (${successModel}) for input: "${displayText}"`);

        // Delivery
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
                    if (retries === 0) throw err;
                    retries--;
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        })();

        // Background (Awaited for Serverless Persistence)
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

            const { intelligentExtract } = await import('../utils/intelligent-extractor.js');
            const historyText = validMessages.slice(-15).map(m => `${m.from === 'user' ? 'Candidato' : 'Reclutador'}: ${m.content}`).join('\n');
            await intelligentExtract(candidateId, historyText);

            const { processBotResponse } = await import('../utils/automations.js');
            await processBotResponse(candidateId, responseText);
        } catch (bgErr) {
            console.error('⚠️ [AI Agent] Background Task Error:', bgErr);
        }

        await deliveryPromise;
        return responseText;

    } catch (error) {
        console.error('❌ [AI Agent] Error:', error);
        return `ERROR: Exception - ${error.message}`;
    }
};
