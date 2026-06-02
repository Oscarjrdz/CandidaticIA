/**
 * POST /api/push-token
 * Registra o actualiza el push token de un usuario (candidato o reclutador).
 * Body: { phone, token, type: 'candidate' | 'recruiter' }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, token, type } = req.body;
  if (!phone || !token || !type) return res.status(400).json({ error: 'Faltan campos: phone, token, type' });
  if (!token.startsWith('ExponentPushToken[')) return res.status(400).json({ error: 'Token inválido' });

  try {
    const { getRedisClient } = await import('./utils/storage.js');
    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Storage no disponible' });

    const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
    const KEY = 'candidatic_push_tokens';

    const raw = await redis.get(KEY);
    const tokens = raw ? JSON.parse(raw) : [];

    const existing = tokens.findIndex(t => t.phone === cleanPhone);
    const entry = { phone: cleanPhone, token, type, updatedAt: new Date().toISOString() };

    if (existing >= 0) tokens[existing] = entry;
    else tokens.push(entry);

    await redis.set(KEY, JSON.stringify(tokens));
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[push-token]', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
