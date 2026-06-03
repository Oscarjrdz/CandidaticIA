/**
 * GET  /api/support  — página de soporte para candidatos
 * POST /api/support  — recibe mensaje de soporte y lo guarda en Redis
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  /* ── POST: guardar mensaje ── */
  if (req.method === 'POST') {
    try {
      const { name, email, subject, message } = req.body;
      if (!name || !email || !message) return res.status(400).json({ error: 'Faltan campos' });

      const { getRedisClient } = await import('./utils/storage.js');
      const redis = getRedisClient();
      if (redis) {
        const ticket = {
          id: Date.now().toString(),
          name, email, subject: subject || 'Sin asunto', message,
          createdAt: new Date().toISOString(),
          status: 'open',
        };
        const raw = await redis.get('candidatic_support_tickets');
        const tickets = raw ? JSON.parse(raw) : [];
        tickets.unshift(ticket);
        await redis.set('candidatic_support_tickets', JSON.stringify(tickets.slice(0, 200)));
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[support]', err);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  /* ── GET: página HTML ── */
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Soporte — Candidatic</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#f7f7f7;padding-bottom:40px}
    .header{background:#ea580c;padding:48px 24px 32px;text-align:center}
    .icon{width:56px;height:56px;border-radius:16px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;line-height:56px}
    .header h1{color:#fff;font-size:22px;font-weight:900;margin-bottom:8px}
    .header p{color:rgba(255,255,255,0.8);font-size:14px;line-height:1.5}
    .wrap{max-width:480px;margin:0 auto;padding:24px 16px}
    .card{background:#fff;border-radius:22px;padding:20px 16px;border:2px solid #e5e7eb;border-bottom:5px solid #d5d5d5;display:flex;flex-direction:column;gap:14px}
    label{display:block;font-size:12px;font-weight:700;color:#64748b;margin-bottom:6px}
    input,textarea{width:100%;padding:12px 14px;border:2px solid #e5e7eb;border-radius:14px;font-size:15px;color:#0f172a;background:#f7f7f7;outline:none}
    textarea{resize:vertical}
    button{background:#ea580c;color:#fff;border:none;border-radius:16px;padding:16px;font-size:15px;font-weight:900;cursor:pointer;border-bottom:4px solid #c2410c;width:100%}
    button:disabled{opacity:.7;cursor:not-allowed}
    .error{color:#dc2626;font-size:13px;background:#fef2f2;padding:10px 14px;border-radius:10px}
    .success{text-align:center;padding:40px 24px}
    .success .emoji{font-size:52px;margin-bottom:16px}
    .success h2{font-size:20px;font-weight:900;color:#0f172a;margin-bottom:8px}
    .success p{color:#64748b;font-size:14px;line-height:1.6}
    .contact-card{background:#fff;border-radius:18px;padding:16px;border:2px solid #e5e7eb;border-bottom:4px solid #d5d5d5;margin-top:16px;display:flex;align-items:center;gap:12px}
    .contact-icon{width:40px;height:40px;border-radius:12px;background:rgba(234,88,12,0.1);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
    .contact-label{font-size:12px;font-weight:700;color:#64748b;margin-bottom:2px}
    .contact-email{font-size:14px;font-weight:700;color:#ea580c}
    footer{text-align:center;font-size:12px;color:#94a3b8;margin-top:24px}
  </style>
</head>
<body>
  <div class="header">
    <div class="icon">🎧</div>
    <h1>Soporte Candidatic</h1>
    <p>Estamos aquí para ayudarte. Escríbenos y te respondemos en menos de 24 horas.</p>
  </div>

  <div class="wrap">
    <div id="form-wrap">
      <form id="support-form" class="card">
        <div>
          <label>Nombre completo</label>
          <input type="text" name="name" placeholder="Ej. Juan Pérez" required/>
        </div>
        <div>
          <label>Correo electrónico</label>
          <input type="email" name="email" placeholder="tu@correo.com" required/>
        </div>
        <div>
          <label>Asunto</label>
          <input type="text" name="subject" placeholder="Ej. No puedo iniciar sesión"/>
        </div>
        <div>
          <label>Mensaje</label>
          <textarea name="message" rows="4" placeholder="Descríbenos tu problema con detalle..." required></textarea>
        </div>
        <div id="error-msg" class="error" style="display:none"></div>
        <button type="submit" id="submit-btn">Enviar mensaje</button>
      </form>
    </div>

    <div id="success-wrap" style="display:none" class="card success">
      <div class="emoji">✅</div>
      <h2>¡Mensaje enviado!</h2>
      <p>Te respondemos en menos de 24 horas en el correo que nos indicaste.</p>
    </div>

    <div class="contact-card">
      <div class="contact-icon">✉️</div>
      <div>
        <div class="contact-label">Correo directo</div>
        <div class="contact-email">soporte@candidatic.com</div>
      </div>
    </div>

    <footer>© ${new Date().getFullYear()} Candidatic. Todos los derechos reservados.</footer>
  </div>

  <script>
    document.getElementById('support-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const errEl = document.getElementById('error-msg');
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      errEl.style.display = 'none';
      const data = Object.fromEntries(new FormData(e.target));
      try {
        const res = await fetch('/api/support', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(data)
        });
        if (res.ok) {
          document.getElementById('form-wrap').style.display = 'none';
          document.getElementById('success-wrap').style.display = 'block';
        } else {
          errEl.textContent = 'Algo salió mal. Intenta de nuevo.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Enviar mensaje';
        }
      } catch {
        errEl.textContent = 'Error de conexión. Escríbenos a soporte@candidatic.com';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Enviar mensaje';
      }
    });
  </script>
</body>
</html>`);
}
