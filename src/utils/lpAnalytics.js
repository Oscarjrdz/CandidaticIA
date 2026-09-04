/**
 * Analítica de la landing (lado cliente). Se llama UNA vez cuando se muestra la
 * landing a un visitante no logueado (ver App.jsx). Documentación del motor y el
 * modelo de datos: docs/contador-visitas-landing.md
 *
 * Manda 2 latidos al endpoint /api/lp/visit:
 *   1) 'view'   al cargar        → fetch keepalive (vid, sid, referrer, utm)
 *   2) 'engage' al salir/ocultar → navigator.sendBeacon (duración, clics, scroll máximo)
 *
 * Exclusión propia (mi compu): si localStorage.lp_optout está puesto, NO cuenta.
 * Se activa visitando la landing con ?notrack (una sola vez por dispositivo).
 *
 * Idempotente: cuenta una sola visita por sesión de pestaña (sessionStorage).
 * Todo es fire-and-forget: jamás debe frenar ni romper la landing.
 */

const OPTOUT_KEY = 'lp_optout';
const VID_KEY = 'lp_vid';
const SESSION_FLAG = 'lp_visit_tracked';

function uuid() {
    try {
        if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    } catch { /* noop */ }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

// Devuelve una función de limpieza (para remover listeners si el componente se desmonta).
export function trackLandingVisit() {
    const noop = () => {};
    try {
        // ?notrack → marca este dispositivo como excluido para siempre.
        if (new URLSearchParams(window.location.search).has('notrack')) {
            localStorage.setItem(OPTOUT_KEY, '1');
        }
        if (localStorage.getItem(OPTOUT_KEY)) return noop; // mi compu: no contar
        if (sessionStorage.getItem(SESSION_FLAG)) return noop; // ya contada esta sesión
        sessionStorage.setItem(SESSION_FLAG, '1');
    } catch {
        // Sin storage (modo privado extremo): seguimos, pero sin dedupe por sesión.
    }

    // vid persistente por dispositivo (detecta visitantes que regresan).
    let vid = '';
    try {
        vid = localStorage.getItem(VID_KEY) || '';
        if (!vid) { vid = uuid(); localStorage.setItem(VID_KEY, vid); }
    } catch {
        vid = uuid();
    }
    const sid = uuid();
    const start = Date.now();
    let clicks = 0;
    let maxScroll = 0;

    const onClick = () => { clicks += 1; };
    const onScroll = () => {
        const el = document.documentElement;
        const denom = el.scrollHeight - el.clientHeight;
        const pct = denom > 0 ? Math.round((el.scrollTop / denom) * 100) : 0;
        if (pct > maxScroll) maxScroll = Math.min(100, pct);
    };
    document.addEventListener('click', onClick, { passive: true, capture: true });
    window.addEventListener('scroll', onScroll, { passive: true });

    // 1) pageview al cargar
    let utm = '';
    try { utm = new URLSearchParams(window.location.search).get('utm_source') || ''; } catch { /* noop */ }
    try {
        fetch('/api/lp/visit', {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ t: 'view', vid, sid, ref: document.referrer || '', utm }),
        }).catch(() => {});
    } catch { /* noop */ }

    // 2) engagement al salir (una sola vez)
    let sent = false;
    const sendEngage = () => {
        if (sent) return;
        sent = true;
        const payload = JSON.stringify({
            t: 'engage', vid, sid,
            dur: Math.round((Date.now() - start) / 1000),
            clk: clicks,
            scr: maxScroll,
        });
        try {
            const blob = new Blob([payload], { type: 'application/json' });
            if (navigator.sendBeacon && navigator.sendBeacon('/api/lp/visit', blob)) return;
        } catch { /* cae al fetch */ }
        try {
            fetch('/api/lp/visit', {
                method: 'POST', keepalive: true,
                headers: { 'Content-Type': 'application/json' }, body: payload,
            }).catch(() => {});
        } catch { /* noop */ }
    };

    const onHide = () => { if (document.visibilityState === 'hidden') sendEngage(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', sendEngage);

    return () => {
        document.removeEventListener('click', onClick, { capture: true });
        window.removeEventListener('scroll', onScroll);
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', sendEngage);
        sendEngage(); // si el componente se desmonta (ej. login), captura el engagement
    };
}
