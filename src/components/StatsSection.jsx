import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { RefreshCw, BarChart3, Users, Venus, Mars, CalendarClock, MapPin, GraduationCap, CheckCircle2, CircleDashed } from 'lucide-react';
import { getOverviewStats } from '../services/statsService';

/* ─── Anti-brinco: caché a nivel de módulo (stale-while-revalidate) ──────────── */
let statsCache = null;

/* ─── Paleta categórica validada (dataviz skill) — light/dark vía var CSS ─────── */
// Ver <style> más abajo: .stats-root define las --sN light, .dark .stats-root las dark.
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const NEUTRAL = 'var(--s-neutral)'; // pista "resto" / "Otros"

const fmt = (n) => new Intl.NumberFormat('es-MX').format(n || 0);
const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
const pctStr = (part, whole) => `${pct(part, whole).toFixed(pct(part, whole) < 10 ? 1 : 0)}%`;

function usePrefersReducedMotion() {
    const [reduced, setReduced] = useState(
        () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
    useEffect(() => {
        const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (!mq) return;
        const on = (e) => setReduced(e.matches);
        mq.addEventListener?.('change', on);
        return () => mq.removeEventListener?.('change', on);
    }, []);
    return reduced;
}

/* ─── Donut animado (SVG puro) ───────────────────────────────────────────────
 * Un anillo de segmentos con pathLength=100 (matemática en %). El "draw-in" se
 * anima transicionando stroke-dasharray desde `0 100`, con stagger por segmento.
 * Hover: resalta la rebanada, atenúa el resto y proyecta el dato al centro.
 * ──────────────────────────────────────────────────────────────────────────── */
function Donut({ segments, centerTop, centerBottom, active, setActive, reduced }) {
    const [drawn, setDrawn] = useState(reduced);
    useEffect(() => {
        if (reduced) { setDrawn(true); return; }
        const id = requestAnimationFrame(() => setDrawn(true));
        return () => cancelAnimationFrame(id);
    }, [reduced]);

    const GAP = 1.4; // separación entre rebanadas (unidades de pathLength=100)
    const total = segments.reduce((a, s) => a + s.value, 0);
    const arcs = segments.reduce((acc, s, i) => {
        const frac = total > 0 ? (s.value / total) * 100 : 0;
        const dash = Math.max(frac - GAP, 0.0001);
        const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].frac : 0;
        acc.push({ ...s, i, dash, offset, frac });
        return acc;
    }, []);

    // Dato mostrado al centro (rebanada activa si la hay).
    const hovered = active != null ? arcs.find((a) => a.i === active) : null;
    const top = hovered ? hovered.label : centerTop;
    const bottom = hovered ? `${fmt(hovered.value)} · ${pctStr(hovered.value, total)}` : centerBottom;

    return (
        <div className="relative mx-auto" style={{ width: 168, height: 168 }}>
            <svg viewBox="0 0 42 42" className="w-full h-full -rotate-90" role="img">
                {/* pista de fondo */}
                <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--track)" strokeWidth="5.2" />
                {arcs.map((a) => {
                    const isActive = active === a.i;
                    const dim = active != null && !isActive;
                    return (
                        <circle
                            key={a.i}
                            cx="21"
                            cy="21"
                            r="15.9155"
                            fill="none"
                            stroke={a.color}
                            strokeWidth={isActive ? 6.4 : 5.2}
                            strokeLinecap="butt"
                            pathLength="100"
                            strokeDasharray={drawn ? `${a.dash} ${100 - a.dash}` : '0 100'}
                            strokeDashoffset={-a.offset}
                            onMouseEnter={() => setActive(a.i)}
                            onMouseLeave={() => setActive(null)}
                            style={{
                                opacity: dim ? 0.32 : 1,
                                cursor: 'pointer',
                                transition: reduced
                                    ? 'opacity .2s, stroke-width .2s'
                                    : `stroke-dasharray .8s cubic-bezier(.22,1,.36,1) ${a.i * 0.09}s, opacity .2s, stroke-width .2s`,
                            }}
                        />
                    );
                })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4 text-center">
                <span className="text-2xl font-bold text-gray-900 dark:text-white leading-none tabular-nums">{top}</span>
                <span className="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 leading-tight">{bottom}</span>
            </div>
        </div>
    );
}

/* ─── Tarjeta de una gráfica ─────────────────────────────────────────────────── */
function ChartCard({ title, icon, segments, centerTop, centerBottom, reduced, loading }) {
    const Icon = icon || BarChart3;
    const [active, setActive] = useState(null);
    const total = segments.reduce((a, s) => a + s.value, 0);
    const hasData = total > 0;

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/70 rounded-2xl shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700/60 flex items-center justify-center shrink-0">
                    <Icon size={16} className="text-gray-500 dark:text-gray-300" />
                </span>
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 leading-tight">{title}</h3>
            </div>

            {loading ? (
                <div className="flex items-center justify-center" style={{ height: 168 }}>
                    <div className="w-[168px] h-[168px] rounded-full border-[9px] border-gray-100 dark:border-gray-700 animate-pulse" />
                </div>
            ) : !hasData ? (
                <div className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500" style={{ height: 168 }}>
                    Sin datos
                </div>
            ) : (
                <Donut
                    segments={segments}
                    centerTop={centerTop}
                    centerBottom={centerBottom}
                    active={active}
                    setActive={setActive}
                    reduced={reduced}
                />
            )}

            {/* Leyenda con valores SIEMPRE visibles (relief rule: contraste light) */}
            {hasData && (
                <ul className="mt-4 space-y-1.5">
                    {segments.map((s, i) => {
                        const isActive = active === i;
                        return (
                            <li
                                key={s.label + i}
                                onMouseEnter={() => setActive(i)}
                                onMouseLeave={() => setActive(null)}
                                className={`flex items-center gap-2 text-xs rounded-md px-1.5 py-1 -mx-1.5 cursor-default transition-colors ${isActive ? 'bg-gray-50 dark:bg-gray-700/50' : ''}`}
                            >
                                <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white dark:ring-gray-800" style={{ background: s.color }} />
                                <span className="flex-1 min-w-0 truncate text-gray-600 dark:text-gray-300">{s.label}</span>
                                <span className="tabular-nums font-medium text-gray-900 dark:text-white">{fmt(s.value)}</span>
                                <span className="tabular-nums text-gray-400 dark:text-gray-500 w-11 text-right">{pctStr(s.value, total)}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

/* ─── Sección Statics ────────────────────────────────────────────────────────── */
export default function StatsSection() {
    const reduced = usePrefersReducedMotion();
    const [data, setData] = useState(() => statsCache);
    const [loading, setLoading] = useState(() => !statsCache);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const mounted = useRef(true);

    const load = useCallback(async (refresh = false) => {
        if (refresh) setRefreshing(true);
        else if (!statsCache) setLoading(true); // no re-encender skeleton si hay caché
        const res = await getOverviewStats(refresh);
        if (!mounted.current) return;
        if (res.success) {
            setData(res);
            statsCache = res;
            setError(null);
        } else {
            setError(res.error || 'Error');
        }
        setLoading(false);
        setRefreshing(false);
    }, []);

    useEffect(() => {
        mounted.current = true;
        load(false); // revalida en silencio (siembra desde caché de módulo)
        return () => { mounted.current = false; };
    }, [load]);

    const total = data?.total || 0;

    // Definición declarativa de las 7 gráficas.
    const charts = useMemo(() => {
        if (!data) return [];
        const distrib = (arr = []) => arr.map((s, i) => ({
            label: s.label,
            value: s.value,
            color: s.label === 'Otros' || s.label === 'Sin dato' ? NEUTRAL : SERIES[i % SERIES.length],
        }));

        return [
            {
                key: 'mujeres', title: 'Mujeres vs Total', icon: Venus,
                segments: [{ label: 'Mujeres', value: data.mujeres, color: SERIES[2] }, { label: 'Otros', value: Math.max(total - data.mujeres, 0), color: NEUTRAL }],
                centerTop: pctStr(data.mujeres, total), centerBottom: `${fmt(data.mujeres)} mujeres`,
            },
            {
                key: 'hombres', title: 'Hombres vs Total', icon: Mars,
                segments: [{ label: 'Hombres', value: data.hombres, color: SERIES[0] }, { label: 'Otros', value: Math.max(total - data.hombres, 0), color: NEUTRAL }],
                centerTop: pctStr(data.hombres, total), centerBottom: `${fmt(data.hombres)} hombres`,
            },
            {
                key: 'edades', title: 'Edades · proporción del total', icon: CalendarClock,
                segments: distrib(data.edades), centerTop: fmt((data.edades || []).reduce((a, s) => a + s.value, 0)), centerBottom: 'con edad',
            },
            {
                key: 'municipio', title: 'Por municipio de Nuevo León', icon: MapPin,
                segments: distrib(data.municipio), centerTop: fmt((data.municipio || []).reduce((a, s) => a + s.value, 0)), centerBottom: 'ubicados',
            },
            {
                key: 'escolaridad', title: 'Por escolaridad', icon: GraduationCap,
                segments: distrib(data.escolaridad), centerTop: fmt((data.escolaridad || []).reduce((a, s) => a + s.value, 0)), centerBottom: 'con dato',
            },
            {
                key: 'completos', title: 'Perfiles completos', icon: CheckCircle2,
                segments: [{ label: 'Completos', value: data.completos, color: SERIES[1] }, { label: 'Restantes', value: Math.max(total - data.completos, 0), color: NEUTRAL }],
                centerTop: pctStr(data.completos, total), centerBottom: `${fmt(data.completos)} completos`,
            },
            {
                key: 'incompletos', title: 'Perfiles incompletos', icon: CircleDashed,
                segments: [{ label: 'Incompletos', value: data.incompletos, color: SERIES[5] }, { label: 'Completos', value: Math.max(total - data.incompletos, 0), color: NEUTRAL }],
                centerTop: pctStr(data.incompletos, total), centerBottom: `${fmt(data.incompletos)} incompletos`,
            },
        ];
    }, [data, total]);

    const updatedLabel = data?.generatedAt
        ? new Date(data.generatedAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Monterrey' })
        : null;

    return (
        <div className="stats-root h-full overflow-y-auto bg-gray-50 dark:bg-gray-900">
            <style>{STATS_CSS}</style>

            {/* Encabezado */}
            <div className="px-5 sm:px-6 pt-5 pb-3 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 mr-auto">
                    <div className="w-9 h-9 rounded-xl bg-gray-900 dark:bg-white/10 flex items-center justify-center">
                        <BarChart3 size={18} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">Estadísticas</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {loading ? 'Cargando…' : (
                                <><span className="font-semibold text-gray-700 dark:text-gray-300">{fmt(total)}</span> candidatos{updatedLabel ? ` · act. ${updatedLabel}` : ''}</>
                            )}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => load(true)}
                    disabled={refreshing || loading}
                    className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 disabled:opacity-50 transition-colors"
                >
                    <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
                    Actualizar
                </button>
            </div>

            {error && !data && (
                <div className="mx-5 sm:mx-6 mb-4 rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Rejilla de gráficas */}
            <div className="px-5 sm:px-6 pb-8 grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {(loading && !data ? Array.from({ length: 7 }) : charts).map((c, i) => (
                    <ChartCard
                        key={c?.key || i}
                        title={c?.title || ''}
                        icon={c?.icon || BarChart3}
                        segments={c?.segments || []}
                        centerTop={c?.centerTop}
                        centerBottom={c?.centerBottom}
                        reduced={reduced}
                        loading={loading && !data}
                    />
                ))}
            </div>
        </div>
    );
}

/* ─── Tokens de color (light/dark) — paleta categórica validada ──────────────── */
const STATS_CSS = `
.stats-root {
  --s1:#2a78d6; --s2:#008300; --s3:#e87ba4; --s4:#eda100;
  --s5:#1baf7a; --s6:#eb6834; --s7:#4a3aa7; --s8:#e34948;
  --s-neutral:#d7d9de; --track:#eef0f3;
}
.dark .stats-root {
  --s1:#3987e5; --s2:#008300; --s3:#d55181; --s4:#c98500;
  --s5:#199e70; --s6:#d95926; --s7:#9085e9; --s8:#e66767;
  --s-neutral:#3a3f47; --track:#2a2e35;
}
`;
