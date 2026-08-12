import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart3, RefreshCw, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { getFlowTagMetrics } from '../../services/flowsService';

// Tablero de métricas estilo split-flap (letras de aeropuerto / relojes de tarjetas):
// cuántos candidatos llegaron por ETIQUETA en el rango elegido. Los números "voltean"
// mecánicamente al cambiar. Widget GLOBAL flotante (todas las secciones), arrastrable
// y ensanchable HACIA LA DERECHA para ver más contadores. Usa la paleta de Candidatic
// (superficie clara, azul de marca) — no negro. Datos: /api/flows?mode=tag_metrics.

const FILTERS = [
    { key: 'hoy', label: 'Hoy' },
    { key: 'ayer', label: 'Ayer' },
    { key: 'semana', label: 'Semana' },
    { key: 'mes', label: 'Mes' },
    { key: 'rango', label: 'Rango' }
];

const LS = { pos: 'cfm:board:pos', width: 'cfm:board:width', collapsed: 'cfm:board:collapsed' };
const MIN_W = 300;
const DEFAULT_W = 480;

const mtyToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });

const loadLS = (key, fallback) => {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
};
const saveLS = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } };

const maxWidthFor = (x) => Math.min(1400, Math.max(MIN_W, window.innerWidth - x - 16));

// Un dígito que voltea: a mitad del giro (edge-on, invisible) se cambia el número.
function FlapDigit({ char }) {
    const [shown, setShown] = useState(char);
    const [flipping, setFlipping] = useState(false);
    const prev = useRef(char);

    useEffect(() => {
        if (char === prev.current) return;
        prev.current = char;
        setFlipping(true);
        const mid = setTimeout(() => setShown(char), 130);
        const end = setTimeout(() => setFlipping(false), 270);
        return () => { clearTimeout(mid); clearTimeout(end); };
    }, [char]);

    return (
        <span className="cfm-digit">
            <span className={`cfm-digit__card${flipping ? ' cfm-digit__card--flip' : ''}`}>{shown}</span>
        </span>
    );
}

function FlapNumber({ value }) {
    const digits = String(Math.max(0, Number(value) || 0)).split('');
    return (
        <span className="cfm-number">
            {digits.map((d, i) => <FlapDigit key={i} char={d} />)}
        </span>
    );
}

function TagTile({ name, total, untagged }) {
    return (
        <div className={`cfm-tile${untagged ? ' cfm-tile--untagged' : ''}`} title={`${name}: ${total}`}>
            <FlapNumber value={total} />
            <span className="cfm-tile__label">{name}</span>
        </div>
    );
}

const rangeIncludesToday = (mode, desde, hasta) => {
    if (mode === 'hoy' || mode === 'semana' || mode === 'mes') return true;
    if (mode === 'ayer') return false;
    if (mode === 'rango') return !hasta || hasta >= mtyToday();
    return false;
};

const clampPos = (x, y) => ({
    x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - 60)),
    y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 40))
});

const FlowMetricsBoard = () => {
    const [mode, setMode] = useState('hoy');
    const [desde, setDesde] = useState(mtyToday());
    const [hasta, setHasta] = useState(mtyToday());
    const [metrics, setMetrics] = useState([]);
    const [total, setTotal] = useState(0);
    const [untagged, setUntagged] = useState(0);
    const [label, setLabel] = useState('');
    const [loading, setLoading] = useState(true);

    const [collapsed, setCollapsed] = useState(() => loadLS(LS.collapsed, false));
    const [pos, setPos] = useState(() => loadLS(LS.pos, { x: 84, y: 76 }));
    const [width, setWidth] = useState(() => {
        const w = Number(loadLS(LS.width, DEFAULT_W));
        return Number.isFinite(w) ? Math.max(MIN_W, w) : DEFAULT_W;
    });

    const debounceRef = useRef(null);
    const dragRef = useRef(null);
    const resizeRef = useRef(null);

    const fetchMetrics = useCallback(async () => {
        setLoading(true);
        const params = mode === 'rango' ? { desde, hasta } : { rango: mode };
        const res = await getFlowTagMetrics(params);
        if (res.success) {
            setMetrics(res.metrics.filter(m => (m.total || 0) > 0)); // ocultar tarjetas en 0
            setTotal(res.total);
            setUntagged(res.untagged || 0);
            setLabel(res.label);
        }
        setLoading(false);
    }, [mode, desde, hasta]);

    useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

    // Refresco en vivo: candidato nuevo por SSE + rango que incluye hoy → reconsulta
    // (debounced). Sin polling recurrente.
    useEffect(() => {
        if (!rangeIncludesToday(mode, desde, hasta)) return;
        const onNew = () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => { fetchMetrics(); }, 1500);
        };
        window.addEventListener('sse:candidate:new', onNew);
        return () => {
            window.removeEventListener('sse:candidate:new', onNew);
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [mode, desde, hasta, fetchMetrics]);

    // Reencaja posición/ancho si la ventana se hace más chica.
    useEffect(() => {
        const onResize = () => {
            setPos(p => clampPos(p.x, p.y));
            setWidth(w => Math.min(w, maxWidthFor(pos.x)));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [pos.x]);

    // Arrastre desde el encabezado.
    const onDragStart = useCallback((e) => {
        e.preventDefault();
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
        const onMove = (ev) => {
            const d = dragRef.current; if (!d) return;
            setPos(clampPos(d.origX + (ev.clientX - d.startX), d.origY + (ev.clientY - d.startY)));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            setPos(p => { saveLS(LS.pos, p); return p; });
            dragRef.current = null;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [pos]);

    // Ensanchar HACIA LA DERECHA (más contadores visibles), sin escalar nada.
    const onResizeStart = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        resizeRef.current = { startX: e.clientX, origW: width };
        const onMove = (ev) => {
            const r = resizeRef.current; if (!r) return;
            const next = r.origW + (ev.clientX - r.startX);
            setWidth(Math.min(maxWidthFor(pos.x), Math.max(MIN_W, next)));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            setWidth(w => { saveLS(LS.width, w); return w; });
            resizeRef.current = null;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [width, pos.x]);

    const toggleCollapsed = () => setCollapsed(c => { const n = !c; saveLS(LS.collapsed, n); return n; });

    const stop = (e) => e.stopPropagation();

    return (
        <div className="cfm-root" style={{ left: pos.x, top: pos.y }}>
            <style>{CFM_STYLES}</style>
            <div className="cfm-board" style={collapsed ? undefined : { width }}>
                <div className="cfm-board__head" onPointerDown={onDragStart}>
                    <div className="cfm-board__title">
                        <GripVertical className="w-3.5 h-3.5 cfm-grip" />
                        <BarChart3 className="w-3.5 h-3.5 cfm-title-icon" />
                        <span>Altas por etiqueta</span>
                        <span className="cfm-total"><FlapNumber value={total} /></span>
                    </div>
                    <div className="cfm-board__actions" onPointerDown={stop}>
                        <button onClick={fetchMetrics} className={`cfm-icon-btn${loading ? ' cfm-spin' : ''}`} title="Actualizar">
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={toggleCollapsed} className="cfm-icon-btn" title={collapsed ? 'Mostrar' : 'Ocultar'}>
                            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                </div>

                {!collapsed && (
                    <>
                        <div className="cfm-filters" onPointerDown={stop}>
                            {FILTERS.map(f => (
                                <button key={f.key} onClick={() => setMode(f.key)} className={`cfm-chip${mode === f.key ? ' cfm-chip--on' : ''}`}>
                                    {f.label}
                                </button>
                            ))}
                            {mode === 'rango' && (
                                <span className="cfm-daterange">
                                    <input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} className="cfm-date" />
                                    <span className="cfm-date-sep">→</span>
                                    <input type="date" value={hasta} min={desde} max={mtyToday()} onChange={e => setHasta(e.target.value)} className="cfm-date" />
                                </span>
                            )}
                        </div>

                        <div className="cfm-tiles" onPointerDown={stop}>
                            {loading && !metrics.length ? (
                                Array.from({ length: 4 }).map((_, i) => <div key={i} className="cfm-tile cfm-tile--skeleton" />)
                            ) : (metrics.length || untagged) ? (
                                <>
                                    {metrics.map(m => <TagTile key={m.name} name={m.name} total={m.total} />)}
                                    <TagTile name="Sin etiqueta" total={untagged} untagged />
                                </>
                            ) : (
                                <div className="cfm-empty">Sin altas en este rango</div>
                            )}
                        </div>
                        {!!label && <div className="cfm-caption">{label}</div>}

                        <div className="cfm-resize-x" onPointerDown={onResizeStart} title="Ensanchar hacia la derecha" />
                    </>
                )}
            </div>
        </div>
    );
};

const CFM_STYLES = `
.cfm-root { position: fixed; z-index: 150; }
.cfm-board {
    position: relative;
    background: var(--bg-card, #fff);
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 16px;
    box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.1));
    padding: 10px 12px;
    color: var(--text-primary, #1a1d29);
    user-select: none;
    min-width: ${MIN_W}px;
}
.cfm-board__head { display:flex; align-items:center; justify-content:space-between; gap:12px; cursor: grab; }
.cfm-board__head:active { cursor: grabbing; }
.cfm-grip { color: var(--text-secondary, #6b7280); opacity:.6; margin-right:-2px; }
.cfm-title-icon { color: var(--accent-brand, #3b82f6); }
.cfm-board__title { display:flex; align-items:center; gap:7px; color: var(--text-secondary, #6b7280); font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
.cfm-total { margin-left:4px; }
.cfm-board__actions { display:flex; gap:4px; cursor: default; }
.cfm-icon-btn { display:flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:8px; color: var(--text-secondary, #6b7280); background: transparent; border:1px solid var(--border-color, #e5e7eb); }
.cfm-icon-btn:hover { color: var(--accent-brand, #3b82f6); background: var(--accent-brand-light, #eff6ff); }
.cfm-spin svg { animation: cfm-rotate .8s linear infinite; }
@keyframes cfm-rotate { to { transform: rotate(360deg); } }

.cfm-filters { display:flex; align-items:center; gap:6px; margin-top:10px; flex-wrap:wrap; }
.cfm-chip { font-size:11px; font-weight:600; color: var(--text-secondary, #6b7280); padding:4px 10px; border-radius:999px; background: var(--accent-brand-light, #eff6ff); border:1px solid var(--border-color, #e5e7eb); }
.cfm-chip:hover { color: var(--accent-brand, #3b82f6); }
.cfm-chip--on { color:#fff; background: var(--accent-brand, #3b82f6); border-color: var(--accent-brand, #3b82f6); }
.cfm-daterange { display:inline-flex; align-items:center; gap:6px; margin-left:2px; }
.cfm-date { font-size:11px; color: var(--text-primary, #1a1d29); background: var(--bg-secondary, #fff); border:1px solid var(--border-color, #e5e7eb); border-radius:8px; padding:3px 6px; }
.cfm-date-sep { color: var(--text-secondary, #6b7280); font-size:12px; }

.cfm-tiles { display:flex; gap:8px; margin-top:12px; overflow-x:auto; padding-bottom:4px; }
.cfm-tiles::-webkit-scrollbar { height:6px; }
.cfm-tiles::-webkit-scrollbar-thumb { background: var(--border-color, #cbd5e1); border-radius:3px; }

.cfm-tile { display:flex; flex-direction:column; align-items:center; gap:6px; padding:8px 10px; border-radius:12px; background: var(--accent-brand-light, #eff6ff); border:1px solid var(--border-color, #e5e7eb); min-width:64px; flex:0 0 auto; }
.cfm-tile--untagged { background: rgba(100,116,139,0.10); }
.cfm-tile__label { font-size:10px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color: var(--accent-brand, #3b82f6); max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cfm-tile--untagged .cfm-tile__label { color: #64748b; }
.cfm-tile--skeleton { width:64px; height:56px; background: var(--accent-brand-light, #eff6ff); animation: cfm-pulse 1.2s ease-in-out infinite; }
@keyframes cfm-pulse { 0%,100% { opacity:.5; } 50% { opacity:.85; } }

.cfm-number { display:inline-flex; gap:2px; }
.cfm-digit { display:inline-block; perspective:140px; }
.cfm-digit__card {
    display:flex; align-items:center; justify-content:center;
    width:1.35rem; height:1.9rem;
    font-size:1.15rem; font-weight:800; line-height:1;
    color:#fff; font-variant-numeric: tabular-nums;
    background: linear-gradient(#5b95ff 0%, #3b82f6 49%, #2563eb 50%, #1d4ed8 100%);
    border-radius:5px;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 2px 4px rgba(37,99,235,0.30);
    position:relative;
}
.cfm-total .cfm-digit__card { width:1.05rem; height:1.5rem; font-size:.9rem; }
.cfm-tile--untagged .cfm-digit__card {
    background: linear-gradient(#94a3b8 0%, #7c8798 49%, #64748b 50%, #556072 100%);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 2px 4px rgba(100,116,139,0.30);
}
.cfm-digit__card::after {
    content:''; position:absolute; left:0; right:0; top:50%; height:1px;
    background:rgba(0,0,0,0.28); box-shadow:0 1px 0 rgba(255,255,255,0.18);
    transform:translateY(-0.5px);
}
.cfm-digit__card--flip { animation: cfm-flap 270ms ease-in; transform-origin:center; backface-visibility:hidden; }
@keyframes cfm-flap {
    0% { transform: rotateX(0deg); }
    49% { transform: rotateX(-88deg); }
    51% { transform: rotateX(88deg); }
    100% { transform: rotateX(0deg); }
}

.cfm-empty { color: var(--text-secondary, #6b7280); font-size:12px; padding:10px 4px; }
.cfm-caption { margin-top:8px; color: var(--text-secondary, #6b7280); font-size:10px; letter-spacing:.03em; }

.cfm-resize-x {
    position:absolute; top:10px; bottom:10px; right:-3px; width:10px;
    cursor: ew-resize; border-radius:6px;
}
.cfm-resize-x::after {
    content:''; position:absolute; top:50%; right:4px; transform:translateY(-50%);
    width:3px; height:26px; border-radius:3px; background: var(--border-color, #cbd5e1);
}
.cfm-resize-x:hover::after { background: var(--accent-brand, #3b82f6); }
`;

export default FlowMetricsBoard;
