import React, { useEffect, useRef, useState } from 'react';
import { FileText, Save, Loader2, Check, RotateCcw } from 'lucide-react';
import { agentIAFetch } from './api';

// ════════════════════════════════════════════════════════════════════════════
// DocEditor — editor de AGENTS.md. Editable por el usuario Y por el agente (que
// lo reescribe vía tool use; el padre refresca `value` cuando eso pasa). Guarda
// con PUT /api/agent-ia/config { doc: 'agents', content }.
// ════════════════════════════════════════════════════════════════════════════

const AgentsDocEditor = ({ value, onSaved }) => {
    const [draft, setDraft] = useState(value || '');
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState(0);
    const lastExternalRef = useRef(value);

    // El agente (u otra fuente) actualizó el documento: sincroniza SIN pisar una
    // edición local en curso. Si el usuario no ha tocado nada (draft == valor previo),
    // adopta el nuevo valor; si sí lo tocó, respeta su borrador.
    useEffect(() => {
        if (value === lastExternalRef.current) return;
        setDraft((prevDraft) => (prevDraft === lastExternalRef.current ? value : prevDraft));
        lastExternalRef.current = value;
    }, [value]);

    const dirty = draft !== value;

    const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
            await agentIAFetch('/api/agent-ia/config', { method: 'PUT', body: { doc: 'agents', content: draft } });
            lastExternalRef.current = draft;
            setSavedAt(Date.now());
            if (onSaved) onSaved(draft);
        } catch (e) {
            alert(`No se pudo guardar AGENTS.md: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="shrink-0 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2 bg-blue-50/50 dark:bg-blue-900/10">
                <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-sm font-bold text-gray-900 dark:text-white">AGENTS.md</span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate hidden sm:inline">· definición del agente</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {dirty && (
                        <button onClick={() => setDraft(value || '')} title="Descartar cambios" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                            <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <button
                        onClick={save}
                        disabled={saving || !dirty}
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                            dirty ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                        }`}
                    >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (savedAt && !dirty ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />)}
                        {saving ? 'Guardando' : (savedAt && !dirty ? 'Guardado' : 'Guardar')}
                    </button>
                </div>
            </div>
            <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                placeholder="Define aquí el comportamiento del agente…"
                className="w-full h-64 resize-none px-4 py-3 text-[13px] font-mono leading-relaxed text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-800 outline-none"
            />
        </div>
    );
};

export default AgentsDocEditor;
