import React, { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { NODE_DEFS, COLOR_CLASSES, PROFILE_FILTER_LABELS, ETIQUETA_MODE_LABELS, GENEROS } from './nodeTypes';
import FlowSelect from './FlowSelect';

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

const NodeConfigDrawer = ({ node, meta, quickReplies, reminderTemplates, projects, onChange, onClose }) => {
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
                {node.type === 'inicio' && (
                    <RadioGroup
                        options={Object.entries(PROFILE_FILTER_LABELS).map(([value, label]) => ({ value, label }))}
                        value={data.profileFilter || 'completo'}
                        onChange={(v) => patch({ profileFilter: v })}
                    />
                )}

                {node.type === 'etiqueta' && (
                    <div className="space-y-4">
                        <RadioGroup
                            options={Object.entries(ETIQUETA_MODE_LABELS).map(([value, label]) => ({ value, label }))}
                            value={data.mode || 'todas'}
                            onChange={(v) => patch({ mode: v })}
                        />
                        {data.mode === 'especifica' && (
                            <FlowSelect
                                value={data.tag || ''}
                                onChange={(v) => patch({ tag: v })}
                                options={(meta?.tags || []).map(t => ({ value: t, label: t }))}
                                placeholder="Elige una etiqueta..."
                                ringClass="focus:ring-indigo-500"
                                emptyLabel="No hay etiquetas creadas todavía"
                            />
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
                    </div>
                )}
            </div>
        </div>
    );
};

export default NodeConfigDrawer;
