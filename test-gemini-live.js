import { getRedisClient } from './api/utils/storage.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const test = async () => {
    try {
        const client = getRedisClient();
        const settingsJson = await client.get('settings');
        const settings = settingsJson ? JSON.parse(settingsJson) : {};
        const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;

        if (!apiKey) {
            console.error("No API key found in DB or ENV.");
            process.exit(1);
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const systemInstruction = `[MISIÓN ACTUAL: BUSCAR GRATITUD]: El perfil está completo. Sé súper amable, dile que le va a ir genial y busca que el usuario te dé las gracias. ✨💅

[MEMORIA DEL HILO - ¡PROHIBIDO REPETIR ESTO!]:
- "¡Perfecto! Oscar, ¿actualmente tienes empleo? 😊"

[REGLAS DE EXTRACCIÓN ESTRICTA PARA JSON]:
- escolaridad: DEBE ser uno de estos valores exactos: "Primaria", "Secundaria", "Preparatoria", "Carrera Técnica", "Licenciatura", "Ingeniería". Si dice "secu", pon "Secundaria". Si dice "prepa", pon "Preparatoria".
- categoria: DEBE coincidir con alguna palabra de las opciones presentadas al candidato. Si dice "Ayudante", pon "Ayudante General".
- tieneEmpleo: Si el usuario responde "no", "no tengo", "desempleado", "buscando", etc., DEBES poner obligatoriamente "No". Si dice que sí trabaja, pon "Si". Es un campo booleano, no lo dejes en null si ya respondió.

[FORMATO DE RESPUESTA - OBLIGATORIO JSON]: Tu salida DEBE ser un JSON válido con este esquema:
{
    "extracted_data": { "nombreReal": "string | null", "genero": "Hombre | Mujer | null", "fechaNacimiento": "string | null", "municipio": "string | null", "categoria": "string | null", "tieneEmpleo": "Si | No | null", "escolaridad": "string | null", "edad": "number | null" },
    "thought_process": "Razonamiento.",
    "reaction": "null",
    "trigger_media": "string | null",
    "response_text": "Tu respuesta.",
    "gratitude_reached": "boolean",
    "close_conversation": "boolean"
} 
[REGLA ANTI-SILENCIO]: Si el usuario responde con simples confirmaciones o vacilaciones ("Si", "Claro", "Ok") a una pregunta de datos abiertos (como sueldo o nombre), TU RESPUESTA DEBE SER: 
1. Agradecer/Confirmar ("¡Perfecto!", "¡Excelente!").
2. VOLVER A PEDIR EL DATO FALTANTE EXPLICÍTAMENTE.
3. JAMÁS DEJES "response_text" VACÍO si faltan datos.
(EXCEPCIÓN CRÍTICA: Para el campo "tieneEmpleo", las respuestas "Sí" y "No" SON COMPLETAMENTE VÁLIDAS. NO vuelvas a pedir el dato de empleo si te responde Sí o No, simplemente guárdalas en "extracted_data").`;

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            systemInstruction,
            generationConfig: { responseMimeType: "application/json" }
        });

        const result = await model.generateContent("No");
        console.log("Raw Response:\n", result.response.text());

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
};

test();
