/**
 * DELETE /api/candidato/profile
 * Elimina la cuenta del candidato autenticado.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    let phone;
    try {
      phone = Buffer.from(token, 'base64').toString().split(':')[0];
    } catch {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const { getCandidateByPhone, deleteCandidate } = await import('../utils/storage.js');
    const digits = String(phone).replace(/\D/g, '').slice(-10);
    const candidate = await getCandidateByPhone(digits);

    if (candidate) await deleteCandidate(candidate.id);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[candidato/delete]', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
