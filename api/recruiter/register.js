/**
 * POST /api/recruiter/register
 * Registra la empresa del reclutador.
 * Headers: Authorization: Bearer <token>
 * Body: { nombre, logo, telefono }
 */
import { randomUUID } from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  let phone;
  try { phone = Buffer.from(token, 'base64').toString().split(':')[0]; } catch { return res.status(401).json({ error: 'Token inválido' }); }
  if (!phone) return res.status(401).json({ error: 'Token inválido' });

  const { nombre, logo, telefono, wapp } = req.body;
  if (!nombre || !telefono) return res.status(400).json({ error: 'nombre y telefono son requeridos' });

  try {
    const { getRedisClient } = await import('../utils/storage.js');
    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Storage no disponible' });

    const empresaId = randomUUID();
    const empresa = {
      id: empresaId,
      nombre,
      logo: logo || '',
      telefono: String(telefono).replace(/\D/g, ''),
      wapp: String(wapp || telefono).replace(/\D/g, ''),
      status: 'pausado', // nace pausada — el admin la activa manualmente desde candidatic.com
    };

    const recruiterData = {
      phone,
      empresa,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    };

    // Guardar reclutador
    await redis.set(`recruiter:${phone}`, JSON.stringify(recruiterData));

    // Agregar empresa al catálogo global de empresas
    const empKey = 'candidatic_empresas';
    const existing = await redis.get(empKey);
    const empresas = existing ? JSON.parse(existing) : [];
    empresas.unshift({ ...empresa, createdAt: new Date().toISOString() });
    await redis.set(empKey, JSON.stringify(empresas));

    return res.status(201).json({ success: true, recruiter: { phone, empresa } });

  } catch (err) {
    console.error('[recruiter/register]', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
