import React, { useState, useEffect, useRef } from 'react';
import { Zap, Plus, GitMerge, Tag, Calendar, Loader2, Save, Trash2, Pencil, Power, MapPin, GraduationCap, Users, Check, ChevronDown, X, Layers, Target, ArrowRight } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';

/**
 * Componente de Multiselección Horizontal Ultra-Compacto (v3.0)
 */
const MultiSelect = ({ label, options, selected, onToggle, placeholder = "Seleccionar...", iconSource: Icon }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="flex-1 min-w-[200px] flex flex-col gap-2" ref={containerRef}>
            <div className="flex items-center gap-2 px-1">
                <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    {Icon && <Icon className="w-3.5 h-3.5 text-slate-400" />}
                </div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                    {label}
                </label>
            </div>

            <div className="relative">
                <div
                    onClick={() => setIsOpen(!isOpen)}
                    className={`min-h-[44px] w-full px-3 py-2 border-2 rounded-xl bg-white dark:bg-gray-950 cursor-pointer flex items-center transition-all duration-300 shadow-sm ${isOpen
                            ? 'border-blue-500 ring-2 ring-blue-500/10 shadow-lg'
                            : 'border-slate-100 dark:border-slate-800/50 hover:border-blue-300 dark:hover:border-blue-700'
                        }`}
                >
                    <div className="flex-1 truncate">
                        {selected.length === 0 ? (
                            <span className="text-xs font-semibold text-slate-400">{placeholder}</span>
                        ) : (
                            <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                {selected.length} {selected.length === 1 ? 'seleccionado' : 'seleccionados'}
                            </span>
                        )}
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-blue-500' : ''}`} />
                </div>

                {isOpen && (
                    <div className="absolute z-[110] mt-2 w-full max-h-60 overflow-y-auto bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl shadow-2xl p-2 animate-in fade-in slide-in-from-top-1 duration-200">
                        {options.map(option => {
                            const name = typeof option === 'string' ? option : option.name;
                            const isSelected = selected.includes(name);
                            return (
                                <div
                                    key={name}
                                    onClick={() => onToggle(name)}
                                    className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all mb-0.5 ${isSelected
                                        ? 'bg-blue-600 text-white'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                                        }`}
                                >
                                    <span className="text-xs font-bold">{name}</span>
                                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3px]" />}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {selected.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                    {selected.slice(0, 2).map(item => (
                        <span key={item} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-[9px] font-black text-blue-600 dark:text-blue-400 rounded-lg border border-blue-100 dark:border-blue-800/40 truncate max-w-[80px]">
                            {item}
                        </span>
                    ))}
                    {selected.length > 2 && (
                        <span className="text-[9px] font-black text-slate-400 pl-1">+{selected.length - 2}</span>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * Sección de Gestión de ByPass (Enrutamiento Automático)
 */
const ByPassSection = ({ showToast }) => {
    const [rules, setRules] = useState([]);
    const [projects, setProjects] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        projectId: '',
        minAge: '',
        maxAge: '',
        municipios: [],
        escolaridades: [],
        categories: [],
        gender: 'Cualquiera'
    });

    const MUNICIPIOS = [
        "Aguascalientes", "Asientos", "Calvillo", "Cosío", "Jesús María", "Pabellón de Arteaga", "Rincón de Romos", "San José de Gracia", "Tepezalá", "El Llano", "San Francisco de los Romo"
    ];

    const ESCOLARIDADES = [
        "Primaria", "Secundaria", "Preparatoria", "Técnica", "Licenciatura", "Maestría"
    ];

    const GENDERS = ["Cualquiera", "Hombre", "Mujer"];

    useEffect(() => {
        loadRules();
        loadProjects();
        loadCategories();
    }, []);

    const loadRules = async () => {
        try {
            const res = await fetch('/api/bypass');
            const data = await res.json();
            if (data.success) {
                setRules(data.data || []);
            }
        } catch (error) {
            console.error('Error loading rules:', error);
            showToast('Error al cargar reglas ByPass', 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadProjects = async () => {
        try {
            const res = await fetch('/api/projects');
            const data = await res.json();
            if (data.success) {
                setProjects(data.projects || []);
            }
        } catch (e) {
            console.error('Error loading projects:', e);
        }
    };

    const loadCategories = async () => {
        try {
            const res = await fetch('/api/categories');
            const data = await res.json();
            if (data.success) {
                setCategories(data.data || []);
            }
        } catch (e) {
            console.error('Error loading categories:', e);
        }
    };

    const handleOpenCreate = () => {
        setEditingId(null);
        setFormData({
            name: '',
            projectId: '',
            minAge: '',
            maxAge: '',
            municipios: [],
            escolaridades: [],
            categories: [],
            gender: 'Cualquiera'
        });
        setIsModalOpen(true);
    };

    const handleEdit = (rule) => {
        setEditingId(rule.id);
        setFormData({
            name: rule.name,
            projectId: rule.projectId,
            minAge: rule.minAge || '',
            maxAge: rule.maxAge || '',
            municipios: rule.municipios || [],
            escolaridades: rule.escolaridades || [],
            categories: rule.categories || [],
            gender: rule.gender || 'Cualquiera'
        });
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.name || !formData.projectId) {
            showToast('El nombre y el proyecto de destino son obligatorios', 'error');
            return;
        }

        setSaving(true);
        try {
            const method = editingId ? 'PUT' : 'POST';
            const body = editingId ? { ...formData, id: editingId } : formData;

            const res = await fetch('/api/bypass', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (data.success) {
                showToast(editingId ? 'Regla actualizada' : 'Regla ByPass creada exitosamente', 'success');
                setIsModalOpen(false);
                loadRules();
            } else {
                showToast(data.error || 'Error al guardar', 'error');
            }
        } catch (error) {
            console.error('Error saving rule:', error);
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (rule) => {
        try {
            const res = await fetch('/api/bypass', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: rule.id, active: !rule.active })
            });
            if (res.ok) {
                showToast('Estado actualizado', 'success');
                loadRules();
            }
        } catch (error) {
            console.error('Error updating rule:', error);
            showToast('Error al actualizar', 'error');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('¿Seguro que deseas eliminar esta regla de ByPass?')) return;

        try {
            const res = await fetch(`/api/bypass?id=${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                showToast('Regla eliminada', 'success');
                loadRules();
            }
        } catch (error) {
            console.error('Error deleting rule:', error);
            showToast('Error al eliminar', 'error');
        }
    };

    const toggleArrayItem = (field, value) => {
        setFormData(prev => {
            const current = prev[field] || [];
            if (current.includes(value)) {
                return { ...prev, [field]: current.filter(i => i !== value) };
            } else {
                return { ...prev, [field]: [...current, value] };
            }
        });
    };

    return (
        <div className="space-y-8 p-4">
            {/* Main Header */}
            <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-6 rounded-[24px] shadow-sm border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/30">
                        <Zap className="w-7 h-7 text-white fill-white" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">ByPass Intelligence ⚡</h2>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Enrutamiento Automático de ADN</p>
                    </div>
                </div>
                <Button onClick={handleOpenCreate} icon={Plus} className="rounded-2xl px-8 py-4 font-black bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all">
                    Nuevo ByPass
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-24">
                    <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
                </div>
            ) : rules.length === 0 ? (
                <div className="py-24 text-center bg-slate-50 dark:bg-slate-900/50 rounded-[40px] border-4 border-dashed border-slate-100 dark:border-slate-800">
                    <Layers className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                    <h3 className="text-xl font-black text-slate-400">Sin reglas configuradas</h3>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {rules.map((rule) => {
                        const targetProject = projects.find(p => p.id === rule.projectId);
                        return (
                            <Card key={rule.id} className="group relative overflow-hidden rounded-[32px] border-2 border-slate-50 dark:border-slate-800/50 bg-white dark:bg-slate-900 hover:border-blue-500 transition-all duration-300 p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${rule.active ? 'bg-blue-600 shadow-md shadow-blue-500/20' : 'bg-slate-100 dark:bg-slate-800'} transition-all`}>
                                            <Target className={`w-5 h-5 ${rule.active ? 'text-white' : 'text-slate-400'}`} />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-black text-slate-900 dark:text-white truncate max-w-[150px]">{rule.name}</h4>
                                            <span className={`text-[9px] font-black uppercase tracking-tighter ${rule.active ? 'text-blue-500' : 'text-slate-400'}`}>
                                                {rule.active ? 'Activo' : 'Pausado'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleToggleActive(rule)} className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg hover:text-blue-600 transition-colors"><Power className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => handleEdit(rule)} className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg hover:text-blue-600 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => handleDelete(rule.id)} className="p-2 bg-red-50 dark:bg-red-900/10 rounded-lg hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mb-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-700/50">
                                    <GitMerge className="w-4 h-4 text-blue-500" />
                                    <span className="text-[11px] font-black text-slate-700 dark:text-slate-300 truncate">
                                        {targetProject ? targetProject.name : 'Desconocido'}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-[9px] font-black text-slate-500 rounded-lg italic border border-slate-100">
                                        {rule.minAge || 0}-{rule.maxAge || 99} años
                                    </span>
                                    {rule.categories?.map(c => <span key={c} className="px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-[9px] font-black text-blue-600 rounded-lg">{c}</span>)}
                                </div>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* CINEMA WIDE MODAL - STRICTLY HORIZONTAL */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingId ? "Editar Inteligencia" : "Nuevo Enrutamiento"}
                maxWidth="screen-2xl"
            >
                <div className="p-6 space-y-10">
                    {/* Identity Bar */}
                    <div className="flex flex-col xl:flex-row items-center gap-8 bg-slate-50/50 dark:bg-slate-800/30 p-6 rounded-[32px] border-2 border-slate-100 dark:border-slate-800/50">
                        <div className="flex-1 w-full space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-2">Identificador</label>
                            <Input
                                placeholder="Ej. Sniper Operadores CDMX"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="text-base font-black py-4 rounded-2xl border-2 focus:ring-4 focus:ring-blue-500/10"
                            />
                        </div>

                        <ArrowRight className="hidden xl:block w-6 h-6 text-slate-200" />

                        <div className="flex-1 w-full space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-2">Silo (Proyecto) Destino</label>
                            <div className="relative">
                                <GitMerge className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 z-10" />
                                <select
                                    className="w-full pl-12 pr-12 py-4 border-2 border-slate-200 dark:border-slate-800 rounded-2xl outline-none bg-white dark:bg-gray-950 text-sm font-black appearance-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                                    value={formData.projectId}
                                    onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                                >
                                    <option value="">-- SELECCIONAR DESTINO --</option>
                                    {projects.map(p => (
                                        <option key={p.id} value={p.id}>{p.name.toUpperCase()}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                            </div>
                        </div>

                        <div className="w-full xl:w-72 space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-2">Género</label>
                            <div className="flex bg-white dark:bg-gray-950 p-1.5 rounded-2xl border-2 border-slate-200 dark:border-slate-800">
                                {GENDERS.map(g => (
                                    <button
                                        key={g}
                                        onClick={() => setFormData({ ...formData, gender: g })}
                                        className={`flex-1 py-2 text-[10px] font-black rounded-xl transition-all ${formData.gender === g ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                                    >
                                        {g.toUpperCase()}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* FILTERS DASHBOARD - HORIZONTAL ROW */}
                    <div className="space-y-4">
                        <h4 className="text-[11px] font-black text-slate-900 dark:text-white uppercase tracking-[0.2em] border-l-4 border-blue-500 pl-3">DNA Sniper Filters 🎯</h4>
                        <div className="flex flex-col lg:flex-row items-start gap-8 bg-white dark:bg-slate-950/20 p-8 rounded-[40px] border-2 border-slate-50 dark:border-slate-800/10 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/5 rounded-full blur-[100px] -mr-48 -mt-48" />

                            {/* Age Column (Manual) */}
                            <div className="w-full lg:w-48 space-y-3 relative z-10">
                                <div className="flex items-center gap-2 px-1">
                                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                    </div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Rango Edad</label>
                                </div>
                                <div className="flex items-center gap-2 bg-slate-50/50 dark:bg-slate-800 p-2 rounded-xl">
                                    <input
                                        type="number"
                                        placeholder="Min"
                                        value={formData.minAge}
                                        onChange={(e) => setFormData({ ...formData, minAge: e.target.value })}
                                        className="w-full bg-white dark:bg-gray-900 border border-slate-100 dark:border-slate-700 rounded-lg p-2 text-xs font-black text-center outline-none focus:ring-2 focus:ring-blue-500/20"
                                    />
                                    <span className="text-slate-300 font-bold">/</span>
                                    <input
                                        type="number"
                                        placeholder="Max"
                                        value={formData.maxAge}
                                        onChange={(e) => setFormData({ ...formData, maxAge: e.target.value })}
                                        className="w-full bg-white dark:bg-gray-900 border border-slate-100 dark:border-slate-700 rounded-lg p-2 text-xs font-black text-center outline-none focus:ring-2 focus:ring-blue-500/20"
                                    />
                                </div>
                            </div>

                            {/* Separator */}
                            <div className="hidden lg:block w-px h-24 bg-slate-100 dark:bg-slate-800" />

                            <MultiSelect
                                label="Categorías"
                                options={categories}
                                selected={formData.categories}
                                onToggle={(v) => toggleArrayItem('categories', v)}
                                placeholder="TODAS"
                                iconSource={Tag}
                            />

                            <div className="hidden lg:block w-px h-24 bg-slate-100 dark:bg-slate-800" />

                            <MultiSelect
                                label="Municipios"
                                options={MUNICIPIOS}
                                selected={formData.municipios}
                                onToggle={(v) => toggleArrayItem('municipios', v)}
                                placeholder="TODOS"
                                iconSource={MapPin}
                            />

                            <div className="hidden lg:block w-px h-24 bg-slate-100 dark:bg-slate-800" />

                            <MultiSelect
                                label="Escolaridad"
                                options={ESCOLARIDADES}
                                selected={formData.escolaridades}
                                onToggle={(v) => toggleArrayItem('escolaridades', v)}
                                placeholder="CUALQUIERA"
                                iconSource={GraduationCap}
                            />
                        </div>
                    </div>

                    {/* Bottom Controls */}
                    <div className="flex justify-end gap-4 pt-4">
                        <Button variant="ghost" onClick={() => setIsModalOpen(false)} disabled={saving} className="rounded-2xl px-12 py-4 h-14 text-[11px] font-black uppercase tracking-widest opacity-60 hover:opacity-100 transition-opacity">
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving}
                            icon={saving ? Loader2 : Save}
                            className="rounded-2xl px-16 py-4 h-14 text-sm font-black bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-500/30 transform hover:-translate-y-1 transition-all"
                        >
                            {saving ? 'GUARDANDO...' : 'FIRE BYPASS RELOAD 🚀'}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ByPassSection;
