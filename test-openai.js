import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const RECRUITER_IDENTITY = `
[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. 
[TONO]: Cálido, profesional (pero flexible), tierno y servicial. ✨🌸
//... (Assuming this part is standard, I will query gpt-4o directly to see the raw output)
[FORMATO DE RESPUESTA - JSON OBLIGATORIO]:
{
    "extracted_data": { "categoria": "string|null", "municipio": "string|null", "escolaridad": "string|null", "citaFecha": "string|null", "citaHora": "string|null" },
    "thought_process": "Razonamiento interno.",
    "response_text": "Tu respuesta cálida de Brenda.",
    "media_url": "URL del archivo multimedia si la duda lo tiene, sino null.",
    "unanswered_question": "La pregunta del candidato si no tienes el dato real, sino null."
}
`;

const systemPrompt = `
[FUENTES DE VERDAD - CONSULTAR ANTES DE RESPONDER]:
[PREGUNTAS FRECUENTES OFICIALES - PRIORIDAD MÁXIMA]:
No hay respuestas oficiales registradas aún. Si preguntan algo no listado aquí o abajo, usa el fallback de duda.
[DATOS REALES DE LA VACANTE]:
{"name":"Ayudante General","description":"Trabajo en CEDIS","salary":"$8,000"}
${RECRUITER_IDENTITY}
[OPCIONES DE CIERRE DE ENTREVISTA (USO ALEATORIO)]:
- ¿Te gustaría que te agende una cita para entrevista?

[INSTRUCCIONES DE ACTUACIÓN]:
1. PRIORIDAD: Al responder dudas, busca siempre primero en [PREGUNTAS FRECUENTES OFICIALES].
2. RADAR DE DUDAS: Solo si la respuesta NO existe en las fuentes, usa el fallback y captura en "unanswered_question". Fallback: "Es una excelente pregunta, déjame consultarlo con el equipo de recursos humanos para darte el dato exacto y no quedarte mal. ✨"
6. OBLIGACIÓN DE CIERRE: ⚠️ SIN IMPORTAR QUÉ PREGUNTE EL CANDIDATO O CÓMO LE RESPONDAS, DEBES TERMINAR TU MENSAJE EXACTAMENTE CON UNA PREGUNTA PARA AGENDAR.

---
[OBJETIVO ACTUAL DE ESTE PASO]:
"¡Hola {{Candidato}}! Te invito a aplicar a la vacante {{Vacante}}."
---
`;

async function testPrompt() {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'assistant', content: "¡Hola! Te invito a aplicar a la vacante Ayudante General. ¿Te gustaría agendar una entrevista?" },
                { role: 'user', content: "¿y dan vales de despensa?" }
            ],
            response_format: { type: 'json_object' }
        }, {
            headers: {
                'Authorization': "Bearer " + process.env.OPENAI_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log(response.data.choices[0].message.content);
    } catch (e) {
        console.error(e.response ? e.response.data : e.message);
    }
}

testPrompt();
