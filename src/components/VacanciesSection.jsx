import React, { useState, useEffect } from 'react';
import { Briefcase, Plus, Building2, Tag, FileText, Loader2, Save, Trash2, Pencil, Copy } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';

/**
 * Sección de Gestión de Vacantes
 */
const VacanciesSection = ({ showToast }) => {
    const [vacancies, setVacancies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);

    // Categories State
    const [categories, setCategories] = useState([]);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [addingCategory, setAddingCategory] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        company: '',
        category: '',
        description: ''
    });

    const [availableFields, setAvailableFields] = useState([]);

    const availableTags = [
        { label: 'Nombre', value: '{{nombre}}' },
        { label: 'WhatsApp', value: '{{whatsapp}}' },
        ...availableFields.map(f => ({ label: f.label, value: `{{${f.value}}}` }))
    ];

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        showToast(`Copiado: ${text}`, 'success');
    };

    const handleTagClick = (tagValue) => {
        copyToClipboard(tagValue);
        // If description is the only field that uses tags, we can just append it here
        setFormData(prev => ({
            ...prev,
            description: prev.description + tagValue
        }));
        showToast(`Insertado: ${tagValue}`, 'success');
    };

    // Load Initial Data
    useEffect(() => {
        loadVacancies();
        loadFields();
        loadCategories();
    }, []);

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

    const loadFields = async () => {
        try {
            const res = await fetch('/api/fields');
            const data = await res.json();
            if (data.success) {
                setAvailableFields(data.fields || []);
            }
        } catch (e) {
            console.error('Error loading fields:', e);
        }
    };

    const loadVacancies = async () => {
        try {
            const res = await fetch('/api/vacancies');
            const data = await res.json();
            if (data.success) {
                setVacancies(data.data);
            }
        } catch (error) {
            console.error('Error loading vacancies:', error);
            showToast('Error al cargar vacantes', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenCreate = () => {
        setEditingId(null);
        setFormData({ name: '', company: '', category: '', description: '' });
        setIsModalOpen(true);
    };

    const handleEdit = (vacancy) => {
        setEditingId(vacancy.id);
        setFormData({
            name: vacancy.name,
            company: vacancy.company,
            category: vacancy.category,
            description: vacancy.description || ''
        });
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        // Validation
        if (!formData.name || !formData.company || !formData.category) {
            showToast('Por favor completa los campos obligatorios', 'error');
            return;
        }

        setSaving(true);
        try {
            const method = editingId ? 'PUT' : 'POST';
            const body = editingId ? { ...formData, id: editingId } : formData;

            const res = await fetch('/api/vacancies', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (data.success) {
                showToast(editingId ? 'Vacante actualizada' : 'Vacante creada exitosamente', 'success');
                setIsModalOpen(false);
                setFormData({ name: '', company: '', category: '', description: '' });
                setEditingId(null);
                loadVacancies(); // Reload list
            } else {
                showToast(data.error || 'Error al guardar', 'error');
            }
        } catch (error) {
            console.error('Error saving vacancy:', error);
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (vacancy) => {
        try {
            const res = await fetch('/api/vacancies', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: vacancy.id, active: !vacancy.active })
            });
            if (res.ok) {
                showToast('Estado actualizado', 'success');
                loadVacancies();
            }
        } catch (error) {
            console.error('Error updating vacancy:', error);
            showToast('Error al actualizar', 'error');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('¿Seguro que deseas eliminar esta vacante?')) return;

        try {
            const res = await fetch(`/api/vacancies?id=${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                showToast('Vacante eliminada', 'success');
                loadVacancies();
            }
        } catch (error) {
            console.error('Error deleting vacancy:', error);
            showToast('Error al eliminar', 'error');
        }
    };

    // Sync to Candidatic logic removed

    const handleAddCategory = async () => {
        if (!newCategoryName.trim()) return;
        setAddingCategory(true);
        try {
            const res = await fetch('/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newCategoryName })
            });
            const data = await res.json();
            if (data.success) {
                showToast('Categoría agregada', 'success');
                setNewCategoryName('');
                loadCategories();
            } else {
                showToast(data.error || 'Error al agregar categoría', 'error');
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        } finally {
            setAddingCategory(false);
        }
    };

    const handleDeleteCategory = async (id) => {
        if (!confirm('¿Seguro que deseas eliminar esta categoría?')) return;
        try {
            const res = await fetch(`/api/categories?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('Categoría eliminada', 'success');
                loadCategories();
            }
        } catch (e) {
            showToast('Error al eliminar', 'error');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                    <Briefcase className="w-6 h-6 text-blue-600" />
                    Gestión de Vacantes
                </h2>
                <div className="flex gap-2">
                    <Button
                        onClick={handleOpenCreate}
                        icon={Plus}
                    >
                        Nueva Vacante
                    </Button>
                </div>
            </div>

            {/* Categorías Section */}
            <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 border-blue-100 dark:border-blue-800/50">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                            <Tag className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wider">
                                Gestión de Categorías
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Clasifica tus vacantes para una mejor organización.
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Nueva categoría..."
                            className="px-3 py-2 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 outline-none w-full md:w-48"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                        />
                        <button
                            onClick={handleAddCategory}
                            disabled={addingCategory || !newCategoryName.trim()}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                        >
                            {addingCategory ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                            Agregar
                        </button>
                    </div>
                </div>

                {categories.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-blue-100/50 dark:border-blue-800/30">
                        {categories.map(cat => (
                            <div
                                key={cat.id}
                                className="group flex items-center gap-2 px-3 py-1 bg-white dark:bg-gray-800 border border-blue-100 dark:border-blue-800/50 rounded-full text-xs font-medium text-blue-700 dark:text-blue-300 shadow-sm"
                            >
                                <span>{cat.name}</span>
                                <button
                                    onClick={() => handleDeleteCategory(cat.id)}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-500 rounded-full transition-all"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            ) : vacancies.length === 0 ? (
                <Card>
                    <div className="text-center py-12">
                        <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
                            <Briefcase className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                            No hay vacantes registradas
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                            Comienza creando tu primera vacante para asignar candidatos.
                        </p>
                        <Button onClick={handleOpenCreate} variant="outline">
                            Crear Vacante
                        </Button>
                    </div>
                </Card>
            ) : (
                <div className="grid gap-4">
                    {vacancies.map((vacancy) => (
                        <Card key={vacancy.id} className="hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                        {vacancy.name}
                                    </h3>
                                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
                                        <span className="flex items-center gap-1">
                                            <Building2 className="w-4 h-4" />
                                            {vacancy.company}
                                        </span>
                                        <span className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full text-xs">
                                            <Tag className="w-3 h-3" />
                                            {vacancy.category}
                                        </span>
                                        <span className="text-xs text-gray-400">
                                            {new Date(vacancy.createdAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                    {vacancy.description && (
                                        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                                            {vacancy.description}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleToggleActive(vacancy)}
                                        className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${vacancy.active
                                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                            }`}
                                    >
                                        {vacancy.active ? 'ACTIVA' : 'INACTIVA'}
                                    </button>
                                    <button
                                        onClick={() => handleEdit(vacancy)}
                                        className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
                                        title="Editar vacante"
                                    >
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(vacancy.id)}
                                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                        title="Eliminar vacante"
                                    >
                                        <div className="w-5 h-5 flex items-center justify-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M3 6h18"></path>
                                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                            </svg>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {/* Create/Edit Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingId ? "Editar Vacante" : "Nueva Vacante"}
            >
                <div className="space-y-4">
                    <Input
                        label="Nombre de la Vacante"
                        placeholder="Ej. Desarrollador Senior"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        autoFocus
                    />

                    <Input
                        label="Empresa"
                        placeholder="Ej. Tech Corp"
                        icon={Building2}
                        value={formData.company}
                        onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    />

                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Categoría
                        </label>
                        <div className="relative">
                            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <select
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500/20 outline-none bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm appearance-none"
                                value={formData.category}
                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                            >
                                <option value="">Selecciona una categoría...</option>
                                {categories.map(cat => (
                                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                                ))}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Descripción
                            </label>
                            <div className="flex flex-wrap gap-1 justify-end">
                                {availableTags.map(tag => (
                                    <button
                                        key={tag.value}
                                        type="button"
                                        onClick={() => handleTagClick(tag.value)}
                                        className="px-2 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-[10px] font-mono text-gray-600 dark:text-gray-400 rounded border border-gray-200 dark:border-gray-700 flex items-center gap-1 transition-all"
                                        title={`Copiar e insertar ${tag.label}`}
                                    >
                                        <span>{tag.value}</span>
                                        <Copy className="w-2.5 h-2.5 opacity-50" />
                                    </button>
                                ))}
                            </div>
                        </div>
                        <textarea
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                            rows={4}
                            placeholder="Detalles sobre el puesto..."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
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
                            {saving ? (editingId ? 'Guardando...' : 'Creando...') : (editingId ? 'Actualizar Vacante' : 'Guardar Vacante')}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default VacanciesSection;
