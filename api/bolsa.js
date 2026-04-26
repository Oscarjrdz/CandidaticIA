/**
 * Bolsa de Empleo API - Manage public jobs for the candidate mobile app
 * GET    /api/bolsa              - List all jobs (add ?public=true for active only)
 * POST   /api/bolsa              - Create a new job
 * PUT    /api/bolsa              - Update a job (any field)
 * DELETE /api/bolsa              - Delete a job
 *
 * Sub-actions via POST with ?action= query param:
 *   ?action=comment   - Add a comment      { jobId, user, text }
 *   ?action=like      - Toggle like        { jobId, userId }
 *   ?action=apply     - Apply to job       { jobId, candidateName, candidatePhone, message? }
 *   ?action=request   - Me llamen/escriban { jobId, candidateName, candidatePhone, requestType, timePreference }
 *   ?action=deleteComment - Delete comment  { jobId, commentId }
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

        /* ──────────── Helpers ──────────── */
        const getJobs = async () => {
            const data = await redis.get(KEY);
            return data ? JSON.parse(data) : [];
        };
        const saveJobs = async (jobs) => {
            await redis.set(KEY, JSON.stringify(jobs));
        };

        /* ──────────── GET ──────────── */
        if (req.method === 'GET') {
            let jobs = await getJobs();

            if (req.query.public === 'true') {
                jobs = jobs.filter(j => j.active !== false);
            }

            return res.status(200).json({ success: true, data: jobs });
        }

        /* ──────────── POST ──────────── */
        if (req.method === 'POST') {
            const action = req.query.action;

            // ─── Sub-action: Add Comment ───
            if (action === 'comment') {
                const { jobId, user, text } = req.body;
                if (!jobId || !text) return res.status(400).json({ error: 'Missing jobId or text' });

                const jobs = await getJobs();
                const job = jobs.find(j => j.id === jobId);
                if (!job) return res.status(404).json({ error: 'Job not found' });

                if (!job.comments) job.comments = [];
                const comment = {
                    id: randomUUID(),
                    user: user || 'Anónimo',
                    text,
                    likes: 0,
                    createdAt: new Date().toISOString()
                };
                job.comments.push(comment);
                await saveJobs(jobs);
                return res.status(201).json({ success: true, data: comment });
            }

            // ─── Sub-action: Toggle Like ───
            if (action === 'like') {
                const { jobId, userId } = req.body;
                if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

                const jobs = await getJobs();
                const job = jobs.find(j => j.id === jobId);
                if (!job) return res.status(404).json({ error: 'Job not found' });

                if (!job.likedBy) job.likedBy = [];
                if (!job.likes) job.likes = 0;

                const uid = userId || 'anonymous';
                if (job.likedBy.includes(uid)) {
                    job.likedBy = job.likedBy.filter(u => u !== uid);
                    job.likes = Math.max(0, job.likes - 1);
                } else {
                    job.likedBy.push(uid);
                    job.likes += 1;
                }
                await saveJobs(jobs);
                return res.status(200).json({ success: true, data: { likes: job.likes, liked: job.likedBy.includes(uid) } });
            }

            // ─── Sub-action: Apply ───
            if (action === 'apply') {
                const { jobId, candidateName, candidatePhone, message } = req.body;
                if (!jobId || !candidatePhone) return res.status(400).json({ error: 'Missing jobId or candidatePhone' });

                const jobs = await getJobs();
                const job = jobs.find(j => j.id === jobId);
                if (!job) return res.status(404).json({ error: 'Job not found' });

                if (!job.applications) job.applications = [];

                // Check if already applied
                const already = job.applications.find(a => a.candidatePhone === String(candidatePhone).replace(/\D/g, ''));
                if (already) {
                    return res.status(200).json({ success: true, alreadyApplied: true, data: already });
                }

                const application = {
                    id: randomUUID(),
                    candidateName: candidateName || 'Candidato',
                    candidatePhone: String(candidatePhone).replace(/\D/g, ''),
                    message: message || '',
                    createdAt: new Date().toISOString()
                };
                job.applications.push(application);
                await saveJobs(jobs);
                return res.status(201).json({ success: true, data: application });
            }

            // ─── Sub-action: Request (me llamen / me escriban) ───
            if (action === 'request') {
                const { jobId, candidateName, candidatePhone, requestType, timePreference } = req.body;
                if (!jobId || !candidatePhone) return res.status(400).json({ error: 'Missing jobId or candidatePhone' });

                const jobs = await getJobs();
                const job = jobs.find(j => j.id === jobId);
                if (!job) return res.status(404).json({ error: 'Job not found' });

                if (!job.requests) job.requests = [];
                const request = {
                    id: randomUUID(),
                    candidateName: candidateName || 'Candidato',
                    candidatePhone: String(candidatePhone).replace(/\D/g, ''),
                    requestType: requestType || 'call', // 'call' | 'whatsapp'
                    timePreference: timePreference || 'Lo antes posible',
                    createdAt: new Date().toISOString()
                };
                job.requests.push(request);
                await saveJobs(jobs);
                return res.status(201).json({ success: true, data: request });
            }

            // ─── Sub-action: Delete Comment ───
            if (action === 'deleteComment') {
                const { jobId, commentId } = req.body;
                if (!jobId || !commentId) return res.status(400).json({ error: 'Missing jobId or commentId' });

                const jobs = await getJobs();
                const job = jobs.find(j => j.id === jobId);
                if (!job) return res.status(404).json({ error: 'Job not found' });

                job.comments = (job.comments || []).filter(c => c.id !== commentId);
                await saveJobs(jobs);
                return res.status(200).json({ success: true });
            }

            // ─── Default: Create Job ───
            const { title, company, location, salary, type, recruiterPhone, description, mediaUrl, companyLogo } = req.body;

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
                mediaUrl: mediaUrl || '',
                companyLogo: companyLogo || '',
                likes: 0,
                likedBy: [],
                comments: [],
                applications: [],
                requests: [],
                createdAt: new Date().toISOString(),
                active: true
            };

            const jobs = await getJobs();
            jobs.unshift(newJob);
            await saveJobs(jobs);

            return res.status(201).json({ success: true, data: newJob });
        }

        /* ──────────── PUT - Update Job ──────────── */
        if (req.method === 'PUT') {
            const { id, ...updates } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing id' });

            const jobs = await getJobs();
            const index = jobs.findIndex(v => v.id === id);
            if (index === -1) return res.status(404).json({ error: 'Job not found' });

            jobs[index] = { ...jobs[index], ...updates };
            await saveJobs(jobs);

            return res.status(200).json({ success: true, data: jobs[index] });
        }

        /* ──────────── DELETE ──────────── */
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'Missing id query parameter' });

            const jobs = await getJobs();
            const newJobs = jobs.filter(v => v.id !== id);
            await saveJobs(newJobs);

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Bolsa API Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
