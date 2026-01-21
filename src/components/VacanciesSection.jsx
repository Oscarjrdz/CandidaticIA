import React, { useState, useEffect } from 'react';
import { Briefcase, Plus, Building2, Tag, FileText, Loader2, Save } from 'lucide-react';
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

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        company: '',
        category: '',
        description: ''
    });

    // Load Vacancies
    useEffect(() => {
        loadVacancies();
    }, []);

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

    const handleSave = async () => {
        // Validation
        if (!formData.name || !formData.company || !formData.category) {
            showToast('Por favor completa los campos obligatorios', 'error');
            return;
        }

        setSaving(true);
        try {
            const res = await fetch('/api/vacancies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();

            if (data.success) {
                showToast('Vacante creada exitosamente', 'success');
                setIsModalOpen(false);
                setFormData({ name: '', company: '', category: '', description: '' });
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

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                    <Briefcase className="w-6 h-6 text-blue-600" />
                    Gestión de Vacantes
                </h2>
                <Button
                    onClick={() => setIsModalOpen(true)}
                    icon={Plus}
                >
                    Nueva Vacante
                </Button>
            </div>

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
                        <Button onClick={() => setIsModalOpen(true)} variant="outline">
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
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${vacancy.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                        {vacancy.active ? 'ACTIVA' : 'INACTIVA'}
                                    </span>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {/* Create Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Nueva Vacante"
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

                    <Input
                        label="Categoría"
                        placeholder="Ej. Tecnología, Ventas, RRHH"
                        icon={Tag}
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    />

                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Descripción
                        </label>
                        <textarea
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
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
                            {saving ? 'Guardando...' : 'Guardar Vacante'}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default VacanciesSection;
