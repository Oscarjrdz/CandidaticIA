/**
 * POST /api/candidato/request-pin
 * Mobile App: genera PIN, lo manda por WhatsApp y devuelve si el candidato existe.
 * Body: { phone: string }  (10 dígitos sin prefijo, o con 52/521)
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

    const { getRedisClient, getCandidateByPhone, updateCandidate } = await import('../utils/storage.js');
    const { sendMessage } = await import('../utils/messenger.js');

    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Servicio no disponible.' });

    // Normalizar teléfono a 10 dígitos para la llave y a formato WApp para el envío
    const digits = String(phone).replace(/\D/g, '');
    const last10 = digits.slice(-10);
    const waPhone = '521' + last10; // formato para gateway (521XXXXXXXXXX)

    // Si el cliente ya generó y mandó el PIN por su cuenta, solo lo guardamos en Redis
    // Si no, lo generamos aquí y lo mandamos por WhatsApp
    const clientPin = req.body.clientPin ? String(req.body.clientPin) : null;
    const pin = clientPin || Math.floor(1000 + Math.random() * 9000).toString();

    // Guardar en Redis con expiración de 10 minutos
    await redis.set(`app_login_pin:${last10}`, pin, 'EX', 600);

    if (!clientPin) {
      // Enviar PIN via template de Meta WhatsApp Business
      const { sendMetaMessage } = await import('../whatsapp/utils.js');
      const msgResult = await sendMetaMessage(waPhone, 'candidatic_pin', 'template', {
        templateName: 'candidatic_pin',
        languageCode: 'es_MX',
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: pin }],
          },
          {
            type: 'button',
            sub_type: 'copy_code',
            index: '0',
            parameters: [{ type: 'coupon_code', coupon_code: pin }],
          },
        ],
      });
      if (!msgResult?.success) {
        console.warn('[request-pin] WhatsApp template send error:', msgResult);
      }
    }

    // Buscar candidato existente
    const candidate = await getCandidateByPhone(last10);

    // Marcar que el candidato existente tiene la app instalada (no bloquea el flujo)
    if (candidate) {
      const now = new Date().toISOString();
      updateCandidate(candidate.id, {
        appRegistered: true,
        appLastSeen: now,
        ...(!candidate.appRegisteredAt && { appRegisteredAt: now }),
      }).catch(() => {});
    }

    const profile = candidate ? {
      nombre: candidate.nombreReal || candidate.nombre || null,
      genero: candidate.genero || null,
      municipio: candidate.municipio || null,
      categoria: candidate.categoria || null,
      escolaridad: candidate.escolaridad || null,
      nacimiento: candidate.fechaNacimiento || null,
      edad: candidate.edad || null,
    } : null;

    return res.status(200).json({
      success: true,
      isNew: !candidate,
      origen: candidate ? (candidate.origen || 'whatsapp') : 'app',
      profile,
    });

  } catch (error) {
    console.error('[request-pin] Error:', error);
    return res.status(500).json({ error: 'Error interno al generar PIN.' });
  }
}
