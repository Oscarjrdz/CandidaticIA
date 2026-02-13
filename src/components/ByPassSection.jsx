import React, { useState, useEffect } from 'react';
import { Zap, Plus, GitMerge, Tag, Calendar, Loader2, Save, Trash2, Pencil, Power, MapPin, GraduationCap, Users } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';

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

    const ESCOLARIDADES = [
        "Primaria", "Secundaria", "Preparatoria", "Técnica", "Licenciatura", "Maestría"
    ];

    const GENDERS = ["Cualquiera", "Hombre", "Mujer"];

    // Load Initial Data
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
                    <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-xl">
                        <Zap className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                            Sistema ByPass ⚡
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Enruta candidatos automáticamente a proyectos según su ADN.
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
                            No hay reglas de ByPass
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                            Configura llaves inteligentes para mandar candidatos directos a tus proyectos.
                        </p>
                        <Button onClick={handleOpenCreate} variant="outline" icon={Plus}>
                            Crear Primer ByPass
                        </Button>
                    </div>
                </Card>
            ) : (
                <div className="grid gap-4">
                    {rules.map((rule) => {
                        const targetProject = projects.find(p => p.id === rule.projectId);
                        return (
                            <Card key={rule.id} className="group hover:shadow-xl hover:shadow-yellow-500/5 transition-all duration-300 border-l-4 border-l-transparent hover:border-l-yellow-500">
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
                                                <span className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700/50 uppercase tracking-tighter font-black">
                                                    <Calendar className="w-3.5 h-3.5" />
                                                    {rule.minAge || '0'} - {rule.maxAge || '99'} años
                                                </span>
                                            )}

                                            {rule.gender !== 'Cualquiera' && (
                                                <span className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700/50 uppercase tracking-tighter font-black text-pink-500 dark:text-pink-400">
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
                                        <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl p-1 shadow-inner border border-gray-200/50 dark:border-gray-700/50">
                                            <button
                                                onClick={() => handleToggleActive(rule)}
                                                className={`p-1.5 rounded-lg transition-all ${rule.active
                                                    ? 'bg-white dark:bg-gray-700 text-yellow-600 shadow-sm'
                                                    : 'text-gray-400 hover:text-gray-600'}`}
                                                title={rule.active ? "Pausar llave" : "Abrir llave"}
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

            {/* Create/Edit Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingId ? "Editar Regla ByPass" : "Nueva Regla ByPass"}
                maxWidth="3xl"
            >
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input
                            label="Nombre de la Regla"
                            placeholder="Ej. Choferes Jóvenes CDMX"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            autoFocus
                        />

                        <div className="space-y-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Proyecto de Destino
                            </label>
                            <div className="relative">
                                <GitMerge className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <select
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-yellow-500/20 outline-none bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm appearance-none"
                                    value={formData.projectId}
                                    onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                                >
                                    <option value="">Selecciona un proyecto...</option>
                                    {projects.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Edad y Género */}
                        <div className="space-y-4">
                            <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 border-b pb-1">
                                Datos Básicos
                            </h4>
                            <div className="grid grid-cols-2 gap-2">
                                <Input
                                    label="Edad Mín"
                                    type="number"
                                    placeholder="18"
                                    value={formData.minAge}
                                    onChange={(e) => setFormData({ ...formData, minAge: e.target.value })}
                                />
                                <Input
                                    label="Edad Máx"
                                    type="number"
                                    placeholder="50"
                                    value={formData.maxAge}
                                    onChange={(e) => setFormData({ ...formData, maxAge: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-500">Género</label>
                                <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                                    {GENDERS.map(g => (
                                        <button
                                            key={g}
                                            onClick={() => setFormData({ ...formData, gender: g })}
                                            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${formData.gender === g
                                                ? 'bg-white dark:bg-gray-700 text-yellow-600 shadow-sm'
                                                : 'text-gray-400 hover:text-gray-600'}`}
                                        >
                                            {g}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Categorías */}
                        <div className="space-y-4">
                            <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 border-b pb-1">
                                Categorías
                            </h4>
                            <div className="max-h-48 overflow-y-auto space-y-1 pr-2 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700">
                                {categories.map(cat => (
                                    <label key={cat.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg cursor-pointer transition-colors group">
                                        <input
                                            type="checkbox"
                                            checked={formData.categories.includes(cat.name)}
                                            onChange={() => toggleArrayItem('categories', cat.name)}
                                            className="w-4 h-4 rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
                                        />
                                        <span className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white">
                                            {cat.name}
                                        </span>
                                    </label>
                                ))}
                                {categories.length === 0 && <p className="text-[10px] text-gray-400 italic">No hay categorías disponibles</p>}
                            </div>
                        </div>

                        {/* Escolaridad */}
                        <div className="space-y-4">
                            <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 border-b pb-1">
                                Escolaridad
                            </h4>
                            <div className="space-y-1">
                                {ESCOLARIDADES.map(esc => (
                                    <label key={esc} className="flex items-center gap-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg cursor-pointer transition-colors group">
                                        <input
                                            type="checkbox"
                                            checked={formData.escolaridades.includes(esc)}
                                            onChange={() => toggleArrayItem('escolaridades', esc)}
                                            className="w-4 h-4 rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
                                        />
                                        <span className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white">
                                            {esc}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-6 border-t dark:border-gray-800">
                        <Button
                            variant="ghost"
                            onClick={() => setIsModalOpen(false)}
                            disabled={saving}
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving}
                            icon={saving ? Loader2 : Save}
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
