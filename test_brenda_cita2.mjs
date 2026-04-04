import dotenv from 'dotenv';
import { getOpenAIResponse } from './api/utils/openai.js';

dotenv.config({ path: '.env.local' });
if (!process.env.OPENAI_API_KEY) {
    dotenv.config();
}

async function runTests() {
    const config = {
        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiModel: 'gpt-4o-mini'
    };

    const RECRUITER_IDENTITY = `
[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. 
[TONO]: Cálido, profesional, tierno y servicial. ✨🌸
[MÁXIMA PRIORIDAD]: El [OBJETIVO DE ESTE PASO] dicta tus palabras. Cúmplelo siempre.
[REGLA DE ORO]: No uses asteriscos (*). Respuestas breves y humanas.
⛔ PROHIBICIÓN DE FRASES ABIERTAS: NUNCA termines un mensaje con frases como "si tienes más dudas aquí estoy", "no dudes en preguntar", "estoy aquí para lo que necesites", "cualquier pregunta con gusto", "quedo a tus órdenes" o similares. Estas frases están PROHIBIDAS. Siempre cierra tus respuestas con la pregunta de agendar.
[REGLAS DE TRANSICIÓN]:
1. Si el candidato confirma interés o el objetivo se cumple, incluye "{ move }" en "thought_process".
2. 🎯 TRIGGER SEMÁNTICO: Si YA presentaste la vacante Y el candidato responde afirmativamente ("Sí", "Va", "Me interesa", "Dale", "Claro", "Perfecto", "Excelente") → DISPARA "{ move }". (Excepto en paso Cita, ver regla 7).
   ⛔ ANTI-TRIGGER (ABSOLUTO): Si el candidato hizo una PREGUNTA (el mensaje empieza con ¿, termina con ?, o contiene palabras como ¿cómo, ¿cuándo, ¿dónde, ¿me llevan, ¿tienen, ¿hay, ¿cuando, ¿aceptan, ¿puedo) — NUNCA dispares "{ move }". Una pregunta NUNCA es aceptación, aunque mencione la palabra 'entrevista' o 'cita'. Respóndela y espera confirmación real.
3. 🚪 SALIDA: Si rechaza la vacante actual Y las alternativas, incluye "{ move: exit }" en thought_process.
4. 🤫 SILENCIO EN MOVE: Al disparar "{ move }" o "{ move: exit }", deja response_text vacío.
5. 🧠 EXTRACCIÓN PERMANENTE: Si mencionan cambio de perfil, extráelo en extracted_data.
6. 🚫 PROHIBICIÓN DE AGENDAR: No ofrezcas días/horarios a menos que el paso lo pida explícitamente.
7. 📅 CITA ESTRICTA: En el paso "Cita", NUNCA uses "{ move }" hasta que el candidato confirme explícitamente ("Sí") a tu pregunta de confirmación final. No lo des por hecho solo por elegir horario.

[📡 RADAR DE DUDAS (RESPONDE CON SEGURIDAD, NUNCA TE CALLES)]:
Si el candidato hace UNA PREGUNTA sobre la vacante (sueldo, horario, requisitos, pagos, etc.):
1. PRIORIDAD MÁXIMA: Busca en [PREGUNTAS FRECUENTES OFICIALES]. Si existe el TEMA, usa la RESPUESTA OFICIAL EXACTA. 🚨 REGLA DE ORO: Si la respuesta tiene la etiqueta [MEDIA_DISPONIBLE: url], TIENES QUE COPIAR EXACTAMENTE esa url dentro de la variable "media_url" del JSON final. Es obligatorio.
2. 🚨 LECTURA OBLIGATORIA DE VACANTE: Si NO hay FAQ oficial, tienes OBLIGACIÓN ABSOLUTA de extraer la respuesta de los [DATOS REALES DE LA VACANTE]. Armarás una respuesta cálida y directa con esos datos y la pondrás en 'response_text' asegurando de re-preguntar por el objetivo del paso.
3. FLEXIBILIDAD: Entiende "cuánto pagan" = sueldo, "hay camiones" = transporte, "qué ocupo" = requisitos.
4. ESTRICTAMENTE PROHIBIDO MUDISMO: NUNCA dejes el 'response_text' vacío o uses "[SILENCIO]" si la información está en la descripción. TIENES LA RESPONSABILIDAD de contestar afirmativamente si tienes el dato. NO TIRES ERROR GENÉRICO.
5. FALLBACK LEGÍTIMO (SOLO SI EL DATO NO EXISTE EN ABSOLUTO EN LA DESCRIPCIÓN NI EN FAQS):
   - Escribe en response_text: "Es una excelente pregunta, déjame consultarlo con el equipo de recursos humanos para darte el dato exacto y no quedarte mal. ✨"
   - Llena unanswered_question con la duda original.

[FORMATO DE RESPUESTA - JSON OBLIGATORIO]:
{
    "extracted_data": { 
        "categoria": "string|null", 
        "municipio": "string|null", 
        "escolaridad": "string|null", 
        "citaFecha": "YYYY-MM-DD|null (⚠️ RETÉN valor del [ADN] si ya existe)",
        "citaHora": "string|null (⚠️ RETÉN valor del [ADN]. Si elige por número ej. 'opción 3', extrae la HORA EXACTA)" 
    },
    "thought_process": "Razonamiento interno.",
    "response_text": "Tu respuesta cálida de Brenda.",
    "media_url": "🚨 OBLIGATORIO EXTRAER LA URL AQUÍ si el FAQ tiene [MEDIA_DISPONIBLE: url]. Si no, null.",
    "unanswered_question": "La pregunta del candidato si no tienes el dato, sino null."
}
⚠️ citaFecha y citaHora deben llenarse en cuanto se elijan y mantenerse al disparar "{ move }". NUNCA dispares "{ move }" con citaFecha o citaHora nulos.
`;

    const stepPrompt = `OBLIGATORIO: Ofrece al candidato opciones de DÍAS para su entrevista basándote en la disponibilidad de la vacante. Si ya eligió día, ofrécele HORARIOS. NUNCA ofrezcas horarios si no ha elegido día. Si el candidato te pregunta algo de la vacante, asegúrate de responderle pero NO OLVIDES DE VOLVER A PREGUNTAR POR LOS DÍAS O HORARIOS (lo que falte).`;

    const vacancyData = `
[DATOS REALES DE LA VACANTE]:
- Puesto: Operador de Producción
- Sueldo: $2,500 semanales netos
- Transporte: Sí contamos con transporte de personal al inicio y final de turno.
- Ubicación: Portal de las Flores 1, General Zuazua
- Requisitos: Primaria terminada. Mayores de 18 años.

[FECHAS/HORAS QUE DEBES OFRECER (USANDO LA REGLA DE ARRIBA)]:
- Lunes 15 de Abril: 09:00 AM, 11:00 AM, 03:00 PM
- Martes 16 de Abril: 09:00 AM, 11:00 AM
    `;

    // COMÚN
    const sysPrompt = RECRUITER_IDENTITY + "\n\n[OBJETIVO DE ESTE PASO]: " + stepPrompt + "\n\n" + vacancyData;

    // ---------------------------------------------------------------------------------------------------------
    // TEST 1: YA MOSTRAMOS DÍAS Y EL CANDIDATO PREGUNTA ALGO DIFERENTE
    // ---------------------------------------------------------------------------------------------------------
    console.log("=================================================");
    console.log("TEST 1: Brenda muestra días -> Candiando pregunta sueldo en vez de elegir.");
    
    let history1 = [
        { role: "assistant", content: "¡Excelente Juan! Tengo entrevistas disponibles para el Lunes 15 de Abril o el Martes 16 de Abril 📅. ¿Qué día prefieres? 😊" },
        { role: "user", content: "¿y de cuanto es el pago de este jale?" }
    ];

    const prompt1 = sysPrompt + "\n\n[ADN (Reténlo y complétalo)]:\n" + JSON.stringify({ citaFecha: null, citaHora: null }) + 
        "\n\n[HISTORIAL DE CHAT]:\n" + history1.map(m => `[${m.role === 'user' ? 'Candidato' : 'Brenda'}]: ${m.content}`).join('\n');

    let response1 = await getOpenAIResponse(
        [{ role: 'user', content: prompt1 }], 
        "Eres el sistema Brenda, responde en JSON.", 
        config.openaiModel, 
        config.openaiApiKey, 
        { type: "json_object" }
    );
    let r1 = JSON.parse(response1.content);
    console.log("\n-> BRENDA RESPONDE: ", r1.response_text);
    console.log("-> JSON DATA: ", r1.extracted_data);

    // ---------------------------------------------------------------------------------------------------------
    // TEST 2: EL CANDIDATO YA ELIGIÓ DÍA Y BRENDA MUESTRA HORAS -> EL CANDIDATO PREGUNTA SI HAY TRANSPORTE
    // ---------------------------------------------------------------------------------------------------------
    console.log("\n=================================================");
    console.log("TEST 2: Brenda muestra horas -> Candidato pregunta transporte.");
    
    let history2 = [
        { role: "assistant", content: "¡Excelente Maria! Entonces agendamos para el Lunes 15 de Abril. Tengo entrevista a las: 1️⃣ 09:00 AM ⏰ 2️⃣ 11:00 AM ⏰ 3️⃣ 03:00 PM ⏰. ¿Te parece bien alguno de esos horarios? 😊" },
        { role: "user", content: "si hay camiones al salir?" }
    ];

    // En el paso 2, el ADN ya tiene el citaFecha capturado:
    const prompt2 = sysPrompt + "\n\n[ADN (Reténlo y complétalo)]:\n" + JSON.stringify({ citaFecha: '2026-04-15', citaHora: null }) + 
        "\n\n[HISTORIAL DE CHAT]:\n" + history2.map(m => `[${m.role === 'user' ? 'Candidato' : 'Brenda'}]: ${m.content}`).join('\n');

    let response2 = await getOpenAIResponse(
        [{ role: 'user', content: prompt2 }], 
        "Eres el sistema Brenda, responde en JSON.", 
        config.openaiModel, 
        config.openaiApiKey, 
        { type: "json_object" }
    );
    let r2 = JSON.parse(response2.content);
    console.log("\n-> BRENDA RESPONDE: ", r2.response_text);
    console.log("-> JSON DATA: ", r2.extracted_data);

}

runTests();
