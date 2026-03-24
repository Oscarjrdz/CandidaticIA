import { getOpenAIResponse } from './api/utils/openai.js';

async function testExtraction() {
  const prompt = `ERES UN EXTRACTOR DE DATOS STRICTO. DEVUELVE SOLO UN JSON.
  
[EXTRAER]: nombreReal, genero, fechaNacimiento, edad, municipio, categoria, escolaridad.
1. REFINAR: Si el dato en [ESTADO] es incompleto, fusiónalo con el nuevo.
2. FORMATO: Nombres/Municipios en Title Case. Fecha DD/MM/YYYY.
3. ESCOLARIDAD: Primaria, Secundaria, Preparatoria, Licenciatura, Técnica, Posgrado.
4. EMPLEO: "Empleado" o "Desempleado".
5. CATEGORÍA: Solo de: ✅ General`;

  const msgs = [
    { role: 'assistant', content: '¿Me puedes dar tu Nombre y Apellidos completos?' },
    { role: 'user', content: '🎙️ [AUDIO TRANSCRITO]: "Me llamo Oscar Rodríguez."' }
  ];

  const res = await getOpenAIResponse(msgs, prompt, 'gpt-4o-mini', process.env.OPENAI_API_KEY, { type: 'json_object' });
  console.log(res);
}

testExtraction().catch(console.error);
