import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Manual .env.local loader
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        }
    });
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found');
    process.exit(1);
}

const query = "mujeres de 18 años";

async function testAI() {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const systemPrompt = `[ARCHITECTURE PROTOCOL: TITAN SEARCH v5.0]
Eres el Motor de Traducción de Intenciones de Candidatic IA. Tu tarea es extraer filtros técnicos de una consulta natural.

[REGLAS DE FILTRADO]:
1. statusAudit (CRÍTICO): 
   - Si piden "completos", "ya terminaron", "registrados", "listos" -> {"statusAudit": "complete"}.
   - Si piden "pendientes", "faltan", "no han terminado", "incompletos" -> {"statusAudit": "pending"}.
2. INTENCIÓN SEMÁNTICA: Traduce plurales a singulares. Ejemplo: "mujeres" -> {"genero": "Mujer"}.
3. RANGOS DE EDAD: 
   - Ejemplo: "de 20 a 30 años" -> {"edad": {"min": 20, "max": 30}}
   - Ejemplo: "más de 30" -> {"edad": {"op": ">", "val": 30}}
4. MUNICIPIOS: Si mencionan un lugar, asígnalo a "municipio" o "colonia" según corresponda.
5. KEYWORDS: Solo para nombres específicos (ej: "Oscar") o habilidades que NO estén en los campos fijos.

[FORMATO DE SALIDA]: JSON JSON JSON. NO TEXT.

Consulta del usuario: "${query}"
`;

    console.log(`🔍 Querying AI for: "${query}"...`);
    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    console.log('--- AI RESPONSE ---');
    console.log(response.text());
    console.log('-------------------');
}

testAI();
