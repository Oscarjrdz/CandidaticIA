import React, { useState, useEffect, useRef } from 'react';
import { Zap, Plus, GitMerge, Tag, Calendar, Loader2, Save, Trash2, Pencil, Power, MapPin, GraduationCap, Users, Check, ChevronDown, X } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';

/**
 * Componente de Multiselección Estilizado
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
        <div className="space-y-1.5" ref={containerRef}>
            <label className="block text-xs font-black uppercase tracking-widest text-gray-400">
                {label}
            </label>
            <div className="relative">
                <div
                    onClick={() => setIsOpen(!isOpen)}
                    className="min-h-[42px] w-full pl-3 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-900 cursor-pointer flex flex-wrap gap-1 items-center hover:border-blue-400 transition-colors"
                >
                    {Icon && <Icon className="w-4 h-4 text-gray-400 mr-1" />}
                    {selected.length === 0 ? (
                        <span className="text-sm text-gray-400">{placeholder}</span>
                    ) : (
                        selected.map(item => (
                            <span
                                key={item}
                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-[10px] font-bold rounded-md border border-blue-100 dark:border-blue-800/40"
                            >
                                {item}
                                <X
                                    className="w-3 h-3 hover:text-blue-800 cursor-pointer"
                                    onClick={(e) => { e.stopPropagation(); onToggle(item); }}
                                />
                            </span>
                        ))
                    )}
                    <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>

                {isOpen && (
                    <div className="absolute z-[100] mt-2 w-full max-h-60 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-2 animate-in fade-in zoom-in duration-200">
                        <div className="grid grid-cols-1 gap-1">
                            {options.map(option => {
                                const isSelected = selected.includes(typeof option === 'string' ? option : option.name);
                                const name = typeof option === 'string' ? option : option.name;
                                return (
                                    <div
                                        key={name}
                                        onClick={() => onToggle(name)}
                                        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${isSelected
                                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                            : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
                                            }`}
                                    >
                                        <span className="text-xs font-medium">{name}</span>
                                        {isSelected && <Check className="w-4 h-4" />}
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
                setProjects(data.data || []);
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
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-xl shadow-sm">
                        <Zap className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                            Sistema ByPass ⚡
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Enrutamiento inteligente de candidatos basado en ADN.
                        </p>
                    </div>
                </div>
                <Button
                    onClick={handleOpenCreate}
                    icon={Plus}
                >
                    Nuevo ByPass
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            ) : rules.length === 0 ? (
                <Card className="border-dashed border-2">
                    <div className="text-center py-12">
                        <div className="mx-auto w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center mb-4">
                            <Zap className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                            No hay reglas configuradas
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                            Configura enrutamientos automáticos para optimizar tu flujo de reclutamiento.
                        </p>
                        <Button onClick={handleOpenCreate} variant="outline" icon={Plus}>
                            Crear Mi Primer ByPass
                        </Button>
                    </div>
                </Card>
            ) : (
                <div className="grid gap-4">
                    {rules.map((rule) => {
                        const targetProject = projects.find(p => p.id === rule.projectId);
                        return (
                            <Card key={rule.id} className="group hover:shadow-xl hover:shadow-yellow-500/5 transition-all duration-300 border-l-4 border-l-transparent hover:border-l-yellow-500 bg-white/10 backdrop-blur-sm">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative z-10">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="text-lg font-bold text-gray-900 dark:text-white group-hover:text-yellow-600 transition-colors">
                                                {rule.name}
                                            </h3>
                                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest ${rule.active
                                                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
                                                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'}`}>
                                                {rule.active ? 'Activa' : 'Pausada'}
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
                                            <span className="flex items-center gap-1.5 font-bold text-blue-600 dark:text-blue-400">
                                                <GitMerge className="w-3.5 h-3.5" />
                                                Destino: {targetProject ? targetProject.name : 'Proyecto Desconocido'}
                                            </span>

                                            {(rule.minAge || rule.maxAge) && (
                                                <span className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 dark:bg-gray-800/40 rounded-lg border border-gray-100 dark:border-gray-700/50">
                                                    <Calendar className="w-3.5 h-3.5" />
                                                    {rule.minAge || '0'} - {rule.maxAge || '99'} años
                                                </span>
                                            )}

                                            {rule.gender !== 'Cualquiera' && (
                                                <span className="flex items-center gap-1.5 px-2 py-1 bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400 rounded-lg border border-pink-100 dark:border-pink-800/30">
                                                    <Users className="w-3.5 h-3.5" />
                                                    {rule.gender}
                                                </span>
                                            )}
                                        </div>

                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {rule.categories?.map(cat => (
                                                <span key={cat} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-md text-[10px] font-bold border border-blue-100 dark:border-blue-800/30">
                                                    {cat}
                                                </span>
                                            ))}
                                            {rule.escolaridades?.map(esc => (
                                                <span key={esc} className="px-2 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-md text-[10px] font-bold border border-green-100 dark:border-green-800/30">
                                                    {esc}
                                                </span>
                                            ))}
                                            {rule.municipios?.map(mun => (
                                                <span key={mun} className="px-2 py-0.5 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 rounded-md text-[10px] font-bold border border-purple-100 dark:border-purple-800/30">
                                                    {mun}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 self-end md:self-center">
                                        <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-xl p-1 shadow-inner border border-gray-200/50 dark:border-gray-700/50">
                                            <button
                                                onClick={() => handleToggleActive(rule)}
                                                className={`p-1.5 rounded-lg transition-all ${rule.active
                                                    ? 'bg-white dark:bg-gray-700 text-yellow-600 shadow-sm'
                                                    : 'text-gray-400 hover:text-gray-600'}`}
                                                title={rule.active ? "Desactivar" : "Activar"}
                                            >
                                                <Power className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleEdit(rule)}
                                                className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all"
                                                title="Editar"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(rule.id)}
                                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all"
                                                title="Eliminar"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Create/Edit Modal - WIDE LAYOUT */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingId ? "Editar Regla ByPass" : "Nueva Regla ByPass"}
                maxWidth="5xl"
            >
                <div className="space-y-8">
                    {/* Header Controls */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
                        <div className="md:col-span-4">
                            <Input
                                label="Nombre de la Regla"
                                placeholder="Ej. Filtro Operadores Norte"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                autoFocus
                            />
                        </div>

                        <div className="md:col-span-4 space-y-1.5">
                            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
                                Proyecto de Destino
                            </label>
                            <div className="relative">
                                <GitMerge className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 z-10" />
                                <select
                                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm appearance-none cursor-pointer hover:border-blue-400 transition-colors"
                                    value={formData.projectId}
                                    onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                                >
                                    <option value="">-- Seleccionar Proyecto --</option>
                                    {projects.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                            </div>
                        </div>

                        <div className="md:col-span-4 space-y-1.5">
                            <label className="text-xs font-black uppercase tracking-widest text-gray-400">Género Preferente</label>
                            <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
                                {GENDERS.map(g => (
                                    <button
                                        key={g}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, gender: g })}
                                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${formData.gender === g
                                            ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm'
                                            : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                        {g}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="h-px bg-gray-100 dark:bg-gray-700" />

                    {/* Filters Grid - Horizontal Space Utilization */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                        {/* Column 1: Age */}
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded inline-block tracking-widest text-gray-500">
                                Rango de Edad
                            </h4>
                            <div className="flex items-center gap-3">
                                <div className="flex-1">
                                    <Input
                                        label="Mínimo"
                                        type="number"
                                        placeholder="18"
                                        value={formData.minAge}
                                        onChange={(e) => setFormData({ ...formData, minAge: e.target.value })}
                                    />
                                </div>
                                <div className="pt-6 text-gray-300">/</div>
                                <div className="flex-1">
                                    <Input
                                        label="Máximo"
                                        type="number"
                                        placeholder="55"
                                        value={formData.maxAge}
                                        onChange={(e) => setFormData({ ...formData, maxAge: e.target.value })}
                                    />
                                </div>
                            </div>
                            <p className="text-[10px] text-gray-400 italic mt-2">
                                * Dejar vacío para no filtrar por edad.
                            </p>
                        </div>

                        {/* Column 2: Categories (Multi-select) */}
                        <div className="space-y-4">
                            <MultiSelect
                                label="Categorías"
                                options={categories}
                                selected={formData.categories}
                                onToggle={(val) => toggleArrayItem('categories', val)}
                                placeholder="Todas las categorías"
                                iconSource={Tag}
                            />
                        </div>

                        {/* Column 3: Escolaridad (Multi-select) */}
                        <div className="space-y-4">
                            <MultiSelect
                                label="Escolaridad"
                                options={ESCOLARIDADES}
                                selected={formData.escolaridades}
                                onToggle={(val) => toggleArrayItem('escolaridades', val)}
                                placeholder="Cualquier estudio"
                                iconSource={GraduationCap}
                            />
                        </div>

                        {/* Column 4: Municipios (Multi-select) */}
                        <div className="space-y-4">
                            <MultiSelect
                                label="Municipios"
                                options={MUNICIPIOS}
                                selected={formData.municipios}
                                onToggle={(val) => toggleArrayItem('municipios', val)}
                                placeholder="Cualquier lugar"
                                iconSource={MapPin}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-8 border-t dark:border-gray-800">
                        <Button
                            variant="ghost"
                            onClick={() => setIsModalOpen(false)}
                            disabled={saving}
                            className="rounded-xl px-6"
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving}
                            icon={saving ? Loader2 : Save}
                            className="rounded-xl px-8 bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/20"
                        >
                            {saving ? 'Guardando...' : (editingId ? 'Actualizar Regla' : 'Crear ByPass')}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ByPassSection;
