import { getRedisClient } from './utils/storage.js';

const REDIS_KEY = 'automation_rules';

// Default automation rules (seed data)
const DEFAULT_RULES = [
    {
        id: 'auto_nombre',
        prompt: 'Captura el nombre real y apellidos del candidato.',
        pattern: 'tu nombre es\\s*[:]?\\s*([^.!?\\n]+)',
        field: 'nombreReal',
        fieldLabel: 'Nombre Real',
        description: 'Extrae el nombre completo del candidato',
        enabled: true,
        createdAt: new Date().toISOString()
    },
    {
        id: 'auto_fecha',
        prompt: 'Extrae la fecha de nacimiento en formato DD/MM/YYYY.',
        pattern: '(?:tu|la) fecha de nacimiento es\\s*[:]?\\s*([^.!?\\n]+)',
        field: 'fechaNacimiento',
        fieldLabel: 'Fecha Nacimiento',
        description: 'Extrae la fecha de nacimiento',
        enabled: true,
        createdAt: new Date().toISOString()
    },
    {
        id: 'auto_municipio',
        prompt: 'Identifica el municipio o ciudad donde vive el candidato.',
        pattern: '(?:vives?|resides?)\\s+en\\s*[:]?\\s*([^.!?\\n]+)',
        field: 'municipio',
        fieldLabel: 'Municipio',
        description: 'Extrae la ciudad/municipio de residencia',
        enabled: true,
        createdAt: new Date().toISOString()
    },
    {
        id: 'auto_categoria',
        prompt: 'Identifica el puesto o categoría de empleo que busca.',
        pattern: 'buscando\\s+empleo\\s+de\\s*[:]?\\s*([^.!?\\n]+)',
        field: 'categoria',
        fieldLabel: 'Categoría',
        description: 'Extrae el área de interés laboral',
        enabled: true,
        createdAt: new Date().toISOString()
    },
    {
        id: 'auto_empleo',
        prompt: 'Determina si el candidato tiene empleo actualmente (Responde Sí/No).',
        pattern: 'entonces\\s+(No|Sí)\\s+Tienes\\s+empleo',
        field: 'tieneEmpleo',
        fieldLabel: 'Tiene empleo',
        description: 'Determina estatus laboral actual',
        enabled: true,
        createdAt: new Date().toISOString()
    }
];

/**
 * Get all automation rules from Redis
 */
async function getAutomationRules() {
    try {
        const redis = getRedisClient();
        const rulesJson = await redis.get(REDIS_KEY);

        if (rulesJson) {
            return JSON.parse(rulesJson);
        }

        // Initialize with defaults if empty
        await redis.set(REDIS_KEY, JSON.stringify(DEFAULT_RULES));
        return DEFAULT_RULES;
    } catch (error) {
        console.error('Error getting automation rules:', error);
        return DEFAULT_RULES; // Fallback
    }
}

/**
 * Save automation rules to Redis
 */
async function saveAutomationRules(rules) {
    try {
        const redis = getRedisClient();
        await redis.set(REDIS_KEY, JSON.stringify(rules));
        return true;
    } catch (error) {
        console.error('Error saving automation rules:', error);
        return false;
    }
}

/**
 * Validate regex pattern
 */
function validatePattern(pattern) {
    try {
        new RegExp(pattern);
        return { valid: true };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

/**
 * API Handler
 */
export default async function handler(req, res) {
    const { method } = req;
    const { id } = req.query;

    try {
        // GET - Retrieve all rules
        if (method === 'GET') {
            const rules = await getAutomationRules();
            return res.status(200).json({ success: true, rules });
        }

        // POST - Create new rule
        if (method === 'POST') {
            const { prompt, pattern, field, fieldLabel, description } = req.body;

            if (!field || (!pattern && !prompt)) {
                return res.status(400).json({
                    success: false,
                    error: 'Field and either Pattern or Prompt are required'
                });
            }

            // Validate regex only if provided
            if (pattern) {
                const validation = validatePattern(pattern);
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid regex pattern: ${validation.error}`
                    });
                }
            }

            const rules = await getAutomationRules();

            const newRule = {
                id: `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                prompt: prompt || '',
                pattern: pattern || '',
                field,
                fieldLabel: fieldLabel || field,
                description: description || '',
                enabled: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            rules.push(newRule);
            await saveAutomationRules(rules);

            return res.status(201).json({ success: true, rule: newRule });
        }

        // PUT - Update existing rule
        if (method === 'PUT') {
            if (!id) {
                return res.status(400).json({ success: false, error: 'Rule ID required' });
            }

            const { prompt, pattern, field, fieldLabel, description, enabled } = req.body;

            // Validate regex if pattern is being updated
            if (pattern) {
                const validation = validatePattern(pattern);
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid regex pattern: ${validation.error}`
                    });
                }
            }

            const rules = await getAutomationRules();
            const ruleIndex = rules.findIndex(r => r.id === id);

            if (ruleIndex === -1) {
                return res.status(404).json({ success: false, error: 'Rule not found' });
            }

            // Update rule
            rules[ruleIndex] = {
                ...rules[ruleIndex],
                ...(prompt !== undefined && { prompt }),
                ...(pattern !== undefined && { pattern }),
                ...(field && { field }),
                ...(fieldLabel && { fieldLabel }),
                ...(description !== undefined && { description }),
                ...(enabled !== undefined && { enabled }),
                updatedAt: new Date().toISOString()
            };

            await saveAutomationRules(rules);

            return res.status(200).json({ success: true, rule: rules[ruleIndex] });
        }

        // DELETE - Remove rule
        if (method === 'DELETE') {
            if (!id) {
                return res.status(400).json({ success: false, error: 'Rule ID required' });
            }

            const rules = await getAutomationRules();
            const filteredRules = rules.filter(r => r.id !== id);

            if (filteredRules.length === rules.length) {
                return res.status(404).json({ success: false, error: 'Rule not found' });
            }

            await saveAutomationRules(filteredRules);

            return res.status(200).json({ success: true, message: 'Rule deleted' });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });

    } catch (error) {
        console.error('Automations API error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
