/**
 * POST /api/recruiter/verify
 * Verifica el PIN del reclutador y devuelve su empresa si ya existe.
 */
import { randomUUID } from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, pin } = req.body;
  if (!phone || !pin) return res.status(400).json({ error: 'Faltan datos' });

  try {
    const { getRedisClient } = await import('../utils/storage.js');
    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Storage no disponible' });

    const cleanPhone = String(phone).replace(/\D/g, '');

    // Master PIN bypass para desarrollo
    if (String(pin) !== '1234') {
      const savedPin = await redis.get(`app_login_pin:${cleanPhone}`);
      if (!savedPin) return res.status(400).json({ error: 'PIN expirado o inexistente.' });
      if (savedPin !== String(pin)) return res.status(401).json({ error: 'PIN incorrecto.' });
      await redis.del(`app_login_pin:${cleanPhone}`);
    }

    const token = Buffer.from(`${cleanPhone}:${Date.now()}`).toString('base64');
    const now = new Date().toISOString();

    // 1. Buscar registro de reclutador directo
    const raw = await redis.get(`recruiter:${cleanPhone}`);
    if (raw) {
      const recruiter = JSON.parse(raw);
      await redis.set(`recruiter:${cleanPhone}`, JSON.stringify({ ...recruiter, lastLogin: now }));
      return res.status(200).json({ success: true, token, recruiter: { phone: cleanPhone, empresa: recruiter.empresa }, isNew: false });
    }

    // 2. Buscar en el catálogo de empresas por teléfono o wapp
    const empRaw = await redis.get('candidatic_empresas');
    if (empRaw) {
      const empresas = JSON.parse(empRaw);
      const match = empresas.find(e => {
        const tel = String(e.telefono || '').replace(/\D/g, '').slice(-10);
        const wap = String(e.wapp || '').replace(/\D/g, '').slice(-10);
        return tel === cleanPhone.slice(-10) || wap === cleanPhone.slice(-10);
      });
      if (match) {
        // Crear registro de reclutador automáticamente y dar bienvenida
        const recruiterData = { phone: cleanPhone, empresa: match, createdAt: now, lastLogin: now };
        await redis.set(`recruiter:${cleanPhone}`, JSON.stringify(recruiterData));
        return res.status(200).json({ success: true, token, recruiter: { phone: cleanPhone, empresa: match }, isNew: false });
      }
    }

    return res.status(200).json({ success: true, token, recruiter: { phone: cleanPhone }, isNew: true });

  } catch (err) {
    console.error('[recruiter/verify]', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
