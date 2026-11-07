/**
 * Vacancies API - Manage job vacancies
 * GET /api/vacancies - List all vacancies
 * POST /api/vacancies - Create a new vacancy
 * PUT /api/vacancies - Update a vacancy
 * DELETE /api/vacancies - Delete a vacancy
 */

import { randomUUID } from 'crypto';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // DYNAMIC IMPORT: Load storage safely
        const { getRedisClient, validateAdminSession } = await import('./utils/storage.js');
        const redis = getRedisClient();

        // Sin cliente Redis (modo memoria / config faltante): en GET devolvemos lista
        // vacía para no romper el frontend; cualquier mutación responde 503.
        if (!redis) {
            console.warn('⚠️ Vacancies API: Redis client is null (Memory Mode?).');
            if (req.method === 'GET') {
                return res.status(200).json({ success: true, data: [] });
            }
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'Storage service not available (Redis missing)'
            });
        }

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

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
            const body = req.body;
            const { name, company, category, description, messageDescription } = body;

            if (!name || !company || !category) {
                return res.status(400).json({ error: 'Missing required fields (name, company, category)' });
            }

            const newVacancy = {
                id: randomUUID(),
                name,
                company,
                category,
                description: description || '',
                messageDescription: messageDescription || '',
                createdAt: new Date().toISOString(),
                active: true
            };

            const data = await redis.get(KEY);
            const vacancies = data ? JSON.parse(data) : [];

            vacancies.unshift(newVacancy);

            await redis.set(KEY, JSON.stringify(vacancies));


            return res.status(201).json({
                success: true,
                data: newVacancy
            });
        }

        // PUT - Update vacancy
        if (req.method === 'PUT') {
            const body = req.body;

            // Acción: Reordenar
            if (body.action === 'reorder') {
                const { orderedIds } = body;
                if (!Array.isArray(orderedIds)) {
                    return res.status(400).json({ error: 'orderedIds debe ser un arreglo' });
                }

                const data = await redis.get(KEY);
                let vacancies = data ? JSON.parse(data) : [];

                // Re-armamos el arreglo basándonos en el orden de los IDs recibidos
                const reordered = [];
                const remaining = [...vacancies];

                orderedIds.forEach(id => {
                    const idx = remaining.findIndex(v => v.id === id);
                    if (idx !== -1) {
                        reordered.push(remaining[idx]);
                        remaining.splice(idx, 1);
                    }
                });

                // Añadimos al final cualquier vacante que no haya venido en la lista (por seguridad)
                const finalVacancies = [...reordered, ...remaining];

                await redis.set(KEY, JSON.stringify(finalVacancies));
                return res.status(200).json({ success: true, data: finalVacancies });
            }

            // Acción Normal: Actualizar datos
            const { id, ...updates } = body;

            if (!id) return res.status(400).json({ error: 'Missing id' });

            const data = await redis.get(KEY);
            let vacancies = data ? JSON.parse(data) : [];

            const index = vacancies.findIndex(v => v.id === id);
            if (index === -1) return res.status(404).json({ error: 'Vacancy not found' });

            vacancies[index] = { ...vacancies[index], ...updates };

            await redis.set(KEY, JSON.stringify(vacancies));

            return res.status(200).json({ success: true, data: vacancies[index] });
        }

        // DELETE - Remove vacancy
        if (req.method === 'DELETE') {
            const { id } = req.query;

            if (!id) return res.status(400).json({ error: 'Missing id query parameter' });

            const data = await redis.get(KEY);
            let vacancies = data ? JSON.parse(data) : [];

            const newVacancies = vacancies.filter(v => v.id !== id);

            await redis.set(KEY, JSON.stringify(newVacancies));

            return res.status(200).json({ success: true });
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

