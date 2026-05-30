/**
 * POST /api/candidato/profile
 * Mobile App: crea o actualiza el perfil del candidato.
 * Headers: Authorization: Bearer <token>  (token = base64 de "phone:timestamp")
 * Body: { nombre, genero, municipio, categoria, escolaridad, nacimiento, edad, foto, cvNombre, experiencia }
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Extraer teléfono del Bearer token
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) return res.status(401).json({ error: 'Token requerido.' });

    let phone;
    try {
      const decoded = Buffer.from(token, 'base64').toString();
      phone = decoded.split(':')[0];
    } catch {
      return res.status(401).json({ error: 'Token inválido.' });
    }

    if (!phone) return res.status(401).json({ error: 'Token inválido (sin teléfono).' });

    const { getCandidateByPhone, saveCandidate, updateCandidate } = await import('../utils/storage.js');

    const digits = String(phone).replace(/\D/g, '');
    const last10 = digits.slice(-10);

    const {
      nombre, genero, municipio, categoria, escolaridad,
      nacimiento, edad, foto, cvNombre, experiencia,
    } = req.body;

    const existing = await getCandidateByPhone(last10);

    const now = new Date().toISOString();

    if (existing) {
      // Candidato existente (vino de WhatsApp o ya estaba en el sistema)
      const updated = await updateCandidate(existing.id, {
        ...(nombre      && { nombreReal: nombre }),
        ...(genero      && { genero }),
        ...(municipio   && { municipio }),
        ...(categoria   && { categoria }),
        ...(escolaridad && { escolaridad }),
        ...(nacimiento  && { fechaNacimiento: nacimiento }),
        ...(edad        && { edad }),
        ...(foto        && { foto }),
        ...(cvNombre    && { cvNombre }),
        ...(experiencia && { experiencia }),
        // Trazabilidad: confirmar que tiene la app y cuándo actualizó por última vez
        appRegistered: true,
        appLastProfileUpdate: now,
        ...(!existing.appRegisteredAt && { appRegisteredAt: now }),
      });

      return res.status(200).json({ success: true, profile: updated });
    } else {
      // Candidato nuevo — llegó por la app, no por WhatsApp
      const newCandidate = {
        whatsapp: '521' + last10,
        nombreReal: nombre || null,
        genero: genero || null,
        municipio: municipio || null,
        categoria: categoria || null,
        escolaridad: escolaridad || null,
        fechaNacimiento: nacimiento || null,
        edad: edad || null,
        foto: foto || null,
        cvNombre: cvNombre || null,
        experiencia: experiencia || [],
        primerContacto: now,
        origen: 'app',
        appRegistered: true,
        appRegisteredAt: now,
        appLastProfileUpdate: now,
      };

      const saved = await saveCandidate(newCandidate);
      return res.status(201).json({ success: true, profile: saved });
    }

  } catch (error) {
    console.error('[candidato/profile] Error:', error);
    return res.status(500).json({ error: 'Error interno al guardar perfil.' });
  }
}
