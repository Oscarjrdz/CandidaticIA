import React, { useEffect, useState } from 'react';
import { Building2, Loader2, Save, Tag } from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';
import { useToast } from '../hooks/useToast';

const emptyForm = {
    name: '',
    company: '',
    category: '',
    description: '',
    messageDescription: '',
    documents: []
};

const VacancyEditorModal = ({ isOpen, onClose, vacancyId, onSaveSuccess }) => {
    const { showToast, ToastComponent } = useToast();
    const [saving, setSaving] = useState(false);
    const [loadingData, setLoadingData] = useState(false);
    const [categories, setCategories] = useState([]);
    const [formData, setFormData] = useState(emptyForm);

    useEffect(() => {
        if (!isOpen) return;
        loadCategories();
        if (vacancyId) loadVacancy(vacancyId);
        else setFormData(emptyForm);
    }, [isOpen, vacancyId]);

    const loadVacancy = async (id) => {
        setLoadingData(true);
        try {
            const res = await fetch('/api/vacancies');
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Error al cargar vacantes');
            const vacancy = data.data.find(v => v.id === id);
            if (!vacancy) {
                showToast('Vacante no encontrada', 'error');
                return;
            }
            setFormData({
                name: vacancy.name || '',
                company: vacancy.company || '',
                category: vacancy.category || '',
                description: vacancy.description || '',
                messageDescription: vacancy.messageDescription || '',
                documents: vacancy.documents || []
            });
        } catch (error) {
            console.error('Error loading vacancy:', error);
            showToast('Error al cargar vacante', 'error');
        } finally {
            setLoadingData(false);
        }
    };

    const loadCategories = async () => {
        try {
            const res = await fetch('/api/categories');
            const data = await res.json();
            if (data.success) setCategories(data.data || []);
        } catch (error) {
            console.error('Error loading categories:', error);
        }
    };

    const handleSave = async () => {
        if (!formData.name || !formData.company || !formData.category) {
            showToast('Por favor completa los campos obligatorios', 'error');
            return;
        }

        setSaving(true);
        try {
            const method = vacancyId ? 'PUT' : 'POST';
            const body = vacancyId ? { ...formData, id: vacancyId } : formData;
            const res = await fetch('/api/vacancies', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (data.success) {
                showToast(vacancyId ? 'Vacante actualizada exitosamente' : 'Vacante creada exitosamente', 'success');
                onSaveSuccess?.();
                if (!vacancyId) onClose();
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

    if (loadingData && vacancyId) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title="Editar Vacante" maxWidth="max-w-4xl w-[92vw]">
                <div className="flex items-center justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            </Modal>
        );
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={vacancyId ? 'Editar Vacante' : 'Nueva Vacante'}
            maxWidth="max-w-4xl w-[92vw]"
        >
            <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Input
                        label="Nombre de la Vacante"
                        placeholder="Ej. Soldador"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        autoFocus
                    />

                    <Input
                        label="Empresa"
                        placeholder="Ej. KATCON"
                        icon={Building2}
                        value={formData.company}
                        onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    />

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            Categoría
                        </label>
                        <div className="relative">
                            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <select
                                className="w-full h-10 pl-10 pr-9 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500/20 outline-none bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm appearance-none"
                                value={formData.category}
                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                            >
                                <option value="">Selecciona una categoría...</option>
                                {categories.map(cat => (
                                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="block text-[10px] font-black tracking-widest text-blue-600 dark:text-blue-400 uppercase">
                        Vacante para Mensaje (Info para el Bot)
                    </label>
                    <textarea
                        className="w-full min-h-[360px] px-4 py-3 border border-blue-100 dark:border-blue-900/50 rounded-lg focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800/20 focus:border-blue-300 bg-blue-50/30 dark:bg-blue-900/10 text-gray-900 dark:text-white text-sm leading-relaxed"
                        placeholder="Escribe aquí la información que Brenda mandará por WhatsApp..."
                        value={formData.messageDescription}
                        onChange={(e) => setFormData({ ...formData, messageDescription: e.target.value })}
                    />
                </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
                <Button variant="ghost" onClick={onClose} disabled={saving}>
                    Cancelar
                </Button>
                <Button onClick={handleSave} disabled={saving} icon={saving ? Loader2 : Save}>
                    {saving ? (vacancyId ? 'Guardando...' : 'Creando...') : (vacancyId ? 'Actualizar Vacante' : 'Guardar Vacante')}
                </Button>
            </div>

            {ToastComponent}
        </Modal>
    );
};

export default VacancyEditorModal;
