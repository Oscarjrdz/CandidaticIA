import React, { useState } from 'react';
import { Handle, Position, NodeToolbar, NodeResizer } from '@xyflow/react';
import { X, Play, Loader2, Check, RefreshCw, Minus, Plus, Lock, LockOpen } from 'lucide-react';
import { NODE_DEFS, COLOR_CLASSES } from './nodeDefs';

// #RRGGBB (o #RGB) + alpha → rgba(). Para pintar el fondo del BG con su transparencia.
function hexToRgba(hex, alpha) {
    const h = String(hex || '#6366f1').replace('#', '');
    const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const r = parseInt(n.slice(0, 2), 16) || 0;
    const g = parseInt(n.slice(2, 4), 16) || 0;
    const b = parseInt(n.slice(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const BG_COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];
const TEXT_COLORS = ['#111827', '#ffffff', '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

// Candado discreto por nodo: SOLO se ve al pasar el mouse (opacity-0 group-hover:opacity-100),
// para no ensuciar la vista. Cerrado = el nodo no se mueve ni se edita (el editor aplica
// draggable/deletable/readOnly según data.locked). El estado se guarda por usuario en Redis.
// El contenedor del nodo debe tener la clase `group` para el hover.
const LockToggle = ({ id, locked, onToggleLock }) => {
    if (!onToggleLock) return null;
    const Icon = locked ? Lock : LockOpen;
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onToggleLock(id); }}
            className={`nodrag absolute -top-2 -left-2 w-5 h-5 rounded-full flex items-center justify-center shadow z-20 opacity-0 group-hover:opacity-100 transition-opacity ${
                locked ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 border border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'
            }`}
            title={locked ? 'Bloqueado — clic para desbloquear (podrás moverlo y editarlo)' : 'Bloquear: no se moverá ni se editará'}
        >
            <Icon className="w-3 h-3" />
        </button>
    );
};

// ── Elemento decorativo "Fondo de sección" (bg) ────────────────────────────────
// Caja de color semitransparente y redimensionable que va DETRÁS de los nodos (su zIndex
// lo fija FlowEditor). El motor la ignora (sin handles). Estilo en un menú flotante que
// la acompaña (NodeToolbar), tamaño arrastrando las esquinas (NodeResizer).
const BgNode = ({ id, data, selected }) => {
    const color = data.color || '#6366f1';
    const opacity = typeof data.opacity === 'number' ? data.opacity : 0.14;
    const locked = !!data.locked;
    const change = (patch) => data.onElementChange?.(id, patch);
    return (
        <>
            {/* Bloqueado: sin manijas de redimensionar ni menú de estilo (no se edita). */}
            <NodeResizer isVisible={selected && !locked} minWidth={120} minHeight={80}
                lineClassName="!border-gray-400" handleClassName="!bg-white !border-2 !border-gray-400 !w-2.5 !h-2.5 !rounded-sm" />
            <NodeToolbar isVisible={selected && !locked} position={Position.Top}
                className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 px-2 py-1.5">
                <div className="flex items-center gap-1">
                    {BG_COLORS.map(c => (
                        <button key={c} type="button" onClick={() => change({ color: c })}
                            className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-1 ring-gray-500 dark:ring-offset-gray-800' : 'border border-black/10'}`}
                            style={{ backgroundColor: c }} title="Color del fondo" />
                    ))}
                </div>
                <div className="flex items-center gap-1.5 pl-2 border-l border-gray-200 dark:border-gray-700">
                    <span className="text-[10px] font-semibold text-gray-400">Opacidad</span>
                    <input type="range" min="5" max="80" value={Math.round(opacity * 100)}
                        onChange={(e) => change({ opacity: Number(e.target.value) / 100 })}
                        className="w-20 accent-gray-500 cursor-pointer" />
                </div>
                <button type="button" onClick={() => data.onDelete?.(id)}
                    className="pl-2 border-l border-gray-200 dark:border-gray-700 text-gray-400 hover:text-red-500" title="Eliminar fondo">
                    <X className="w-4 h-4" />
                </button>
            </NodeToolbar>
            <div className="group relative w-full h-full">
                <LockToggle id={id} locked={locked} onToggleLock={data.onToggleLock} />
                <div className="w-full h-full rounded-2xl border-2 border-dashed"
                    style={{ backgroundColor: hexToRgba(color, opacity), borderColor: hexToRgba(color, Math.min(1, opacity + 0.4)) }} />
            </div>
        </>
    );
};

// ── Elemento decorativo "Texto" ────────────────────────────────────────────────
// Texto libre para comentar un nodo o titular un BG. Doble-click para editar (igual que
// Figma/FigJam), single-drag para moverlo. Tamaño de letra y color en el menú flotante.
const TextoNode = ({ id, data, selected }) => {
    const [editing, setEditing] = useState(false);
    const fontSize = Number(data.fontSize) || 18;
    const color = data.color || '#111827';
    const locked = !!data.locked;
    const change = (patch) => data.onElementChange?.(id, patch);
    return (
        <>
            <NodeResizer isVisible={selected && !locked} minWidth={60} minHeight={28}
                lineClassName="!border-gray-400" handleClassName="!bg-white !border-2 !border-gray-400 !w-2.5 !h-2.5 !rounded-sm" />
            <NodeToolbar isVisible={selected && !locked} position={Position.Top}
                className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 px-2 py-1.5">
                <div className="flex items-center gap-1">
                    <button type="button" onClick={() => change({ fontSize: Math.max(10, fontSize - 2) })}
                        className="p-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" title="Más chico">
                        <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs font-semibold text-gray-500 w-6 text-center tabular-nums">{fontSize}</span>
                    <button type="button" onClick={() => change({ fontSize: Math.min(80, fontSize + 2) })}
                        className="p-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" title="Más grande">
                        <Plus className="w-3.5 h-3.5" />
                    </button>
                </div>
                <div className="flex items-center gap-1 pl-2 border-l border-gray-200 dark:border-gray-700">
                    {TEXT_COLORS.map(c => (
                        <button key={c} type="button" onClick={() => change({ color: c })}
                            className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-1 ring-gray-500 dark:ring-offset-gray-800' : 'border border-black/10'}`}
                            style={{ backgroundColor: c }} title="Color del texto" />
                    ))}
                </div>
                <button type="button" onClick={() => data.onDelete?.(id)}
                    className="pl-2 border-l border-gray-200 dark:border-gray-700 text-gray-400 hover:text-red-500" title="Eliminar texto">
                    <X className="w-4 h-4" />
                </button>
            </NodeToolbar>
            <div className="group relative w-full h-full">
                <LockToggle id={id} locked={locked} onToggleLock={data.onToggleLock} />
                {editing && !locked ? (
                    <textarea
                        autoFocus
                        value={data.text || ''}
                        onChange={(e) => change({ text: e.target.value })}
                        onBlur={() => setEditing(false)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="Escribe aquí…"
                        className="nodrag nowheel w-full h-full resize-none bg-transparent focus:outline-none leading-snug font-semibold"
                        style={{ fontSize, color }}
                    />
                ) : (
                    <div
                        onDoubleClick={locked ? undefined : () => setEditing(true)}
                        className={`w-full h-full whitespace-pre-wrap break-words leading-snug font-semibold ${locked ? 'cursor-default' : 'cursor-move'}`}
                        style={{ fontSize, color }}
                        title={locked ? 'Bloqueado' : 'Doble-click para editar'}
                    >
                        {data.text?.trim() ? data.text : <span className="opacity-40">{locked ? 'Texto' : 'Doble-click para editar'}</span>}
                    </div>
                )}
            </div>
        </>
    );
};

// Badge de resultado de la última corrida del nodo "test": verde con check si el nodo
// SÍ pasó/se ejecutó, gris con X si no se alcanzó (bloqueado por una condición previa
// o él mismo no cumplió). undefined = no hay corrida de prueba reciente, no se muestra.
const TestResultBadge = ({ testPassed }) => {
    if (testPassed === undefined) return null;
    return (
        <div
            className={`absolute -top-2 -left-2 w-5 h-5 rounded-full flex items-center justify-center text-white shadow z-10 ${testPassed ? 'bg-emerald-500' : 'bg-gray-400'}`}
            title={testPassed ? 'La última prueba SÍ llegó a este nodo' : 'La última prueba NO llegó a este nodo'}
        >
            {testPassed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
        </div>
    );
};

const InicioToggle = ({ active, onToggle }) => (
    <button
        onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
        className={`nodrag mt-2 inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
            active
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-700'
                : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'
        }`}
    >
        <span className={`w-7 h-3.5 rounded-full flex items-center px-0.5 transition-colors ${active ? 'bg-emerald-500 justify-end' : 'bg-gray-300 dark:bg-gray-500 justify-start'}`}>
            <span className="w-2.5 h-2.5 rounded-full bg-white shadow" />
        </span>
        {active ? 'Flujo activo' : 'Flujo inactivo'}
    </button>
);

const TestNodeBody = ({ id, data, colors }) => {
    const status = data.testStatus || 'idle';
    return (
        <div className="px-3 pb-3 pt-1.5 space-y-2">
            <input
                type="tel"
                value={data.testPhone || ''}
                onChange={(e) => data.onTestPhoneChange?.(id, e.target.value)}
                placeholder="Ej. 8181234567"
                className="nodrag w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
            <button
                onClick={(e) => { e.stopPropagation(); data.onTestRun?.(id, data.testPhone); }}
                disabled={status === 'running' || !data.testPhone}
                className={`nodrag w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-50 ${colors.icon}`}
            >
                {status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {status === 'running' ? 'Corriendo...' : 'Run'}
            </button>
            {data.testMessage && (
                <p className={`text-xs ${status === 'error' ? 'text-red-500' : status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                    {data.testMessage}
                </p>
            )}
        </div>
    );
};

// Nodo "inicio_lista" (flujo manual, no en vivo): botón para cargar la lista de
// candidatos que matchean el filtro configurado en el drawer, y botón Run para
// correr el resto del flujo uno por uno — reintentar (recargar / volver a dar Run)
// nunca vuelve a mandarle nada a un candidato ya marcado `executed` (dedupe real de
// producción, ver runFlowForListCandidate en flow-engine.js).
const InicioListaBody = ({ id, data, summary }) => {
    const list = Array.isArray(data.candidateList) ? data.candidateList : null;
    const status = data.listStatus || 'idle'; // idle | loading | ready | running
    const doneCount = list ? list.filter(c => c.executed).length : 0;

    return (
        <div className="px-3 pb-3 pt-1.5 space-y-2">
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{summary}</p>
            <button
                onClick={(e) => { e.stopPropagation(); data.onLoadList?.(id); }}
                disabled={status === 'loading' || status === 'running'}
                className="nodrag w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50"
            >
                {status === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {status === 'loading' ? 'Cargando…' : list ? 'Recargar lista' : 'Cargar lista'}
            </button>

            {list && (
                <>
                    <div className="nodrag nowheel max-h-40 overflow-y-auto space-y-1">
                        {list.length === 0 && <p className="text-xs text-gray-400 py-1">Nadie matchea este filtro</p>}
                        {list.map(c => (
                            <div key={c.id} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                                {c.id === data.runningCandidateId
                                    ? <Loader2 className="w-3 h-3 shrink-0 animate-spin text-indigo-500" />
                                    : c.executed
                                        ? <Check className="w-3 h-3 shrink-0 text-emerald-500" />
                                        : <span className="w-3 h-3 shrink-0 rounded-full border border-gray-300 dark:border-gray-600" />}
                                <span className="truncate">{c.nombre}</span>
                            </div>
                        ))}
                    </div>
                    {list.length > 0 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); data.onRunList?.(id); }}
                            disabled={status === 'running' || doneCount === list.length}
                            className="nodrag w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50"
                        >
                            {status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                            {status === 'running' ? `Corriendo… (${doneCount}/${list.length})` : doneCount === list.length ? 'Completado' : `Run (${doneCount}/${list.length})`}
                        </button>
                    )}
                </>
            )}
        </div>
    );
};

// Un único componente renderiza todos los tipos de nodo — la diferencia visual (ícono,
// color, texto resumen) sale de NODE_DEFS. La configuración real vive en el drawer
// lateral (NodeConfigDrawer), salvo "inicio" (toggle inline) y "test" (input+run inline).
// Post-it de documentación: no ejecuta nada, no se conecta. Se arrastra desde
// cualquier parte MENOS el textarea (marcado `nodrag`) para poder escribir dentro.
// Al hacer click NO abre el drawer de config — solo se edita en línea.
const NotaNode = ({ id, data, selected }) => {
    const Icon = NODE_DEFS.nota.icon;
    const locked = !!data.locked;
    return (
        <div
            className={`group relative w-56 rounded-md shadow-md transition-shadow bg-amber-100 dark:bg-amber-100 border border-amber-300/70 dark:border-amber-400/40 ${selected ? 'ring-2 ring-amber-500' : ''}`}
            style={{ boxShadow: '0 6px 14px -6px rgba(0,0,0,0.35)' }}
        >
            <LockToggle id={id} locked={locked} onToggleLock={data.onToggleLock} />
            {data.onDelete && !locked && (
                <button
                    onClick={(e) => { e.stopPropagation(); data.onDelete(id); }}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                    title="Eliminar nota"
                >
                    <X className="w-3 h-3" />
                </button>
            )}
            {/* Franja superior = zona de agarre para arrastrar la nota */}
            <div className={`flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-amber-700 ${locked ? 'cursor-default' : 'cursor-move'}`}>
                <Icon className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-wide">Nota</span>
            </div>
            <textarea
                value={data.text || ''}
                onChange={(e) => data.onNotaChange?.(id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                readOnly={locked}
                placeholder="Escribe aquí qué hace esta parte del flujo…"
                rows={4}
                className="nodrag nowheel w-full resize-none bg-transparent px-2.5 pb-2.5 pt-0 text-sm leading-snug text-amber-900 placeholder:text-amber-600/60 focus:outline-none"
            />
        </div>
    );
};

const FlowNode = ({ id, type, data, selected }) => {
    const def = NODE_DEFS[type] || NODE_DEFS.contador;
    const colors = COLOR_CLASSES[def.color] || COLOR_CLASSES.gray;
    const Icon = def.icon;
    const isTest = type === 'test';
    const isInicioLista = type === 'inicio_lista';

    if (type === 'nota') return <NotaNode id={id} data={data} selected={selected} />;
    if (type === 'bg') return <BgNode id={id} data={data} selected={selected} />;
    if (type === 'texto') return <TextoNode id={id} data={data} selected={selected} />;

    const testRing = data.testPassed === true ? 'ring-2 ring-emerald-400' : data.testPassed === false ? 'ring-2 ring-gray-300 dark:ring-gray-600' : '';
    const locked = !!data.locked;

    return (
        <div
            className={`group relative w-60 rounded-2xl border-2 shadow-sm transition-shadow ${colors.bg} ${(isTest || locked) ? 'cursor-default' : 'cursor-pointer'} ${selected ? 'border-gray-900 dark:border-white shadow-md' : colors.border} ${testRing}`}
            onClick={(isTest || locked) ? undefined : () => data.onConfigure?.(id)}
        >
            <TestResultBadge testPassed={data.testPassed} />
            <LockToggle id={id} locked={locked} onToggleLock={data.onToggleLock} />

            {def.hasTarget && (
                <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white dark:!border-gray-900" />
            )}

            {data.onDelete && !locked && type !== 'inicio' && type !== 'inicio_lista' && type !== 'inicio_incompleto_silencio' && (
                <button
                    onClick={(e) => { e.stopPropagation(); data.onDelete(id); }}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                    title="Eliminar nodo"
                >
                    <X className="w-3 h-3" />
                </button>
            )}

            <div className="flex items-center gap-2 px-3 pt-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${colors.icon}`}>
                    <Icon className="w-4 h-4 text-white" />
                </div>
                <span className={`text-xs font-semibold ${colors.text}`}>{def.label}</span>
            </div>

            {isTest ? (
                <TestNodeBody id={id} data={data} colors={colors} />
            ) : isInicioLista ? (
                <InicioListaBody id={id} data={data} summary={def.summary(data)} />
            ) : (
                <div className="px-3 pb-3 pt-1.5">
                    <p className="text-sm text-gray-700 dark:text-gray-200 truncate">{def.summary(data)}</p>
                    {type === 'contador' && (
                        <span className={`inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${colors.icon} text-white`}>
                            {data.liveCount ?? '—'}
                        </span>
                    )}
                    {(type === 'inicio' || type === 'inicio_incompleto_silencio') && (
                        <InicioToggle active={!!data.active} onToggle={data.onToggleActive} />
                    )}
                </div>
            )}

            {def.branching ? (
                <>
                    {/* Salida "Sí cumple": arista normal (sin sourceHandle 'no'). El id 'si'
                        hace que sea el handle por defecto al que se re-mapean las aristas
                        viejas (ver migración en FlowEditor). Para "Esperando Respuesta" las
                        ramas significan Coincidió (Sí) / Timeout (No), mismo cableado. */}
                    <Handle type="source" id="si" position={Position.Right} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white dark:!border-gray-900" />
                    {type !== 'esperando_respuesta' && (
                        <span className="absolute top-1/2 -translate-y-1/2 -right-6 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 pointer-events-none whitespace-nowrap">Sí</span>
                    )}
                    {/* Salida "No cumple": los candidatos que NO pasan la condición salen por aquí. */}
                    <Handle type="source" id="no" position={Position.Bottom} className="!w-3 !h-3 !bg-red-500 !border-2 !border-white dark:!border-gray-900" />
                    <span className="absolute left-1/2 -translate-x-1/2 -bottom-5 text-[10px] font-bold text-red-500 pointer-events-none whitespace-nowrap">{type === 'esperando_respuesta' ? 'Timeout' : 'No cumple'}</span>
                </>
            ) : def.hasSource && (
                <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white dark:!border-gray-900" />
            )}
        </div>
    );
};

export default FlowNode;
