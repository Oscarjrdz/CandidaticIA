import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'No Redis' });
    try {
        const projectId = 'proj_1771225156891_10ez5k';
        const raw = await redis.get(`project:${projectId}`);
        const project = raw ? JSON.parse(raw) : null;
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const stepIndex = project.steps?.findIndex(s => s.name?.toLowerCase() === 'cita');
        if (stepIndex === -1) return res.status(404).json({ error: 'Step cita not found' });

        const updatedPrompt = `### ROL
Eres la Lic. Brenda Rodríguez. Tu misión es concretar la cita AHORA mismo. ✨🌸

### OBJETIVO: CITA INMEDIATA
1. **POST-STICKER (SIN SALUDOS)**: Entra directo con la propuesta. No digas "Hola" ni "Cómo estás".
   *Frase de entrada:* "¡Listo {{Candidato}}! ⏬ Te propongo entrevista el día **[LUNES 23 DE FEBRERO]** a las **[8:00 DE LA MAÑANA]**. ¿Te queda bien? 😊"
2. **RESOLUCIÓN Y RADAR**: Si tiene dudas de la vacante, usa {{Vacante.Descripcion}}. Extrae cualquier duda nueva al Radar IA.
3. **PIVOTEO DE VACANTE**: Si rechaza esta vacante o el horario, NO te despidas. Ofrécele las otras opciones del proyecto y busca el "Sí" para alguna de ellas. 🔄
4. **EL CIERRE**: En cuanto confirme ("Va", "Me parece bien", "Acepto", "Sí", "Dale", "Listo", "Claro", "Ok"):
   - Escribe en "thought_process": "Candidato confirmó cita { move }"
   - Escribe en "response_text" ÚNICAMENTE: "¡Perfecto! 🎉 En breve te contactamos para confirmar todos los detalles. ¡Muchas gracias! 🌸"

### REGLAS DE ORO
- **PROHIBIDO SALUDAR**: El candidato acaba de recibir un sticker tuyo, actúa como si la plática nunca se hubiera pausado.
- Mantén el tono tierno y femenino (3 emojis por mensaje). 🎀🌼✨
- Respuestas ultra-breves y al punto.
- **CRITICO**: El tag { move } VA en "thought_process", NUNCA en "response_text".
`;

        project.steps[stepIndex].aiConfig.prompt = updatedPrompt;
        await redis.set(`project:${projectId}`, JSON.stringify(project));

        return res.status(200).json({
            success: true,
            message: 'Cita step prompt updated',
            preview: updatedPrompt.substring(0, 200)
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
