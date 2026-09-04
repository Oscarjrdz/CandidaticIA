/**
 * Motor de analítica de la landing principal (candidatic.com) — nivel premium.
 * Documentación completa del modelo de datos y decisiones: docs/contador-visitas-landing.md
 *
 *   POST /api/lp/visit               → registra evento (público). Body: { t, vid, sid, ... }
 *   GET  /api/lp/visit               → contadores públicos para el footer { total, new, returning, unique }
 *   GET  /api/lp/visit?report=1      → reporte completo (requiere sesión admin)
 *   GET  /api/lp/visit?ignoreme=1    → agrega TU IP actual a la lista de ignorados (admin)
 *
 * ── Cómo se captura (2 latidos desde el cliente, ver src/utils/lpAnalytics.js) ──
 *   1) 'view'   al cargar la landing (fetch keepalive): vid, sid, referrer, utm.
 *   2) 'engage' al salir (navigator.sendBeacon): duración, clics, scroll máximo.
 *   El server completa IP (x-forwarded-for), país (x-vercel-ip-country), dispositivo y bot-check (UA).
 *
 * ── Privacy / exclusión propia ──
 *   - Opt-out por dispositivo: el cliente no dispara si localStorage.lp_optout está puesto (?notrack).
 *   - Ignore por IP: lp:ignore:ips (SET). Se checa server-side antes de contar.
 *
 * ── Barato por diseño ──
 *   - Bots se descartan ANTES de tocar Redis (regex en memoria).
 *   - Todo va en UN pipeline (un round-trip). EXPIRE de llaves diarias solo la 1ª visita del día.
 *   - SADD lp:visitors:all vid da "nuevo vs recurrente" en un solo comando (su retorno).
 *   - Únicos = vid persistente en localStorage (no requiere hashear IP por visita).
 *
 * ── Llaves en Redis (zona Monterrey, TTL 400d salvo los totales que son ∞) ──
 *   lp:total                 INCR   vistas acumuladas
 *   lp:new:total / lp:ret:total  INCR   vistas nuevas / de regreso, acumuladas
 *   lp:daily:DÍA             INCR   vistas por día
 *   lp:new:DÍA / lp:ret:DÍA  INCR   nuevas / regreso por día
 *   lp:unique:DÍA            HLL    visitantes únicos por día (PFADD vid)
 *   lp:visitors:all          SET    todos los vid vistos (SCARD = únicos histórico)
 *   lp:ref:DÍA/utm:DÍA/geo:DÍA/dev:DÍA  HASH  desglose por origen/utm/país/dispositivo
 *   lp:eng:DÍA               HASH   sumas de duración/clics/scroll + # sesiones (para promedios)
 *   lp:visitor:VID           HASH   perfil: first,last,visits,ip,ref,geo,dev,clk,dur
 *   lp:visitor:VID:ips       SET    todas las IPs vistas de ese visitante
 *   lp:s:SID                 HASH   registro por visita: vid,ts,ip,ua,ref,geo,dev,utm,new,dur,clk,scr
 *   lp:ignore:ips            SET    IPs excluidas del conteo
 */

import crypto from 'node:crypto';

const K = {
    total: 'lp:total',
    newTotal: 'lp:new:total',
    retTotal: 'lp:ret:total',
    daily: (d) => `lp:daily:${d}`,
    newDay: (d) => `lp:new:${d}`,
    retDay: (d) => `lp:ret:${d}`,
    unique: (d) => `lp:unique:${d}`,
    visitorsAll: 'lp:visitors:all',
    ref: (d) => `lp:ref:${d}`,
    utm: (d) => `lp:utm:${d}`,
    geo: (d) => `lp:geo:${d}`,
    dev: (d) => `lp:dev:${d}`,
    eng: (d) => `lp:eng:${d}`,
    visitor: (v) => `lp:visitor:${v}`,
    visitorIps: (v) => `lp:visitor:${v}:ips`,
    session: (s) => `lp:s:${s}`,
    ignoreIps: 'lp:ignore:ips',
};

const TTL = 60 * 60 * 24 * 400; // ~13 meses para todo lo con caducidad
const RATE_LIMIT_MAX = 40;      // máx eventos contados por IP por minuto
// Baseline SOLO de presentación para el contador del footer: el número visible
// arranca en este valor. NO afecta los datos reales (el reporte admin sigue
// mostrando las visitas reales desde 0). Ver docs/contador-visitas-landing.md
const PUBLIC_BASELINE = 100000;
const TZ = 'America/Monterrey';

// Bots/crawlers/agentes de IA — misma familia que filtra `isbot`/Umami.
const BOT_RE = /bot|crawler|spider|crawl|slurp|mediapartners|facebookexternalhit|meta-external|whatsapp|telegram|preview|headless|phantom|puppeteer|playwright|selenium|python-requests|curl|wget|axios|go-http|scrapy|semrush|ahrefs|mj12|dotbot|bytespider|gptbot|claudebot|ccbot|google-extended|amazonbot|applebot|petalbot|dataforseo/i;

function dayMty(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}

function clientIp(req) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd || req.socket?.remoteAddress || 'unknown';
}

function deviceType(ua) {
    if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet';
    if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini/i.test(ua)) return 'mobile';
    return 'desktop';
}

// Referrer → dominio limpio. Vacío = 'directo'; mismo sitio = 'interno'.
function refHost(ref) {
    if (!ref) return 'directo';
    try {
        const h = new URL(ref).hostname.replace(/^www\./, '').toLowerCase();
        if (!h) return 'directo';
        if (h.endsWith('candidatic.com')) return 'interno';
        return h.slice(0, 100);
    } catch {
        return 'directo';
    }
}

function readBody(req) {
    const b = req.body;
    if (!b) return {};
    if (typeof b === 'string') { try { return JSON.parse(b); } catch { return {}; } }
    return b;
}

const clampInt = (v, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || 0));
const sanitizeId = (v) => String(v || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

export default async function handler(req, res) {
    const { getRedisClient } = await import('../utils/storage.js');
    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    // ────────────────────────────── POST: registrar evento ──────────────────────────────
    if (req.method === 'POST') {
        try {
            const ua = String(req.headers['user-agent'] || '');
            if (!ua || BOT_RE.test(ua)) return res.status(204).end(); // 1) filtro de bots

            const ip = clientIp(req);
            const body = readBody(req);
            const type = body.t === 'engage' ? 'engage' : 'view';
            const day = dayMty();

            // 2) exclusión propia (por IP) + rate-limit anti-abuso, en un mini-pipeline
            const minute = Math.floor(Date.now() / 60000);
            const rlKey = `lp:rl:${crypto.createHash('sha1').update(ip).digest('hex')}:${minute}`;
            const pre = await redis.pipeline()
                .sismember(K.ignoreIps, ip)
                .incr(rlKey)
                .exec();
            const ignored = pre[0][1] === 1;
            const hits = pre[1][1];
            if (hits === 1) redis.expire(rlKey, 90).catch(() => {});
            if (ignored || hits > RATE_LIMIT_MAX) return res.status(204).end();

            // vid persistente (localStorage) = identidad del visitante. Fallback: hash IP+UA del día.
            const vid = sanitizeId(body.vid) ||
                crypto.createHash('sha256').update(day + ip + ua).digest('hex').slice(0, 32);
            const sid = sanitizeId(body.sid) || crypto.randomUUID().replace(/-/g, '');

            // ── EVENTO 'engage': duración / clics / scroll al salir ──
            if (type === 'engage') {
                const dur = clampInt(body.dur, 0, 86400);   // seg, tope 24h
                const clk = clampInt(body.clk, 0, 100000);
                const scr = clampInt(body.scr, 0, 100);     // %
                const pipe = redis.pipeline();
                pipe.hset(K.session(sid), { dur, clk, scr });
                pipe.expire(K.session(sid), TTL);
                pipe.hincrby(K.eng(day), 'durSum', dur);
                pipe.hincrby(K.eng(day), 'durN', 1);
                pipe.hincrby(K.eng(day), 'clkSum', clk);
                pipe.hincrby(K.eng(day), 'scrSum', scr);
                pipe.hincrby(K.eng(day), 'sessions', 1);
                pipe.expire(K.eng(day), TTL);
                pipe.hincrby(K.visitor(vid), 'dur', dur);
                pipe.hincrby(K.visitor(vid), 'clk', clk);
                await pipe.exec();
                return res.status(204).end();
            }

            // ── EVENTO 'view': la visita ──
            const ref = refHost(body.ref || req.headers['referer'] || '');
            const utm = String(body.utm || '').trim().slice(0, 100).toLowerCase() || 'ninguno';
            const geo = String(req.headers['x-vercel-ip-country'] || 'XX').toUpperCase().slice(0, 2);
            const dev = deviceType(ua);
            const now = Date.now();

            // SADD devuelve 1 si es un vid nuevo (primera vez), 0 si ya existía (regreso).
            const isNew = (await redis.sadd(K.visitorsAll, vid)) === 1;

            const pipe = redis.pipeline();
            pipe.incr(K.total);
            pipe.incr(K.daily(day));
            pipe.pfadd(K.unique(day), vid);
            if (isNew) { pipe.incr(K.newTotal); pipe.incr(K.newDay(day)); }
            else { pipe.incr(K.retTotal); pipe.incr(K.retDay(day)); }
            pipe.hincrby(K.ref(day), ref, 1);
            pipe.hincrby(K.utm(day), utm, 1);
            pipe.hincrby(K.geo(day), geo, 1);
            pipe.hincrby(K.dev(day), dev, 1);
            // perfil del visitante (recurrencia + IPs)
            pipe.hsetnx(K.visitor(vid), 'first', now);
            pipe.hset(K.visitor(vid), { last: now, ip, ref, geo, dev });
            pipe.hincrby(K.visitor(vid), 'visits', 1);
            pipe.expire(K.visitor(vid), TTL);
            pipe.sadd(K.visitorIps(vid), ip);
            pipe.expire(K.visitorIps(vid), TTL);
            // registro individual de la visita
            pipe.hset(K.session(sid), { vid, ts: now, ip, ua: ua.slice(0, 300), ref, geo, dev, utm, new: isNew ? 1 : 0 });
            pipe.expire(K.session(sid), TTL);
            await pipe.exec();

            // EXPIRE de llaves diarias solo la 1ª visita del día (barato: 0 en el resto).
            // Se detecta releyendo daily; a 10 visitas/día el costo es nulo.
            redis.get(K.daily(day)).then((v) => {
                if (String(v) === '1') {
                    redis.pipeline()
                        .expire(K.daily(day), TTL).expire(K.unique(day), TTL)
                        .expire(K.newDay(day), TTL).expire(K.retDay(day), TTL)
                        .expire(K.ref(day), TTL).expire(K.utm(day), TTL)
                        .expire(K.geo(day), TTL).expire(K.dev(day), TTL)
                        .exec().catch(() => {});
                }
            }).catch(() => {});

            return res.status(204).end();
        } catch (e) {
            console.error('[lp-visit] track error:', e.message); // fire-and-forget: nunca romper la landing
        }
        return res.status(204).end();
    }

    // ────────────────────────────── GET ──────────────────────────────
    if (req.method === 'GET') {
        // Excluir mi IP actual (admin, un clic desde mi compu)
        if (req.query.ignoreme !== undefined) {
            try {
                const { validateAdminSession } = await import('../utils/storage.js');
                if (!(await validateAdminSession(req))) return res.status(401).json({ error: 'No autorizado' });
                const ip = clientIp(req);
                await redis.sadd(K.ignoreIps, ip);
                return res.status(200).json({ success: true, ignored: ip, message: 'Esta IP ya no se contará.' });
            } catch (e) {
                return res.status(500).json({ error: 'Internal error', details: e.message });
            }
        }

        // Reporte completo (admin)
        if (req.query.report !== undefined) {
            try {
                const { validateAdminSession } = await import('../utils/storage.js');
                if (!(await validateAdminSession(req))) return res.status(401).json({ error: 'No autorizado' });

                const days = clampInt(req.query.days, 1, 90) || 30;
                const dates = Array.from({ length: days }, (_, i) => dayMty(days - 1 - i));

                const pipe = redis.pipeline();
                pipe.get(K.total); pipe.get(K.newTotal); pipe.get(K.retTotal); pipe.scard(K.visitorsAll);
                dates.forEach((d) => pipe.get(K.daily(d)));
                dates.forEach((d) => pipe.pfcount(K.unique(d)));
                dates.forEach((d) => pipe.get(K.newDay(d)));
                dates.forEach((d) => pipe.get(K.retDay(d)));
                dates.forEach((d) => pipe.hgetall(K.ref(d)));
                dates.forEach((d) => pipe.hgetall(K.utm(d)));
                dates.forEach((d) => pipe.hgetall(K.geo(d)));
                dates.forEach((d) => pipe.hgetall(K.dev(d)));
                dates.forEach((d) => pipe.hgetall(K.eng(d)));
                const r = await pipe.exec();

                let i = 0;
                const n = () => Number(r[i++][1] || 0);
                const h = () => r[i++][1] || {};
                const total = n(), newTotal = n(), retTotal = n(), uniqueTotal = n();
                const views = dates.map(n), unique = dates.map(n), newD = dates.map(n), retD = dates.map(n);
                const refA = dates.map(h), utmA = dates.map(h), geoA = dates.map(h), devA = dates.map(h), engA = dates.map(h);

                const mergeTop = (arr, limit) => {
                    const acc = {};
                    for (const obj of arr) for (const [k, v] of Object.entries(obj)) acc[k] = (acc[k] || 0) + Number(v);
                    return Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })).slice(0, limit);
                };
                const sum = (arr, f) => arr.reduce((s, o) => s + Number(o[f] || 0), 0);
                const durSum = sum(engA, 'durSum'), durN = sum(engA, 'durN');
                const scrSum = sum(engA, 'scrSum'), scrN = sum(engA, 'sessions');
                const clkSum = sum(engA, 'clkSum');

                return res.status(200).json({
                    success: true,
                    total, newTotal, returningTotal: retTotal, uniqueVisitorsAllTime: uniqueTotal,
                    days,
                    daily: dates.map((date, k) => ({ date, views: views[k], unique: unique[k], new: newD[k], returning: retD[k] })),
                    engagement: {
                        avgDurationSec: durN ? Math.round(durSum / durN) : 0,
                        avgScrollPct: scrN ? Math.round(scrSum / scrN) : 0,
                        totalClicks: clkSum,
                    },
                    topReferrers: mergeTop(refA, 15),
                    topUtm: mergeTop(utmA, 15),
                    byCountry: mergeTop(geoA, 20),
                    byDevice: mergeTop(devA, 5),
                });
            } catch (e) {
                console.error('[lp-visit] report error:', e.message);
                return res.status(500).json({ error: 'Internal error', details: e.message });
            }
        }

        // Contadores públicos para el footer
        try {
            const r = await redis.pipeline()
                .get(K.total).get(K.newTotal).get(K.retTotal).scard(K.visitorsAll)
                .exec();
            res.setHeader('Cache-Control', 'public, max-age=60'); // 1 min de caché: barato aunque haya bots leyendo
            return res.status(200).json({
                total: PUBLIC_BASELINE + Number(r[0][1] || 0), // baseline de presentación (footer)
                new: Number(r[1][1] || 0),
                returning: Number(r[2][1] || 0),
                unique: Number(r[3][1] || 0),
            });
        } catch (e) {
            return res.status(500).json({ error: 'Internal error', details: e.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
