/**
 * Vacancies API - Manage job vacancies
 * GET /api/vacancies - List all vacancies
 * POST /api/vacancies - Create a new vacancy
 */

import { getRedisClient } from './utils/storage.js';
import { randomUUID } from 'crypto';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const redis = getRedisClient();

    if (!redis) {
        return res.status(500).json({
            error: 'Redis not available',
            message: 'REDIS_URL not configured'
        });
    }

    try {
        const KEY = 'candidatic_vacancies';

        // GET - List vacancies
        if (req.method === 'GET') {
            const data = await redis.get(KEY);
            const vacancies = data ? JSON.parse(data) : [];
            return res.status(200).json({
                success: true,
                data: vacancies
            });
        }

        // POST - Create vacancy
        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const { name, company, category, description } = body;

            if (!name || !company || !category) {
                return res.status(400).json({ error: 'Missing required fields (name, company, category)' });
            }

            const newVacancy = {
                id: randomUUID(),
                name,
                company,
                category,
                description: description || '',
                createdAt: new Date().toISOString(),
                active: true
            };

            // Get existing
            const data = await redis.get(KEY);
            const vacancies = data ? JSON.parse(data) : [];

            // Add new (prepend to list)
            vacancies.unshift(newVacancy);

            // Save
            await redis.set(KEY, JSON.stringify(vacancies));

            return res.status(201).json({
                success: true,
                data: newVacancy
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Vacancies API Error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}

/**
 * Parse JSON body from request
 */
async function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}
