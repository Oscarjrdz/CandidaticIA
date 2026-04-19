export default function handler(req, res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Política de Privacidad — Candidatic IA</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0a0a0f; color: #e0e0e0; line-height: 1.7; padding: 2rem; }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { color: #a78bfa; margin-bottom: 0.5rem; font-size: 2rem; }
        h2 { color: #818cf8; margin: 2rem 0 0.5rem; font-size: 1.3rem; }
        .date { color: #888; margin-bottom: 2rem; }
        p, li { margin-bottom: 0.8rem; color: #ccc; }
        ul { padding-left: 1.5rem; }
        a { color: #a78bfa; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Política de Privacidad</h1>
        <p class="date">Última actualización: abril 2026</p>

        <h2>1. Responsable del Tratamiento</h2>
        <p>HR One México es responsable del tratamiento de tus datos personales a través de la plataforma Candidatic IA, en cumplimiento con la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).</p>

        <h2>2. Datos que Recopilamos</h2>
        <ul>
            <li><strong>Datos de identificación:</strong> nombre, número de teléfono WhatsApp.</li>
            <li><strong>Datos laborales:</strong> experiencia, habilidades, disponibilidad, pretensiones salariales.</li>
            <li><strong>Datos de comunicación:</strong> mensajes intercambiados con el asistente virtual Brenda.</li>
            <li><strong>Datos técnicos:</strong> tipo de dispositivo, fecha y hora de interacción.</li>
        </ul>

        <h2>3. Finalidad del Tratamiento</h2>
        <ul>
            <li>Facilitar procesos de reclutamiento y selección de personal.</li>
            <li>Comunicar vacantes relevantes a los candidatos.</li>
            <li>Agendar entrevistas y dar seguimiento a candidaturas.</li>
            <li>Mejorar la calidad del servicio mediante análisis de uso.</li>
        </ul>

        <h2>4. Base Legal</h2>
        <p>El tratamiento de tus datos se basa en tu consentimiento otorgado al interactuar voluntariamente con nuestro servicio de WhatsApp Business.</p>

        <h2>5. Compartición de Datos</h2>
        <p>Tus datos podrán ser compartidos con las empresas que publican vacantes a través de nuestra plataforma, exclusivamente para fines de reclutamiento. No vendemos ni comercializamos datos personales a terceros.</p>

        <h2>6. Almacenamiento y Seguridad</h2>
        <p>Tus datos se almacenan en servidores seguros con cifrado en tránsito y en reposo. Implementamos medidas técnicas y organizativas para proteger tu información contra acceso no autorizado.</p>

        <h2>7. Derechos ARCO</h2>
        <p>Tienes derecho a Acceder, Rectificar, Cancelar u Oponerte al tratamiento de tus datos personales. Para ejercer estos derechos, envía un correo a: <a href="mailto:privacidad@hrone.mx">privacidad@hrone.mx</a></p>

        <h2>8. Retención de Datos</h2>
        <p>Tus datos se conservarán mientras sean necesarios para los fines descritos. Puedes solicitar la eliminación de tus datos en cualquier momento.</p>

        <h2>9. Uso de Inteligencia Artificial</h2>
        <p>Utilizamos modelos de inteligencia artificial para asistir en la comunicación con candidatos. Las decisiones finales de contratación siempre son tomadas por personas.</p>

        <h2>10. Contacto</h2>
        <p>Para consultas sobre privacidad: <a href="mailto:privacidad@hrone.mx">privacidad@hrone.mx</a></p>

        <p style="margin-top: 3rem; color: #666; font-size: 0.85rem;">© 2026 HR One México. Todos los derechos reservados.</p>
    </div>
</body>
</html>`);
}
