import React, { useEffect, useState } from 'react';
import { UserRound, Plus, Trash2, Pencil, Loader2, X, Save } from 'lucide-react';
import { apiFetch } from './api';
import { useToastContext } from '../../contexts/ToastContext';

// ════════════════════════════════════════════════════════════════════════════
// AgentsLibrary — CRUD visual de Agentes (reclutadores: Oscar Agent, Paty Agent…).
// Un agente = el ESTILO/persuasión de un reclutador real que conduce a Brenda.
// La guía de estilo se puede escribir a mano o pegar la propuesta que genera el
// panel de "Personalidad" (que la sintetiza de los chats reales del reclutador).
// ════════════════════════════════════════════════════════════════════════════

const EMPTY_FORM = { id: null, name: '', recruiterName: '', styleGuide: '', notes: '', color: '#2563eb' };
const COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#db2777', '#059669', '#ea580c'];

const AgentsLibrary = ({ onChange }) => {
    const { showToast } = useToastContext();
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState(EMPTY_FORM);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const data = await apiFetch('/api/brenda-training/agents');
            setAgents(data.agents || []);
            onChange?.(data.agents || []);
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const openNew = () => { setForm(EMPTY_FORM); setEditing(true); };
    const openEdit = (agent) => { setForm({ ...EMPTY_FORM, ...agent }); setEditing(true); };
    const closeForm = () => { setForm(EMPTY_FORM); setEditing(false); };

    const handleSave = async () => {
        if (!form.name.trim() || saving) return;
        setSaving(true);
        try {
            await apiFetch('/api/brenda-training/agents', { method: 'POST', body: form });
            showToast(form.id ? 'Agente actualizado' : 'Agente creado', 'success');
            closeForm();
            load();
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        try {
            await apiFetch('/api/brenda-training/agents', { method: 'DELETE', body: { id } });
            setAgents((prev) => prev.filter((a) => a.id !== id));
            onChange?.(agents.filter((a) => a.id !== id));
        } catch (e) {
            showToast(e.message, 'error');
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <UserRound className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <div>
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Agentes · reclutadores</h3>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">El estilo de cada reclutador (Oscar, Paty, Sam…). Sin nombre de empresa.</p>
                    </div>
                </div>
                {!editing && (
                    <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors">
                        <Plus className="w-4 h-4" /> Nuevo agente
                    </button>
                )}
            </div>

            {/* Formulario crear/editar */}
            {editing && (
                <div className="mb-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/10 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-blue-700 dark:text-blue-300">{form.id ? 'Editar agente' : 'Nuevo agente'}</span>
                        <button onClick={closeForm} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder='Nombre del agente (ej. "Oscar Agent")'
                            className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white outline-none focus:border-blue-500"
                        />
                        <input
                            value={form.recruiterName}
                            onChange={(e) => setForm({ ...form, recruiterName: e.target.value })}
                            placeholder='Reclutador real (ej. "Oscar")'
                            className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white outline-none focus:border-blue-500"
                        />
                    </div>
                    <textarea
                        value={form.styleGuide}
                        onChange={(e) => setForm({ ...form, styleGuide: e.target.value })}
                        placeholder="Guía de estilo: tono, tácticas, cómo reencuadra objeciones, frases reales. Puedes pegar aquí la propuesta que genera el panel de Personalidad."
                        rows={6}
                        className="w-full text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200 outline-none focus:border-blue-500 resize-none leading-relaxed"
                    />
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            {COLORS.map((c) => (
                                <button
                                    key={c}
                                    onClick={() => setForm({ ...form, color: c })}
                                    className={`w-5 h-5 rounded-full border-2 ${form.color === c ? 'border-gray-800 dark:border-white' : 'border-transparent'}`}
                                    style={{ backgroundColor: c }}
                                    title="Color"
                                />
                            ))}
                        </div>
                        <button
                            onClick={handleSave}
                            disabled={!form.name.trim() || saving}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 transition-colors"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
                        </button>
                    </div>
                </div>
            )}

            {/* Lista de agentes */}
            {loading ? (
                <p className="text-xs text-gray-400 text-center py-6">Cargando agentes…</p>
            ) : agents.length === 0 && !editing ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">Todavía no hay agentes. Crea el primero (ej. Oscar Agent).</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {agents.map((a) => (
                        <div key={a.id} className="group rounded-xl border border-gray-200 dark:border-gray-700 p-3" style={{ borderLeftWidth: 4, borderLeftColor: a.color || '#2563eb' }}>
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="text-sm font-bold text-gray-900 dark:text-white truncate">{a.name}</div>
                                    {a.recruiterName && <div className="text-[11px] text-gray-400 dark:text-gray-500">reclutador: {a.recruiterName}</div>}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => openEdit(a)} className="p-1 text-gray-400 hover:text-blue-600" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => handleDelete(a.id)} className="p-1 text-gray-400 hover:text-red-500" title="Borrar"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 line-clamp-3 leading-relaxed">
                                {a.styleGuide ? a.styleGuide.slice(0, 160) : <span className="italic text-gray-400">Sin guía de estilo todavía — edítalo para enseñarle cómo habla.</span>}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AgentsLibrary;
