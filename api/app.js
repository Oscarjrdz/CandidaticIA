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
const ANDROID_URL = '';                        // ← Play Store (Android) — aún no publicada, dejar ''

const isPlaceholder = (u) => !u || u.startsWith('PENDIENTE_');

export default function handler(req, res) {
    const ua = String(req.headers['user-agent'] || '').toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isAndroid = /android/.test(ua);

    // No cachear: el comportamiento depende del dispositivo y Android cambiará al publicarse.
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (isIOS && !isPlaceholder(IOS_URL)) {
        res.writeHead(302, { Location: IOS_URL });
        return res.end();
    }
    if (isAndroid && !isPlaceholder(ANDROID_URL)) {
        res.writeHead(302, { Location: ANDROID_URL });
        return res.end();
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
<meta name="description" content="Descarga la app de Candidatic para ver tus vacantes y dar seguimiento a tu proceso.">
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
