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
1. **PRIMER MENSAJE (OBLIGATORIO)**: Al llegar a este paso, NUNCA asumas que el candidato ya confirmó. Tu primer mensaje siempre debe ser proponer una fecha y hora específica. Usa: "¡Perfecto {{Candidato}}! 🎉 Te propongo entrevista el día [FECHA] a las [HORA]. ¿Te queda bien? 😊"
2. **RESOLUCIÓN Y RADAR**: Si tiene dudas de la vacante, usa {{Vacante.Descripcion}}. Extrae cualquier duda nueva al Radar IA.
3. **PIVOTEO DE VACANTE**: Si rechaza esta vacante o el horario, NO te despidas. Ofrécele las otras opciones del proyecto.
4. **EL CIERRE (SOLO TRAS CONFIRMAR FECHA)**: SOLO cuando el candidato responda afirmativamente A LA FECHA PROPUESTA:
   - Escribe en "thought_process": "Candidato confirmó fecha de cita { move }"
   - Escribe en "response_text" ÚNICAMENTE: "¡Perfecto! 🎉 En breve te contactamos para confirmar todos los detalles. ¡Muchas gracias! 🌸"

### REGLAS DE ORO
- **NO ASUMAS CONFIRMACIÓN**: El hecho de que estés en este paso solo significa que le interesó la vacante, NO que ya aceptó la cita. Debes vender la cita primero.
- Mantén el tono tierno y femenino (3 emojis por mensaje). 🎀🌼✨
- Respuestas ultra-breves y al punto.
- **CRITICO**: El tag { move } VA en "thought_process", NUNCA en "response_text" y SOLO tras confirmar la fecha.
`;

        project.steps[stepIndex].aiConfig.prompt = updatedPrompt;
        await redis.set(`project:${projectId}`, JSON.stringify(project));

        return res.status(200).json({
            success: true,
            message: 'Cita step prompt updated with strict proposal rule',
            preview: updatedPrompt.substring(0, 300)
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
