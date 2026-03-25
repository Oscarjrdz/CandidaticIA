import React, { useState, useEffect, useRef } from 'react';
import { Zap, Plus, GitMerge, Tag, Calendar, Loader2, Save, Trash2, Pencil, Power, MapPin, GraduationCap, Users, Check, ChevronDown, X, Layers, Target, ArrowRight, ShieldCheck, ZapOff } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';

/**
 * Componente de Selección Ribbon (v4.5)
 * Soporta selección única y múltiple con estética consistente.
 */
const RibbonSelect = ({ label, options, selected, onToggle, placeholder = "Seleccionar...", iconSource: Icon, multiple = true }) => {
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

    const handleSelect = (name) => {
        onToggle(name);
        if (!multiple) setIsOpen(false);
    };

    const isItemSelected = (name) => {
        return multiple ? selected.includes(name) : selected === name;
    };

    const getDisplayValue = () => {
        if (multiple) {
            if (selected.length === 0) return <span className="text-[11px] font-bold text-slate-400">{placeholder}</span>;
            return (
                <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-blue-600 dark:text-blue-400">{selected.length}</span>
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">items</span>
                </div>
            );
        } else {
            if (!selected) return <span className="text-[11px] font-bold text-slate-400">{placeholder}</span>;
            return <span className="text-[11px] font-black text-blue-600 dark:text-blue-400 uppercase truncate">{selected}</span>;
        }
    };

    return (
        <div className="flex-1 min-w-[180px] group" ref={containerRef}>
            <div className="flex items-center gap-2 mb-1.5 px-1">
                <label className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 group-hover:text-blue-500 transition-colors">
                    {label}
                </label>
            </div>

            <div className="relative">
                <div
                    onClick={() => setIsOpen(!isOpen)}
                    className={`h-[48px] w-full px-4 border-2 rounded-xl bg-white dark:bg-slate-900/50 cursor-pointer flex items-center gap-3 transition-all duration-300 shadow-sm ${isOpen
                        ? 'border-blue-500 ring-4 ring-500/10 shadow-lg'
                        : 'border-slate-100 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700'
                        }`}
                >
                    {Icon && <Icon className={`w-4 h-4 ${(multiple ? selected.length > 0 : selected) ? 'text-blue-500' : 'text-slate-400'}`} />}
                    <div className="flex-1 truncate">
                        {getDisplayValue()}
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform duration-300 ${isOpen ? 'rotate-180 text-blue-500' : ''}`} />
                </div>

                {isOpen && (
                    <div className="absolute z-[120] mt-2 w-[240px] max-h-72 overflow-y-auto bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] p-2 slide-in-from-top-2 duration-200">
                        <div className="p-2 border-b border-slate-50 dark:border-slate-800 mb-2">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Opciones Disponibles</span>
                        </div>
                        {options.map(option => {
                            const name = typeof option === 'string' ? option : option.name;
                            const isSelected = isItemSelected(name);
                            return (
                                <div
                                    key={name}
                                    onClick={() => handleSelect(name)}
                                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all mb-1 group/item ${isSelected
                                        ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                                        }`}
                                >
                                    <span className="text-xs font-bold">{name}</span>
                                    {isSelected ? <Check className="w-4 h-4 stroke-[3px]" /> : <Plus className="w-3.5 h-3.5 opacity-0 group-hover/item:opacity-100" />}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Micro Tags Below (Only for multi) */}
            {multiple && selected.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 min-h-[16px]">
                    {selected.slice(0, 3).map(item => (
                        <span key={item} className="inline-flex items-center px-1.5 py-0.5 bg-blue-50/50 dark:bg-blue-900/10 text-[8px] font-bold text-blue-600 dark:text-blue-400 rounded border border-blue-100/30 dark:border-blue-800/20 truncate max-w-[70px]">
                            {item}
                        </span>
                    ))}
                    {selected.length > 3 && (
                        <span className="text-[8px] font-black text-slate-400 flex items-center">+ {selected.length - 3}</span>
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
    const [systemActive, setSystemActive] = useState(false);
    const [dragOverIndex, setDragOverIndex] = useState(null);

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
        "Abasolo", "Agualeguas", "Aldama", "Allende", "Anáhuac", "Apodaca", "Aramberri", "Bustamante", "Cadereyta", "Carmen", "Cerralvo", "China", "Ciénega", "Doctor Arroyo", "Doctor Coss", "Doctor González", "Galeana", "García", "San Pedro", "General Bravo", "General Escobedo", "General Terán", "General Treviño", "General Zaragoza", "General Zuazua", "Guadalupe", "Los Herreras", "Higueras", "Hualahuises", "Iturbide", "Juárez", "Lampazos", "Linares", "Marín", "Melchor Ocampo", "Mier y Noriega", "Mina", "Montemorelos", "Monterrey", "Parás", "Pesquería", "Los Ramones", "Rayones", "Sabinas", "Salinas", "San Nicolás", "Hidalgo", "Santa Catarina", "Santiago", "Vallecillo", "Villaldama"
    ];

    const ESCOLARIDADES = [
        "Sin estudios", "Primaria", "Secundaria", "Preparatoria", "Técnica", "Licenciatura"
    ];

    const GENDERS = ["Cualquiera", "Hombre", "Mujer"];

    useEffect(() => {
        loadRules();
        loadProjects();
        loadCategories();
        loadSystemStatus();
    }, []);

    const loadSystemStatus = async () => {
        try {
            const res = await fetch('/api/settings?type=bypass_enabled');
            const data = await res.json();
            if (data.success) {
                setSystemActive(data.data);
            }
        } catch (error) {
            console.error('Error loading system status:', error);
        }
    };

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

    const handleToggleSystem = async () => {
        const newValue = !systemActive;
        setSystemActive(newValue);
        try {
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'bypass_enabled', data: newValue })
            });
            showToast(newValue ? 'Sistema ByPass Activado' : 'Sistema ByPass Desactivado', 'success');
        } catch (error) {
            console.error('Error toggling system:', error);
            showToast('Error al cambiar estado del sistema', 'error');
            setSystemActive(!newValue);
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

    const handleReorder = async (newRules) => {
        setRules(newRules);
        try {
            await fetch('/api/bypass', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderedIds: newRules.map(r => r.id) })
            });
        } catch (e) {
            console.error('Reorder error:', e);
            showToast('Error al guardar el orden', 'error');
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
        <div className="space-y-4 w-full pb-8">
            {/* Master ByPass Controller: Matched to Bot IA style */}
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 flex flex-col md:flex-row items-center justify-between gap-4 min-h-[82px]">
                <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-2xl bg-blue-600 shadow-lg shadow-blue-500/20 flex items-center justify-center transition-all">
                        <Zap className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight uppercase tracking-tight">BYPASS INTELLIGENCE</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                            <p className="text-[10px] font-black tracking-widest uppercase text-blue-600 dark:text-blue-400">
                                ENRUTAMIENTO AUTOMÁTICO
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-1.5 rounded-xl shadow-sm">
                        <div className="flex flex-col">
                            <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 leading-none">Global</span>
                            <span className={`text-[10px] font-bold ${systemActive ? 'text-blue-600' : 'text-gray-400'}`}>
                                {systemActive ? 'ACTIVADO' : 'DESACTIVADO'}
                            </span>
                        </div>
                        <button
                            onClick={handleToggleSystem}
                            className={`
                                relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
                                ${systemActive ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
                            `}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${systemActive ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                    <Button onClick={handleOpenCreate} icon={Plus} className="bg-blue-600 hover:bg-blue-700 text-white h-12 px-10 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 transition-all hover:scale-[1.02]">
                        Nuevo ByPass
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-24">
                    <Loader2 className="w-16 h-16 animate-spin text-blue-500/20" />
                </div>
            ) : rules.length === 0 ? (
                <div className="py-32 text-center bg-slate-50/50 dark:bg-slate-950/20 rounded-[48px] border-4 border-dashed border-slate-100 dark:border-slate-800/50">
                    <ZapOff className="w-20 h-20 text-slate-200 mx-auto mb-6" />
                    <h3 className="text-2xl font-black text-slate-300">Sin Inteligencia de ByPass</h3>
                    <p className="text-slate-400 mt-2 font-bold italic">Configura tu primer radar para automatizar tu flujo.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {/* Priority header */}
                    <div className="flex items-center gap-3 px-4 pb-1">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest w-8 text-center">#</span>
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex-1">Regla de Bypass</span>
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Proyecto Destino</span>
                    </div>

                    {rules.map((rule, index) => {
                        const targetProject = projects.find(p => p.id === rule.projectId);
                        return (
                            <div
                                key={rule.id}
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', String(index));
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    setDragOverIndex(index);
                                }}
                                onDragLeave={() => setDragOverIndex(null)}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    setDragOverIndex(null);
                                    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
                                    if (fromIdx === index) return;
                                    const next = [...rules];
                                    const [moved] = next.splice(fromIdx, 1);
                                    next.splice(index, 0, moved);
                                    handleReorder(next);
                                }}
                                onDragEnd={() => setDragOverIndex(null)}
                                className={`group flex items-center gap-3 p-4 bg-white dark:bg-slate-900 rounded-2xl border-2 transition-all cursor-grab active:cursor-grabbing select-none ${
                                    dragOverIndex === index
                                        ? 'border-blue-400 shadow-lg shadow-blue-500/10 scale-[1.01]'
                                        : rule.active
                                        ? 'border-slate-100 dark:border-slate-800 hover:border-blue-200'
                                        : 'border-slate-100 dark:border-slate-800 opacity-60'
                                }`}
                            >
                                {/* Priority number */}
                                <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                                    <span className="text-xs font-black text-blue-600 dark:text-blue-400">{index + 1}</span>
                                </div>

                                {/* Drag handle */}
                                <div className="flex flex-col gap-[3px] opacity-30 group-hover:opacity-60 transition-opacity flex-shrink-0">
                                    <div className="w-3.5 h-0.5 bg-slate-500 rounded-full" />
                                    <div className="w-3.5 h-0.5 bg-slate-500 rounded-full" />
                                    <div className="w-3.5 h-0.5 bg-slate-500 rounded-full" />
                                </div>

                                {/* Status dot */}
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${rule.active ? 'bg-green-500' : 'bg-slate-300'}`} />

                                {/* Rule name + tags */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-black text-slate-800 dark:text-white truncate">{rule.name}</p>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {rule.categories?.map(c => (
                                            <span key={c} className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-[8px] font-black text-blue-600 dark:text-blue-400 rounded border border-blue-100/50 dark:border-blue-800/20">{c.toUpperCase()}</span>
                                        ))}
                                        <span className="px-1.5 py-0.5 bg-slate-50 dark:bg-slate-800 text-[8px] font-black text-slate-400 rounded border border-slate-100 dark:border-slate-700">{rule.minAge || 0}-{rule.maxAge || 99} años</span>
                                        {rule.gender && rule.gender !== 'Cualquiera' && (
                                            <span className="px-1.5 py-0.5 bg-purple-50 dark:bg-purple-900/20 text-[8px] font-black text-purple-600 dark:text-purple-400 rounded border border-purple-100/50">{rule.gender}</span>
                                        )}
                                    </div>
                                </div>

                                {/* Destination project */}
                                <div className="flex items-center gap-2 flex-shrink-0 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl">
                                    <GitMerge className="w-3.5 h-3.5 text-blue-400" />
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 max-w-[120px] truncate">
                                        {targetProject?.name || 'Sin asignar'}
                                    </span>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                    <button
                                        onClick={() => handleToggleActive(rule)}
                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                            rule.active ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-700'
                                        }`}
                                    >
                                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${rule.active ? 'translate-x-5' : 'translate-x-1'}`} />
                                    </button>
                                    <button onClick={() => handleEdit(rule)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl hover:text-blue-600 transition-all">
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDelete(rule.id)} className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl hover:text-red-500 transition-all">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    <p className="text-[9px] text-slate-400 text-center pt-2 font-bold uppercase tracking-widest">
                        ↕ Arrastra para cambiar la prioridad — si un candidato aplica a varias reglas, se mete al proyecto de la #1
                    </p>
                </div>
            )}

            {/* TRUE HORIZONTAL RIBBON MODAL */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingId ? "Ajuste de ByPass" : "Configuración de ByPass"}
                maxWidth="max-w-[95vw]"
            >
                <div className="p-8 space-y-12">
                    {/* UNIFIED HORIZONTAL RIBBON v5.0 */}
                    <div className="flex flex-col 2xl:flex-row items-stretch gap-8 bg-white dark:bg-slate-900/80 p-8 rounded-[48px] border-2 border-slate-100 dark:border-slate-800/50 shadow-2xl relative overflow-visible">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-[80px] -mr-32 -mt-32 pointer-events-none" />

                        {/* 1. IDENTIFIER (Always Input) */}
                        <div className="w-full 2xl:w-[280px] space-y-3">
                            <div className="flex items-center gap-2 px-1">
                                <Tag className="w-3.5 h-3.5 text-blue-500" />
                                <label className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Nombre de By Pass</label>
                            </div>
                            <Input
                                placeholder="Ej. Sniper MTY Centro"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="text-sm font-black py-4 px-5 rounded-xl border-2 focus:ring-8 focus:ring-blue-100/20 transition-all uppercase"
                            />
                        </div>

                        <div className="hidden 2xl:block w-px bg-slate-100 dark:bg-slate-800 my-4" />

                        {/* 2. TARGET PROJECT (Single RibbonSelect) */}
                        <RibbonSelect
                            label="Proyecto Destino"
                            options={projects}
                            selected={projects.find(p => p.id === formData.projectId)?.name || ''}
                            onToggle={(name) => {
                                const proj = projects.find(p => p.name === name);
                                if (proj) {
                                    setFormData({ ...formData, projectId: proj.id });
                                } else {
                                    console.error('Project not found by name:', name);
                                }
                            }}
                            placeholder="SELECCIONAR PROYECTO"
                            iconSource={GitMerge}
                            multiple={false}
                        />

                        {/* 3. GENDER (Single RibbonSelect) */}
                        <RibbonSelect
                            label="Género"
                            options={GENDERS}
                            selected={formData.gender.toUpperCase()}
                            onToggle={(v) => setFormData({ ...formData, gender: v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() })}
                            placeholder="CUALQUIERA"
                            iconSource={Users}
                            multiple={false}
                        />

                        {/* 4. CATEGORIES (Multi RibbonSelect) */}
                        <RibbonSelect
                            label="Categorías"
                            options={categories}
                            selected={formData.categories}
                            onToggle={(v) => toggleArrayItem('categories', v)}
                            placeholder="TODAS LAS CATEGORÍAS"
                            iconSource={Layers}
                        />

                        {/* 5. MUNICIPIOS (Multi RibbonSelect) - NUEVO LEÓN */}
                        <RibbonSelect
                            label="Municipio"
                            options={MUNICIPIOS}
                            selected={formData.municipios}
                            onToggle={(v) => toggleArrayItem('municipios', v)}
                            placeholder="CUALQUIER MUNICIPIO"
                            iconSource={MapPin}
                        />

                        {/* 6. ESCOLARIDAD (Multi RibbonSelect) */}
                        <RibbonSelect
                            label="Escolaridad"
                            options={ESCOLARIDADES}
                            selected={formData.escolaridades}
                            onToggle={(v) => toggleArrayItem('escolaridades', v)}
                            placeholder="CUALQUIER GRADO"
                            iconSource={GraduationCap}
                        />

                        {/* 7. AGE GROUP (Compact) */}
                        <div className="w-full 2xl:w-[150px] space-y-3">
                            <div className="flex items-center gap-2 px-1">
                                <Calendar className="w-3.5 h-3.5 text-blue-500" />
                                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Edad</label>
                            </div>
                            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-2 rounded-xl border border-slate-100 dark:border-slate-700">
                                <input
                                    type="number"
                                    placeholder="18"
                                    value={formData.minAge}
                                    onChange={(e) => setFormData({ ...formData, minAge: e.target.value })}
                                    className="w-10 bg-transparent text-center text-[11px] font-black outline-none"
                                />
                                <span className="text-slate-300">/</span>
                                <input
                                    type="number"
                                    placeholder="55"
                                    value={formData.maxAge}
                                    onChange={(e) => setFormData({ ...formData, maxAge: e.target.value })}
                                    className="w-10 bg-transparent text-center text-[11px] font-black outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* ACTION DOCK */}
                    <div className="flex flex-col md:flex-row justify-between items-center gap-6 pt-10 border-t-4 border-slate-50 dark:border-slate-900">
                        <div className="flex items-center gap-3 text-slate-400 group cursor-help">
                            <div className="p-2 bg-slate-50 dark:bg-slate-900 rounded-full group-hover:bg-blue-50 transition-colors">
                                <ShieldCheck className="w-5 h-5 group-hover:text-blue-500" />
                            </div>
                            <p className="text-[10px] font-bold italic leading-tight">
                                Al guardar, Brenda aplicará esta inteligencia en tiempo real <br /> cada vez que un candidato califique en el ADN seleccionado.
                            </p>
                        </div>

                        <div className="flex items-center gap-6 w-full md:w-auto">
                            <Button
                                onClick={handleSave}
                                disabled={saving}
                                icon={saving ? Loader2 : Save}
                                className={`flex-1 md:flex-none rounded-3xl px-16 py-5 h-16 text-base font-black bg-blue-600 hover:bg-blue-700 shadow-2xl shadow-blue-600/30 transform hover:-translate-y-1 active:scale-[0.98] transition-all flex items-center justify-center gap-4 ${saving ? 'opacity-80' : ''}`}
                            >
                                {saving ? 'GUARDANDO...' : 'GUARDAR 🚀'}
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ByPassSection;
