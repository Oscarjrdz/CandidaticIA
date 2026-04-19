export default function handler(req, res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Términos y Condiciones — Candidatic IA</title>
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
        <h1>Términos y Condiciones</h1>
        <p class="date">Última actualización: abril 2026</p>

        <h2>1. Aceptación de los Términos</h2>
        <p>Al utilizar los servicios de Candidatic IA, operado por HR One México, aceptas estos términos y condiciones en su totalidad. Si no estás de acuerdo, no utilices la plataforma.</p>

        <h2>2. Descripción del Servicio</h2>
        <p>Candidatic IA es una plataforma de reclutamiento asistida por inteligencia artificial que facilita la comunicación entre reclutadores y candidatos a través de WhatsApp y otros canales digitales.</p>

        <h2>3. Uso del Servicio</h2>
        <ul>
            <li>El servicio está destinado exclusivamente a fines de reclutamiento y selección de personal.</li>
            <li>Los usuarios se comprometen a no utilizar la plataforma para enviar spam, contenido ilegal o no solicitado.</li>
            <li>Cada cuenta es personal e intransferible.</li>
        </ul>

        <h2>4. Comunicaciones por WhatsApp</h2>
        <p>Al interactuar con nuestro número de WhatsApp Business, aceptas recibir mensajes relacionados con procesos de reclutamiento. Puedes optar por no recibir más mensajes en cualquier momento escribiendo "STOP".</p>

        <h2>5. Propiedad Intelectual</h2>
        <p>Todo el contenido, diseño y tecnología de Candidatic IA son propiedad de HR One México. Queda prohibida la reproducción, distribución o modificación sin autorización previa.</p>

        <h2>6. Limitación de Responsabilidad</h2>
        <p>HR One México no garantiza la obtención de empleo a través de la plataforma. El servicio se proporciona "tal cual" y no nos hacemos responsables por decisiones tomadas con base en la información procesada.</p>

        <h2>7. Modificaciones</h2>
        <p>Nos reservamos el derecho de modificar estos términos en cualquier momento. Los cambios se publicarán en esta página y entrarán en vigor inmediatamente.</p>

        <h2>8. Contacto</h2>
        <p>Para cualquier consulta sobre estos términos, contáctanos en: <a href="mailto:contacto@hrone.mx">contacto@hrone.mx</a></p>

        <p style="margin-top: 3rem; color: #666; font-size: 0.85rem;">© 2026 HR One México. Todos los derechos reservados.</p>
    </div>
</body>
</html>`);
}
