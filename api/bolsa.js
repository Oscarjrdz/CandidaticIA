/**
 * Bolsa de Empleo API - Manage public jobs for the candidate mobile app
 * GET /api/bolsa - List all active jobs
 * POST /api/bolsa - Create a new job
 * PUT /api/bolsa - Update a job
 * DELETE /api/bolsa - Delete a job
 */

import { randomUUID } from 'crypto';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();

        if (!redis) {
            if (req.method === 'GET') {
                return res.status(200).json({ success: true, data: [] });
            }
            return res.status(503).json({ error: 'Storage service not available' });
        }

        const KEY = 'candidatic_bolsa_empleo';

        // GET - List Jobs (Used by Mobile App & Web Dashboard)
        if (req.method === 'GET') {
            const data = await redis.get(KEY);
            let jobs = data ? JSON.parse(data) : [];
            
            // Si viene un parámetro public=true, podríamos filtrar solo las activas
            if (req.query.public === 'true') {
                jobs = jobs.filter(j => j.active !== false);
            }

            return res.status(200).json({
                success: true,
                data: jobs
            });
        }

        // POST - Create Job
        if (req.method === 'POST') {
            const { title, company, location, salary, type, recruiterPhone, description } = req.body;

            if (!title || !company || !recruiterPhone) {
                return res.status(400).json({ error: 'Missing required fields (title, company, recruiterPhone)' });
            }

            const newJob = {
                id: randomUUID(),
                title,
                company,
                location: location || '',
                salary: salary || '',
                type: type || 'Tiempo Completo',
                recruiterPhone: String(recruiterPhone).replace(/\D/g, ''),
                description: description || '',
                createdAt: new Date().toISOString(),
                active: true
            };

            const data = await redis.get(KEY);
            const jobs = data ? JSON.parse(data) : [];

            jobs.unshift(newJob);

            await redis.set(KEY, JSON.stringify(jobs));

            return res.status(201).json({
                success: true,
                data: newJob
            });
        }

        // PUT - Update Job
        if (req.method === 'PUT') {
            const { id, ...updates } = req.body;

            if (!id) return res.status(400).json({ error: 'Missing id' });

            const data = await redis.get(KEY);
            let jobs = data ? JSON.parse(data) : [];

            const index = jobs.findIndex(v => v.id === id);
            if (index === -1) return res.status(404).json({ error: 'Job not found' });

            jobs[index] = { ...jobs[index], ...updates };

            await redis.set(KEY, JSON.stringify(jobs));

            return res.status(200).json({ success: true, data: jobs[index] });
        }

        // DELETE - Remove Job
        if (req.method === 'DELETE') {
            const { id } = req.query;

            if (!id) return res.status(400).json({ error: 'Missing id query parameter' });

            const data = await redis.get(KEY);
            let jobs = data ? JSON.parse(data) : [];

            const newJobs = jobs.filter(v => v.id !== id);

            await redis.set(KEY, JSON.stringify(newJobs));

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Bolsa API Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
