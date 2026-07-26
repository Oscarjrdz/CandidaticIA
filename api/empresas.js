/**
 * Empresas API — CRUD para el módulo de empresas de la Bolsa de Empleo
 * GET    /api/empresas  - Listar empresas
 * POST   /api/empresas  - Crear empresa  { nombre, logo, telefono }
 * PUT    /api/empresas  - Editar empresa { id, nombre?, logo?, telefono? }
 * DELETE /api/empresas  - Eliminar       ?id=xxx
 */

import { randomUUID } from 'crypto';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();
        if (!redis) return res.status(503).json({ error: 'Storage no disponible' });

        const KEY = 'candidatic_empresas';

        const getEmpresas = async () => {
            const data = await redis.get(KEY);
            return data ? JSON.parse(data) : [];
        };
        const saveEmpresas = async (list) => redis.set(KEY, JSON.stringify(list));

        if (req.method === 'GET') {
            const empresas = await getEmpresas();
            // Enriquecer cada empresa con lastLogin del registro del reclutador (recruiter:<tel10>)
            const enriched = await Promise.all(empresas.map(async (e) => {
                try {
                    const tel10 = String(e.telefono || '').replace(/\D/g, '').slice(-10);
                    if (!tel10) return e;
                    const rraw = await redis.get(`recruiter:${tel10}`);
                    if (rraw) {
                        const r = JSON.parse(rraw);
                        return { ...e, lastLogin: r.lastLogin || null, createdAt: e.createdAt || r.createdAt || null };
                    }
                } catch { /* si falla, se devuelve la empresa sin enriquecer */ }
                return e;
            }));
            return res.status(200).json({ success: true, data: enriched });
        }

        if (req.method === 'POST') {
            const { nombre, logo, telefono } = req.body;
            if (!nombre || !telefono) return res.status(400).json({ error: 'nombre y telefono son requeridos' });
            const empresa = {
                id: randomUUID(),
                nombre,
                logo: logo || '',
                telefono: String(telefono).replace(/\D/g, ''),
                status: 'activo', // creada por el admin → activa por defecto
                createdAt: new Date().toISOString(),
            };
            const list = await getEmpresas();
            list.unshift(empresa);
            await saveEmpresas(list);
            return res.status(201).json({ success: true, data: empresa });
        }

        if (req.method === 'PUT') {
            const { id, ...updates } = req.body;
            if (!id) return res.status(400).json({ error: 'Falta id' });
            const list = await getEmpresas();
            const idx = list.findIndex(e => e.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Empresa no encontrada' });
            if (updates.telefono) updates.telefono = String(updates.telefono).replace(/\D/g, '');
            list[idx] = { ...list[idx], ...updates };
            await saveEmpresas(list);

            // Cascade: al cambiar el status de la empresa, activar/pausar TODAS sus vacantes.
            // Después el admin puede pausar/activar vacantes individuales cuando quiera.
            if (updates.status === 'activo' || updates.status === 'pausado') {
                const emp = list[idx];
                const phones = [emp.telefono, emp.wapp].filter(Boolean)
                    .map(p => String(p).replace(/\D/g, '').slice(-10));
                const wantActive = updates.status === 'activo';
                const JOBS_KEY = 'candidatic_bolsa_empleo';
                const jobsRaw = await redis.get(JOBS_KEY);
                const jobs = jobsRaw ? JSON.parse(jobsRaw) : [];
                let changed = false;
                jobs.forEach(j => {
                    const jp = String(j.recruiterPhone || '').replace(/\D/g, '').slice(-10);
                    if (phones.includes(jp) && j.active !== wantActive) {
                        j.active = wantActive;
                        changed = true;
                    }
                });
                if (changed) await redis.set(JOBS_KEY, JSON.stringify(jobs));
            }

            return res.status(200).json({ success: true, data: list[idx] });
        }

        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'Falta id' });

            const list = await getEmpresas();
            const emp = list.find(e => e.id === id);

            // 1. Quitar la empresa del catálogo
            await saveEmpresas(list.filter(e => e.id !== id));

            // ── Borrado profundo: registro del reclutador + sus vacantes ──
            if (emp) {
                const phones = [emp.telefono, emp.wapp].filter(Boolean)
                    .map(p => String(p).replace(/\D/g, '').slice(-10));

                // 2. Borrar el/los registro(s) del reclutador (recruiter:<tel10>)
                for (const p of phones) {
                    await redis.del(`recruiter:${p}`);
                }

                // 3. Borrar TODAS las vacantes de esa empresa (match por telefono o wapp)
                if (phones.length) {
                    const JOBS_KEY = 'candidatic_bolsa_empleo';
                    const jobsRaw = await redis.get(JOBS_KEY);
                    const jobs = jobsRaw ? JSON.parse(jobsRaw) : [];
                    const remaining = jobs.filter(j =>
                        !phones.includes(String(j.recruiterPhone || '').replace(/\D/g, '').slice(-10))
                    );
                    if (remaining.length !== jobs.length) {
                        await redis.set(JOBS_KEY, JSON.stringify(remaining));
                    }
                }
            }

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Método no permitido' });
    } catch (err) {
        console.error('[empresas] Error:', err);
        return res.status(500).json({ error: 'Error interno' });
    }
}
