import React, { useState, useEffect, useMemo, useCallback } from 'react';

/* ────────────────────────────────────────────────────────────
   Blog dentro de la SPA — navegación instantánea, sin reloads
   ni cambios en la URL. Las ligas bonitas (candidatic.com/slug)
   se usan SOLO al compartir. Mismo diseño que la página
   server-rendered (api/blog/render.js).
   ──────────────────────────────────────────────────────────── */

function readingTime(html = '') {
  const words = String(html).replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
function formatDate(iso) {
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  return `${parseInt(m[3],10)} de ${meses[parseInt(m[2],10)-1]} de ${m[1]}`;
}
function postPath(p) {
  return p.root ? `/${p.slug}` : `/blog/${p.slug}`;
}

const ICONS = {
  wa: <path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.1-.6.2-.2.3-.7.9-.8 1-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5s-.6-1.5-.9-2c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.3s1 2.7 1.1 2.8c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15L2 22l5.1-1.3A10 10 0 1 0 12 2zm0 18.3c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.3 8.3 0 1 1 12 20.3z" />,
  fb: <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.5V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z" />,
  x: <path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-7.3L6 22H2.9l7.5-8.6L2.6 2H9l4.6 6.7L18.9 2zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20z" />,
  li: <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5V9h3v10zM6.5 7.7a1.7 1.7 0 1 1 0-3.5 1.7 1.7 0 0 1 0 3.5zM19 19h-3v-5.4c0-1.3-.5-2.1-1.6-2.1-.9 0-1.4.6-1.6 1.2-.1.2-.1.5-.1.8V19h-3V9h3v1.3a3 3 0 0 1 2.7-1.5c2 0 3.4 1.3 3.4 4V19z" />,
};

export default function BlogView() {
  const [posts, setPosts] = useState(null);
  const [activeSlug, setActiveSlug] = useState(null);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);

  // Cargar entradas una sola vez
  useEffect(() => {
    let alive = true;
    fetch('/api/blog/data')
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        const list = d?.posts || [];
        setPosts(list);
        setActiveSlug(list[0]?.slug || null);
      })
      .catch(() => { if (alive) setPosts([]); });
    return () => { alive = false; };
  }, []);

  // Barra de progreso de lectura
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = (h.scrollHeight - h.clientHeight) || 1;
      setProgress(Math.min(100, Math.max(0, (h.scrollTop / max) * 100)));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [activeSlug]);

  const active = useMemo(
    () => (posts || []).find(p => p.slug === activeSlug) || (posts || [])[0] || null,
    [posts, activeSlug]
  );

  const openPost = useCallback((slug) => {
    setActiveSlug(slug);
    setCopied(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const shareUrl = active
    ? `${window.location.origin}${postPath(active)}`
    : '';

  const copyLink = useCallback(() => {
    if (!shareUrl) return;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1800); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl).then(done).catch(() => window.prompt('Copia el enlace:', shareUrl));
    } else {
      window.prompt('Copia el enlace:', shareUrl);
    }
  }, [shareUrl]);

  if (!posts) {
    return (
      <div className="cdx-blog"><div className="cdx-loading">Cargando blog…</div><ScopedStyles /></div>
    );
  }
  if (!active) {
    return (
      <div className="cdx-blog"><div className="cdx-loading">Aún no hay entradas.</div><ScopedStyles /></div>
    );
  }

  const t = encodeURIComponent(active.title);
  const u = encodeURIComponent(shareUrl);
  const shareLinks = {
    wa: `https://wa.me/?text=${encodeURIComponent(active.title + ' ' + shareUrl)}`,
    fb: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    x: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
    li: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
  };

  return (
    <div className="cdx-blog">
      <div className="cdx-progress" style={{ width: `${progress}%` }} />

      <div className="cdx-wrap">
        <article className="cdx-article">
          <img className="cdx-cover" src={active.cover} alt={active.title} />
          <div className="cdx-pad">
            <span className="cdx-kicker">{active.category || 'Blog'}</span>
            <h1 className="cdx-h1">{active.title}</h1>
            <div className="cdx-meta">
              <span className="cdx-avatar">{initials(active.author || 'Candidatic IA')}</span>
              <span className="cdx-who">
                <span className="cdx-name">{active.author || 'Candidatic'}</span>
                <span className="cdx-sub">{formatDate(active.date)} · {readingTime(active.content)} min de lectura</span>
              </span>
            </div>

            <div className="cdx-content" dangerouslySetInnerHTML={{ __html: active.content || '' }} />

            <div className="cdx-share">
              <span className="cdx-share-label">Compartir</span>
              <div className="cdx-share-btns">
                <a className="cdx-sb cdx-wa" href={shareLinks.wa} target="_blank" rel="noopener noreferrer" aria-label="Compartir en WhatsApp" title="WhatsApp"><svg viewBox="0 0 24 24" fill="currentColor">{ICONS.wa}</svg></a>
                <a className="cdx-sb cdx-fb" href={shareLinks.fb} target="_blank" rel="noopener noreferrer" aria-label="Compartir en Facebook" title="Facebook"><svg viewBox="0 0 24 24" fill="currentColor">{ICONS.fb}</svg></a>
                <a className="cdx-sb cdx-x" href={shareLinks.x} target="_blank" rel="noopener noreferrer" aria-label="Compartir en X" title="X"><svg viewBox="0 0 24 24" fill="currentColor">{ICONS.x}</svg></a>
                <a className="cdx-sb cdx-li" href={shareLinks.li} target="_blank" rel="noopener noreferrer" aria-label="Compartir en LinkedIn" title="LinkedIn"><svg viewBox="0 0 24 24" fill="currentColor">{ICONS.li}</svg></a>
                <button type="button" className={`cdx-sb cdx-copy${copied ? ' copied' : ''}`} onClick={copyLink} aria-label="Copiar enlace" title="Copiar enlace">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
                </button>
                {copied && <span className="cdx-copied-tip">Enlace copiado ✓</span>}
              </div>
            </div>
          </div>
        </article>

        <aside className="cdx-sidebar">
          <h3>Entradas recientes</h3>
          <ul className="cdx-slist">
            {posts.map(p => (
              <li key={p.slug} className={p.slug === active.slug ? 'active' : ''}>
                <button type="button" onClick={() => openPost(p.slug)}>
                  <img src={p.cover} alt="" loading="lazy" />
                  <span className="cdx-s-meta">
                    <span className="cdx-s-title">{p.title}</span>
                    <span className="cdx-s-date">{formatDate(p.date)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <ScopedStyles />
    </div>
  );
}

/* Estilos del blog (aislados con el prefijo .cdx-) */
function ScopedStyles() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@800;900&family=Lora:ital,wght@0,400;0,500;1,400&display=swap');
.cdx-blog{--v:#7c3aed;--b:#2563eb;--ink:#111827;--muted:#6b7280;--line:#e5e7eb;background:#f8fafc;min-height:60vh}
.cdx-loading{max-width:1120px;margin:0 auto;padding:80px 20px;text-align:center;color:var(--muted);font-weight:600}
.cdx-progress{position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,#2563eb,#7c3aed,#9333ea);z-index:60;transition:width .1s linear}
.cdx-wrap{max-width:1120px;margin:0 auto;padding:28px 20px 60px;display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:40px;align-items:start}
.cdx-article{background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 6px 30px rgba(15,23,42,.05)}
.cdx-cover{width:100%;aspect-ratio:16/9;object-fit:cover;background:#eef2f7;display:block}
.cdx-pad{padding:32px 34px 40px}
.cdx-kicker{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--v);margin-bottom:12px}
.cdx-h1{font-family:'Inter',system-ui,sans-serif;font-size:clamp(2.1rem,5.2vw,3.6rem);font-weight:900;line-height:1.08;color:var(--ink);letter-spacing:-.035em;margin-bottom:18px;text-wrap:balance}
.cdx-meta{display:flex;align-items:center;gap:12px;font-size:13.5px;color:var(--muted);margin-bottom:26px;padding-bottom:24px;border-bottom:1px solid var(--line)}
.cdx-avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;flex-shrink:0}
.cdx-who{display:flex;flex-direction:column;gap:2px}
.cdx-name{font-weight:700;color:var(--ink);font-size:14px}
.cdx-sub{font-size:12.5px;color:var(--muted)}
.cdx-content{font-family:'Lora',Georgia,serif;font-size:19px;line-height:1.78;color:#33404f;max-width:68ch}
.cdx-content p{margin:0 0 22px}
.cdx-content .lede{font-size:22px;line-height:1.6;color:var(--ink);font-weight:500;margin-bottom:26px}
.cdx-content strong{color:var(--ink);font-weight:600}
.cdx-content blockquote{font-family:'Inter',system-ui,sans-serif;font-size:1.4rem;line-height:1.35;font-weight:700;color:var(--ink);letter-spacing:-.02em;margin:32px 0;padding:6px 0 6px 22px;border-left:4px solid var(--v)}
.cdx-content h2{font-family:'Inter',system-ui,sans-serif;font-size:1.55rem;font-weight:800;color:var(--ink);margin:40px 0 16px;letter-spacing:-.02em;line-height:1.2}
.cdx-content ul,.cdx-content ol{margin:0 0 20px 22px}
.cdx-content li{margin-bottom:8px}
.cdx-content img{border-radius:12px;margin:24px 0}
.cdx-content a{color:var(--b);text-decoration:underline}
.cdx-share{display:flex;align-items:center;gap:14px;margin:34px 0 4px;padding-top:24px;border-top:1px solid var(--line)}
.cdx-share-label{font-size:13px;font-weight:700;color:var(--ink)}
.cdx-share-btns{display:flex;gap:10px;flex-wrap:wrap;align-items:center;position:relative}
.cdx-sb{width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:none;cursor:pointer;color:#fff;transition:transform .15s,opacity .15s}
.cdx-sb:hover{transform:translateY(-2px);opacity:.92}
.cdx-sb svg{width:19px;height:19px}
.cdx-wa{background:#25d366}.cdx-fb{background:#1877f2}.cdx-x{background:#000}.cdx-li{background:#0a66c2}.cdx-copy{background:#6b7280}.cdx-copy.copied{background:#16a34a}
.cdx-copied-tip{font-size:12.5px;font-weight:600;color:#16a34a}
.cdx-sidebar{position:sticky;top:92px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px 18px;box-shadow:0 6px 30px rgba(15,23,42,.05)}
.cdx-sidebar h3{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--line)}
.cdx-slist{list-style:none;display:flex;flex-direction:column;gap:4px;margin:0;padding:0}
.cdx-slist li button{width:100%;text-align:left;background:none;border:none;cursor:pointer;display:flex;gap:12px;padding:9px;border-radius:12px;transition:background .15s}
.cdx-slist li button:hover{background:#f3f4f6}
.cdx-slist li.active button{background:#f5f3ff}
.cdx-slist img{width:64px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#eef2f7}
.cdx-s-meta{display:flex;flex-direction:column;gap:3px;min-width:0}
.cdx-s-title{font-size:13px;font-weight:600;color:var(--ink);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cdx-s-date{font-size:11.5px;color:var(--muted)}
@media(max-width:900px){
  .cdx-wrap{grid-template-columns:1fr;gap:28px}
  .cdx-sidebar{position:static;top:auto}
  .cdx-pad{padding:24px 22px 32px}
  .cdx-content{font-size:17px}
}
`}</style>
  );
}
