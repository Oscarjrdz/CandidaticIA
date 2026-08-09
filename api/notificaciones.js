/**
 * GET  /api/notificaciones  — estadísticas de tokens activos
 * POST /api/notificaciones  — enviar notificación push
 *   Body: { title, body, target: 'candidates' | 'recruiters' | 'all', data? }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { getRedisClient, validateAdminSession } = await import('./utils/storage.js');
    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Storage no disponible' });

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const KEY = 'candidatic_push_tokens';
    const raw = await redis.get(KEY);
    const allTokens = raw ? JSON.parse(raw) : [];

    const candidates = allTokens.filter(t => t.type === 'candidate');
    const recruiters = allTokens.filter(t => t.type === 'recruiter');

    /* ── GET: estadísticas ── */
    if (req.method === 'GET') {
      return res.status(200).json({
        success: true,
        stats: {
          candidates: candidates.length,
          recruiters: recruiters.length,
          total: allTokens.length,
        },
        tokens: allTokens,
      });
    }

    /* ── POST: enviar notificación ── */
    if (req.method === 'POST') {
      const { title, body, target = 'all', data = {} } = req.body;
      if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'Faltan title y body' });

      let targets = [];
      if (target === 'candidates') targets = candidates;
      else if (target === 'recruiters') targets = recruiters;
      else targets = allTokens;

      const rawTokens = targets.map(t => t.token).filter(t => t?.startsWith('ExponentPushToken['));
      // Dedupe defensivo: si el mismo device quedó guardado dos veces (bug de registro
      // con phone vacío ya corregido en push-token.js, pero puede haber datos viejos),
      // no se le manda la notificación duplicada al mismo token.
      const validTokens = [...new Set(rawTokens)];
      if (validTokens.length === 0) return res.status(200).json({ success: true, sent: 0 });

      // Expo Push API — máx 100 por batch
      const batches = [];
      for (let i = 0; i < validTokens.length; i += 100) {
        batches.push(validTokens.slice(i, i + 100));
      }

      let sent = 0;
      for (const batch of batches) {
        const messages = batch.map(token => ({
          to: token,
          title: title.trim(),
          body: body.trim(),
          data,
          sound: 'default',
          priority: 'high',
        }));

        const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(messages),
        });

        if (pushRes.ok) {
          const result = await pushRes.json();
          const data2 = Array.isArray(result.data) ? result.data : [];
          sent += data2.filter(r => r.status === 'ok').length || batch.length;
        }
      }

      // Guardar historial de notificaciones
      const HIST_KEY = 'candidatic_notif_history';
      const histRaw = await redis.get(HIST_KEY);
      const history = histRaw ? JSON.parse(histRaw) : [];
      history.unshift({
        id: Date.now().toString(),
        title: title.trim(),
        body: body.trim(),
        target,
        sent,
        total: validTokens.length,
        createdAt: new Date().toISOString(),
      });
      await redis.set(HIST_KEY, JSON.stringify(history.slice(0, 50)));

      return res.status(200).json({ success: true, sent, total: validTokens.length });
    }

    /* ── DELETE: quitar un dispositivo registrado (limpieza manual) ── */
    if (req.method === 'DELETE') {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Falta token' });

      const remaining = allTokens.filter(t => t.token !== token);
      await redis.set(KEY, JSON.stringify(remaining));
      return res.status(200).json({ success: true, removed: allTokens.length - remaining.length });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error('[notificaciones]', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
