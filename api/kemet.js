/**
 * Liga del mapa de la planta Kemet San Nicolás — /kemet  (rewrite → /api/kemet)
 *
 * Brenda/plantillas mandan candidatic.com/kemet como "liga del mapa". Antes era un
 * redirect crudo a Google Maps, así que WhatsApp leía los metadatos de Google Maps y
 * mostraba las COORDENADAS crudas (25°43'54.8"N 100°15'11.1"W) en el preview.
 *
 * Aquí servimos una página con Open Graph propio para que el preview de WhatsApp diga
 * algo humano ("Clic aquí para ver dónde está la planta de Kemet"), y a la persona que
 * la abre la mandamos igual a Google Maps con un splash de marca (sin flash blanco).
 *
 * Nota: WhatsApp CACHEA el preview por URL. Si ya se compartió antes, el preview viejo
 * (coordenadas) puede tardar en refrescar. Se fuerza con el Sharing Debugger de Facebook.
 */
const MAPS_URL = 'https://maps.app.goo.gl/RTfkk3ySMfP8yiYc7'; // ← destino real (Google Maps de la planta)

const OG_TITLE = '📍 Planta Kemet San Nicolás';
const OG_DESCRIPTION = 'Clic aquí para ver dónde está la planta de Kemet en el mapa 🗺️';
const PAGE_URL = 'https://www.candidatic.com/kemet';

export default function handler(req, res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Cache corto: permite refrescar el preview sin quedar clavado, sin re-render por visita.
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(renderMapSplash());
}

function renderMapSplash() {
    const safe = String(MAPS_URL).replace(/"/g, '%22');
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${OG_TITLE} — Candidatic</title>
<meta name="description" content="${OG_DESCRIPTION}">
<!-- Open Graph / vista previa en WhatsApp, Facebook, etc. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Candidatic — Bolsa de Empleo">
<meta property="og:title" content="${OG_TITLE}">
<meta property="og:description" content="${OG_DESCRIPTION}">
<meta property="og:url" content="${PAGE_URL}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${OG_TITLE}">
<meta name="twitter:description" content="${OG_DESCRIPTION}">
<!-- Redirección para humanos (los crawlers de preview NO ejecutan esto y se quedan con el OG de arriba). -->
<meta http-equiv="refresh" content="1;url=${safe}">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:24px; text-align:center; color:#fff;
    background:linear-gradient(135deg,#22c55e 0%,#16a34a 50%,#15803d 100%);
  }
  .pin { font-size:60px; margin-bottom:14px; animation:drop .5s ease; }
  @keyframes drop { from { transform:translateY(-18px); opacity:0; } to { transform:translateY(0); opacity:1; } }
  h1 { font-size:23px; font-weight:900; letter-spacing:-.5px; }
  p { font-size:15px; opacity:.92; margin-top:8px; }
  .spinner {
    width:32px; height:32px; margin:24px auto 0; border-radius:50%;
    border:4px solid rgba(255,255,255,.35); border-top-color:#fff; animation:spin .8s linear infinite;
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  .fallback { margin-top:22px; font-size:14px; }
  .fallback a { color:#fff; font-weight:700; text-decoration:underline; }
</style>
</head>
<body>
  <div class="pin">📍</div>
  <h1>Planta Kemet San Nicolás</h1>
  <p>Abriendo el mapa…</p>
  <div class="spinner"></div>
  <p class="fallback">Si no abre solo, <a href="${safe}">toca aquí</a>.</p>
  <script>
    // Redirección inmediata sin dejar el splash en el historial (el botón "atrás" no vuelve aquí).
    setTimeout(function(){ window.location.replace(${JSON.stringify(MAPS_URL)}); }, 250);
  </script>
</body>
</html>`;
}
