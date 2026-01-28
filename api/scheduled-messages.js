import { getRedisClient } from './utils/storage.js';

const REDIS_KEY = 'scheduled_message_rules';

/**
 * Get all scheduled message rules
 */
async function getRules() {
    try {
        const redis = getRedisClient();
        const rulesJson = await redis.get(REDIS_KEY);
        return rulesJson ? JSON.parse(rulesJson) : [];
    } catch (error) {
        console.error('Error getting scheduled rules:', error);
        return [];
    }
}

/**
 * Save rules
 */
async function saveRules(rules) {
    try {
        const redis = getRedisClient();
        await redis.set(REDIS_KEY, JSON.stringify(rules));
        return true;
    } catch (error) {
        console.error('Error saving scheduled rules:', error);
        return false;
    }
}

export default async function handler(req, res) {
    const { method } = req;
    const { id } = req.query;

    try {
        // GET - List rules
        if (method === 'GET') {
            const rules = await getRules();
            return res.status(200).json({ success: true, rules });
        }

        // POST - Create rule
        if (method === 'POST') {
            const { name, userInactivityMinutes, botInactivityMinutes, message } = req.body;

            if (!name || !message || userInactivityMinutes === undefined) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }

            const rules = await getRules();

            const newRule = {
                id: `sched_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name,
                userInactivityMinutes: parseInt(userInactivityMinutes),
                botInactivityMinutes: parseInt(botInactivityMinutes || 0),
                message,
                oneTime: req.body.oneTime || false,
                enabled: true,
                sentCount: 0,
                createdAt: new Date().toISOString()
            };

            rules.push(newRule);
            await saveRules(rules);

            return res.status(201).json({ success: true, rule: newRule });
        }

        // PUT - Update rule
        if (method === 'PUT') {
            if (!id) return res.status(400).json({ success: false, error: 'ID required' });

            const rules = await getRules();
            const index = rules.findIndex(r => r.id === id);

            if (index === -1) return res.status(404).json({ success: false, error: 'Rule not found' });

            // Merge updates
            rules[index] = { ...rules[index], ...req.body, updatedAt: new Date().toISOString() };

            // Ensure numbers are numbers
            if (rules[index].userInactivityMinutes) rules[index].userInactivityMinutes = parseInt(rules[index].userInactivityMinutes);
            if (rules[index].botInactivityMinutes) rules[index].botInactivityMinutes = parseInt(rules[index].botInactivityMinutes);

            await saveRules(rules);
            return res.status(200).json({ success: true, rule: rules[index] });
        }

        // DELETE - Remove rule
        if (method === 'DELETE') {
            if (!id) return res.status(400).json({ success: false, error: 'ID required' });

            const rules = await getRules();
            const filtered = rules.filter(r => r.id !== id);

            await saveRules(filtered);
            return res.status(200).json({ success: true, message: 'Deleted' });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Scheduled API Error:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}
