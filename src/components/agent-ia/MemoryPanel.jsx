import React, { useEffect, useRef, useState } from 'react';
import { BrainCircuit, Save, Loader2, Check, RotateCcw, ThumbsUp, ThumbsDown } from 'lucide-react';
import { agentIAFetch } from './api';

// ════════════════════════════════════════════════════════════════════════════
// MemoryPanel — MEMORY.md (memoria aprobada) + propuestas pendientes del agente.
// El agente PROPONE (aparecen aquí como pendientes); el usuario APRUEBA o RECHAZA.
// El doc aprobado también es editable a mano.
// ════════════════════════════════════════════════════════════════════════════

const MemoryPanel = ({ value, pending = [], onSaved, onResolved }) => {
    const [draft, setDraft] = useState(value || '');
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState(0);
    const [busyId, setBusyId] = useState(null);
    const lastExternalRef = useRef(value);

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
            await agentIAFetch('/api/agent-ia/config', { method: 'PUT', body: { doc: 'memory', content: draft } });
            lastExternalRef.current = draft;
            setSavedAt(Date.now());
            if (onSaved) onSaved(draft);
        } catch (e) {
            alert(`No se pudo guardar MEMORY.md: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    const resolve = async (id, action) => {
        if (busyId) return;
        setBusyId(id);
        try {
            const data = await agentIAFetch('/api/agent-ia/memory', { method: 'POST', body: { action, id } });
            // Sincroniza el textarea EN VIVO con la memoria nueva (si no hay una edición
            // local sin guardar), sin depender del efecto de `value` que llegaba tarde.
            if (typeof data.memoryMd === 'string') {
                setDraft((prev) => (prev === lastExternalRef.current ? data.memoryMd : prev));
                lastExternalRef.current = data.memoryMd;
            }
            if (onResolved) onResolved(data);
        } catch (e) {
            alert(`No se pudo ${action === 'approve' ? 'aprobar' : 'rechazar'}: ${e.message}`);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="shrink-0 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2 bg-purple-50/50 dark:bg-purple-900/10">
                <div className="flex items-center gap-2 min-w-0">
                    <BrainCircuit className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                    <span className="text-sm font-bold text-gray-900 dark:text-white">MEMORY.md</span>
                    {pending.length > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-600 text-white">{pending.length} por revisar</span>
                    )}
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
                            dirty ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                        }`}
                    >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (savedAt && !dirty ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />)}
                        {saving ? 'Guardando' : (savedAt && !dirty ? 'Guardado' : 'Guardar')}
                    </button>
                </div>
            </div>

            {/* Propuestas pendientes del agente */}
            {pending.length > 0 && (
                <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/60 bg-purple-50/30 dark:bg-purple-900/5">
                    {pending.map((p) => (
                        <div key={p.id} className="px-4 py-2.5 flex items-start gap-2">
                            <p className="flex-1 text-[13px] text-gray-700 dark:text-gray-200 leading-snug">{p.text}</p>
                            <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => resolve(p.id, 'approve')} disabled={busyId === p.id} title="Aprobar (agregar a MEMORY.md)" className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 transition-colors">
                                    {busyId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={() => resolve(p.id, 'reject')} disabled={busyId === p.id} title="Rechazar" className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors">
                                    <ThumbsDown className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                placeholder="Aún no hay memoria acumulada. El agente propondrá aprendizajes aquí, y tú los apruebas."
                className="w-full h-52 resize-none px-4 py-3 text-[13px] font-mono leading-relaxed text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-800 outline-none"
            />
        </div>
    );
};

export default MemoryPanel;
