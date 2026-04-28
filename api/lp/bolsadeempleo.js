export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Bolsa de Empleo — Candidatic IA</title>
<meta name="description" content="Vacantes disponibles con contratación inmediata. Postúlate ahora por WhatsApp.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  font-family:'Inter',system-ui,sans-serif;
  background:#0a0a0f;
  color:#fff;
  min-height:100vh;
  -webkit-tap-highlight-color:transparent;
}
.header{
  position:sticky;top:0;z-index:50;
  background:rgba(10,10,15,.92);
  backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px);
  border-bottom:1px solid rgba(255,255,255,.06);
  padding:14px 16px;
  text-align:center;
}
.header img{height:28px}
.header h1{
  font-size:13px;font-weight:600;
  color:rgba(255,255,255,.5);
  margin-top:4px;letter-spacing:.5px;
  text-transform:uppercase;
}
.hero{
  background:linear-gradient(135deg,#f97316 0%,#ea580c 50%,#c2410c 100%);
  padding:28px 20px;text-align:center;
}
.hero h2{
  font-size:22px;font-weight:900;
  line-height:1.2;margin-bottom:6px;
}
.hero p{font-size:14px;opacity:.9}
.feed{
  padding:12px;
  display:flex;flex-direction:column;
  gap:16px;
  max-width:480px;margin:0 auto;
  padding-bottom:24px;
}
.card{
  background:#141420;
  border-radius:16px;
  overflow:hidden;
  border:1px solid rgba(255,255,255,.06);
  box-shadow:0 4px 24px rgba(0,0,0,.4);
  transition:transform .2s;
}
.card:active{transform:scale(.98)}
.card img{
  width:100%;display:block;
  object-fit:contain;
}
.card-body{padding:16px}
.card-body .badge{
  display:inline-block;
  background:rgba(249,115,22,.15);
  color:#fb923c;
  font-size:11px;font-weight:700;
  padding:4px 10px;border-radius:20px;
  margin-bottom:10px;
  text-transform:uppercase;letter-spacing:.5px;
}
.card-body .title{
  font-size:17px;font-weight:700;
  margin-bottom:4px;
}
.card-body .sub{
  font-size:13px;color:rgba(255,255,255,.45);
  margin-bottom:14px;
}
.btn-wa{
  display:flex;align-items:center;justify-content:center;gap:8px;
  width:100%;padding:14px;
  background:linear-gradient(135deg,#25d366,#128c7e);
  color:#fff;font-size:15px;font-weight:700;
  border:none;border-radius:12px;
  cursor:pointer;text-decoration:none;
  letter-spacing:.3px;
  transition:opacity .2s,transform .15s;
  -webkit-tap-highlight-color:transparent;
}
.btn-wa:active{transform:scale(.96);opacity:.85}
.btn-wa svg{width:22px;height:22px;flex-shrink:0}
.footer{
  text-align:center;padding:24px 16px;
  color:rgba(255,255,255,.25);font-size:11px;
}
.footer a{color:#fb923c;text-decoration:none}

@media(min-width:600px){
  .hero h2{font-size:28px}
  .feed{padding:20px}
  .card-body .title{font-size:19px}
}
</style>
</head>
<body>
<header class="header">
  <div style="font-size:20px;font-weight:900;color:#f97316">CANDIDATIC</div>
  <h1>Bolsa de Empleo</h1>
</header>

<section class="hero">
  <h2>🔥 Vacantes Disponibles</h2>
  <p>Contratación inmediata · Hombres y Mujeres</p>
</section>

<main class="feed">

  <article class="card" id="vacancy-ayudantes">
    <a href="https://wa.me/5218180859480" target="_blank" rel="noopener"><img src="/lp/ayudantes.jpg" alt="Vacante Ayudantes Generales" loading="lazy"></a>
    <div class="card-body">
      <span class="badge">🔥 Contratación Inmediata</span>
      <div class="title">Ayudantes Generales</div>
      <div class="sub">Sueldo semanal $4,500 · Hombres y Mujeres</div>
      <a href="https://wa.me/5218180859480" target="_blank" rel="noopener" class="btn-wa">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        POSTÚLATE A ESTA VACANTE
      </a>
    </div>
  </article>

  <article class="card" id="vacancy-soldadores">
    <a href="https://wa.me/5218180859480" target="_blank" rel="noopener"><img src="/lp/soldadores.jpg" alt="Vacante Soldadores" loading="lazy"></a>
    <div class="card-body">
      <span class="badge">🔥 Contratación Inmediata</span>
      <div class="title">Soldadores</div>
      <div class="sub">Sueldo semanal $5,500 · Hombres y Mujeres</div>
      <a href="https://wa.me/5218180859480" target="_blank" rel="noopener" class="btn-wa">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        POSTÚLATE A ESTA VACANTE
      </a>
    </div>
  </article>

  <article class="card" id="vacancy-almacenistas">
    <a href="https://wa.me/5218180859480" target="_blank" rel="noopener"><img src="/lp/almacenistas.jpg" alt="Vacante Almacenistas" loading="lazy"></a>
    <div class="card-body">
      <span class="badge">🔥 Contratación Inmediata</span>
      <div class="title">Almacenistas</div>
      <div class="sub">Sueldo semanal $4,500 · Hombres y Mujeres</div>
      <a href="https://wa.me/5218180859480" target="_blank" rel="noopener" class="btn-wa">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        POSTÚLATE A ESTA VACANTE
      </a>
    </div>
  </article>

  <article class="card" id="vacancy-operarios">
    <a href="https://wa.me/5218180859480" target="_blank" rel="noopener"><img src="/lp/operarios.jpg" alt="Vacante Operarios Generales" loading="lazy"></a>
    <div class="card-body">
      <span class="badge">🔥 Contratación Inmediata</span>
      <div class="title">Operarios Generales</div>
      <div class="sub">Sueldo semanal $4,500 · Hombres y Mujeres</div>
      <a href="https://wa.me/5218180859480" target="_blank" rel="noopener" class="btn-wa">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        POSTÚLATE A ESTA VACANTE
      </a>
    </div>
  </article>

</main>

<footer class="footer">
  <p>© 2026 <a href="https://candidatic.com">Candidatic IA</a> · HR One México</p>
  <p style="margin-top:4px"><a href="/terms">Términos</a> · <a href="/privacy">Privacidad</a></p>
</footer>


</body>
</html>`);
}
