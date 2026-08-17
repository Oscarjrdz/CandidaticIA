import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Plus, Save, Check, ClipboardPaste } from 'lucide-react';
import { NODE_DEFS, COLOR_CLASSES } from './nodeTypes';

const ENTRY_TYPES = ['inicio', 'inicio_lista', 'inicio_incompleto_silencio'];
const ADDABLE_TYPES = Object.keys(NODE_DEFS).filter(t => !ENTRY_TYPES.includes(t));

const FlowToolbar = ({ flowName, active, dirty, saving, onAddNode, onSave, onToggleActive, onRename, onBack, canPaste, onPaste }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState(flowName);
    const menuRef = useRef(null);

    useEffect(() => setNameDraft(flowName), [flowName]);

    useEffect(() => {
        const onClickOutside = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    return (
        <div className="absolute top-3 left-3 right-3 z-[100] flex items-center justify-between gap-3 pointer-events-none">
            <div className="flex items-center gap-2 pointer-events-auto">
                <button
                    onClick={onBack}
                    className="p-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                    title="Volver a la galería"
                >
                    <ArrowLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                </button>

                {editingName ? (
                    <input
                        autoFocus
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={() => { setEditingName(false); if (nameDraft.trim() && nameDraft !== flowName) onRename(nameDraft.trim()); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                ) : (
                    <button
                        onClick={() => setEditingName(true)}
                        className="px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm text-sm font-semibold text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                        {flowName || 'Flujo sin nombre'}
                    </button>
                )}

                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => setMenuOpen(o => !o)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-sm hover:bg-indigo-700"
                    >
                        <Plus className="w-4 h-4" /> Agregar nodo
                    </button>
                    {menuOpen && (
                        <div className="absolute left-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-lg p-2 max-h-96 overflow-y-auto">
                            {ADDABLE_TYPES.map(type => {
                                const def = NODE_DEFS[type];
                                const colors = COLOR_CLASSES[def.color];
                                const Icon = def.icon;
                                return (
                                    <button
                                        key={type}
                                        onClick={() => { onAddNode(type); setMenuOpen(false); }}
                                        className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left"
                                    >
                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${colors.icon}`}>
                                            <Icon className="w-4 h-4 text-white" />
                                        </div>
                                        <span className="text-sm text-gray-700 dark:text-gray-200">{def.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {canPaste && (
                    <button
                        onClick={onPaste}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-sm font-semibold shadow-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                        title="Pegar aquí lo que clonaste/copiaste (también de otro flujo)"
                    >
                        <ClipboardPaste className="w-4 h-4" /> Pegar
                    </button>
                )}
            </div>

            <div className="flex items-center gap-2 pointer-events-auto">
                <button
                    onClick={onToggleActive}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border shadow-sm transition-colors ${
                        active
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-700'
                            : 'bg-white text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
                    }`}
                >
                    <span className={`w-8 h-4 rounded-full flex items-center px-0.5 transition-colors ${active ? 'bg-emerald-500 justify-end' : 'bg-gray-300 dark:bg-gray-600 justify-start'}`}>
                        <span className="w-3 h-3 rounded-full bg-white shadow" />
                    </span>
                    {active ? 'Activo' : 'Inactivo'}
                </button>

                <button
                    onClick={onSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                    {saving ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {saving ? 'Guardado' : dirty ? 'Guardar' : 'Guardado'}
                </button>
            </div>
        </div>
    );
};

export default FlowToolbar;
