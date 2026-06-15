/**
 * GET /api/candidato/test-pin?phone=XXXXXXXXXX
 * Debug endpoint — prueba el envío del template candidatic_pin y devuelve el error completo.
 * BORRAR después de resolver el problema.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const phone = req.query.phone || '5218112345678';
  const pin = '1234';

  const { sendMetaMessage } = await import('../whatsapp/utils.js');

  const result = await sendMetaMessage(phone, 'candidatic_pin', 'template', {
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

  return res.status(200).json({ result });
}
