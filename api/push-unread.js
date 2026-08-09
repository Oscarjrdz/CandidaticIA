/**
 * GET  /api/push-unread?phone=&type=   — contador de notificaciones no leídas
 * POST /api/push-unread  { phone, type } — marca como leídas (resetea a 0)
 * Usado por la burbuja/badge dentro de las apps de candidato y reclutador.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { getRedisClient } = await import('./utils/storage.js');
    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Storage no disponible' });

    const KEY = 'candidatic_push_tokens';

    if (req.method === 'GET') {
      const { phone, type } = req.query;
      if (!phone || !type) return res.status(400).json({ error: 'Faltan phone, type' });
      const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);

      const raw = await redis.get(KEY);
      const tokens = raw ? JSON.parse(raw) : [];
      const entry = tokens.find(t => t.phone === cleanPhone && t.type === type);
      return res.status(200).json({ success: true, unreadCount: entry?.unreadCount || 0 });
    }

    if (req.method === 'POST') {
      const { phone, type } = req.body;
      if (!phone || !type) return res.status(400).json({ error: 'Faltan phone, type' });
      const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);

      const raw = await redis.get(KEY);
      const tokens = raw ? JSON.parse(raw) : [];
      const idx = tokens.findIndex(t => t.phone === cleanPhone && t.type === type);
      if (idx >= 0 && tokens[idx].unreadCount) {
        tokens[idx].unreadCount = 0;
        await redis.set(KEY, JSON.stringify(tokens));
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error('[push-unread]', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
