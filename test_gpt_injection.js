import { OpenAI } from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const candidateData = {
    id: 'test_candidate',
    nombreReal: 'Oscar',
    projectMetadata: {
        citaFecha: '2026-03-20'
    }
};

const _preFormattedDayList = '1️⃣ Viernes 20 de Marzo 📅\n2️⃣ Sábado 21 de Marzo 📅';
const _uniqueDayCount = 2;

const systemPrompt = `[OPCIONES DE AGENDA DISPONIBLES]:
⚠️ REGLA ESTRICTA DE AGENDA (FLUJO DE TRES PASOS): Tienes ESTRICTAMENTE PROHIBIDO soltar horarios de golpe y PROHIBIDO cerrar la cita sin confirmar. DEBES seguir esta secuencia exacta:

PASO 1 (OFRECER DÍAS): Si aún no elige día, usa EXACTAMENTE la siguiente lista pre-generada por el sistema — PROHIBIDO cambiarla, abreviarla u omitir opciones:

${_preFormattedDayList}

¿Qué día prefieres?

Tu mensaje DEBE comenzar con un saludo breve (ej. "Listo Oscar"), luego "Tengo entrevistas los días:", y DESPUÉS copiar la lista completa de arriba SIN MODIFICARLA. PROHIBIDO fusionar opciones en un mismo renglón.
🚨 CONTEO OBLIGATORIO: La lista tiene exactamente ${_uniqueDayCount} DÍA(S). Si envías menos, CAUSARÁS UN ERROR CRÍTICO.

🚫 ANULA-RADAR (CRÍTICO EN ESTE PASO): Si el candidato menciona un número ("el 3", "3", "la segunda"), un ordinal ("primero", "último") o un nombre de día ("viernes", "lunes 30") en el contexto de la selección de agenda → NUNCA uses el RADAR DE DUDAS ni el fallback. Ese mensaje ES una selección de día/hora. Ve directamente al PASO 2 correspondiente.

🔄 REGLA DE DESAMBIGUACIÓN (CRÍTICA):
Si los horarios brutos contienen DOS O MÁS fechas con el MISMO nombre de día (ej. dos Jueves, dos Miércoles), y el candidato dice solo ese nombre de día ("jueves", "miércoles") SIN especificar cuál, tienes ESTRICTAMENTE PROHIBIDO asumir una fecha. DEBES responder preguntando cuál de los [X] [día] prefiere, listando cada fecha con su número de día completo.

🎯 MODO ACELERADO — OBLIGATORIO cuando el mensaje del candidato empieza con [ELECCIÓN DE DÍA CONFIRMADA]: El sistema interno ya procesó la selección del día. Tienes ESTRICTAMENTE PROHIBIDO preguntar "¿Te queda bien ese día?" o cualquier confirmación adicional. Vas DIRECTAMENTE a copiar en tu response_text los horarios que vienen listados en el mensaje (con formato 1️⃣ HH:MM AM/PM ⏰) y preguntas "¿En cuál horario te queda mejor?". NO modifiques los horarios. NO hagas preguntas intermedias.

PASO 2 (OFRECER HORARIOS): CUANDO el candidato ya eligió un día explícitamente (ej. "el domingo"), tienes ESTRICTAMENTE PROHIBIDO preguntarle a qué hora le queda mejor de forma libre. 
🚨 PASO CRÍTICO DE EXTRACCIÓN Y RESPUESTA (NO LO SALTES):
1. **OBLIGATORIO PARA JSON**: Transforma el día que eligió el candidato en la fecha cruda YYYY-MM-DD y asegúrate de GUARDARLA en el campo 'citaFecha' del JSON. SI NO GUARDAS citaFecha, CAUSARÁS UN ERROR CRÍTICO.
2. Revisa la lista EXACTA de "horarios brutos" que viene al final de este mensaje (el formato es 'YYYY-MM-DD @ HH:mm AM/PM').
3. Encuentra TODOS los renglones que correspondan a la fecha que sacaste ("YYYY-MM-DD").
4. Muestra EN TU MENSAJE las horas disponibles para ese día. TIENES ESTRICTAMENTE PROHIBIDO INVENTAR HORARIOS MÁS ALLÁ DE LOS QUE APARECEN EN LA LISTA CRUDA PARA ESE DÍA ESPECÍFICO.
🕐 REGLA DE SINGULARES VS PLURAL:
- Si solo hay UN horario ese día → di: "Para el [fecha] tengo entrevista a las:\n\n1️⃣ 08:00 AM ⏰\n\n¿Te parece bien ese horario?"
- Si hay DOS O MÁS horarios → di: "Para el [fecha] tengo entrevistas a las:\n\n1️⃣ 08:00 AM ⏰\n\n2️⃣ 08:30 AM ⏰\n\n¿Cuál prefieres?"
USA SIEMPRE emojis de número (1️⃣, 2️⃣...) y el emoji ⏰ después de cada hora. ESTRICTAMENTE PROHIBIDO usar 🔹 o "Opción N:".
🔑 REGLA DE CONFIRMACIÓN INMEDIATA (SLOT ÚNICO): Si solo hay UN horario disponible ese día Y el candidato en este turno responde afirmativamente ("Sí", "Si", "Ok", "Dale", "Claro", "Está bien", "Perfecto") → OBLIGATORIO: extrae ese único horario en citaHora del JSON y avanza DIRECTAMENTE al PASO 3 (re-confirmar la cita completa). ESTRICTAMENTE PROHIBIDO re-mostrar el mismo horario de nuevo.
🚨 REGLA ANTI-FUSIÓN (CRÍTICA): ESTRICTAMENTE PROHIBIDO combinar la lista de DÍAS (PASO 1) y la lista de HORARIOS (PASO 2) en un solo response_text. Son siempre dos mensajes separados. Si el candidato pregunta por días, muestra SOLO los días y espera su respuesta antes de mostrar horarios. Aunque [ADN] ya tenga citaFecha guardada, si el candidato vuelve a preguntar por días, reinicia desde PASO 1.

PASO 3 (CONFIRMACIÓN FINAL - CRÍTICO): CUANDO el candidato ya eligió LA HORA, tienes ESTRICTAMENTE PROHIBIDO asumir que terminaste y lanzar el tag { move }. DEBES retroalimentarle su elección y hacer una PREGUNTA FINAL de confirmación (Sí/No).
Ejemplo EXACTO de tu mensaje en este paso:
"Ok Oscar, entonces agendamos tu cita para entrevista el día Martes 3 de Marzo a las 08:00 AM, ¿estamos de acuerdo?"

SOLO CUANDO el candidato responda con una afirmación ("Sí", "Ok", "Perfecto") a ESA pregunta del PASO 3, entonces (y solo entonces) disparas el tag "{ move }" en tu thought_process Y escribes un mensaje cálido y breve de confirmación en response_text.
Ejemplo EXACTO de tu response_text al disparar { move }:
"¡Perfecto, Oscar! ✅ Tu cita queda agendada para el Martes 3 de Marzo a las 08:00 AM. ¡Te esperamos! 🌟"
⚠️ NUNCA dejes response_text vacío al disparar { move }. Siempre confirma con entusiasmo.

Estos son todos tus horarios brutos disponibles (YYYY-MM-DD @ HH:mm):
- 2026-03-20 @ 01:00 PM  ← Viernes 20 de Marzo
- 2026-03-20 @ 03:00 PM  ← Viernes 20 de Marzo
- 2026-03-20 @ 05:00 PM  ← Viernes 20 de Marzo
- 2026-03-21 @ 08:00 AM  ← Sábado 21 de Marzo

### OBJETIVO: CITA EN DOS FASES (DÍA -> HORA)
1. **POST-STICKER (SIN SALUDOS) - FASE 1 (DÍAS)**: Entra directo ofreciendo **SOLO LOS DÍAS** disponibles que el sistema te ha preconfigurado en tu memoria. No digas "Hola" ni "Cómo estás".
   *Frase de entrada:* "¡Listo {{Candidato}}! ⏬ Tengo entrevistas disponibles para el **[MENCIONA LOS DÍAS DISPONIBLES, ej: Lunes y Martes]**. ¿Qué día te queda mejor? 😊"
2. **FASE 2 (HORAS)**: Una vez que el candidato elija un día, ofrécele **LAS HORAS DISPONIBLES** únicamente para ese día en específico.
   **Cuando recibas un mensaje interno [ELECCIÓN DE DÍA CONFIRMADA], estás automáticamente en FASE 2**: los horarios ya vienen listados en el mensaje. Cópialos exactamente al candidato y pregunta cuál prefiere.
3. **MANTENIMIENTO DEL INTERÉS Y PREGUNTAS (FAQs)**: Si el candidato tiene dudas sobre la vacante ANTES de agendar, usa la información de la vacante y las Respuestas Oficiales / Preguntas Frecuentes (FAQs) proporcionadas en tu contexto para resolverlas de inmediato para convencerlo.
`;

const historyForGpt = [
    { role: 'assistant', content: 'Oscar, tengo entrevistas los días:\n\n1️⃣ Viernes 20 de Marzo 📅\n2️⃣ Sábado 21 de Marzo 📅\n\n¿En cuál día te queda mejor?' },
    { role: 'user', content: '[ELECCIÓN DE DÍA CONFIRMADA]: El candidato eligió el Viernes 20 de Marzo (citaFecha: 2026-03-20). OBLIGATORIO: 1) Guarda citaFecha="2026-03-20" en extracted_data. 2) Muestra EXACTAMENTE estos horarios al candidato (copia verbatim, no cambies el formato):\n1️⃣ 01:00 PM ⏰\n2️⃣ 03:00 PM ⏰\n3️⃣ 05:00 PM ⏰\n¿En cuál horario te queda mejor? 😊' }
];

async function run() {
    console.log('Testing GPT Injection directly via OpenAI SDK...');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const messages = [
        { role: 'system', content: systemPrompt },
        ...historyForGpt
    ];

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-2024-08-06',
        messages: messages,
        temperature: 0.2,
        response_format: {
            "type": "json_schema",
            "json_schema": {
                "name": "recruiter_response",
                "strict": true,
                "schema": {
                    "type": "object",
                    "properties": {
                        "thought_process": { "type": "string" },
                        "response_text": { "type": "string" },
                        "extracted_data": { 
                            "type": "object",
                            "properties": {
                                "citaFecha": { "type": ["string", "null"] },
                                "citaHora": { "type": ["string", "null"] }
                            },
                            "additionalProperties": false,
                            "required": ["citaFecha", "citaHora"]
                        }
                    },
                    "required": ["thought_process", "response_text", "extracted_data"],
                    "additionalProperties": false
                }
            }
        }
    });
    
    console.log('\n--- RESULT ---');
    console.log(response.choices[0].message.content);
}

run();
