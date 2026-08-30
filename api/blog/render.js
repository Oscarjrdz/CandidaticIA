// ─────────────────────────────────────────────────────────────
// Render del blog de Candidatic IA — layout estilo WordPress.
// Diseño simple por entrada: foto grande + texto abajo,
// sidebar derecho con el historial, y botones de compartir en redes.
// ─────────────────────────────────────────────────────────────

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absUrl(origin, path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return origin + (path.startsWith('/') ? path : '/' + path);
}

function formatDate(iso) {
  // iso: "2026-08-28" -> "28 de agosto de 2026"
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const [, y, mo, d] = m;
  return `${parseInt(d, 10)} de ${meses[parseInt(mo, 10) - 1]} de ${y}`;
}

function readingTime(html = '') {
  const text = String(html).replace(/<[^>]+>/g, ' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function shareButtons(url, title) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const wa = `https://wa.me/?text=${encodeURIComponent(title + ' ' + url)}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${u}`;
  const x = `https://twitter.com/intent/tweet?text=${t}&url=${u}`;
  const li = `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
  return `
  <div class="share">
    <span class="share-label">Compartir</span>
    <div class="share-btns">
      <a class="sb sb-wa" href="${wa}" target="_blank" rel="noopener noreferrer" aria-label="Compartir en WhatsApp" title="WhatsApp">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.1-.6.2-.2.3-.7.9-.8 1-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5s-.6-1.5-.9-2c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.3s1 2.7 1.1 2.8c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15L2 22l5.1-1.3A10 10 0 1 0 12 2zm0 18.3c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.3 8.3 0 1 1 12 20.3z"/></svg>
      </a>
      <a class="sb sb-fb" href="${fb}" target="_blank" rel="noopener noreferrer" aria-label="Compartir en Facebook" title="Facebook">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.5V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/></svg>
      </a>
      <a class="sb sb-x" href="${x}" target="_blank" rel="noopener noreferrer" aria-label="Compartir en X" title="X">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-7.3L6 22H2.9l7.5-8.6L2.6 2H9l4.6 6.7L18.9 2zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20z"/></svg>
      </a>
      <a class="sb sb-li" href="${li}" target="_blank" rel="noopener noreferrer" aria-label="Compartir en LinkedIn" title="LinkedIn">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5V9h3v10zM6.5 7.7a1.7 1.7 0 1 1 0-3.5 1.7 1.7 0 0 1 0 3.5zM19 19h-3v-5.4c0-1.3-.5-2.1-1.6-2.1-.9 0-1.4.6-1.6 1.2-.1.2-.1.5-.1.8V19h-3V9h3v1.3a3 3 0 0 1 2.7-1.5c2 0 3.4 1.3 3.4 4V19z"/></svg>
      </a>
      <button class="sb sb-copy" type="button" onclick="copyBlogLink(this)" aria-label="Copiar enlace" title="Copiar enlace">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
      </button>
    </div>
  </div>`;
}

function sidebar(allPosts, origin, currentSlug) {
  const items = allPosts
    .map((p) => {
      const active = p.slug === currentSlug ? ' class="active"' : '';
      return `<li${active}>
        <a href="${origin}/blog/${escapeHtml(p.slug)}">
          <img src="${escapeHtml(absUrl(origin, p.cover))}" alt="" loading="lazy">
          <div class="s-meta">
            <span class="s-title">${escapeHtml(p.title)}</span>
            <span class="s-date">${formatDate(p.date)}</span>
          </div>
        </a>
      </li>`;
    })
    .join('\n');
  return `<aside class="sidebar">
    <h3>Entradas recientes</h3>
    <ul class="s-list">${items}</ul>
  </aside>`;
}

/**
 * Renderiza la página completa de una entrada.
 * @param {object} post          entrada actual
 * @param {object[]} allPosts    todas las entradas (para el sidebar)
 * @param {string} origin        ej. "https://www.candidatic.com"
 */
export function renderPostPage(post, allPosts, origin) {
  const canonical = `${origin}/blog/${post.slug}`;
  const coverAbs = absUrl(origin, post.cover);
  const desc = post.excerpt || '';
  const title = `${post.title} — Blog Candidatic IA`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="icon" href="/favicon-candidatic-32.png">

<!-- Open Graph / preview al compartir -->
<meta property="og:type" content="article">
<meta property="og:site_name" content="Candidatic IA">
<meta property="og:title" content="${escapeHtml(post.title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(coverAbs)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="675">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="article:published_time" content="${escapeHtml(post.date)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(post.title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(coverAbs)}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Lora:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>
  :root{
    --violet:#7c3aed; --blue:#2563eb; --ink:#111827; --body:#374151;
    --muted:#6b7280; --line:#e5e7eb; --bg:#f8fafc; --card:#ffffff;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{font-family:'Inter',system-ui,sans-serif;color:var(--body);background:var(--bg);-webkit-font-smoothing:antialiased;line-height:1.65}
  a{color:inherit;text-decoration:none}
  img{max-width:100%;display:block}

  /* Header */
  .site-header{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
  .site-header .bar{height:4px;background:linear-gradient(90deg,#2563eb,#7c3aed,#9333ea)}
  .site-header .inner{max-width:1120px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;flex-direction:column;line-height:1}
  .brand img{height:26px;width:auto}
  .brand .by{margin-top:3px;font-size:9px;font-weight:600;color:#111}
  .brand .by a{color:#111;text-decoration:none}
  .brand .by a:hover{text-decoration:underline}
  .nav-back{font-size:13px;font-weight:600;color:var(--violet)}
  .nav-back:hover{text-decoration:underline}

  /* Layout */
  .wrap{max-width:1120px;margin:0 auto;padding:28px 20px 60px;display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:40px;align-items:start}

  /* Article */
  .article{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 6px 30px rgba(15,23,42,.05)}
  .cover{width:100%;aspect-ratio:16/9;object-fit:cover;background:#eef2f7}
  .article .pad{padding:32px 34px 40px}
  .kicker{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--violet);margin-bottom:12px}
  .article h1{font-family:'Inter',sans-serif;font-size:clamp(2.1rem,5.2vw,3.6rem);font-weight:900;line-height:1.08;color:var(--ink);letter-spacing:-.035em;margin-bottom:18px;text-wrap:balance}
  .post-meta{display:flex;align-items:center;gap:12px;font-size:13.5px;color:var(--muted);margin-bottom:26px;padding-bottom:24px;border-bottom:1px solid var(--line)}
  .post-meta .avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif;font-weight:800;font-size:15px;flex-shrink:0}
  .post-meta .who{display:flex;flex-direction:column;gap:2px}
  .post-meta .who .name{font-weight:700;color:var(--ink);font-size:14px}
  .post-meta .who .sub{font-size:12.5px;color:var(--muted)}
  .post-meta .dot{opacity:.5}

  /* Barra de progreso de lectura */
  .progress{position:fixed;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,#2563eb,#7c3aed,#9333ea);z-index:60;transition:width .1s linear}
  .content{font-family:'Lora',Georgia,serif;font-size:19px;line-height:1.78;color:#33404f;max-width:68ch}
  .content p{margin:0 0 22px}
  .content .lede{font-size:22px;line-height:1.6;color:var(--ink);font-weight:500;margin-bottom:26px}
  .content strong{color:var(--ink);font-weight:600}
  .content blockquote{font-family:'Inter',sans-serif;font-size:1.4rem;line-height:1.35;font-weight:700;color:var(--ink);letter-spacing:-.02em;margin:32px 0;padding:6px 0 6px 22px;border-left:4px solid var(--violet)}
  .content h2{font-family:'Inter',sans-serif;font-size:1.55rem;font-weight:800;color:var(--ink);margin:40px 0 16px;letter-spacing:-.02em;line-height:1.2}
  .content ul,.content ol{margin:0 0 20px 22px}
  .content li{margin-bottom:8px}
  .content img{border-radius:12px;margin:24px 0}
  .content a{color:var(--blue);text-decoration:underline}

  /* Share */
  .share{display:flex;align-items:center;gap:14px;margin:34px 0 4px;padding-top:24px;border-top:1px solid var(--line)}
  .share-label{font-size:13px;font-weight:700;color:var(--ink)}
  .share-btns{display:flex;gap:10px;flex-wrap:wrap}
  .sb{width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:none;cursor:pointer;color:#fff;transition:transform .15s,opacity .15s}
  .sb:hover{transform:translateY(-2px);opacity:.92}
  .sb svg{width:19px;height:19px}
  .sb-wa{background:#25d366}
  .sb-fb{background:#1877f2}
  .sb-x{background:#000}
  .sb-li{background:#0a66c2}
  .sb-copy{background:#6b7280}
  .sb-copy.copied{background:#16a34a}

  /* Sidebar */
  .sidebar{position:sticky;top:92px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px 18px;box-shadow:0 6px 30px rgba(15,23,42,.05)}
  .sidebar h3{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--line)}
  .s-list{list-style:none;display:flex;flex-direction:column;gap:4px}
  .s-list li a{display:flex;gap:12px;padding:9px;border-radius:12px;transition:background .15s}
  .s-list li a:hover{background:#f3f4f6}
  .s-list li.active a{background:#f5f3ff}
  .s-list img{width:64px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#eef2f7}
  .s-meta{display:flex;flex-direction:column;gap:3px;min-width:0}
  .s-title{font-size:13px;font-weight:600;color:var(--ink);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .s-date{font-size:11.5px;color:var(--muted)}

  /* Footer */
  .site-footer{border-top:1px solid var(--line);background:#fff;padding:26px 20px;text-align:center;color:var(--muted);font-size:13px}
  .site-footer a{color:var(--violet)}

  /* Toast */
  .toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--ink);color:#fff;padding:10px 18px;border-radius:999px;font-size:13.5px;font-weight:600;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;z-index:100}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

  @media(max-width:900px){
    .wrap{grid-template-columns:1fr;gap:28px}
    .sidebar{position:static;top:auto}
    .article .pad{padding:24px 22px 32px}
    .content{font-size:17px}
  }
</style>
</head>
<body>
  <div class="progress" id="progress"></div>
  <header class="site-header">
    <div class="bar"></div>
    <div class="inner">
      <a class="brand" href="${origin}/blog">
        <img src="/logo-candidatic-landing.png" alt="Candidatic IA">
        <span class="by">by <a href="https://www.hr1.mx" target="_blank" rel="noopener noreferrer">Hr One México</a> 🇲🇽</span>
      </a>
      <a class="nav-back" href="/">← Volver al sitio</a>
    </div>
  </header>

  <main class="wrap">
    <article class="article">
      <img class="cover" src="${escapeHtml(coverAbs)}" alt="${escapeHtml(post.title)}">
      <div class="pad">
        <span class="kicker">${escapeHtml(post.category || 'Blog')}</span>
        <h1>${escapeHtml(post.title)}</h1>
        <div class="post-meta">
          <span class="avatar">${escapeHtml(initials(post.author || 'Candidatic IA'))}</span>
          <span class="who">
            <span class="name">${escapeHtml(post.author || 'Candidatic')}</span>
            <span class="sub">${formatDate(post.date)} <span class="dot">·</span> ${readingTime(post.content)} min de lectura</span>
          </span>
        </div>
        <div class="content">${post.content || ''}</div>
        ${shareButtons(canonical, post.title)}
      </div>
    </article>

    ${sidebar(allPosts, origin, post.slug)}
  </main>

  <footer class="site-footer">
    © ${(post.date || '').slice(0, 4)} Candidatic IA · by <a href="https://www.hr1.mx" target="_blank" rel="noopener noreferrer">Hr One México</a> 🇲🇽
  </footer>

  <div class="toast" id="toast">Enlace copiado ✓</div>

  <script>
    function copyBlogLink(btn){
      var url = ${JSON.stringify(canonical)};
      function ok(){
        btn.classList.add('copied');
        var t=document.getElementById('toast');t.classList.add('show');
        setTimeout(function(){btn.classList.remove('copied');t.classList.remove('show');},1800);
      }
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(url).then(ok).catch(function(){window.prompt('Copia el enlace:',url);});
      }else{window.prompt('Copia el enlace:',url);}
    }
    // Barra de progreso de lectura
    (function(){
      var bar=document.getElementById('progress');
      function upd(){
        var h=document.documentElement;
        var max=(h.scrollHeight-h.clientHeight)||1;
        var pct=Math.min(100,Math.max(0,(h.scrollTop||document.body.scrollTop)/max*100));
        bar.style.width=pct+'%';
      }
      window.addEventListener('scroll',upd,{passive:true});
      window.addEventListener('resize',upd);upd();
    })();
  </script>
</body>
</html>`;
}
