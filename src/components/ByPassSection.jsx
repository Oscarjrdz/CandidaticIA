import React, { useState, useEffect, useRef } from 'react';
import { Zap, Plus, GitMerge, Tag, Calendar, Loader2, Save, Trash2, Pencil, Power, MapPin, GraduationCap, Users, Check, ChevronDown, X, Layers, Target } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';

/**
 * Componente de Multiselección Premium (v2.0)
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
        <div className="space-y-2 group" ref={containerRef}>
            <div className="flex items-center justify-between px-1">
                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400 group-hover:text-blue-500 transition-colors">
                    {label}
                </label>
                <span className="text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
                    {selected.length} seleccionados
                </span>
            </div>
            <div className="relative">
                <div
                    onClick={() => setIsOpen(!isOpen)}
                    className={`min-h-[46px] w-full pl-4 pr-12 py-2 border-2 rounded-2xl bg-white dark:bg-gray-900 cursor-pointer flex flex-wrap gap-2 items-center transition-all duration-300 shadow-sm ${isOpen
                        ? 'border-blue-500 ring-4 ring-blue-500/10 shadow-lg'
                        : 'border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700'
                        }`}
                >
                    {Icon && <Icon className={`w-4 h-4 transition-colors ${selected.length > 0 ? 'text-blue-500' : 'text-gray-400'}`} />}
                    {selected.length === 0 ? (
                        <span className="text-sm font-medium text-gray-400">{placeholder}</span>
                    ) : (
                        <div className="flex flex-wrap gap-1.5 flex-1 pr-4">
                            {selected.map(item => (
                                <span
                                    key={item}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[11px] font-bold rounded-xl border border-blue-100/50 dark:border-blue-800/40 animate-in zoom-in duration-200"
                                >
                                    {item}
                                    <X
                                        className="w-3 h-3 hover:text-blue-800 dark:hover:text-blue-200 cursor-pointer transition-colors"
                                        onClick={(e) => { e.stopPropagation(); onToggle(item); }}
                                    />
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180 text-blue-500' : ''}`} />
                    </div>
                </div>

                {isOpen && (
                    <div className="absolute z-[100] mt-3 w-full max-h-72 overflow-y-auto bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-[28px] shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-3 animate-in fade-in slide-in-from-top-2 duration-300 scrollbar-thin">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1">
                            {options.map(option => {
                                const name = typeof option === 'string' ? option : option.name;
                                const isSelected = selected.includes(name);
                                return (
                                    <div
                                        key={name}
                                        onClick={() => onToggle(name)}
                                        className={`flex items-center justify-between px-4 py-3 rounded-2xl cursor-pointer transition-all duration-200 group/item ${isSelected
                                            ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30'
                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                                            }`}
                                    >
                                        <span className={`text-[13px] font-bold ${isSelected ? 'text-white' : 'group-hover/item:text-blue-600'}`}>{name}</span>
                                        {isSelected && <Check className="w-4 h-4 stroke-[3px]" />}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
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
                // FIXED: API returns data.projects, not data.data
                setProjects(data.projects || []);
                console.log(`[ByPass] Projects Loaded: ${data.projects?.length}`);
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
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white/40 dark:bg-slate-800/20 backdrop-blur-xl p-8 rounded-[40px] border border-white dark:border-slate-700/50 shadow-2xl shadow-blue-500/5">
                <div className="flex items-center gap-6">
                    <div className="p-4 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-[28px] shadow-lg shadow-orange-500/20 rotate-3 group-hover:rotate-0 transition-transform duration-500">
                        <Zap className="w-8 h-8 text-white fill-white" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-black text-slate-900 dark:text-white flex items-center gap-3 tracking-tighter">
                            ByPass Intelligence ⚡
                        </h2>
                        <p className="text-slate-500 dark:text-gray-400 font-medium max-w-md">
                            Crea flujos de enrutamiento automático conectando el ADN de tus candidatos con tus proyectos estratégicos.
                        </p>
                    </div>
                </div>
                <Button
                    onClick={handleOpenCreate}
                    icon={Plus}
                    className="rounded-3xl px-10 py-6 text-lg font-black bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-500/30 transform hover:-translate-y-1 active:scale-95 transition-all"
                >
                    Nueva Regla
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-blue-100 dark:border-blue-900/30 rounded-full animate-pulse" />
                        <Loader2 className="w-16 h-16 animate-spin text-blue-500 absolute inset-0" />
                    </div>
                </div>
            ) : rules.length === 0 ? (
                <div className="bg-white/40 dark:bg-slate-800/20 backdrop-blur-xl border-4 border-dashed border-slate-200 dark:border-slate-700 rounded-[48px] p-24 text-center">
                    <div className="max-w-md mx-auto">
                        <div className="w-24 h-24 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
                            <Layers className="w-10 h-10 text-blue-500" />
                        </div>
                        <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-4 tracking-tight">
                            Radar de Enrutamiento Inactivo
                        </h3>
                        <p className="text-slate-500 dark:text-slate-400 font-medium mb-10 leading-relaxed">
                            No tienes reglas activas. Configura tu primer ByPass para que Brenda envíe candidatos calificados automáticamente a sus proyectos.
                        </p>
                        <Button onClick={handleOpenCreate} variant="outline" icon={Plus} className="rounded-full px-8 py-4 border-2">
                            Inicializar Primer ByPass
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                    {rules.map((rule) => {
                        const targetProject = projects.find(p => p.id === rule.projectId);
                        return (
                            <Card key={rule.id} className="group relative overflow-hidden rounded-[40px] border-none bg-white dark:bg-slate-900/40 shadow-xl hover:shadow-[0_20px_60px_-15px_rgba(30,58,138,0.15)] transition-all duration-500 p-8">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-500/5 to-purple-500/5 rounded-full blur-3xl -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-1000" />

                                <div className="relative z-10 space-y-6">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-4">
                                            <div className={`p-4 rounded-2xl ${rule.active ? 'bg-blue-600 shadow-lg shadow-blue-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'} transition-all duration-500`}>
                                                <Target className={`w-6 h-6 ${rule.active ? 'text-white' : ''}`} />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-tight group-hover:text-blue-600 transition-colors">
                                                    {rule.name}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <div className={`w-2 h-2 rounded-full ${rule.active ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}`} />
                                                    <span className={`text-[10px] font-black uppercase tracking-widest ${rule.active ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>
                                                        {rule.active ? 'En Línea' : 'Pausado'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex bg-slate-50 dark:bg-slate-800/50 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-700/50 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-4 group-hover:translate-x-0">
                                            <button onClick={() => handleToggleActive(rule)} className={`p-2 rounded-xl transition-all ${rule.active ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
                                                <Power className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleEdit(rule)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-white dark:hover:bg-slate-700 rounded-xl transition-all">
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleDelete(rule.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-xl transition-all">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="bg-slate-50/50 dark:bg-slate-800/30 rounded-3xl p-5 border border-white dark:border-slate-800">
                                        <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400 mb-2">
                                            <GitMerge className="w-5 h-5" />
                                            <span className="text-sm font-black uppercase tracking-tighter">Silo de Destino</span>
                                        </div>
                                        <div className="text-lg font-bold text-slate-800 dark:text-white pl-8">
                                            {targetProject ? targetProject.name : 'No asignado'}
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        {(rule.minAge || rule.maxAge) && (
                                            <span className="px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-[11px] font-bold border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-2 uppercase tracking-tighter">
                                                <Calendar className="w-3.5 h-3.5" />
                                                {rule.minAge || '0'} - {rule.maxAge || '99'} años
                                            </span>
                                        )}
                                        {rule.gender !== 'Cualquiera' && (
                                            <span className="px-3 py-1.5 bg-pink-50/50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400 rounded-xl text-[11px] font-bold border border-pink-100 dark:border-pink-800/40 shadow-sm flex items-center gap-2 uppercase tracking-tighter">
                                                <Users className="w-3.5 h-3.5" />
                                                {rule.gender}
                                            </span>
                                        )}
                                    </div>

                                    <div className="space-y-4 pt-2">
                                        {rule.categories?.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {rule.categories.map(cat => (
                                                    <span key={cat} className="px-2.5 py-1 bg-blue-50/50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400 rounded-lg text-[10px] font-bold border border-blue-100/30 dark:border-blue-800/30">
                                                        {cat}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex flex-wrap gap-1.5">
                                            {rule.municipios?.map(mun => (
                                                <span key={mun} className="px-2.5 py-1 bg-slate-100/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 rounded-lg text-[10px] font-bold border border-slate-200/50 dark:border-slate-700/50">
                                                    {mun}
                                                </span>
                                            ))}
                                            {rule.escolaridades?.map(esc => (
                                                <span key={esc} className="px-2.5 py-1 bg-slate-100/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 rounded-lg text-[10px] font-bold border border-slate-200/50 dark:border-slate-700/50">
                                                    {esc}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Create/Edit Modal - ULTRA WIDE LAYOUT */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingId ? "Editar Inteligencia de ByPass" : "Entrenar Nueva Regla de ByPass"}
                maxWidth="7xl"
            >
                <div className="px-4 py-4 space-y-8">
                    {/* TOP SECTION: Identity and Destination */}
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                        <div className="xl:col-span-5 space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Identificador de la Regla</label>
                            <Input
                                placeholder="Ej. Filtro Sniper CDMX - Logística"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="text-base font-bold py-3 rounded-[20px] border-2 focus:ring-8 focus:ring-blue-100/20"
                                autoFocus
                            />
                            <p className="text-[10px] text-slate-400 px-2 leading-relaxed">Este nombre es sólo para organización interna. Ejemplo: "Choferes Senior Norte".</p>
                        </div>

                        <div className="xl:col-span-4 space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Silo (Proyecto) de Destino</label>
                            <div className="relative group">
                                <GitMerge className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 z-10 transition-transform group-hover:scale-110" />
                                <select
                                    className="w-full pl-12 pr-12 py-3.5 border-2 border-slate-100 dark:border-slate-800 rounded-[20px] focus:ring-8 focus:ring-blue-100/20 outline-none bg-white dark:bg-gray-900 text-slate-900 dark:text-white text-sm font-bold appearance-none cursor-pointer hover:border-blue-400 transition-all shadow-sm"
                                    value={formData.projectId}
                                    onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                                >
                                    <option value="">-- SELECCIONAR PROYECTO --</option>
                                    {projects.map(p => (
                                        <option key={p.id} value={p.id}>{p.name.toUpperCase()}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 pointer-events-none" />
                            </div>
                            <p className="text-[10px] text-slate-400 px-2 italic">Los candidatos que cumplan los filtros se moverán aquí automáticamente.</p>
                        </div>

                        <div className="xl:col-span-3 space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Filtro de Género</label>
                            <div className="flex bg-slate-100 dark:bg-slate-800 p-2 rounded-[24px] border-2 border-slate-50 dark:border-slate-800 shadow-inner">
                                {GENDERS.map(g => (
                                    <button
                                        key={g}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, gender: g })}
                                        className={`flex-1 py-2 text-xs font-black rounded-xl transition-all duration-300 ${formData.gender === g
                                            ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-xl shadow-blue-500/10'
                                            : 'text-slate-400 hover:text-slate-600'}`}
                                    >
                                        {g}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="h-0.5 bg-gradient-to-r from-transparent via-slate-100 dark:via-slate-800 to-transparent my-2" />

                    {/* FILTERS SECTION: ADN Data */}
                    <div className="space-y-8">
                        {/* Row 1: Age and Categories */}
                        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                            <div className="xl:col-span-4 space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Configuración de Edad</label>
                                <div className="bg-slate-50/50 dark:bg-slate-800/40 p-6 rounded-[24px] border-2 border-slate-100 dark:border-slate-700/50 space-y-4">
                                    <div className="flex items-center gap-4">
                                        <div className="flex-1 space-y-1">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-2">Mín</span>
                                            <input
                                                type="number"
                                                placeholder="18"
                                                value={formData.minAge}
                                                onChange={(e) => setFormData({ ...formData, minAge: e.target.value })}
                                                className="w-full text-xl font-black p-3 text-center bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none"
                                            />
                                        </div>
                                        <div className="text-xl font-black text-slate-200 pt-6">/</div>
                                        <div className="flex-1 space-y-1">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-2">Máx</span>
                                            <input
                                                type="number"
                                                placeholder="55"
                                                value={formData.maxAge}
                                                onChange={(e) => setFormData({ ...formData, maxAge: e.target.value })}
                                                className="w-full text-xl font-black p-3 text-center bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-xl border border-blue-100/50 dark:border-blue-800/50">
                                        <div className="w-2 h-2 rounded-full bg-blue-500 shadow-sm" />
                                        <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 italic">
                                            Tip: Deja los campos vacíos para omitir este filtro.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="xl:col-span-8 flex flex-col justify-end">
                                <MultiSelect
                                    label="Segmentación por Categorías"
                                    options={categories}
                                    selected={formData.categories}
                                    onToggle={(val) => toggleArrayItem('categories', val)}
                                    placeholder="TODAS LAS CATEGORÍAS"
                                    iconSource={Tag}
                                />
                                <p className="text-[11px] text-slate-400 mt-4 px-2 italic font-medium">Puedes elegir múltiples etiquetas. El sistema hará "Match" si el candidato tiene al menos una de las seleccionadas.</p>
                            </div>
                        </div>

                        {/* Row 2: Location and Education */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                            <MultiSelect
                                label="Filtro Geográfico (Municipios)"
                                options={MUNICIPIOS}
                                selected={formData.municipios}
                                onToggle={(val) => toggleArrayItem('municipios', val)}
                                placeholder="CUALQUIER UBICACIÓN"
                                iconSource={MapPin}
                            />
                            <MultiSelect
                                label="Nivel Educativo (Escolaridad)"
                                options={ESCOLARIDADES}
                                selected={formData.escolaridades}
                                onToggle={(val) => toggleArrayItem('escolaridades', val)}
                                placeholder="CUALQUIER NIVEL DE ESTUDIO"
                                iconSource={GraduationCap}
                            />
                        </div>
                    </div>

                    {/* ACTION BUTTONS */}
                    <div className="flex flex-col sm:flex-row justify-end gap-6 pt-8 border-t-2 border-slate-50 dark:border-slate-800/50">
                        <Button
                            variant="ghost"
                            onClick={() => setIsModalOpen(false)}
                            disabled={saving}
                            className="rounded-[28px] px-12 py-3 h-14 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 font-black uppercase tracking-widest text-xs transition-all"
                        >
                            Abortar
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving}
                            icon={saving ? Loader2 : Save}
                            className={`rounded-[28px] px-16 py-3 h-14 text-base font-black bg-blue-600 hover:bg-blue-700 shadow-[0_20px_40px_-10px_rgba(37,99,235,0.4)] transform hover:-translate-y-1 transition-all flex items-center gap-3 ${saving ? 'opacity-80' : ''}`}
                        >
                            {saving ? 'PROCESANDO...' : (editingId ? 'ACTUALIZAR' : 'GUARDAR')}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ByPassSection;
