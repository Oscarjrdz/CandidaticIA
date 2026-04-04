import fs from 'fs';
import path from 'path';

// Read key manually
const envRaw = fs.readFileSync('.env.local', 'utf8');
const keyMatch = envRaw.match(/OPENAI_API_KEY=["']?([^"'\n\r]+)["']?/);
const apiKey = keyMatch ? keyMatch[1].trim() : null;

async function doFetch(promptText) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: "Eres el asistente Brenda, responde en JSON." },
                { role: "user", content: promptText }
            ],
            temperature: 0.1
        })
    });
    const data = await res.json();
    if (data.error) {
        console.error("OPENAI ERROR:", data.error);
        return null;
    }
    return JSON.parse(data.choices[0].message.content);
}

const RECRUITER_IDENTITY = `
[IDENTIDAD]: Eres la Lic. Brenda Rodríguez (25 años), reclutadora de Candidatic. 
[MÁXIMA PRIORIDAD]: El [OBJETIVO DE ESTE PASO] dicta tus palabras. 
⛔ PROHIBICIÓN DE FRASES ABIERTAS: NUNCA termines un mensaje con frases como "si tienes más dudas", "quedo atenta", etc.
[REGLAS DE TRANSICIÓN]:
1. Si el candidato confirma interés, incluye "{ move }" en "thought_process".
2. Si el candidato hace UNA PREGUNTA (el mensaje empieza con ¿, o contiene ¿cómo, dónde, etc) NUNCA dispares "{ move }".
6. NUNCA ofrezcas días/horarios a menos que el paso lo pida explícitamente.
7. 📅 CITA ESTRICTA: En el paso "Cita", NUNCA uses "{ move }" hasta que el candidato confirme explícitamente ("Sí"). 

[📡 RADAR DE DUDAS (RESPONDE CON SEGURIDAD)]:
Si el candidato hace UNA PREGUNTA sobre la vacante:
2. 🚨 LECTURA OBLIGATORIA DE VACANTE: Armarás una respuesta cálida y directa con esos datos y la pondrás en 'response_text' asegurando de re-preguntar por el objetivo del paso.
4. ESTRICTAMENTE PROHIBIDO MUDISMO: NUNCA dejes el 'response_text' vacío o uses "[SILENCIO]".

[FORMATO DE RESPUESTA - JSON OBLIGATORIO]:
{
    "extracted_data": { 
        "citaFecha": "YYYY-MM-DD|null",
        "citaHora": "string|null" 
    },
    "thought_process": "Razonamiento interno.",
    "response_text": "Tu respuesta cálida de Brenda."
}
⚠️ citaFecha y citaHora deben llenarse en cuanto se elijan y mantenerse.
`;

const stepPrompt = `OBLIGATORIO: Ofrece al candidato opciones de DÍAS para su entrevista basándote en la disponibilidad. Si ya eligió día, ofrécele HORARIOS. NUNCA ofrezcas horarios si no ha elegido día. Si el candidato te pregunta algo, asegúrate de responderle pero NO OLVIDES DE VOLVER A PREGUNTAR POR LOS DÍAS O HORARIOS (lo que falte).`;

const vacancyData = `
[DATOS REALES DE LA VACANTE]:
- Puesto: Operador de Producción
- Sueldo: $2,500 semanales netos
- Transporte: Sí contamos con transporte de personal al inicio y final de turno.
- Días: Lunes 15 de Abril, Martes 16 de Abril
- Horarios Lunes 15: 09:00 AM, 11:00 AM, 03:00 PM
`;

const sysPrompt = RECRUITER_IDENTITY + "\n\n[OBJETIVO DE ESTE PASO]: " + stepPrompt + "\n\n" + vacancyData;

async function runTests() {
    console.log("=================================================");
    console.log("TEST 1: Día -> Pregunta sueldo");
    let history1 = [
        { role: "assistant", content: "¡Excelente Juan! Tengo entrevistas disponibles para el Lunes 15 de Abril o el Martes 16 de Abril 📅. ¿Qué día prefieres? 😊" },
        { role: "user", content: "¿y de cuanto es el pago de este jale?" }
    ];
    let prompt1 = sysPrompt + "\n\n[ADN (Reténlo y complétalo)]:\n" + JSON.stringify({ citaFecha: null, citaHora: null }) + 
        "\n\n[HISTORIAL DE CHAT]:\n" + history1.map(m => `[${m.role === 'user' ? 'Candidato' : 'Brenda'}]: ${m.content}`).join('\n');
    let r1 = await doFetch(prompt1);
    console.log("-> BRENDA RESPONDE: ", r1.response_text);
    console.log("-> JSON DATA: ", JSON.stringify(r1.extracted_data));

    console.log("\n=================================================");
    console.log("TEST 2: Hora -> Pregunta transporte");
    let history2 = [
        { role: "assistant", content: "¡Excelente Maria! Tengo entrevista a las: 1️⃣ 09:00 AM ⏰ 2️⃣ 11:00 AM ⏰ 3️⃣ 03:00 PM ⏰. ¿Te parece bien alguno de esos horarios? 😊" },
        { role: "user", content: "si hay camiones al salir?" }
    ];
    let prompt2 = sysPrompt + "\n\n[ADN (Reténlo y complétalo)]:\n" + JSON.stringify({ citaFecha: '2026-04-15', citaHora: null }) + 
        "\n\n[HISTORIAL DE CHAT]:\n" + history2.map(m => `[${m.role === 'user' ? 'Candidato' : 'Brenda'}]: ${m.content}`).join('\n');
    let r2 = await doFetch(prompt2);
    console.log("-> BRENDA RESPONDE: ", r2.response_text);
    console.log("-> JSON DATA: ", JSON.stringify(r2.extracted_data));
}
runTests();
