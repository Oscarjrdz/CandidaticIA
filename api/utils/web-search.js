import axios from 'axios';
import { getRedisClient } from './storage.js';

const SERPER_API_URL = 'https://google.serper.dev/search';

/**
 * Search the web using Serper.dev (Google Search API).
 * Returns structured results: title, link, snippet.
 * 
 * API key is read from Redis (ai_config.serperApiKey) or env (SERPER_API_KEY).
 */
export async function searchWeb(query, options = {}) {
    const { maxResults = 5, lang = 'es', country = 'mx' } = options;

    // Resolve API key
    let apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
        try {
            const redis = getRedisClient();
            if (redis) {
                const aiConfigJson = await redis.get('ai_config');
                if (aiConfigJson) {
                    const config = JSON.parse(aiConfigJson);
                    apiKey = config.serperApiKey;
                }
            }
        } catch { /* ignore */ }
    }

    if (!apiKey) {
        return { success: false, error: 'No hay API key de Serper configurada. Agrégala en Settings → ai_config → serperApiKey.', results: [] };
    }

    try {
        const response = await axios.post(SERPER_API_URL, {
            q: query,
            gl: country,
            hl: lang,
            num: maxResults
        }, {
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            timeout: 8000
        });

        const data = response.data;
        const results = [];

        // Knowledge graph (instant answer)
        if (data.knowledgeGraph) {
            const kg = data.knowledgeGraph;
            results.push({
                type: 'knowledge',
                title: kg.title || '',
                description: kg.description || '',
                source: kg.descriptionSource || '',
                attributes: kg.attributes || {}
            });
        }

        // Answer box
        if (data.answerBox) {
            results.push({
                type: 'answer',
                title: data.answerBox.title || '',
                answer: data.answerBox.answer || data.answerBox.snippet || '',
                source: data.answerBox.link || ''
            });
        }

        // Organic results
        if (data.organic) {
            for (const item of data.organic.slice(0, maxResults)) {
                results.push({
                    type: 'organic',
                    title: item.title || '',
                    snippet: item.snippet || '',
                    link: item.link || '',
                    date: item.date || ''
                });
            }
        }

        return { success: true, results, query };
    } catch (error) {
        console.error('[WebSearch] Error:', error.response?.data || error.message);
        return { success: false, error: error.message, results: [] };
    }
}

/**
 * Format search results into compact text for GPT (~200-400 tokens).
 */
export function formatSearchResultsForPrompt(searchData) {
    if (!searchData?.success || !searchData.results?.length) return '';

    const lines = [`\n=== RESULTADOS DE BÚSQUEDA WEB: "${searchData.query}" ===`];

    for (const r of searchData.results) {
        if (r.type === 'knowledge') {
            lines.push(`📚 ${r.title}: ${r.description}`);
            if (r.attributes && Object.keys(r.attributes).length > 0) {
                const attrs = Object.entries(r.attributes).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(' | ');
                lines.push(`   ${attrs}`);
            }
        } else if (r.type === 'answer') {
            lines.push(`✅ Respuesta directa: ${r.answer}`);
        } else {
            const datePart = r.date ? ` (${r.date})` : '';
            lines.push(`• ${r.title}${datePart}`);
            lines.push(`  ${r.snippet}`);
        }
    }

    lines.push('INSTRUCCIÓN: Usa estos resultados para responder. Cita fuentes cuando sea relevante. No inventes datos que no estén en los resultados.');

    return lines.join('\n');
}

/**
 * Detect if a message has web search intent.
 * Returns the search query if intent detected, null otherwise.
 */
export function detectWebSearchIntent(message) {
    const normalized = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // Explicit triggers — user explicitly asks to search
    const EXPLICIT_TRIGGERS = [
        'busca en internet', 'busca en google', 'busca en la web', 'busca online',
        'investiga sobre', 'investiga en internet', 'googleame', 'googlea',
        'busca informacion sobre', 'busca info sobre', 'busca info de',
        'que dice internet', 'que dice google', 'search',
        'busca en linea', 'averigua sobre', 'averigua en internet'
    ];

    for (const trigger of EXPLICIT_TRIGGERS) {
        if (normalized.includes(trigger)) {
            // Extract query after trigger
            const idx = normalized.indexOf(trigger);
            const queryAfter = message.slice(idx + trigger.length).trim();
            return queryAfter.length > 2 ? queryAfter : message;
        }
    }

    // Implicit triggers — questions about external knowledge
    const IMPLICIT_PATTERNS = [
        /^(?:que|qué) (?:es|son|significa|significa) (.+)/,
        /^(?:como|cómo) (?:funciona|se hace|se usa|puedo) (.+)/,
        /^(?:quien|quién) (?:es|fue|era) (.+)/,
        /^(?:donde|dónde) (?:esta|está|queda) (.+)/,
        /^(?:cuando|cuándo) (?:fue|es|sera|será) (.+)/,
        /^(?:por que|porqué|por qué) (.+)/,
        /^(?:cual|cuál) es (?:el|la|los|las) (.+)/,
        /^(?:dime|explica|explicame) (?:que|qué|sobre|acerca) (.+)/
    ];

    // Only match implicit patterns if it's NOT about candidatic/candidates/platform
    const CANDIDATIC_KEYWORDS = [
        'candidatic', 'candidato', 'candidata', 'candidatos', 'candidatas',
        'brenda', 'whatsapp', 'plataforma', 'modulo', 'bot', 'regla',
        'vacante', 'copiloto', 'dashboard', 'chat web'
    ];

    const isCandidaticQuestion = CANDIDATIC_KEYWORDS.some(kw => normalized.includes(kw));
    if (isCandidaticQuestion) return null;

    for (const pattern of IMPLICIT_PATTERNS) {
        const match = normalized.match(pattern);
        if (match) return match[1] || message;
    }

    return null;
}
