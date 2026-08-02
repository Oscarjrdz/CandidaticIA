import React, { useState } from 'react';
import { Puzzle, Plus, Save, Loader2, Trash2, ChevronDown, ChevronRight, Tag, FileText } from 'lucide-react';
import { agentIAFetch } from './api';

// ════════════════════════════════════════════════════════════════════════════
// SkillsPanel — gestor de SKILLS DE RECLUTAMIENTO (playbooks por cliente).
// Cada skill (ej. "Yageo", "Metalsa") tiene un nombre y un contenido markdown:
// qué etiqueta usar, qué mensaje del banco, cómo responder al candidato. El
// usuario las crea/edita/borra aquí; el agente también las ve, edita y crea
// (vía tool use) y al hacerlo este panel se refresca.
// ════════════════════════════════════════════════════════════════════════════

const SkillRow = ({ skill, expanded, onToggle, onSaved, onDeleted }) => {
    const [name, setName] = useState(skill.name);
    const [content, setContent] = useState(skill.content || '');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [err, setErr] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);

    const dirty = name !== skill.name || content !== (skill.content || '');

    const save = async () => {
        if (saving || !name.trim()) return;
        setErr('');
        setSaving(true);
        try {
            const data = await agentIAFetch('/api/agent-ia/skills', { method: 'PUT', body: { id: skill.id, name: name.trim(), content } });
            if (onSaved) onSaved(data.skills);
        } catch (e) {
            setErr(`No se pudo guardar: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (deleting) return;
        setErr('');
        setDeleting(true);
        try {
            const data = await agentIAFetch(`/api/agent-ia/skills?id=${encodeURIComponent(skill.id)}`, { method: 'DELETE' });
            if (onDeleted) onDeleted(data.skills);
        } catch (e) {
            setErr(`No se pudo borrar: ${e.message}`);
            setDeleting(false);
            setConfirmDelete(false);
        }
    };

    return (
        <div className="border-b border-gray-100 dark:border-gray-700/60 last:border-b-0">
            <button onClick={onToggle} className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                <Puzzle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">{skill.name}</span>
            </button>
            {expanded && (
                <div className="px-4 pb-3 pt-1 space-y-2">
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Nombre (ej. Yageo)"
                        className="w-full text-[13px] font-semibold rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-gray-900 dark:text-white outline-none focus:border-amber-500"
                    />
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        spellCheck={false}
                        placeholder={'Playbook del cliente en markdown:\n- Etiqueta: Anuncio Yageo\n- Mensaje de banco: PUNTO YAGEO\n- Si el candidato pregunta por sueldo: ...'}
                        className="w-full h-44 resize-none text-[12px] font-mono leading-relaxed rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-2 text-gray-800 dark:text-gray-100 outline-none focus:border-amber-500"
                    />
                    <div className="flex items-center justify-between">
                        {confirmDelete ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px]">
                                <span className="text-gray-600 dark:text-gray-300">¿Borrar?</span>
                                <button onClick={remove} disabled={deleting} className="font-semibold text-red-500 hover:text-red-600 disabled:opacity-50">
                                    {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Sí, borrar'}
                                </button>
                                <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="text-gray-400 hover:text-gray-500">Cancelar</button>
                            </span>
                        ) : (
                            <button onClick={() => { setErr(''); setConfirmDelete(true); }} className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:text-red-600">
                                <Trash2 className="w-3.5 h-3.5" /> Borrar
                            </button>
                        )}
                        <button onClick={save} disabled={saving || !dirty || !name.trim()} className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${dirty && name.trim() ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'}`}>
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar
                        </button>
                    </div>
                    {err && <p className="text-[11px] text-red-500 dark:text-red-400">{err}</p>}
                </div>
            )}
        </div>
    );
};

const SkillsPanel = ({ skills = [], onChange }) => {
    const [expandedId, setExpandedId] = useState(null);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [savingNew, setSavingNew] = useState(false);
    const [createErr, setCreateErr] = useState('');

    const createSkill = async () => {
        if (savingNew || !newName.trim()) return;
        setCreateErr('');
        setSavingNew(true);
        try {
            const data = await agentIAFetch('/api/agent-ia/skills', { method: 'POST', body: { name: newName.trim(), content: '' } });
            if (onChange) onChange(data.skills);
            setNewName('');
            setCreating(false);
            if (data.skill?.id) setExpandedId(data.skill.id);
        } catch (e) {
            setCreateErr(`No se pudo crear: ${e.message}`);
        } finally {
            setSavingNew(false);
        }
    };

    return (
        <div className="flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="shrink-0 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2 bg-amber-50/50 dark:bg-amber-900/10">
                <div className="flex items-center gap-2 min-w-0">
                    <Puzzle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-sm font-bold text-gray-900 dark:text-white">Skills de reclutamiento</span>
                    {skills.length > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">{skills.length}</span>}
                </div>
                <button onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors shrink-0">
                    <Plus className="w-3.5 h-3.5" /> Nueva
                </button>
            </div>

            {creating && (
                <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 bg-amber-50/30 dark:bg-amber-900/5">
                    <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') createSkill(); }}
                        autoFocus
                        placeholder="Nombre del cliente (ej. Metalsa)"
                        className="flex-1 text-[13px] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-gray-900 dark:text-white outline-none focus:border-amber-500"
                    />
                    <button onClick={createSkill} disabled={savingNew || !newName.trim()} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white">
                        {savingNew ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Crear'}
                    </button>
                </div>
            )}
            {createErr && (
                <div className="px-4 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-red-50/50 dark:bg-red-900/10">
                    <p className="text-[11px] text-red-500 dark:text-red-400">{createErr}</p>
                </div>
            )}

            {skills.length === 0 && !creating ? (
                <div className="px-4 py-6 text-center">
                    <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed">
                        Aún no hay skills. Crea el playbook de un cliente (ej. "Yageo"): qué etiqueta usar, qué mensaje del banco y cómo responder al candidato. Tú o el agente pueden crearlas.
                    </p>
                </div>
            ) : (
                <div>
                    {skills.map((s) => (
                        <SkillRow
                            key={s.id}
                            skill={s}
                            expanded={expandedId === s.id}
                            onToggle={() => setExpandedId((id) => (id === s.id ? null : s.id))}
                            onSaved={onChange}
                            onDeleted={(list) => { setExpandedId(null); if (onChange) onChange(list); }}
                        />
                    ))}
                </div>
            )}

            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700/60 flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500">
                <span className="inline-flex items-center gap-1"><Tag className="w-3 h-3" /> el agente ve etiquetas</span>
                <span className="inline-flex items-center gap-1"><FileText className="w-3 h-3" /> y el banco de respuestas</span>
            </div>
        </div>
    );
};

export default SkillsPanel;
