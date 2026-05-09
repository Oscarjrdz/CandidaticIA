import { getOpenAIResponse } from '../utils/openai.js';
import { getRedisClient } from '../utils/storage.js';
import { 
    getCandidateKnowledgeSnapshot, 
    formatCompactSnapshot, 
    searchCandidateRoster, 
    formatSearchResults 
} from '../utils/copilot-candidate-knowledge.js';

const SYSTEM_KNOWLEDGE = `
Candidatic IA es una plataforma web de reclutamiento con módulos internos:
- Candidatos: gestión de perfiles capturados desde WhatsApp y otras fuentes.
- Chat Web: conversaciones con candidatos.
- Envíos Masivos: campañas y secuencias de mensajes.
- Estadísticas de Ads: seguimiento de campañas Meta/Facebook.
- Bot IA: configuración de Brenda Rodríguez, prompts, reglas y modo host.
- Automatizaciones: reglas de extracción inteligente hacia campos del candidato.
- Vacantes: gestión de vacantes, FAQ y contenido de reclutamiento.
- Bolsa de Empleo: experiencia pública/app para candidatos.
- ByPass: enrutamiento automático de candidatos.
- Proyectos: CRM/Kanban de reclutamiento.
- Post Maker: creación de posts para Facebook.
- Usuarios: roles, permisos y equipo.
- Settings: credenciales y configuración general.

Capacidades técnicas ya existentes:
- OpenAI configurable desde ai_config o variables de entorno.
- Redis como almacenamiento principal.
- Endpoints serverless en /api.
- Webhooks de WhatsApp/UltraMsg y Messenger.
- Extracción inteligente de datos de candidatos.
- Recordatorios, reactivación y procesos cron.

Estado actual del copiloto:
- Puede orientar al usuario sobre cómo funciona la plataforma.
- Puede explicar módulos, flujos y buenas prácticas.
- Puede proponer pasos, prompts y automatizaciones.
- No debe afirmar que ejecutó cambios, envió mensajes, editó candidatos o creó reglas.
- Si el usuario pide una acción que modifique datos, debe explicar que puede prepararla/proponerla y pedir confirmación.
`;

const FALLBACK_BRENDA_PERSONALITY = `
Brenda Rodríguez es una asistente de reclutamiento cálida, clara, profesional y práctica.
Habla en español natural, con tono humano, directo y servicial.
Evita sonar robótica, exagerada o demasiado técnica.
Prioriza ayudar al equipo a avanzar con orden, criterio y buena comunicación.
`;

function normalizeHistory(history = []) {
    return history
        .filter((message) => message && typeof message.content === 'string')
        .slice(-10)
        .map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content.slice(0, 3000)
        }));
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Método no permitido' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const question = String(body.message || '').trim();
        const history = normalizeHistory(body.history);

        if (!question) {
            return res.status(400).json({ success: false, error: 'Falta el mensaje para Brenda' });
        }

        const redis = getRedisClient();
        let model = 'gpt-4o-mini';

        if (redis) {
            try {
                const storedModel = await redis.get('bot_ia_model');
                model = storedModel || model;
            } catch (error) {
                console.warn('[Copilot] No se pudo leer configuración:', error.message);
            }
        }

        const snapshot = await getCandidateKnowledgeSnapshot();
        const compactStats = formatCompactSnapshot(snapshot);
        
        // Pass context from the last few messages for cross-referenced questions
        const searchContext = history.slice(-2).map(m => m.content).join(' ') + ' ' + question;
        const searchResults = await searchCandidateRoster(snapshot.allCandidatesSummary, searchContext);
        const searchText = formatSearchResults(searchResults);

        const systemPrompt = `
Eres Brenda Rodríguez, copiloto interno de Candidatic IA.

PERSONALIDAD (COPILOTO, NO BOT DE WHATSAPP):
${FALLBACK_BRENDA_PERSONALITY}

CONOCIMIENTO DEL SISTEMA Y MÓDULOS:
${SYSTEM_KNOWLEDGE}

CONOCIMIENTO DE LA BASE DE CANDIDATOS (DATOS REALES):
${compactStats}
${searchText}

INSTRUCCIONES FINALES:
- Responde como copiloto operativo interno, no como bot externo para candidatos.
- Eres capaz de responder sobre cómo funciona la plataforma Y sobre las estadísticas reales de candidatos.
- Si el usuario pregunta "cuántos", "cuántas", o hace preguntas de conteo cruzado y hay una "BÚSQUEDA ESPECÍFICA", usa el "Total coincidencias" de esa búsqueda como la respuesta matemática.
- Si te preguntan "hoy" o "ayer", usa zona horaria ${snapshot.timezone}.
- No inventes métricas, candidatos, ni campañas. Usa SOLO los datos proporcionados.
- Mantén respuestas breves y ejecutivas salvo que el usuario pida detalle.
`;

        const result = await getOpenAIResponse(
            [...history, { role: 'user', content: question }],
            systemPrompt,
            model,
            null,
            null,
            null,
            1200
        );

        return res.status(200).json({
            success: true,
            reply: result.content,
            model: result.model,
            skill: 'unified_omni_knowledge'
        });
    } catch (error) {
        console.error('[Copilot] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'No pude responder como copiloto en este momento.',
            detail: error.message
        });
    }
}
