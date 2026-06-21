/**
 * POST /api/recruiter/request-pin
 * Genera PIN, lo manda por WhatsApp (Meta) y lo guarda en Redis.
 * Body: { phone: string }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Falta el número de teléfono.' });

    const { getRedisClient } = await import('../utils/storage.js');
    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Servicio no disponible.' });

    const digits = String(phone).replace(/\D/g, '');
    const last10 = digits.slice(-10);
    const waPhone = '521' + last10;

    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    await redis.set(`app_login_pin:${last10}`, pin, 'EX', 600);

    const { sendMetaMessage } = await import('../whatsapp/utils.js');
    const msgResult = await sendMetaMessage(waPhone, 'candidatic_pin', 'template', {
      templateName: 'candidatic_pin',
      languageCode: 'es_MX',
      components: [
        { type: 'body', parameters: [{ type: 'text', text: String(pin) }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(pin) }] },
      ],
    });

    if (!msgResult?.success) {
      console.error('[recruiter/request-pin] Meta error:', JSON.stringify(msgResult));
    } else {
      console.log('[recruiter/request-pin] PIN enviado OK:', msgResult?.messageId);
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('[recruiter/request-pin] Error:', error);
    return res.status(500).json({ error: 'Error interno al generar PIN.' });
  }
}
