import React, { useState, useEffect } from 'react';
import { Briefcase, Plus, Building2, Tag, Loader2, Save, Trash2, Pencil, Copy, Power, GripVertical, X } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';
import VacancyEditorModal from './VacancyEditorModal';
import { useConfirmModal } from './ui/ConfirmModal';

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
    rectSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useToastContext } from '../contexts/ToastContext';

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
        <div ref={setNodeRef} style={style} className="h-full">
            <Card
                className="group h-full hover:shadow-md transition-all duration-200 border border-gray-100 dark:border-gray-700 overflow-hidden"
                bodyClassName="p-3"
            >
                <div className="flex items-start gap-2">
                    <div
                        {...attributes}
                        {...listeners}
                        className="flex items-center justify-center p-1 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors bg-gray-50 dark:bg-gray-800 rounded-md shrink-0"
                    >
                        <GripVertical className="w-4 h-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white leading-snug line-clamp-2">
                                {vacancy.name}
                            </h3>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide shrink-0 ${vacancy.active
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'}`}>
                                {vacancy.active ? 'Activa' : 'Off'}
                            </span>
                        </div>

                        <div className="mt-2 space-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                            <span className="flex items-center gap-1.5 min-w-0">
                                <Building2 className="w-3 h-3 text-blue-500 shrink-0" />
                                <span className="truncate">{vacancy.company}</span>
                            </span>
                            <span className="flex items-center gap-1.5 min-w-0 text-blue-600 dark:text-blue-400 font-semibold">
                                <Tag className="w-3 h-3 shrink-0" />
                                <span className="truncate">{vacancy.category}</span>
                            </span>
                        </div>

                        {vacancy.messageDescription && (
                            <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-400 line-clamp-3 leading-relaxed bg-gray-50/70 dark:bg-gray-900/40 p-2 rounded-md">
                                {vacancy.messageDescription}
                            </p>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-gray-400">
                                {vacancy.createdAt ? new Date(vacancy.createdAt).toLocaleDateString() : ''}
                            </span>
                            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 border border-gray-200/50 dark:border-gray-700/50">
                                <button
                                    onClick={() => handleToggleActive(vacancy)}
                                    className={`p-1.5 rounded-md transition-all ${vacancy.active
                                        ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm'
                                        : 'text-gray-400 hover:text-gray-600'}`}
                                    title={vacancy.active ? 'Pausar vacante' : 'Activar vacante'}
                                >
                                    <Power className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => handleClone(vacancy)}
                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-white dark:hover:bg-gray-700 rounded-md transition-all"
                                    title="Clonar Vacante"
                                >
                                    <Copy className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => handleEdit(vacancy)}
                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-white dark:hover:bg-gray-700 rounded-md transition-all"
                                    title="Editar"
                                >
                                    <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => handleDelete(vacancy.id)}
                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-all"
                                    title="Eliminar"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
};

/**
 * Sortable Category Pill Component
 * El orden de las píldoras define el orden en que Brenda menciona las categorías.
 */
const SortableCategoryPill = ({
    cat,
    isEditing,
    editingCategoryName,
    setEditingCategoryName,
    handleSaveEditCategory,
    handleCancelEditCategory,
    handleStartEditCategory,
    handleDeleteCategory
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: cat.id, disabled: isEditing });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : 1,
        position: 'relative'
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="group flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-gray-800 border border-blue-100 dark:border-blue-800/50 rounded-full text-xs font-medium text-blue-700 dark:text-blue-300 shadow-sm transition-all"
        >
            {isEditing ? (
                <>
                    <input
                        type="text"
                        value={editingCategoryName}
                        onChange={(e) => setEditingCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEditCategory();
                            if (e.key === 'Escape') handleCancelEditCategory();
                        }}
                        className="w-28 px-1.5 py-0.5 text-xs border border-blue-300 dark:border-blue-600 rounded bg-blue-50 dark:bg-gray-900 text-blue-800 dark:text-blue-200 outline-none focus:ring-1 focus:ring-blue-400"
                        autoFocus
                    />
                    <button
                        onClick={handleSaveEditCategory}
                        className="p-0.5 hover:bg-green-50 dark:hover:bg-green-900/30 text-green-600 rounded-full transition-all"
                        title="Guardar"
                    >
                        <Save className="w-3 h-3" />
                    </button>
                    <button
                        onClick={handleCancelEditCategory}
                        className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 rounded-full transition-all"
                        title="Cancelar"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </>
            ) : (
                <>
                    <span
                        {...attributes}
                        {...listeners}
                        className="cursor-grab active:cursor-grabbing text-blue-300 hover:text-blue-500 transition-colors -ml-1"
                        title="Arrastra para reordenar"
                    >
                        <GripVertical className="w-3 h-3" />
                    </span>
                    <span
                        onDoubleClick={() => handleStartEditCategory(cat)}
                        className="cursor-default select-none"
                        title="Doble clic para editar"
                    >
                        {cat.name}
                    </span>
                    <button
                        onClick={() => handleStartEditCategory(cat)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-500 rounded-full transition-all"
                        title="Editar"
                    >
                        <Pencil className="w-3 h-3" />
                    </button>
                    <button
                        onClick={() => handleDeleteCategory(cat.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-500 rounded-full transition-all"
                        title="Eliminar"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                </>
            )}
        </div>
    );
};

/**
 * Sección de Gestión de Vacantes
 */
const VacanciesSection = () => {
    const { showToast } = useToastContext();
    const [vacancies, setVacancies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [_saving, _setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const { confirmModalJSX, showConfirm } = useConfirmModal();

    // DND Sensors
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const [categories, setCategories] = useState([]);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [addingCategory, setAddingCategory] = useState(false);
    const [editingCategoryId, setEditingCategoryId] = useState(null);
    const [editingCategoryName, setEditingCategoryName] = useState('');



    // Load Initial Data
    useEffect(() => {
        loadVacancies();
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
        setIsModalOpen(true);
    };

    const handleEdit = (vacancy) => {
        setEditingId(vacancy.id);
        setIsModalOpen(true);
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
        const confirmed = await showConfirm({
            title: 'Eliminar Vacante',
            message: '¿Seguro que deseas eliminar esta vacante? Esta acción no se puede deshacer.',
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            variant: 'danger'
        });
        if (!confirmed) return;

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

    const handleCategoryDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        setCategories((items) => {
            const oldIndex = items.findIndex(item => item.id === active.id);
            const newIndex = items.findIndex(item => item.id === over.id);
            const newArray = arrayMove(items, oldIndex, newIndex);

            saveCategoryOrder(newArray.map(c => c.id));

            return newArray;
        });
    };

    const saveCategoryOrder = async (orderedIds) => {
        try {
            const res = await fetch('/api/categories', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reorder', orderedIds })
            });
            if (!res.ok) throw new Error('Reorder failed');
        } catch (error) {
            console.error('Error saving category order:', error);
            showToast('Error al guardar el nuevo orden de categorías', 'error');
            loadCategories();
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
        const confirmed = await showConfirm({
            title: 'Eliminar Categoría',
            message: '¿Seguro que deseas eliminar esta categoría?',
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            variant: 'danger'
        });
        if (!confirmed) return;
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

    const handleStartEditCategory = (cat) => {
        setEditingCategoryId(cat.id);
        setEditingCategoryName(cat.name);
    };

    const handleSaveEditCategory = async () => {
        if (!editingCategoryName.trim() || !editingCategoryId) return;
        try {
            const res = await fetch('/api/categories', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: editingCategoryId, name: editingCategoryName })
            });
            const data = await res.json();
            if (data.success) {
                showToast('Categoría actualizada', 'success');
                setEditingCategoryId(null);
                setEditingCategoryName('');
                loadCategories();
            } else {
                showToast(data.error || 'Error al editar', 'error');
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        }
    };

    const handleCancelEditCategory = () => {
        setEditingCategoryId(null);
        setEditingCategoryName('');
    };

    return (
        <div className="space-y-4 w-full pb-8">
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
                                Clasifica tus vacantes. Arrastra las categorías para definir el orden en que Brenda las menciona.
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
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleCategoryDragEnd}
                        >
                            <SortableContext
                                items={categories.map(c => c.id)}
                                strategy={rectSortingStrategy}
                            >
                                {categories.map(cat => (
                                    <SortableCategoryPill
                                        key={cat.id}
                                        cat={cat}
                                        isEditing={editingCategoryId === cat.id}
                                        editingCategoryName={editingCategoryName}
                                        setEditingCategoryName={setEditingCategoryName}
                                        handleSaveEditCategory={handleSaveEditCategory}
                                        handleCancelEditCategory={handleCancelEditCategory}
                                        handleStartEditCategory={handleStartEditCategory}
                                        handleDeleteCategory={handleDeleteCategory}
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>
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
                        strategy={rectSortingStrategy}
                    >
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
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

            {/* Create/Edit Modal extracted */}
            {isModalOpen && (
                <VacancyEditorModal
                    isOpen={isModalOpen}
                    onClose={() => {
                        setIsModalOpen(false);
                        setEditingId(null);
                    }}
                    vacancyId={editingId}
                    onSaveSuccess={() => {
                        loadVacancies(); // Refresh list after edit/create
                    }}
                />
            )}
            
            {confirmModalJSX}
        </div>
    );
};

export default VacanciesSection;
