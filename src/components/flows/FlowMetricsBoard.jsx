import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart3, RefreshCw, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { getFlowTagMetrics } from '../../services/flowsService';

// Tablero de métricas estilo split-flap (letras de aeropuerto / relojes de tarjetas):
// cuántos candidatos llegaron por ETIQUETA en el rango elegido. Los números "voltean"
// mecánicamente al cambiar. Es un widget GLOBAL flotante (se ve en todas las secciones),
// arrastrable a cualquier parte y redimensionable desde la esquina (encoge todo).
// Datos: /api/flows?mode=tag_metrics (contadores agregados, no escanea candidatos).

const FILTERS = [
    { key: 'hoy', label: 'Hoy' },
    { key: 'ayer', label: 'Ayer' },
    { key: 'semana', label: 'Semana' },
    { key: 'mes', label: 'Mes' },
    { key: 'rango', label: 'Rango' }
];

const LS = { pos: 'cfm:board:pos', scale: 'cfm:board:scale', collapsed: 'cfm:board:collapsed' };
const MIN_SCALE = 0.55;
const MAX_SCALE = 1.4;

const mtyToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });

const loadLS = (key, fallback) => {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
};
const saveLS = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } };

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
    const [scale, setScale] = useState(() => {
        const s = Number(loadLS(LS.scale, 1));
        return Number.isFinite(s) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)) : 1;
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

    // Reencaja si la ventana se hace más chica y el widget queda fuera.
    useEffect(() => {
        const onResize = () => setPos(p => clampPos(p.x, p.y));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

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

    // Redimensionar (escala TODO) desde la esquina inferior derecha.
    const onResizeStart = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        resizeRef.current = { startX: e.clientX, startY: e.clientY, origScale: scale };
        const onMove = (ev) => {
            const r = resizeRef.current; if (!r) return;
            const delta = ((ev.clientX - r.startX) + (ev.clientY - r.startY)) / 2 / 320;
            setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, r.origScale + delta)));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            setScale(s => { saveLS(LS.scale, s); return s; });
            resizeRef.current = null;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [scale]);

    const toggleCollapsed = () => setCollapsed(c => { const n = !c; saveLS(LS.collapsed, n); return n; });

    const stop = (e) => e.stopPropagation();

    return (
        <div
            className="cfm-root"
            style={{ left: pos.x, top: pos.y, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
            <style>{CFM_STYLES}</style>
            <div className="cfm-board">
                <div className="cfm-board__head" onPointerDown={onDragStart}>
                    <div className="cfm-board__title">
                        <GripVertical className="w-3.5 h-3.5 cfm-grip" />
                        <BarChart3 className="w-3.5 h-3.5" />
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
                    </>
                )}

                <div className="cfm-resize" onPointerDown={onResizeStart} title="Redimensionar" />
            </div>
        </div>
    );
};

const CFM_STYLES = `
.cfm-root { position: fixed; z-index: 150; }
.cfm-board {
    position: relative;
    background: linear-gradient(180deg, #1c1c1e 0%, #121214 100%);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05);
    padding: 10px 12px;
    max-width: min(72vw, 760px);
    user-select: none;
}
.cfm-board__head { display:flex; align-items:center; justify-content:space-between; gap:12px; cursor: grab; }
.cfm-board__head:active { cursor: grabbing; }
.cfm-grip { color:#5b616b; margin-right:-2px; }
.cfm-board__title { display:flex; align-items:center; gap:7px; color:#cbd0d8; font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
.cfm-total { margin-left:4px; }
.cfm-board__actions { display:flex; gap:4px; cursor: default; }
.cfm-icon-btn { display:flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:8px; color:#9aa1ac; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); }
.cfm-icon-btn:hover { color:#e5e7eb; background:rgba(255,255,255,0.09); }
.cfm-spin svg { animation: cfm-rotate .8s linear infinite; }
@keyframes cfm-rotate { to { transform: rotate(360deg); } }

.cfm-filters { display:flex; align-items:center; gap:6px; margin-top:10px; flex-wrap:wrap; }
.cfm-chip { font-size:11px; font-weight:600; color:#aab0ba; padding:4px 10px; border-radius:999px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); }
.cfm-chip:hover { color:#e5e7eb; }
.cfm-chip--on { color:#0b0b0c; background:#f5e9c8; border-color:#f5e9c8; }
.cfm-daterange { display:inline-flex; align-items:center; gap:6px; margin-left:2px; }
.cfm-date { font-size:11px; color:#e5e7eb; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:3px 6px; color-scheme:dark; }
.cfm-date-sep { color:#7c828c; font-size:12px; }

.cfm-tiles { display:flex; gap:8px; margin-top:12px; overflow-x:auto; padding-bottom:4px; }
.cfm-tiles::-webkit-scrollbar { height:6px; }
.cfm-tiles::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.14); border-radius:3px; }

.cfm-tile { display:flex; flex-direction:column; align-items:center; gap:6px; padding:8px 10px; border-radius:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); min-width:64px; flex:0 0 auto; }
.cfm-tile--untagged { background:rgba(96,165,250,0.06); border-color:rgba(96,165,250,0.18); }
.cfm-tile__label { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#e8c98a; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cfm-tile--untagged .cfm-tile__label { color:#9cc4f7; }
.cfm-tile--skeleton { width:64px; height:56px; background:rgba(255,255,255,0.05); animation: cfm-pulse 1.2s ease-in-out infinite; }
@keyframes cfm-pulse { 0%,100% { opacity:.4; } 50% { opacity:.7; } }

.cfm-number { display:inline-flex; gap:2px; }
.cfm-digit { display:inline-block; perspective:140px; }
.cfm-digit__card {
    display:flex; align-items:center; justify-content:center;
    width:1.35rem; height:1.9rem;
    font-size:1.15rem; font-weight:800; line-height:1;
    color:#f7edd2; font-variant-numeric: tabular-nums;
    background: linear-gradient(#33343a 0%, #26272c 49%, #0e0e10 50%, #1b1c20 100%);
    border-radius:5px;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05), 0 2px 4px rgba(0,0,0,0.5);
    position:relative;
}
.cfm-total .cfm-digit__card { width:1.05rem; height:1.5rem; font-size:.9rem; }
.cfm-digit__card::after {
    content:''; position:absolute; left:0; right:0; top:50%; height:1px;
    background:rgba(0,0,0,0.65); box-shadow:0 1px 0 rgba(255,255,255,0.05);
    transform:translateY(-0.5px);
}
.cfm-digit__card--flip { animation: cfm-flap 270ms ease-in; transform-origin:center; backface-visibility:hidden; }
@keyframes cfm-flap {
    0% { transform: rotateX(0deg); }
    49% { transform: rotateX(-88deg); }
    51% { transform: rotateX(88deg); }
    100% { transform: rotateX(0deg); }
}

.cfm-empty { color:#7c828c; font-size:12px; padding:10px 4px; }
.cfm-caption { margin-top:8px; color:#7c828c; font-size:10px; letter-spacing:.03em; }

.cfm-resize {
    position:absolute; right:2px; bottom:2px; width:16px; height:16px;
    cursor: nwse-resize; border-radius:0 0 12px 0;
    background:
        linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0.28) 60%, transparent 60%,
        transparent 70%, rgba(255,255,255,0.28) 70%, rgba(255,255,255,0.28) 80%, transparent 80%);
}
`;

export default FlowMetricsBoard;
