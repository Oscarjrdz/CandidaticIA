import React, { useEffect, useState } from 'react';
import { Building2, Plus, Trash2, Pencil, Loader2, X, Save } from 'lucide-react';
import { apiFetch } from './api';
import { useToastContext } from '../../contexts/ToastContext';

// ════════════════════════════════════════════════════════════════════════════
// SkillsLibrary — CRUD visual de Skills (clientes: Skill Katcon, Skill Metalsa…).
// Una skill = los HECHOS CERRADOS de una vacante. Como la vacante es cerrada, la
// skill es casi una "ficha de datos" rígida: sueldo, turno, descansos, ubicación,
// beneficios (para persuadir) y reglas duras (que el agente NO puede cruzar).
// El agente persuade SOBRE estos hechos; nunca los cambia.
// ════════════════════════════════════════════════════════════════════════════

const EMPTY_FORM = {
    id: null, name: '', clientName: '',
    salary: '', schedule: '', restDays: '', location: '',
    benefits: '', rules: '', color: '#d97706'
};
const COLORS = ['#d97706', '#dc2626', '#ca8a04', '#0d9488', '#4f46e5', '#be123c'];

// Los arrays (benefits/rules) se editan como texto de líneas y se convierten
// a/desde array al guardar/cargar — más natural para escribir varias.
const toLines = (arr) => (Array.isArray(arr) ? arr.join('\n') : (arr || ''));

const SkillsLibrary = ({ onChange }) => {
    const { showToast } = useToastContext();
    const [skills, setSkills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState(EMPTY_FORM);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const data = await apiFetch('/api/brenda-training/skills');
            setSkills(data.skills || []);
            onChange?.(data.skills || []);
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
    const openEdit = (skill) => {
        setForm({ ...EMPTY_FORM, ...skill, benefits: toLines(skill.benefits), rules: toLines(skill.rules) });
        setEditing(true);
    };
    const closeForm = () => { setForm(EMPTY_FORM); setEditing(false); };

    const handleSave = async () => {
        if (!form.name.trim() || saving) return;
        setSaving(true);
        try {
            // benefits/rules van como texto de líneas; el backend los normaliza a array.
            await apiFetch('/api/brenda-training/skills', { method: 'POST', body: form });
            showToast(form.id ? 'Skill actualizada' : 'Skill creada', 'success');
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
            await apiFetch('/api/brenda-training/skills', { method: 'DELETE', body: { id } });
            setSkills((prev) => prev.filter((s) => s.id !== id));
            onChange?.(skills.filter((s) => s.id !== id));
        } catch (e) {
            showToast(e.message, 'error');
        }
    };

    const field = (label, key, placeholder) => (
        <div>
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{label}</label>
            <input
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={placeholder}
                className="w-full mt-0.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white outline-none focus:border-amber-500"
            />
        </div>
    );

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    <div>
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Skills · clientes</h3>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">Hechos cerrados de cada vacante (Katcon, Metalsa…). Datos rígidos, no negociables.</p>
                    </div>
                </div>
                {!editing && (
                    <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 transition-colors">
                        <Plus className="w-4 h-4" /> Nueva skill
                    </button>
                )}
            </div>

            {editing && (
                <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-700 dark:text-amber-300">{form.id ? 'Editar skill' : 'Nueva skill'}</span>
                        <button onClick={closeForm} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {field('Nombre de la skill', 'name', 'ej. Skill Katcon')}
                        {field('Cliente / empresa', 'clientName', 'ej. Katcon')}
                        {field('Sueldo', 'salary', 'ej. 1500 semanal')}
                        {field('Horario / turno', 'schedule', 'ej. 8 horas, turno fijo')}
                        {field('Descansos', 'restDays', 'ej. Domingos')}
                        {field('Ubicación', 'location', 'ej. Planta Santa Catarina')}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Beneficios (uno por línea — para persuadir)</label>
                            <textarea
                                value={form.benefits}
                                onChange={(e) => setForm({ ...form, benefits: e.target.value })}
                                placeholder={'Planta climatizada\nTransporte\nComedor'}
                                rows={4}
                                className="w-full mt-0.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200 outline-none focus:border-amber-500 resize-none"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Reglas duras (uno por línea — NO cruzar)</label>
                            <textarea
                                value={form.rules}
                                onChange={(e) => setForm({ ...form, rules: e.target.value })}
                                placeholder={'Sueldo no negociable\nTurno no se cambia'}
                                rows={4}
                                className="w-full mt-0.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200 outline-none focus:border-amber-500 resize-none"
                            />
                        </div>
                    </div>
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
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 transition-colors"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="text-xs text-gray-400 text-center py-6">Cargando skills…</p>
            ) : skills.length === 0 && !editing ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">Todavía no hay clientes. Crea la primera skill (ej. Skill Katcon).</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {skills.map((s) => (
                        <div key={s.id} className="group rounded-xl border border-gray-200 dark:border-gray-700 p-3" style={{ borderLeftWidth: 4, borderLeftColor: s.color || '#d97706' }}>
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="text-sm font-bold text-gray-900 dark:text-white truncate">{s.name}</div>
                                    {s.clientName && <div className="text-[11px] text-gray-400 dark:text-gray-500">cliente: {s.clientName}</div>}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => openEdit(s)} className="p-1 text-gray-400 hover:text-amber-600" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => handleDelete(s.id)} className="p-1 text-gray-400 hover:text-red-500" title="Borrar"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                            </div>
                            <div className="mt-2 space-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                                {s.salary && <div>💵 {s.salary}</div>}
                                {s.schedule && <div>🕐 {s.schedule}</div>}
                                {s.restDays && <div>🌴 Descansa: {s.restDays}</div>}
                                {s.location && <div>📍 {s.location}</div>}
                                {Array.isArray(s.benefits) && s.benefits.length > 0 && <div className="text-emerald-600 dark:text-emerald-400">✓ {s.benefits.join(' · ')}</div>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SkillsLibrary;
