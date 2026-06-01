/**
 * GET  /api/recruiter/profile  — obtiene perfil del reclutador
 * PUT  /api/recruiter/profile  — actualiza empresa del reclutador
 * Headers: Authorization: Bearer <token>
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  let phone;
  try { phone = Buffer.from(token, 'base64').toString().split(':')[0]; } catch { return res.status(401).json({ error: 'Token inválido' }); }

  try {
    const { getRedisClient } = await import('../utils/storage.js');
    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Storage no disponible' });

    if (req.method === 'GET') {
      const raw = await redis.get(`recruiter:${phone}`);
      if (!raw) return res.status(404).json({ error: 'Reclutador no encontrado' });
      return res.status(200).json({ success: true, recruiter: JSON.parse(raw) });
    }

    if (req.method === 'PUT') {
      const { nombre, logo, telefono, wapp } = req.body;
      const raw = await redis.get(`recruiter:${phone}`);
      if (!raw) return res.status(404).json({ error: 'Reclutador no encontrado' });

      const current = JSON.parse(raw);
      const updatedEmpresa = {
        ...current.empresa,
        ...(nombre    && { nombre }),
        ...(logo      && { logo }),
        ...(telefono  && { telefono: String(telefono).replace(/\D/g, '') }),
        ...(wapp      && { wapp: String(wapp).replace(/\D/g, '') }),
      };

      const updated = { ...current, empresa: updatedEmpresa, updatedAt: new Date().toISOString() };
      await redis.set(`recruiter:${phone}`, JSON.stringify(updated));

      // Sincronizar en catálogo global de empresas
      const empKey = 'candidatic_empresas';
      const empRaw = await redis.get(empKey);
      if (empRaw) {
        const empresas = JSON.parse(empRaw);
        const idx = empresas.findIndex(e => e.id === updatedEmpresa.id);
        if (idx >= 0) { empresas[idx] = { ...empresas[idx], ...updatedEmpresa }; await redis.set(empKey, JSON.stringify(empresas)); }
      }

      return res.status(200).json({ success: true, recruiter: { phone, empresa: updatedEmpresa } });
    }

    if (req.method === 'DELETE') {
      const raw = await redis.get(`recruiter:${phone}`);
      const empresaId = raw ? JSON.parse(raw).empresa?.id : null;
      await redis.del(`recruiter:${phone}`);
      if (empresaId) {
        const empRaw = await redis.get('candidatic_empresas');
        if (empRaw) {
          const empresas = JSON.parse(empRaw);
          await redis.set('candidatic_empresas', JSON.stringify(empresas.filter(e => e.id !== empresaId)));
        }
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error('[recruiter/profile]', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
