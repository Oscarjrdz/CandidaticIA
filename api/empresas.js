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
            return res.status(200).json({ success: true, data: await getEmpresas() });
        }

        if (req.method === 'POST') {
            const { nombre, logo, telefono } = req.body;
            if (!nombre || !telefono) return res.status(400).json({ error: 'nombre y telefono son requeridos' });
            const empresa = {
                id: randomUUID(),
                nombre,
                logo: logo || '',
                telefono: String(telefono).replace(/\D/g, ''),
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
            return res.status(200).json({ success: true, data: list[idx] });
        }

        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'Falta id' });
            const list = await getEmpresas();
            await saveEmpresas(list.filter(e => e.id !== id));
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Método no permitido' });
    } catch (err) {
        console.error('[empresas] Error:', err);
        return res.status(500).json({ error: 'Error interno' });
    }
}
