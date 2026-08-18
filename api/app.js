/**
 * Liga inteligente de descarga de la app — /app  (rewrite → /api/app)
 *
 * Brenda manda SIEMPRE el mismo link (candidatic.com/app). Cuando el candidato lo abre
 * desde su teléfono, aquí leemos su User-Agent (que YA es el suyo, porque él está abriendo
 * el link) y lo mandamos a la tienda correcta. No hace falta saber su sistema operativo de
 * antemano: el link lo detecta al tocarlo.
 *
 *   iPhone/iPad → App Store
 *   Android     → Play Store (cuando esté publicada; ver ANDROID_URL)
 *   compu/otro  → página con los botones disponibles
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 👉 CONFIG: pega aquí las URLs de las tiendas. Android está pendiente de publicarse;
 *    déjala en '' (vacío) hasta que salga — mientras, los Android verán "muy pronto".
 *    Al pegar la URL de Play Store, Android empieza a redirigir solo, sin tocar nada más.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const IOS_URL = 'https://apps.apple.com/mx/app/candidatic/id6776012569';   // ← App Store (iOS) — publicada
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.candidatic.candidatos';   // ← Play Store (Android) — publicada

const isPlaceholder = (u) => !u || u.startsWith('PENDIENTE_');

export default function handler(req, res) {
    const ua = String(req.headers['user-agent'] || '').toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isAndroid = /android/.test(ua);

    // No cachear: el comportamiento depende del dispositivo y Android cambiará al publicarse.
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (isIOS && !isPlaceholder(IOS_URL)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(renderRedirectSplash(IOS_URL, 'App Store'));
    }
    if (isAndroid && !isPlaceholder(ANDROID_URL)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(renderRedirectSplash(ANDROID_URL, 'Google Play'));
    }

    // Fallback: Android aún no publicada, compu, o iOS sin URL configurada todavía.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderFallback({
        iosReady: !isPlaceholder(IOS_URL),
        androidReady: !isPlaceholder(ANDROID_URL),
        iosUrl: IOS_URL,
        androidUrl: ANDROID_URL,
        isAndroid,
    }));
}

// Splash de marca Candidatic mientras redirige a la tienda (evita el "flash blanco" del 302 crudo).
function renderRedirectSplash(storeUrl, storeName) {
    const safe = String(storeUrl).replace(/"/g, '%22');
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="1;url=${safe}">
<title>Abriendo ${storeName}… — Candidatic</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:24px; text-align:center; color:#fff;
    background:linear-gradient(135deg,#FBA83E 0%,#F7941D 48%,#EE7B10 100%);
  }
  .icon {
    width:110px; height:110px; border-radius:26px; margin-bottom:22px;
    box-shadow:0 18px 44px rgba(120,60,0,.35); animation:pop .5s ease;
  }
  @keyframes pop { from { transform:scale(.85); opacity:0; } to { transform:scale(1); opacity:1; } }
  h1 { font-size:26px; font-weight:900; letter-spacing:-.5px; }
  h1 span { font-weight:600; opacity:.9; }
  p { font-size:15px; opacity:.9; margin-top:8px; }
  .spinner {
    width:34px; height:34px; margin:26px auto 0; border-radius:50%;
    border:4px solid rgba(255,255,255,.35); border-top-color:#fff; animation:spin .8s linear infinite;
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  .fallback { margin-top:28px; font-size:14px; }
  .fallback a { color:#fff; font-weight:700; text-decoration:underline; }
</style>
</head>
<body>
  <img class="icon" src="https://www.candidatic.com/lp/Candidatic_app_candidato_icono.png" alt="Candidatic">
  <h1>Candidatic <span>Bolsa de Empleo</span></h1>
  <p>Abriendo ${storeName}…</p>
  <div class="spinner"></div>
  <p class="fallback">Si no abre solo, <a href="${safe}">toca aquí</a>.</p>
  <script>
    // Redirección inmediata sin dejar el splash en el historial (el botón "atrás" no vuelve aquí).
    setTimeout(function(){ window.location.replace(${JSON.stringify(storeUrl)}); }, 250);
  </script>
</body>
</html>`;
}

function renderFallback({ iosReady, androidReady, iosUrl, androidUrl, isAndroid }) {
    const iosBtn = iosReady
        ? `<a class="btn ios" href="${iosUrl}"><span class="ico"></span><span><small>Descárgala en</small><b>App Store</b></span></a>`
        : `<div class="btn soon"><span class="ico"></span><span><small>iPhone</small><b>Muy pronto</b></span></div>`;

    const androidBtn = androidReady
        ? `<a class="btn android" href="${androidUrl}"><span class="ico play"></span><span><small>Disponible en</small><b>Google Play</b></span></a>`
        : `<div class="btn soon"><span class="ico play"></span><span><small>Android</small><b>Muy pronto</b></span></div>`;

    // Mensaje contextual: si es un Android y aún no sale, avísale con claridad.
    const note = isAndroid && !androidReady
        ? `<p class="note">La app para <b>Android</b> está por salir. Te avisaremos por WhatsApp en cuanto esté lista. 🤖</p>`
        : `<p class="note">Ábrelo desde tu celular para ir directo a tu tienda.</p>`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Descarga la app — Candidatic</title>
<meta name="description" content="Bolsa de empleo de vacantes operativas: ayudantes generales, montacarguistas y operarios de producción. Descárgala GRATIS.">
<!-- Open Graph / vista previa en WhatsApp, Facebook, etc. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Candidatic — Bolsa de Empleo">
<meta property="og:title" content="Descárgala GRATIS — Candidatic Bolsa de Empleo">
<meta property="og:description" content="Bolsa de empleo de vacantes operativas: ayudantes generales, montacarguistas, operarios de producción y más. 🧡">
<meta property="og:image" content="https://www.candidatic.com/lp/og-descarga-app.png">
<meta property="og:image:secure_url" content="https://www.candidatic.com/lp/og-descarga-app.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Descarga la app Candidatic Bolsa de Empleo">
<meta property="og:url" content="https://www.candidatic.com/app">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Descárgala GRATIS — Candidatic Bolsa de Empleo">
<meta name="twitter:description" content="Vacantes operativas: ayudantes generales, montacarguistas, operarios de producción y más. 🧡">
<meta name="twitter:image" content="https://www.candidatic.com/lp/og-descarga-app.png">
<style>
  :root { color-scheme: light dark; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
    background:linear-gradient(160deg,#6d28d9 0%,#4f46e5 55%,#7c3aed 100%);
    color:#fff;
  }
  .card {
    width:100%; max-width:400px; background:rgba(255,255,255,.08);
    border:1px solid rgba(255,255,255,.15); border-radius:24px; padding:36px 28px;
    text-align:center; backdrop-filter:blur(12px); box-shadow:0 20px 60px rgba(0,0,0,.25);
  }
  .logo { font-size:26px; font-weight:900; letter-spacing:-.5px; margin-bottom:6px; }
  .logo span { opacity:.85; font-weight:600; }
  h1 { font-size:20px; font-weight:800; margin:14px 0 6px; }
  p.sub { font-size:14px; opacity:.85; line-height:1.5; margin-bottom:24px; }
  .btns { display:flex; flex-direction:column; gap:12px; }
  .btn {
    display:flex; align-items:center; justify-content:center; gap:12px;
    background:#000; color:#fff; text-decoration:none; padding:12px 18px; border-radius:14px;
    font-weight:600; transition:transform .15s ease, opacity .15s ease;
  }
  .btn:hover { transform:translateY(-2px); }
  .btn span:last-child { display:flex; flex-direction:column; align-items:flex-start; line-height:1.15; }
  .btn small { font-size:10px; opacity:.8; font-weight:500; }
  .btn b { font-size:16px; }
  .btn .ico { width:22px; height:22px; background:#fff; border-radius:5px; flex-shrink:0; }
  .btn .ico.play { border-radius:4px; background:linear-gradient(135deg,#00d4ff,#00f076,#ffce00,#ff3a44); }
  .btn.soon { background:rgba(255,255,255,.12); opacity:.55; cursor:default; }
  .btn.soon:hover { transform:none; }
  .note { font-size:12.5px; opacity:.75; margin-top:22px; line-height:1.5; }
  .note b { opacity:1; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">CANDIDATIC <span>IA</span></div>
    <h1>Descarga la app</h1>
    <p class="sub">Ve tus vacantes, agenda y da seguimiento a tu proceso desde tu celular.</p>
    <div class="btns">
      ${iosBtn}
      ${androidBtn}
    </div>
    ${note}
  </div>
</body>
</html>`;
}
