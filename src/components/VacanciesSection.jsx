import React, { useState, useEffect } from 'react';
import { Briefcase, Plus, Building2, Tag, FileText, Loader2, Save, Trash2, Pencil, Copy, Power, GripVertical, Sparkles, RefreshCw, Image as ImageIcon, MapPin, Paperclip } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';

// DND Kit imports
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Sortable Vacancy Card Component
 */
const SortableVacancyCard = ({ vacancy, handleToggleActive, handleEdit, handleClone, handleDelete }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: vacancy.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : 1,
        position: 'relative'
    };

    return (
        <div ref={setNodeRef} style={style}>
            <Card className="group hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300 border-l-4 border-l-transparent hover:border-l-blue-500 overflow-hidden relative">
                {/* Decorative Background Element */}
                <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative z-10">

                    {/* Contenedor Izquierdo: Grip handle + Contenido */}
                    <div className="flex-1 flex gap-3">
                        <div
                            {...attributes}
                            {...listeners}
                            className="flex items-center justify-center p-1.5 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors self-start md:self-center bg-gray-50/50 dark:bg-gray-800/30 rounded-lg"
                        >
                            <GripVertical className="w-5 h-5" />
                        </div>

                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors">
                                    {vacancy.name}
                                </h3>
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest ${vacancy.active
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'}`}>
                                    {vacancy.active ? 'Activa' : 'Inactiva'}
                                </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
                                <span className="flex items-center gap-1.5 font-medium">
                                    <Building2 className="w-3.5 h-3.5 text-blue-500" />
                                    {vacancy.company}
                                </span>
                                <span className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 rounded-lg shadow-sm font-bold text-blue-600 dark:text-blue-400">
                                    <Tag className="w-3.5 h-3.5" />
                                    {vacancy.category}
                                </span>
                                <span className="flex items-center gap-1.5 opacity-70 italic">
                                    <FileText className="w-3.5 h-3.5" />
                                    Creada {new Date(vacancy.createdAt).toLocaleDateString()}
                                </span>
                            </div>

                            {vacancy.description && (
                                <p className="mt-3 text-xs text-gray-600 dark:text-gray-400 line-clamp-2 leading-relaxed bg-gray-50/50 dark:bg-gray-900/50 p-2 rounded-lg border border-gray-100/50 dark:border-gray-700/30">
                                    {vacancy.description}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Botones de acción */}
                    <div className="flex items-center gap-3 self-end md:self-center">
                        <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl p-1 shadow-inner border border-gray-200/50 dark:border-gray-700/50">
                            <button
                                onClick={() => handleToggleActive(vacancy)}
                                className={`p-1.5 rounded-lg transition-all ${vacancy.active
                                    ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm'
                                    : 'text-gray-400 hover:text-gray-600'}`}
                                title={vacancy.active ? "Pausar vacante" : "Activar vacante"}
                            >
                                <Power className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleClone(vacancy)}
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all"
                                title="Clonar Vacante"
                            >
                                <Copy className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleEdit(vacancy)}
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all"
                                title="Editar"
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleDelete(vacancy.id)}
                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all"
                                title="Eliminar"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
};

/**
 * Sección de Gestión de Vacantes
 */
const VacanciesSection = ({ showToast }) => {
    const [vacancies, setVacancies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);

    // FAQ Radar State
    const [faqs, setFaqs] = useState([]);
    const [loadingFaqs, setLoadingFaqs] = useState(false);

    // DND Sensors
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const [categories, setCategories] = useState([]);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [addingCategory, setAddingCategory] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        company: '',
        category: '',
        description: '',
        messageDescription: ''
    });

    const [availableFields, setAvailableFields] = useState([]);

    const loadFaqs = async (vacancyId) => {
        setLoadingFaqs(true);
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${vacancyId}`);
            const data = await res.json();
            if (data.success) {
                setFaqs(data.faqs || []);
            }
        } catch (error) {
            console.error('Error loading FAQs:', error);
        } finally {
            setLoadingFaqs(false);
        }
    };

    // Auto-refresh (silent poll) para FAQ radar
    useEffect(() => {
        let interval;
        if (isModalOpen && editingId) {
            interval = setInterval(() => {
                fetch(`/api/vacancies/faq?vacancyId=${editingId}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            setFaqs(data.faqs || []);
                        }
                    })
                    .catch(e => console.error('Silent FAQ poll error:', e));
            }, 10000);
        }
        return () => clearInterval(interval);
    }, [isModalOpen, editingId]);

    const handleSaveFaq = async (faq) => {
        try {
            const bodyPayload = {
                faqId: faq.id,
                officialAnswer: faq.officialAnswer,
                mediaType: faq.mediaType,
                mediaUrl: faq.mediaUrl,
                locationLat: faq.locationLat,
                locationLng: faq.locationLng,
                locationAddress: faq.locationAddress
            };

            const res = await fetch(`/api/vacancies/faq?vacancyId=${editingId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
            });
            if (res.ok) {
                showToast('Respuesta oficial guardada e inyectada a la IA', 'success');
                loadFaqs(editingId);
            } else {
                showToast('Error al guardar respuesta', 'error');
            }
        } catch (error) {
            console.error('Error saving FAQ:', error);
            showToast('Error de conexión', 'error');
        }
    };

    const handleDeleteFaq = async (faqId) => {
        if (!confirm('¿Seguro que deseas eliminar esta pregunta del radar?')) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${editingId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faqId })
            });
            if (res.ok) {
                showToast('Pregunta descartada', 'success');
                loadFaqs(editingId);
            }
        } catch (error) {
            console.error('Error deleting FAQ:', error);
            showToast('Error al eliminar duda', 'error');
        }
    };

    const handleSplitFaq = async (faqId, questionText) => {
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${editingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'split', faqId, questionText })
            });
            if (res.ok) {
                showToast('Duda separada en un nuevo tema', 'success');
                loadFaqs(editingId);
            } else {
                showToast('Error al separar duda', 'error');
            }
        } catch (error) {
            console.error('Error splitting FAQ:', error);
            showToast('Error de conexión', 'error');
        }
    };

    const handleRemoveQuestion = async (faqId, questionText) => {
        if (!confirm('¿Deseas eliminar esta pregunta específica?')) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${editingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove_question', faqId, questionText })
            });
            if (res.ok) {
                showToast('Pregunta eliminada', 'success');
                loadFaqs(editingId);
            } else {
                showToast('Error al eliminar pregunta', 'error');
            }
        } catch (error) {
            console.error('Error removing question:', error);
            showToast('Error de conexión', 'error');
        }
    };

    const handleUpdateTopic = async (faqId, newTopic) => {
        if (!newTopic?.trim()) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${editingId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faqId, topic: newTopic })
            });
            if (res.ok) {
                showToast('Tema actualizado', 'success');
                loadFaqs(editingId);
            }
        } catch (error) {
            console.error('Error updating topic:', error);
            showToast('Error al actualizar tema', 'error');
        }
    };

    const handleReclusterFaqs = async () => {
        if (!confirm('Brenda volverá a analizar todas las preguntas para agruparlas mejor según los nombres de los temas actuales. ¿Deseas continuar?')) return;

        setIsLoadingFaqs(true);
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${editingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'recluster' })
            });
            if (res.ok) {
                showToast('Dudas re-agrupadas con éxito ✨', 'success');
                loadFaqs(editingId);
            } else {
                showToast('Error al re-agrupar', 'error');
            }
        } catch (error) {
            console.error('Error reclustering FAQs:', error);
            showToast('Error de conexión', 'error');
        } finally {
            setIsLoadingFaqs(false);
        }
    };
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
        setFormData({ name: '', company: '', category: '', description: '', messageDescription: '' });
        setFaqs([]);
        setIsModalOpen(true);
    };

    const handleEdit = (vacancy) => {
        setEditingId(vacancy.id);
        setFormData({
            name: vacancy.name,
            company: vacancy.company,
            category: vacancy.category,
            description: vacancy.description || '',
            messageDescription: vacancy.messageDescription || ''
        });
        setIsModalOpen(true);
        loadFaqs(vacancy.id);
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
                loadVacancies(); // Reload list

                // Si es modo creación, cerramos modal. Si es edición, mantenemos abierto.
                if (!editingId) {
                    setIsModalOpen(false);
                    setFormData({ name: '', company: '', category: '', description: '', messageDescription: '' });
                }
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

    const handleClone = async (vacancy) => {
        try {
            const cloneData = {
                name: `${vacancy.name} (Copia)`,
                company: vacancy.company,
                category: vacancy.category,
                description: vacancy.description || '',
                messageDescription: vacancy.messageDescription || ''
            };

            const res = await fetch('/api/vacancies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cloneData)
            });

            const data = await res.json();
            if (data.success) {
                showToast('Vacante clonada', 'success');
                loadVacancies();
            } else {
                showToast(data.error || 'Error al clonar vacante', 'error');
            }
        } catch (error) {
            console.error('Error cloning vacancy:', error);
            showToast('Error de conexión al clonar', 'error');
        }
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;

        if (active.id !== over.id) {
            setVacancies((items) => {
                const oldIndex = items.findIndex(item => item.id === active.id);
                const newIndex = items.findIndex(item => item.id === over.id);

                const newArray = arrayMove(items, oldIndex, newIndex);

                // Fire async update to backend
                saveNewOrder(newArray.map(v => v.id));

                return newArray;
            });
        }
    };

    const saveNewOrder = async (orderedIds) => {
        try {
            await fetch('/api/vacancies', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reorder', orderedIds })
            });
        } catch (error) {
            console.error('Error saving reordered list:', error);
            showToast('Error al guardar el nuevo orden', 'error');
        }
    };

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
            const res = await fetch(`/ api / categories ? id = ${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('Categoría eliminada', 'success');
                loadCategories();
            }
        } catch (e) {
            showToast('Error al eliminar', 'error');
        }
    };

    return (
        <div className="space-y-4 w-full pb-8 animate-in fade-in duration-700">
            {/* Command Bar: Homologated with Bot IA Style */}
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 flex flex-col md:flex-row items-center justify-between gap-4 min-h-[82px]">
                <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-2xl bg-blue-600 shadow-lg shadow-blue-500/20 flex items-center justify-center transition-all">
                        <Briefcase className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight uppercase tracking-tight">GESTIÓN DE VACANTES</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                            <p className="text-[10px] font-black tracking-widest uppercase text-blue-600 dark:text-blue-400">
                                SISTEMA ACTIVO
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        onClick={handleOpenCreate}
                        icon={Plus}
                        className="rounded-2xl shadow-lg shadow-blue-500/20 hover:scale-105 transition-all duration-300"
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
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={vacancies.map(v => v.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="grid gap-4">
                            {vacancies.map((vacancy) => (
                                <SortableVacancyCard
                                    key={vacancy.id}
                                    vacancy={vacancy}
                                    handleToggleActive={handleToggleActive}
                                    handleEdit={handleEdit}
                                    handleClone={handleClone}
                                    handleDelete={handleDelete}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}

            {/* Create/Edit Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingId ? "Editar Vacante" : "Nueva Vacante"}
                maxWidth={editingId ? "max-w-[1400px] w-[95vw]" : "max-w-xl"}
            >
                <div className={`grid gap-8 ${editingId ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                    {/* COLUMNA 1: FORMULARIO VACANTE */}
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        </div>

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
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Descripción
                            </label>
                            <textarea
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                                rows={12}
                                placeholder="Detalles sobre el puesto..."
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="block text-[10px] font-black tracking-widest text-blue-600 dark:text-blue-400 uppercase">
                                Vacante para Mensaje (Info para el Bot)
                            </label>
                            <textarea
                                className="w-full px-4 py-2 border border-blue-100 dark:border-blue-900/50 rounded-lg focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800/20 focus:border-blue-300 bg-blue-50/30 dark:bg-blue-900/10 text-gray-900 dark:text-white text-sm italic"
                                rows={6}
                                placeholder="Escribe aquí la información simplificada que el bot mandará por WhatsApp..."
                                value={formData.messageDescription}
                                onChange={(e) => setFormData({ ...formData, messageDescription: e.target.value })}
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

                    {/* COLUMNA 2: RADAR DE DUDAS (SOLO EN EDICION) */}
                    {editingId && (
                        <div className="space-y-4 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 pt-6 lg:pt-0 lg:pl-8 flex flex-col h-[calc(100vh-12rem)] max-h-[600px]">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                                        Radar de Dudas (IA)
                                    </h3>
                                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                        Dudas frecuentes de candidatos sobre esta vacante. Dales respuesta y la IA lo aprenderá al instante.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleReclusterFaqs}
                                        disabled={loadingFaqs || faqs.length === 0}
                                        className="flex justify-center items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-indigo-100 dark:border-indigo-800 disabled:opacity-50 whitespace-nowrap"
                                        title="Brenda re-analizará todas las dudas basándose en los nombres de los temas actuales"
                                    >
                                        <Sparkles className={`w-3 h-3 ${loadingFaqs ? 'animate-pulse' : ''}`} />
                                        {loadingFaqs ? 'Re-agrupando...' : 'Re-agrupar con IA'}
                                    </button>
                                    <button
                                        onClick={() => loadFaqs(editingId)}
                                        className="p-1.5 text-gray-500 hover:text-indigo-600 bg-gray-50 hover:bg-indigo-50 rounded-lg transition-colors flex-shrink-0"
                                        title="Consultar radar de dudas a Vercel"
                                    >
                                        <RefreshCw className={`w-4 h-4 ${loadingFaqs ? 'animate-spin' : ''}`} />
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar h-full">
                                {loadingFaqs ? (
                                    <div className="flex justify-center py-8">
                                        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                                    </div>
                                ) : faqs.length === 0 ? (
                                    <div className="text-center py-10 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                                        <span className="text-2xl mb-2 block">🎧</span>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium tracking-tight">Candidatic analizando llamadas y chats en vivo...</p>
                                    </div>
                                ) : (
                                    faqs.map(faq => (
                                        <div key={faq.id} className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-800 rounded-2xl p-3 shadow-sm hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all duration-300 relative group overflow-hidden">
                                            {/* Decoration */}
                                            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full -mr-12 -mt-12 blur-2xl group-hover:bg-indigo-500/10 transition-colors"></div>

                                            {/* Header: Titulo y Frecuencia */}
                                            <div className="flex justify-between items-center mb-2 relative z-10">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600">
                                                        <FileText className="w-4 h-4" />
                                                    </div>
                                                    <div
                                                        className="cursor-pointer group/title"
                                                        onClick={() => {
                                                            const n = prompt('Nuevo nombre del tema FAQ:', faq.topic);
                                                            if (n && n !== faq.topic) handleUpdateTopic(faq.id, n);
                                                        }}
                                                        title="Haz clic para editar el nombre del tema"
                                                    >
                                                        <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-tight leading-none mb-1 group-hover/title:text-indigo-600 dark:group-hover/title:text-indigo-400 transition-colors flex items-center gap-2">
                                                            {faq.topic}
                                                            <Pencil className="w-3 h-3 opacity-0 group-hover/title:opacity-100 transition-all text-gray-400" />
                                                        </h4>
                                                        <div className="flex items-center gap-2">
                                                            <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 text-[9px] font-black rounded-md uppercase tracking-widest">
                                                                {faq.frequency} detecciones
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                                                    onClick={() => handleDeleteFaq(faq.id)}
                                                    title="Eliminar duda"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>

                                            {/* Body: Grid asimétrico para dar más espacio a Auditoría */}
                                            <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr] gap-2 mb-3 relative z-10">
                                                <div className="bg-gray-50 dark:bg-gray-900/50 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800/50">
                                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5 font-sans leading-none">
                                                        🔍 Dudas Recabadas
                                                    </p>
                                                    <ul className="space-y-1 list-none">
                                                        {(faq.originalQuestions || []).slice(0, 3).map((q, idx) => (
                                                            <li key={idx} className="flex items-center justify-between group/q text-[11px] text-gray-600 dark:text-gray-400 italic pl-3 border-l-2 border-indigo-200 dark:border-indigo-800 transition-all hover:bg-gray-100/50 dark:hover:bg-gray-800/50 rounded-r-lg py-0.5 leading-snug">
                                                                <span className="truncate flex-1" title={q}>"{q}"</span>
                                                                <div className="flex items-center opacity-0 group-hover/q:opacity-100 transition-all ml-1 flex-shrink-0">
                                                                    <button
                                                                        onClick={() => handleSplitFaq(faq.id, q)}
                                                                        className="p-1 hover:text-indigo-600 hover:bg-white dark:hover:bg-gray-900 rounded-md transition-all"
                                                                        title="Separar esta duda en un nuevo tema"
                                                                    >
                                                                        <Plus className="w-3 h-3" />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleRemoveQuestion(faq.id, q)}
                                                                        className="p-1 hover:text-red-500 hover:bg-white dark:hover:bg-gray-900 rounded-md transition-all"
                                                                        title="Eliminar esta pregunta"
                                                                    >
                                                                        <Trash2 className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>

                                                <div className="bg-blue-50/50 dark:bg-blue-900/10 p-2.5 rounded-xl border border-blue-100 dark:border-blue-900/20">
                                                    <p className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5 leading-none">
                                                        🤖 Auditoría: Brenda Respondió
                                                    </p>
                                                    <p className="text-[11px] text-blue-800 dark:text-blue-300 font-medium leading-snug max-w-full">
                                                        {faq.lastAiResponse || 'Consultando base de datos oficial...'}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Footer: Input de entrenamiento (Horizontal) */}
                                            <div className="bg-indigo-50/30 dark:bg-indigo-900/10 p-2 rounded-2xl border border-indigo-100/50 dark:border-indigo-800/30 relative z-10">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 relative group/input">
                                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 group-focus-within/input:text-indigo-600 transition-colors">
                                                            <Plus className="w-3.5 h-3.5" />
                                                        </div>
                                                        <input
                                                            type="text"
                                                            value={faq.officialAnswer || ''}
                                                            onChange={(e) => {
                                                                const newFaqs = [...faqs];
                                                                const idx = newFaqs.findIndex(f => f.id === faq.id);
                                                                if (idx > -1) {
                                                                    newFaqs[idx].officialAnswer = e.target.value;
                                                                    setFaqs(newFaqs);
                                                                }
                                                            }}
                                                            placeholder="Entrena a Brenda para que sepa responder exactamente esto..."
                                                            className="w-full pl-9 pr-4 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all shadow-inner"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={() => handleSaveFaq(faq)}
                                                        className="px-5 py-2 bg-indigo-600 hover:bg-black text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-indigo-500/20 hover:shadow-none translate-y-0 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
                                                        disabled={!faq.officialAnswer?.trim()}
                                                    >
                                                        Enseñar
                                                    </button>
                                                </div>

                                                {/* Media / Attachment Setting */}
                                                <div className="mt-3 flex flex-wrap gap-2 items-start border-t border-indigo-100/30 dark:border-indigo-800/20 pt-3">
                                                    <div className="flex gap-1.5 items-center">
                                                        <select
                                                            value={faq.mediaType || ''}
                                                            onChange={(e) => {
                                                                const newFaqs = [...faqs];
                                                                const idx = newFaqs.findIndex(f => f.id === faq.id);
                                                                if (idx > -1) {
                                                                    newFaqs[idx].mediaType = e.target.value;
                                                                    if (!e.target.value) {
                                                                        newFaqs[idx].mediaUrl = '';
                                                                        newFaqs[idx].locationLat = '';
                                                                        newFaqs[idx].locationLng = '';
                                                                        newFaqs[idx].locationAddress = '';
                                                                    }
                                                                    setFaqs(newFaqs);
                                                                }
                                                            }}
                                                            className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 bg-indigo-100/50 dark:bg-indigo-900/30 rounded-lg outline-none border border-transparent focus:border-indigo-300 dark:focus:border-indigo-700 transition-all"
                                                        >
                                                            <option value="">Sin Adjunto</option>
                                                            <option value="image">Imagen</option>
                                                            <option value="document">Documento (PDF)</option>
                                                            <option value="location">Ubicación (Maps)</option>
                                                        </select>
                                                    </div>

                                                    {(faq.mediaType === 'image' || faq.mediaType === 'document') && (
                                                        <div className="flex-1 min-w-[200px] flex gap-2">
                                                            <div className="flex-1 relative flex items-center">
                                                                {faq.mediaType === 'image' ? <ImageIcon className="w-3.5 h-3.5 absolute left-2 text-indigo-400" /> : <Paperclip className="w-3.5 h-3.5 absolute left-2 text-indigo-400" />}
                                                                <input
                                                                    type="text"
                                                                    placeholder={faq.mediaType === 'image' ? "URL de la imagen (JPG/PNG)" : "URL del documento (PDF)"}
                                                                    value={faq.mediaUrl || ''}
                                                                    onChange={(e) => {
                                                                        const newFaqs = [...faqs];
                                                                        const idx = newFaqs.findIndex(f => f.id === faq.id);
                                                                        if (idx > -1) {
                                                                            newFaqs[idx].mediaUrl = e.target.value;
                                                                            setFaqs(newFaqs);
                                                                        }
                                                                    }}
                                                                    className="w-full pl-7 pr-3 py-1.5 text-xs bg-white dark:bg-gray-800 border-none rounded-lg focus:ring-2 focus:ring-indigo-500/20 outline-none placeholder:text-gray-400 shadow-sm"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}

                                                    {faq.mediaType === 'location' && (
                                                        <div className="flex-1 min-w-[250px] flex flex-col gap-2">
                                                            <div className="flex gap-2 w-full">
                                                                <div className="relative flex-1">
                                                                    <MapPin className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-indigo-400" />
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Latitud (ej. 25.6866)"
                                                                        value={faq.locationLat || ''}
                                                                        onChange={(e) => {
                                                                            const newFaqs = [...faqs];
                                                                            const idx = newFaqs.findIndex(f => f.id === faq.id);
                                                                            if (idx > -1) {
                                                                                newFaqs[idx].locationLat = e.target.value;
                                                                                setFaqs(newFaqs);
                                                                            }
                                                                        }}
                                                                        className="w-full pl-7 pr-2 py-1.5 text-xs bg-white dark:bg-gray-800 border-none rounded-lg focus:ring-2 focus:ring-indigo-500/20 outline-none shadow-sm"
                                                                    />
                                                                </div>
                                                                <div className="relative flex-1">
                                                                    <MapPin className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-indigo-400" />
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Longitud (ej. -100.3161)"
                                                                        value={faq.locationLng || ''}
                                                                        onChange={(e) => {
                                                                            const newFaqs = [...faqs];
                                                                            const idx = newFaqs.findIndex(f => f.id === faq.id);
                                                                            if (idx > -1) {
                                                                                newFaqs[idx].locationLng = e.target.value;
                                                                                setFaqs(newFaqs);
                                                                            }
                                                                        }}
                                                                        className="w-full pl-7 pr-2 py-1.5 text-xs bg-white dark:bg-gray-800 border-none rounded-lg focus:ring-2 focus:ring-indigo-500/20 outline-none shadow-sm"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <input
                                                                type="text"
                                                                placeholder="Dirección (ej. Oficina Principal, Monterrey)"
                                                                value={faq.locationAddress || ''}
                                                                onChange={(e) => {
                                                                    const newFaqs = [...faqs];
                                                                    const idx = newFaqs.findIndex(f => f.id === faq.id);
                                                                    if (idx > -1) {
                                                                        newFaqs[idx].locationAddress = e.target.value;
                                                                        setFaqs(newFaqs);
                                                                    }
                                                                }}
                                                                className="w-full px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border-none rounded-lg focus:ring-2 focus:ring-indigo-500/20 outline-none shadow-sm"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
};

export default VacanciesSection;
