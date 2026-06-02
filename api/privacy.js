export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Política de Privacidad — Candidatic</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; color: #1e293b; line-height: 1.7; background: #fff; }
    main { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
    h1 { font-size: 28px; font-weight: 800; margin-bottom: 8px; color: #ea580c; }
    .date { color: #64748b; font-size: 14px; margin-bottom: 36px; }
    h2 { font-size: 20px; font-weight: 700; margin-bottom: 10px; margin-top: 32px; color: #0f172a; }
    p { margin-bottom: 10px; }
    ul { padding-left: 20px; margin-top: 8px; margin-bottom: 10px; }
    li { margin-bottom: 4px; }
    strong { color: #0f172a; }
    .contact { font-weight: 600; color: #ea580c; }
    footer { border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 48px; font-size: 13px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <main>
    <h1>Política de Privacidad</h1>
    <p class="date">Última actualización: Junio 2026</p>

    <h2>1. Información que recopilamos</h2>
    <p><strong>Candidatic</strong> ("la App") recopila la siguiente información cuando creas una cuenta y usas nuestros servicios:</p>
    <ul>
      <li>Número de teléfono WhatsApp (usado para autenticación)</li>
      <li>Nombre completo</li>
      <li>Fecha de nacimiento y edad</li>
      <li>Género</li>
      <li>Municipio de residencia</li>
      <li>Categoría de trabajo y escolaridad</li>
      <li>Foto de perfil (opcional, subida voluntariamente)</li>
      <li>Currículum Vitae (opcional, subido voluntariamente)</li>
      <li>Experiencia laboral</li>
    </ul>

    <h2>2. Cómo usamos tu información</h2>
    <p>Usamos la información recopilada exclusivamente para:</p>
    <ul>
      <li>Autenticar tu acceso mediante código PIN por WhatsApp</li>
      <li>Mostrar tu perfil a empresas reclutadoras cuando te postulas a una vacante</li>
      <li>Conectarte con oportunidades de empleo relevantes</li>
      <li>Enviarte notificaciones push sobre nuevas vacantes (con tu permiso)</li>
      <li>Mejorar la experiencia de la plataforma</li>
    </ul>

    <h2>3. Compartición de datos</h2>
    <p><strong>No vendemos tu información personal a terceros.</strong> Tu perfil únicamente es visible por las empresas reclutadoras registradas en Candidatic cuando decides postularte a sus vacantes. El número de WhatsApp solo se comparte cuando solicitas que un reclutador te contacte directamente.</p>

    <h2>4. Almacenamiento y seguridad</h2>
    <p>Tus datos se almacenan de forma segura en servidores protegidos (Vercel, Redis Cloud). La autenticación se realiza mediante tokens temporales. Utilizamos HTTPS para todas las comunicaciones. Los PINs de acceso expiran a los 10 minutos y no se almacenan.</p>

    <h2>5. Permisos del dispositivo</h2>
    <ul>
      <li><strong>Galería de fotos:</strong> Solo cuando decides subir una foto de perfil o imagen de CV. Nunca accedemos sin tu consentimiento.</li>
      <li><strong>Notificaciones push:</strong> Para enviarte alertas de nuevas vacantes. Puedes desactivarlas en cualquier momento desde la configuración de tu dispositivo.</li>
      <li>No accedemos a cámara, micrófono, ubicación ni contactos.</li>
    </ul>

    <h2>6. Derechos del usuario</h2>
    <p>Tienes derecho a:</p>
    <ul>
      <li>Acceder a tus datos personales almacenados</li>
      <li>Corregir información inexacta en tu perfil</li>
      <li>Solicitar la eliminación completa de tu cuenta y datos</li>
      <li>Retirar tu consentimiento para el envío de notificaciones</li>
    </ul>
    <p>Para ejercer estos derechos contáctanos directamente.</p>

    <h2>7. Retención de datos</h2>
    <p>Conservamos tu información mientras tu cuenta esté activa. Si solicitas eliminar tu cuenta, borramos todos tus datos en un plazo de 30 días.</p>

    <h2>8. Menores de edad</h2>
    <p>Candidatic está dirigido a personas mayores de 15 años en busca de empleo. No recopilamos intencionalmente información de menores de 15 años.</p>

    <h2>9. Cambios a esta política</h2>
    <p>Podemos actualizar esta política periódicamente. Los cambios significativos se notificarán mediante la App.</p>

    <h2>10. Contacto</h2>
    <p>Si tienes preguntas sobre esta política, escríbenos a:</p>
    <p class="contact">soporte@candidatic.com</p>

    <footer>© ${new Date().getFullYear()} Candidatic. Todos los derechos reservados.</footer>
  </main>
</body>
</html>`);
}
