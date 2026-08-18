import React, { useState, useMemo, useEffect } from 'react';
import { X } from 'lucide-react';
import { NODE_DEFS, COLOR_CLASSES, PROFILE_FILTER_LABELS, ETIQUETA_MODE_LABELS, GENEROS } from './nodeTypes';
import FlowSelect from './FlowSelect';
import { getFlowCounters, getFlowCounterRange } from '../../services/flowsService';

const StatCell = ({ label, value }) => (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
        <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{value ?? '—'}</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
    </div>
);

// Desglose por fecha de un nodo Contador. El total incluye el histórico (SET); el
// desglose hoy/ayer/semana/mes y el rango personalizado salen del ZSET de timestamps,
// que empezó a registrarse al liberar esta feature (los pasos previos no tienen fecha).
const ContadorStats = ({ flowId, nodeId }) => {
    const todayLocal = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local (Monterrey)
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [from, setFrom] = useState(todayLocal);
    const [to, setTo] = useState(todayLocal);
    const [rangeCount, setRangeCount] = useState(null);
    const [rangeLoading, setRangeLoading] = useState(false);
    const [rangeError, setRangeError] = useState('');

    useEffect(() => {
        let alive = true;
        if (!flowId) { setLoading(false); return; }
        setLoading(true);
        getFlowCounters(flowId).then(res => {
            if (!alive) return;
            setStats(res.success ? (res.counters?.[nodeId] || null) : null);
            setLoading(false);
        });
        return () => { alive = false; };
    }, [flowId, nodeId]);

    const calcRange = async () => {
        setRangeError('');
        if (from > to) { setRangeError('El "desde" no puede ser posterior al "hasta".'); return; }
        setRangeLoading(true);
        setRangeCount(null);
        const res = await getFlowCounterRange(flowId, nodeId, from, to);
        setRangeLoading(false);
        if (res.success) setRangeCount(res.count);
        else setRangeError(res.error || 'No se pudo calcular');
    };

    return (
        <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700">
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Conteo por periodo</label>
            {loading ? (
                <p className="text-xs text-gray-400">Cargando…</p>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <StatCell label="Total (histórico)" value={stats?.total} />
                        <StatCell label="Hoy" value={stats?.hoy} />
                        <StatCell label="Ayer" value={stats?.ayer} />
                        <StatCell label="Esta semana" value={stats?.estaSemana} />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                        <StatCell label="Este mes" value={stats?.esteMes} />
                    </div>

                    <div className="mt-4">
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Rango personalizado</label>
                        <div className="flex items-center gap-2">
                            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
                                className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-xs focus:outline-none focus:ring-2 focus:ring-gray-500" />
                            <span className="text-xs text-gray-400">a</span>
                            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
                                className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-xs focus:outline-none focus:ring-2 focus:ring-gray-500" />
                        </div>
                        <button onClick={calcRange} disabled={rangeLoading}
                            className="mt-2 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-gray-800 dark:bg-gray-700 text-white hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-50">
                            {rangeLoading ? 'Calculando…' : 'Calcular rango'}
                        </button>
                        {rangeError && <p className="mt-2 text-xs text-red-500">{rangeError}</p>}
                        {rangeCount != null && !rangeError && (
                            <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                                <strong className="tabular-nums">{rangeCount}</strong> candidato{rangeCount === 1 ? '' : 's'} entre {from} y {to}.
                            </p>
                        )}
                    </div>
                    <p className="mt-3 text-[11px] text-gray-400">El desglose por fecha cuenta desde que se activó esta función; el total sí incluye el histórico completo.</p>
                </>
            )}
        </div>
    );
};

const RadioGroup = ({ options, value, onChange }) => (
    <div className="space-y-2">
        {options.map(opt => (
            <label key={opt.value} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                <input
                    type="radio"
                    checked={value === opt.value}
                    onChange={() => onChange(opt.value)}
                    className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-200">{opt.label}</span>
            </label>
        ))}
    </div>
);

const MultiSelectChecklist = ({ items, selected, onChange, searchable }) => {
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => {
        if (!searchable || !query.trim()) return items;
        const q = query.trim().toLowerCase();
        return items.filter(i => i.toLowerCase().includes(q));
    }, [items, query, searchable]);

    const toggle = (item) => {
        onChange(selected.includes(item) ? selected.filter(s => s !== item) : [...selected, item]);
    };

    return (
        <div>
            {searchable && (
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar..."
                    className="w-full mb-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
            )}
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
                {filtered.map(item => (
                    <label key={item} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selected.includes(item)}
                            onChange={() => toggle(item)}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-200">{item}</span>
                    </label>
                ))}
                {!filtered.length && <p className="text-xs text-gray-400 py-2">Sin resultados</p>}
            </div>
            {selected.length > 0 && (
                <button onClick={() => onChange([])} className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                    Limpiar selección ({selected.length})
                </button>
            )}
        </div>
    );
};

// Editor de "listas de frases" para el nodo Esperando Respuesta. Cada grupo es una lista
// de frases (una por línea en el textarea). Se puede tener varias listas. Para el motor,
// basta con que el mensaje del candidato coincida con UNA frase de CUALQUIER lista → rama "Sí".
const FraseGruposEditor = ({ grupos, onChange }) => {
    const list = Array.isArray(grupos) && grupos.length ? grupos : [{ id: 'g1', label: '', frases: [] }];

    const updateGroup = (idx, fields) => {
        onChange(list.map((g, i) => (i === idx ? { ...g, ...fields } : g)));
    };
    const addGroup = () => {
        onChange([...list, { id: `g${Date.now()}`, label: '', frases: [] }]);
    };
    const removeGroup = (idx) => {
        const next = list.filter((_, i) => i !== idx);
        onChange(next.length ? next : [{ id: 'g1', label: '', frases: [] }]);
    };

    return (
        <div className="space-y-3">
            {list.map((g, idx) => (
                <div key={g.id || idx} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={g.label || ''}
                            onChange={(e) => updateGroup(idx, { label: e.target.value })}
                            placeholder={`Lista ${idx + 1} (nombre opcional)`}
                            className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {list.length > 1 && (
                            <button onClick={() => removeGroup(idx)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="Quitar lista">
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    <textarea
                        value={(Array.isArray(g.frases) ? g.frases : []).join('\n')}
                        onChange={(e) => updateGroup(idx, { frases: e.target.value.split('\n').map(s => s.trimStart()) })}
                        placeholder={"Una frase por línea:\nnos vemos\nahí estaré\nconfirmado"}
                        rows={4}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                    />
                    <p className="text-[11px] text-gray-400">
                        {(Array.isArray(g.frases) ? g.frases.filter(f => String(f || '').trim()) : []).length} frase(s) en esta lista.
                    </p>
                </div>
            ))}
            <button onClick={addGroup} className="w-full px-3 py-2 rounded-lg text-xs font-semibold border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                + Agregar otra lista de frases
            </button>
        </div>
    );
};

const NodeConfigDrawer = ({ node, flowId, meta, quickReplies, reminderTemplates, projects, onChange, onClose }) => {
    if (!node) return null;
    const def = NODE_DEFS[node.type] || NODE_DEFS.contador;
    const colors = COLOR_CLASSES[def.color] || COLOR_CLASSES.gray;
    const Icon = def.icon;
    const data = node.data || {};

    const patch = (fields) => onChange(node.id, fields);

    return (
        <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-2xl z-[200] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${colors.icon}`}>
                        <Icon className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">{def.label}</h3>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                    <X className="w-4 h-4 text-gray-500" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
                {node.type === 'inicio' && (() => {
                    const trigger = (Array.isArray(data.trigger) && data.trigger.length) ? data.trigger : ['al_completar'];
                    const toggleTrigger = (val) => {
                        const has = trigger.includes(val);
                        let next = has ? trigger.filter(t => t !== val) : [...trigger, val];
                        if (!next.length) next = [val === 'al_completar' ? 'al_regresar' : 'al_completar']; // nunca vacío
                        patch({ trigger: next });
                    };
                    const showReturn = trigger.includes('al_regresar');
                    return (
                    <div className="space-y-5">
                        <div>
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">¿A quién? (filtro de perfil)</label>
                            <RadioGroup
                                options={Object.entries(PROFILE_FILTER_LABELS).map(([value, label]) => ({ value, label }))}
                                value={data.profileFilter || 'completo'}
                                onChange={(v) => patch({ profileFilter: v })}
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">¿Cuándo entra? (disparador)</label>
                            {[
                                { value: 'al_completar', label: 'Al completar su registro', hint: 'Justo cuando termina de dar sus datos (disparo clásico).' },
                                { value: 'al_regresar', label: 'Cuando regresa y pide info', hint: 'Un candidato YA completo que vuelve (click de anuncio o frase).' }
                            ].map(opt => (
                                <label key={opt.value} className="flex items-start gap-2.5 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer mb-2">
                                    <input type="checkbox" checked={trigger.includes(opt.value)} onChange={() => toggleTrigger(opt.value)} className="w-4 h-4 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500" />
                                    <span>
                                        <span className="text-sm text-gray-700 dark:text-gray-200 block">{opt.label}</span>
                                        <span className="text-xs text-gray-400">{opt.hint}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        {showReturn && (
                            <div className="space-y-4 border-l-2 border-indigo-200 dark:border-indigo-800 pl-3">
                                <p className="text-xs bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-2.5 text-indigo-800 dark:text-indigo-300">
                                    Solo para <strong>“cuando regresa”</strong>. El candidato entra al flujo de su <strong>última</strong> vacante — pon un nodo <strong>Filtro: Etiqueta</strong> en modo <strong>“es su etiqueta actual”</strong> después de este Inicio para rutearlo.
                                </p>
                                <div>
                                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">¿Qué cuenta como “regresó”?</label>
                                    <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer mb-2">
                                        <input type="checkbox" checked={data.returnOnAd !== false} onChange={(e) => patch({ returnOnAd: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" />
                                        <span className="text-sm text-gray-700 dark:text-gray-200">Volvió a clickear un anuncio</span>
                                    </label>
                                    <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                                        <input type="checkbox" checked={!!data.returnOnPhrase} onChange={(e) => patch({ returnOnPhrase: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" />
                                        <span className="text-sm text-gray-700 dark:text-gray-200">Escribió una frase</span>
                                    </label>
                                </div>
                                {data.returnOnPhrase && (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Frases que cuentan como “pide info”</label>
                                            <FraseGruposEditor grupos={data.returnGrupos} onChange={(v) => patch({ returnGrupos: v })} />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Cómo comparar</label>
                                            <RadioGroup
                                                options={[
                                                    { value: 'contiene', label: 'Contiene la frase (recomendado)' },
                                                    { value: 'palabra', label: 'La frase aparece como palabra(s) suelta(s)' },
                                                    { value: 'exacto', label: 'El mensaje es exactamente la frase' }
                                                ]}
                                                value={data.returnMatchMode || 'contiene'}
                                                onChange={(v) => patch({ returnMatchMode: v })}
                                            />
                                        </div>
                                    </div>
                                )}
                                <div>
                                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Solo si regresó después de (días)</label>
                                    <input type="number" min="0" step="1" value={data.minReturnDays ?? 0} onChange={(e) => patch({ minReturnDays: Math.max(0, parseInt(e.target.value, 10) || 0) })} className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                                    <p className="text-xs text-gray-400 mt-1.5"><b>0</b> = sin importar cuándo completó. Ej. 7 = solo si completó su registro hace 7+ días. (Los completos previos a esta función no tienen fecha → no se filtran.)</p>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Máx. de veces</label>
                                        <input type="number" min="0" step="1" value={data.maxReturns ?? 0} onChange={(e) => patch({ maxReturns: Math.max(0, parseInt(e.target.value, 10) || 0) })} className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                                        <p className="text-xs text-gray-400 mt-1.5"><b>0</b> = sin tope.</p>
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Cooldown (días)</label>
                                        <input type="number" min="0" step="1" value={data.returnCooldownDays ?? 0} onChange={(e) => patch({ returnCooldownDays: Math.max(0, parseInt(e.target.value, 10) || 0) })} className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                                        <p className="text-xs text-gray-400 mt-1.5">Mínimo entre disparos.</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    );
                })()}

                {node.type === 'inicio_lista' && (
                    <div className="space-y-5">
                        <p className="text-xs text-gray-400">
                            Flujo manual, no en vivo: arma una lista de candidatos que ya existen (no se dispara solo cuando alguien completa su perfil). Dale a "Cargar lista" en el nodo y luego "Run" para correrlo uno por uno.
                        </p>
                        <div>
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Estado del perfil</label>
                            <RadioGroup
                                options={[
                                    { value: 'todos', label: PROFILE_FILTER_LABELS.todos },
                                    { value: 'completo', label: PROFILE_FILTER_LABELS.completo },
                                    { value: 'incompleto', label: PROFILE_FILTER_LABELS.incompleto }
                                ]}
                                value={data.profileFilter || 'todos'}
                                onChange={(v) => patch({ profileFilter: v })}
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Etiquetas (al menos una)</label>
                            <MultiSelectChecklist
                                items={meta?.tags || []}
                                selected={data.tags || []}
                                onChange={(v) => patch({ tags: v })}
                                searchable
                            />
                        </div>
                        <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={!!data.within24h}
                                onChange={(e) => patch({ within24h: e.target.checked })}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-200">Solo si sigue dentro de la ventana de 24h de Meta</span>
                        </label>
                        <p className="text-xs text-gray-400">
                            La ventana de 24h se calcula sobre el último mensaje que EL CANDIDATO te mandó (no lo que tú le mandaste a él) — si se marca, se excluyen los que ya no se les puede escribir texto libre.
                        </p>
                    </div>
                )}

                {node.type === 'inicio_incompleto_silencio' && (
                    <div className="space-y-5">
                        <p className="text-xs text-gray-400">
                            Se dispara solo (por un cron cada 15 min) para candidatos con perfil <b>incompleto</b> que llevan cierto tiempo <b>sin responderle a Brenda</b>. Es como el reenganche, pero corriendo las acciones que armes abajo.
                        </p>
                        <div>
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Horas de silencio para disparar</label>
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={data.silenceHours ?? 1}
                                onChange={(e) => patch({ silenceHours: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <p className="text-xs text-gray-400 mt-1.5">Se mide desde el último mensaje del candidato (o desde el último disparo). Ej. 1 = espera 1 hora de silencio.</p>
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Máximo de veces que puede pasar por el nodo</label>
                            <input
                                type="number"
                                min="0"
                                step="1"
                                value={data.maxPasses ?? 0}
                                onChange={(e) => patch({ maxPasses: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <p className="text-xs text-gray-400 mt-1.5">
                                <b>0</b> = dispara 1 sola vez por candidato (los que nunca han pasado). <b>1</b> = los que nunca pasaron + los que pasaron 1 vez (2 disparos). En general dispara {(Number(data.maxPasses ?? 0)) + 1} {(Number(data.maxPasses ?? 0)) + 1 === 1 ? 'vez' : 'veces'} en total, esperando el silencio entre cada una.
                            </p>
                        </div>
                    </div>
                )}

                {node.type === 'etiqueta' && (
                    <div className="space-y-4">
                        <RadioGroup
                            options={Object.entries(ETIQUETA_MODE_LABELS).map(([value, label]) => ({ value, label }))}
                            value={data.mode || 'todas'}
                            onChange={(v) => patch({ mode: v })}
                        />
                        {(data.mode === 'especifica' || data.mode === 'actual') && (
                            <FlowSelect
                                value={data.tag || ''}
                                onChange={(v) => patch({ tag: v })}
                                options={(meta?.tags || []).map(t => ({ value: t, label: t }))}
                                placeholder="Elige una etiqueta..."
                                ringClass="focus:ring-indigo-500"
                                emptyLabel="No hay etiquetas creadas todavía"
                            />
                        )}
                        {data.mode === 'actual' && (
                            <p className="text-xs bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-2.5 text-indigo-800 dark:text-indigo-300">
                                Pasa solo si esta es la <strong>última vacante</strong> del candidato (el anuncio que clickeó más recientemente), aunque tenga otras etiquetas en su historial. Ideal para rutear un flujo <strong>“cuando regresa”</strong> a la vacante correcta.
                            </p>
                        )}
                    </div>
                )}

                {node.type === 'condicion_genero' && (
                    <MultiSelectChecklist
                        items={GENEROS}
                        selected={data.generos || []}
                        onChange={(v) => patch({ generos: v })}
                    />
                )}

                {node.type === 'condicion_edad' && (
                    <div className="flex items-center gap-3">
                        <div className="flex-1">
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Desde</label>
                            <input
                                type="number" min="0" max="120"
                                value={data.min ?? ''}
                                onChange={(e) => patch({ min: e.target.value === '' ? null : Number(e.target.value) })}
                                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Hasta</label>
                            <input
                                type="number" min="0" max="120"
                                value={data.max ?? ''}
                                onChange={(e) => patch({ max: e.target.value === '' ? null : Number(e.target.value) })}
                                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                )}

                {node.type === 'condicion_municipio' && (
                    <MultiSelectChecklist
                        items={meta?.municipios || []}
                        selected={data.municipios || []}
                        onChange={(v) => patch({ municipios: v })}
                        searchable
                    />
                )}

                {node.type === 'condicion_categoria' && (
                    <MultiSelectChecklist
                        items={meta?.categorias || []}
                        selected={data.categorias || []}
                        onChange={(v) => patch({ categorias: v })}
                        searchable
                    />
                )}

                {node.type === 'condicion_escolaridad' && (
                    <MultiSelectChecklist
                        items={meta?.escolaridades || []}
                        selected={data.escolaridades || []}
                        onChange={(v) => patch({ escolaridades: v })}
                    />
                )}

                {node.type === 'accion_whatsapp' && (
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Mensaje del banco de respuestas</label>
                        <FlowSelect
                            value={data.quickReplyId || ''}
                            onChange={(v) => {
                                const qr = (quickReplies || []).find(r => r.id === v);
                                patch({ quickReplyId: v, quickReplyName: qr?.name || '' });
                            }}
                            options={(quickReplies || []).map(r => ({ value: r.id, label: r.name }))}
                            placeholder="Elige un mensaje..."
                            ringClass="focus:ring-emerald-500"
                            emptyLabel="No hay mensajes en el banco de respuestas"
                        />
                        {data.quickReplyId && (
                            <p className="mt-2 text-xs text-gray-400">Se manda con variables ya resueltas ({'{{nombre}}'}, {'{{municipio}}'}, etc.)</p>
                        )}
                    </div>
                )}

                {node.type === 'accion_whatsapp_personalizado' && (
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Mensaje</label>
                        <textarea
                            value={data.message || ''}
                            onChange={(e) => patch({ message: e.target.value })}
                            placeholder="Escribe tu mensaje... Puedes usar {{nombre}}, {{municipio}}, {{categoria}}, etc."
                            rows={6}
                            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                        />
                        <p className="mt-2 text-xs text-gray-400">Las variables ({'{{nombre}}'}, {'{{municipio}}'}, etc.) se resuelven igual que en el banco de respuestas.</p>
                    </div>
                )}

                {node.type === 'accion_vacante' && (
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Vacante (maletín)</label>
                        <FlowSelect
                            value={data.vacancyId || ''}
                            onChange={(v) => {
                                const vac = (meta?.vacantes || []).find(x => x.id === v);
                                patch({ vacancyId: v, vacancyName: vac?.name || '' });
                            }}
                            options={(meta?.vacantes || []).map(v => ({ value: v.id, label: v.name }))}
                            placeholder="Elige una vacante..."
                            ringClass="focus:ring-emerald-500"
                            emptyLabel="No hay vacantes con 'info para el bot' activada"
                        />
                        {data.vacancyId && (
                            <p className="mt-2 text-xs text-gray-400">Manda el mismo texto que el maletín del chat manual (nombre + descripción), sin variables.</p>
                        )}
                    </div>
                )}

                {node.type === 'accion_etiqueta' && (
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Etiqueta a asignar</label>
                        <FlowSelect
                            value={data.tag || ''}
                            onChange={(v) => patch({ tag: v })}
                            options={(meta?.tags || []).map(t => ({ value: t, label: t }))}
                            placeholder="Elige una etiqueta..."
                            ringClass="focus:ring-amber-500"
                            emptyLabel="No hay etiquetas creadas todavía"
                        />
                    </div>
                )}

                {node.type === 'accion_limpiar_etiquetas' && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        No necesita configuración: al ejecutarse, quita <strong>todas</strong> las etiquetas que tenga el candidato en ese momento (no solo una).
                    </p>
                )}

                {node.type === 'accion_marcar_leido' && (
                    <div className="space-y-3 text-sm text-gray-500 dark:text-gray-400">
                        <p>
                            No necesita configuración: al ejecutarse, marca al candidato como <strong>leído</strong> y lo saca de la lista de no-leídos (le quita la burbuja/badge). Útil para candidatos que ya están completos pero <strong>no cumplen los filtros</strong>. Si el candidato vuelve a escribir, reaparece como no-leído.
                        </p>
                        <p className="text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 text-amber-800 dark:text-amber-300">
                            <strong>Puedes conectarle varias ramas rojas “No cumple”</strong>: se dispara si el candidato falla en <strong>cualquiera</strong> de ellas (O/OR). ⚠️ Ojo: solo conecta la roja de una condición si fallarla <strong>sí</strong> significa descartar. No conectes aquí la roja de condiciones que solo <strong>enrutan</strong> (ej. “Género: Mujer” cuando el hombre debe seguir por otra rama), porque marcarías leído a candidatos válidos.
                        </p>
                    </div>
                )}

                {node.type === 'accion_desactivar_bot' && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        No necesita configuración: al ejecutarse, <strong>silencia a Brenda</strong> para ese candidato — exactamente igual que cuando un humano interviene en el chat (modo humano). El candidato queda marcado como intervenido y la IA <strong>deja de responderle</strong>. No lo bloquea en WhatsApp: un reclutador puede seguir escribiéndole. Se reactiva sola a los 5 días, o manualmente desde el chat.
                    </p>
                )}

                {node.type === 'accion_reactivar_bot' && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        No necesita configuración: al ejecutarse, <strong>reactiva a Brenda</strong> para ese candidato — deshace el <strong>Desactivar Bot</strong> (o una intervención humana). La IA vuelve a responderle normalmente. Útil al final de un ciclo <strong>Desactivar Bot → Esperando respuesta → … → Reactivar Bot</strong>.
                    </p>
                )}

                {node.type === 'esperando_respuesta' && (
                    <div className="space-y-5">
                        <p className="text-xs bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-2.5 text-blue-800 dark:text-blue-300">
                            <strong>Ponlo siempre DESPUÉS de un “Desactivar Bot”.</strong> El flujo se queda en modo oyente: cuando el candidato responde, si su mensaje coincide con alguna frase, el flujo continúa por la rama <strong>Sí</strong>. Como Brenda está en silencio, no hay doble respuesta.
                        </p>
                        <div>
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Frases que activan la continuación</label>
                            <FraseGruposEditor grupos={data.grupos} onChange={(v) => patch({ grupos: v })} />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Cómo comparar</label>
                            <RadioGroup
                                options={[
                                    { value: 'contiene', label: 'Contiene la frase (recomendado)' },
                                    { value: 'palabra', label: 'La frase aparece como palabra(s) suelta(s)' },
                                    { value: 'exacto', label: 'El mensaje es exactamente la frase' }
                                ]}
                                value={data.matchMode || 'contiene'}
                                onChange={(v) => patch({ matchMode: v })}
                            />
                            <p className="text-xs text-gray-400 mt-1.5">La comparación ignora mayúsculas y acentos.</p>
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Tiempo máximo de espera (horas)</label>
                            <input
                                type="number" min="1" step="1"
                                value={data.timeoutHoras ?? 48}
                                onChange={(e) => patch({ timeoutHoras: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <p className="text-xs text-gray-400 mt-1.5">Si el candidato no responde algo que coincida dentro de este plazo, la próxima vez que escriba (o si vuelve a entrar) el flujo continúa por la rama <strong>No</strong> (timeout). Conéctale ahí un <strong>Reactivar Bot</strong> si quieres devolvérselo a Brenda.</p>
                        </div>
                    </div>
                )}

                {node.type === 'accion_recordatorio' && (
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Plantilla de recordatorio</label>
                        <FlowSelect
                            value={data.templateId || ''}
                            onChange={(v) => {
                                const tpl = (reminderTemplates || []).find(t => t.id === v);
                                patch({ templateId: v, templateName: tpl?.name || '' });
                            }}
                            options={(reminderTemplates || []).map(t => ({ value: t.id, label: t.name }))}
                            placeholder="Elige una plantilla..."
                            ringClass="focus:ring-emerald-500"
                            emptyLabel="No hay plantillas de recordatorio"
                        />
                        {!(reminderTemplates || []).length && (
                            <p className="mt-2 text-xs text-gray-400">Todavía no tienes plantillas de recordatorio — créalas desde la campanita en Chat.</p>
                        )}
                        {data.templateId && (
                            <p className="mt-2 text-xs text-gray-400">Se programa según el tiempo configurado en la plantilla (días + hora), a partir del momento en que el candidato completa su perfil.</p>
                        )}
                    </div>
                )}

                {node.type === 'accion_proyecto' && (
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Proyecto</label>
                        <FlowSelect
                            value={data.projectId || ''}
                            onChange={(v) => {
                                const proj = (projects || []).find(p => p.id === v);
                                patch({ projectId: v, projectName: proj?.name || '' });
                            }}
                            options={(projects || []).map(p => ({ value: p.id, label: p.name }))}
                            placeholder="Elige un proyecto..."
                            ringClass="focus:ring-amber-500"
                            emptyLabel="No hay proyectos creados todavía"
                        />
                        {data.projectId && (
                            <p className="mt-2 text-xs text-gray-400">Cae en la primera columna del proyecto. Si ya estaba en otro proyecto, se desvincula de ahí (solo puede estar en uno a la vez).</p>
                        )}
                    </div>
                )}

                {node.type === 'accion_quitar_etiqueta' && (
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Etiqueta a quitar</label>
                        <FlowSelect
                            value={data.tag || ''}
                            onChange={(v) => patch({ tag: v })}
                            options={(meta?.tags || []).map(t => ({ value: t, label: t }))}
                            placeholder="Elige una etiqueta..."
                            ringClass="focus:ring-amber-500"
                            emptyLabel="No hay etiquetas creadas todavía"
                        />
                    </div>
                )}

                {node.type === 'contador' && (
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Nombre del contador</label>
                        <input
                            type="text"
                            value={data.label || ''}
                            onChange={(e) => patch({ label: e.target.value })}
                            placeholder="Ej. Llegaron al final"
                            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                        />
                        <p className="mt-2 text-xs text-gray-400">Cuenta candidatos únicos que llegan a este punto del flujo. No manda nada ni modifica al candidato.</p>
                        <ContadorStats flowId={flowId} nodeId={node.id} />
                    </div>
                )}

                {def.branching && node.type !== 'esperando_respuesta' && (
                    <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Este nodo tiene <strong>dos salidas</strong>: la verde <strong className="text-emerald-600 dark:text-emerald-400">Sí</strong> (a la derecha) para los candidatos que <strong>cumplen</strong>, y la roja <strong className="text-red-500">No cumple</strong> (abajo) para los que <strong>no</strong>. Conecta la salida roja a un nodo <strong>Marcar Leído</strong> si quieres sacarlos de la lista sin mandarles nada.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default NodeConfigDrawer;
