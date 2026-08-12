import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart3, RefreshCw, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { getFlowTagMetrics } from '../../services/flowsService';
import { useAuthContext } from '../../contexts/AuthContext';

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

const MIN_W = 300;
const DEFAULT_W = 480;
const MIN_SCALE = 0.55;
const MAX_SCALE = 1.35;
const DEFAULT_POS = { x: 84, y: 76 };

const mtyToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });

const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(s)));

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

    // Config del tablero (posición, ancho, escala, colapsado) persistida por usuario en
    // Redis (perfil del reclutador, preferences.metricsBoard) — mismo patrón que el banco
    // de respuestas: setUser + PUT /api/users con merge superficial. Así te sigue entre
    // sesiones y dispositivos, no solo en este navegador.
    const { user, setUser } = useAuthContext();
    const savedCfg = user?.preferences?.metricsBoard || {};

    const [collapsed, setCollapsed] = useState(() => !!savedCfg.collapsed);
    const [pos, setPos] = useState(() => (savedCfg.pos && Number.isFinite(savedCfg.pos.x) ? savedCfg.pos : DEFAULT_POS));
    const [width, setWidth] = useState(() => (Number.isFinite(savedCfg.width) ? Math.max(MIN_W, savedCfg.width) : DEFAULT_W));
    const [scale, setScale] = useState(() => (Number.isFinite(savedCfg.scale) ? clampScale(savedCfg.scale) : 1));

    const debounceRef = useRef(null);
    const dragRef = useRef(null);
    const resizeRef = useRef(null);
    const scaleRef = useRef(null);
    const hydratedRef = useRef(false);

    // Si el perfil del usuario llega después del primer render, aplica su config UNA vez.
    useEffect(() => {
        if (hydratedRef.current) return;
        const cfg = user?.preferences?.metricsBoard;
        if (!cfg) return;
        hydratedRef.current = true;
        if (cfg.pos && Number.isFinite(cfg.pos.x)) setPos(cfg.pos);
        if (Number.isFinite(cfg.width)) setWidth(Math.max(MIN_W, cfg.width));
        if (Number.isFinite(cfg.scale)) setScale(clampScale(cfg.scale));
        if (typeof cfg.collapsed === 'boolean') setCollapsed(cfg.collapsed);
    }, [user?.preferences?.metricsBoard]);

    // Guarda un parche de config en el perfil del usuario (Redis) + estado local.
    const persistCfg = useCallback((patch) => {
        if (!user?.id) return;
        const nextBoard = { ...(user.preferences?.metricsBoard || {}), ...patch };
        const nextPreferences = { ...(user.preferences || {}), metricsBoard: nextBoard };
        setUser(prev => prev ? { ...prev, preferences: nextPreferences } : prev);
        fetch('/api/users', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, preferences: nextPreferences })
        }).catch(() => {});
    }, [user?.id, user?.preferences, setUser]);

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
            setPos(p => { persistCfg({ pos: p }); return p; });
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
            setWidth(w => { persistCfg({ width: w }); return w; });
            resizeRef.current = null;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [width, pos.x]);

    // Escalar TODO (encoger/agrandar) desde la esquina inferior derecha.
    const onScaleStart = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        scaleRef.current = { startX: e.clientX, startY: e.clientY, origScale: scale };
        const onMove = (ev) => {
            const r = scaleRef.current; if (!r) return;
            const delta = ((ev.clientX - r.startX) + (ev.clientY - r.startY)) / 2 / 320;
            setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, r.origScale + delta)));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            setScale(s => { persistCfg({ scale: s }); return s; });
            scaleRef.current = null;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [scale]);

    const toggleCollapsed = () => setCollapsed(c => { const n = !c; persistCfg({ collapsed: n }); return n; });

    const stop = (e) => e.stopPropagation();

    return (
        <div className="cfm-root" style={{ left: pos.x, top: pos.y, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <style>{CFM_STYLES}</style>
            <div className="cfm-board" style={collapsed ? undefined : { minWidth: width }}>
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
                        <div className="cfm-resize" onPointerDown={onScaleStart} title="Encoger / agrandar todo" />
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
    /* El tablero crece a lo ancho para que TODOS los contadores quepan en una sola línea
       (max-content = tan ancho como su fila más ancha, que es la de tarjetas). El ancho
       persistido del usuario actúa como piso (min-width, se aplica inline). Solo si la
       fila superara el ancho de la pantalla entra el scroll horizontal de .cfm-tiles. */
    width: max-content;
    min-width: ${MIN_W}px;
    max-width: calc(100vw - 24px);
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
.cfm-chip { font-size:11px; font-weight:600; color: var(--text-secondary, #6b7280); padding:4px 10px; border-radius:999px; background: transparent; border:1px solid var(--border-color, #e5e7eb); transition: background .12s ease, color .12s ease, border-color .12s ease; }
.cfm-chip:hover { background: var(--accent-brand-light, #eff6ff); color: var(--text-primary, #1a1d29); border-color: var(--accent-brand, #3b82f6); }
.cfm-chip--on, .cfm-chip--on:hover { color:#fff; background: var(--accent-brand, #3b82f6); border-color: var(--accent-brand, #3b82f6); }
.cfm-daterange { display:inline-flex; align-items:center; gap:6px; margin-left:2px; }
.cfm-date { font-size:11px; color: var(--text-primary, #1a1d29); background: var(--bg-secondary, #fff); border:1px solid var(--border-color, #e5e7eb); border-radius:8px; padding:3px 6px; }
.cfm-date-sep { color: var(--text-secondary, #6b7280); font-size:12px; }

/* Una sola LÍNEA de contadores: no se envuelven en varias filas — el tablero se
   ensancha hacia la derecha (o se desliza horizontal) para ver más. */
.cfm-tiles { display:flex; flex-wrap:nowrap; gap:8px; margin-top:12px; overflow-x:auto; overflow-y:hidden; padding-bottom:4px; scrollbar-width:thin; scrollbar-color: var(--border-color, #cbd5e1) transparent; }
.cfm-tiles::-webkit-scrollbar { height:6px; }
.cfm-tiles::-webkit-scrollbar-thumb { background: var(--border-color, #cbd5e1); border-radius:3px; }
.cfm-tiles::-webkit-scrollbar-track { background: transparent; }

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
    position:absolute; top:10px; bottom:26px; right:-3px; width:10px;
    cursor: ew-resize; border-radius:6px;
}
.cfm-resize-x::after {
    content:''; position:absolute; top:50%; right:4px; transform:translateY(-50%);
    width:3px; height:26px; border-radius:3px; background: var(--border-color, #cbd5e1);
}
.cfm-resize-x:hover::after { background: var(--accent-brand, #3b82f6); }

.cfm-resize {
    position:absolute; right:1px; bottom:1px; width:16px; height:16px;
    cursor: nwse-resize; border-radius:0 0 14px 0;
    background:
        linear-gradient(135deg, transparent 45%, var(--border-color, #cbd5e1) 45%, var(--border-color, #cbd5e1) 55%, transparent 55%,
        transparent 68%, var(--border-color, #cbd5e1) 68%, var(--border-color, #cbd5e1) 78%, transparent 78%);
}
.cfm-resize:hover {
    background:
        linear-gradient(135deg, transparent 45%, var(--accent-brand, #3b82f6) 45%, var(--accent-brand, #3b82f6) 55%, transparent 55%,
        transparent 68%, var(--accent-brand, #3b82f6) 68%, var(--accent-brand, #3b82f6) 78%, transparent 78%);
}
`;

export default FlowMetricsBoard;
