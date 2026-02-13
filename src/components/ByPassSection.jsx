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
                    <div className="absolute z-[120] mt-2 w-[240px] max-h-72 overflow-y-auto bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] p-2 animate-in fade-in slide-in-from-top-2 duration-200">
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
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Horizontal Command Bar */}
            <div className="flex flex-col xl:flex-row justify-between items-center gap-6 bg-white dark:bg-slate-900 px-8 py-6 rounded-[32px] shadow-2xl shadow-blue-500/5 border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-5">
                    <div className="p-4 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-xl shadow-blue-500/20">
                        <Zap className="w-8 h-8 text-white fill-white" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter">ByPass Intelligence ⚡</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Enrutamiento Automático Sniper</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden md:flex flex-col items-end px-4 border-r border-slate-100 dark:border-slate-800">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado del Radar</span>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Escaneando Candidatos...</span>
                        </div>
                    </div>
                    <Button onClick={handleOpenCreate} icon={Plus} className="rounded-2xl px-10 py-5 text-base font-black bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-500/30 transform hover:-translate-y-1 active:scale-95 transition-all">
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
                    {rules.map((rule) => {
                        const targetProject = projects.find(p => p.id === rule.projectId);
                        return (
                            <Card key={rule.id} className="group relative overflow-hidden rounded-[32px] border-2 border-slate-50 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:shadow-xl hover:border-blue-500/50 transition-all duration-300 p-6">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-3.5 rounded-2xl flex items-center justify-center transition-all duration-500 ${rule.active ? 'bg-blue-600 shadow-lg shadow-blue-500/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                                            <Target className={`w-5 h-5 ${rule.active ? 'text-white' : 'text-slate-400'}`} />
                                        </div>
                                        <div>
                                            <h4 className="text-base font-black text-slate-900 dark:text-white truncate max-w-[140px] tracking-tight">{rule.name}</h4>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <div className={`w-1.5 h-1.5 rounded-full ${rule.active ? 'bg-blue-500' : 'bg-slate-400'}`} />
                                                <span className={`text-[9px] font-black uppercase tracking-widest ${rule.active ? 'text-blue-500' : 'text-slate-400'}`}>
                                                    {rule.active ? 'Online' : 'Pausado'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 xl:opacity-0 group-hover:opacity-100 transition-opacity translate-x-3 group-hover:translate-x-0">
                                        <button onClick={() => handleToggleActive(rule)} className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl hover:text-blue-600 transition-all"><Power className="w-4 h-4" /></button>
                                        <button onClick={() => handleEdit(rule)} className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl hover:text-blue-600 transition-all"><Pencil className="w-4 h-4" /></button>
                                        <button onClick={() => handleDelete(rule.id)} className="p-2.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl hover:text-red-500 transition-all"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50">
                                        <div className="p-2 bg-white dark:bg-slate-900 rounded-lg shadow-sm">
                                            <GitMerge className="w-4 h-4 text-blue-500" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Destino</span>
                                            <p className="text-xs font-black text-slate-800 dark:text-slate-200 truncate">{targetProject ? targetProject.name : 'No Asignado'}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {rule.categories?.map(c => <span key={c} className="px-2.5 py-1 bg-blue-50/50 dark:bg-blue-900/10 text-[9px] font-black text-blue-600 dark:text-blue-400 rounded-lg border border-blue-100/50 dark:border-blue-800/10">{c.toUpperCase()}</span>)}
                                        <span className="px-2.5 py-1 bg-slate-50 dark:bg-slate-800 text-[9px] font-black text-slate-500 rounded-lg border border-slate-100 dark:border-slate-700 shadow-sm">{rule.minAge || 0}-{rule.maxAge || 99} AÑOS</span>
                                    </div>
                                </div>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* TRUE HORIZONTAL RIBBON MODAL */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingId ? "Ajuste de Inteligencia ByPass" : "Entrenamiento de Nuevo Radar ByPass"}
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
                                <label className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Identificador Radar</label>
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
                            label="Silo Destino"
                            options={projects}
                            selected={projects.find(p => p.id === formData.projectId)?.name.toUpperCase() || ''}
                            onToggle={(name) => {
                                const proj = projects.find(p => p.name.toUpperCase() === name);
                                if (proj) setFormData({ ...formData, projectId: proj.id });
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
                            label="Categorías ADN"
                            options={categories}
                            selected={formData.categories}
                            onToggle={(v) => toggleArrayItem('categories', v)}
                            placeholder="TODAS LAS CATEGORÍAS"
                            iconSource={Layers}
                        />

                        {/* 5. MUNICIPIOS (Multi RibbonSelect) - NUEVO LEÓN */}
                        <RibbonSelect
                            label="Geografía (NL)"
                            options={MUNICIPIOS}
                            selected={formData.municipios}
                            onToggle={(v) => toggleArrayItem('municipios', v)}
                            placeholder="CUALQUIER MUNICIPIO"
                            iconSource={MapPin}
                        />

                        {/* 6. ESCOLARIDAD (Multi RibbonSelect) */}
                        <RibbonSelect
                            label="Formación"
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
                                variant="ghost"
                                onClick={() => setIsModalOpen(false)}
                                disabled={saving}
                                className="flex-1 md:flex-none rounded-3xl px-12 py-5 h-16 text-[11px] font-black uppercase tracking-widest opacity-40 hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                            >
                                Abortar
                            </Button>
                            <Button
                                onClick={handleSave}
                                disabled={saving}
                                icon={saving ? Loader2 : Save}
                                className={`flex-[2] md:flex-none rounded-3xl px-16 py-5 h-16 text-base font-black bg-blue-600 hover:bg-blue-700 shadow-2xl shadow-blue-600/30 transform hover:-translate-y-1 active:scale-[0.98] transition-all flex items-center justify-center gap-4 ${saving ? 'opacity-80' : ''}`}
                            >
                                {saving ? 'SINCRONIZANDO...' : (editingId ? 'ACTUALIZAR RADAR 🚀' : 'IMPLEMENTAR RADAR 🚀')}
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ByPassSection;
