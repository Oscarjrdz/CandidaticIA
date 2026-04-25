import React, { useState, useEffect } from 'react';
import { Briefcase, Plus, Building2, Tag, Loader2, Save, Trash2, Pencil, Power, Smartphone } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';
import { useConfirmModal } from './ui/ConfirmModal';

const BolsaSection = ({ showToast }) => {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingJob, setEditingJob] = useState(null);
    const { confirmModalJSX, showConfirm } = useConfirmModal();

    const [formData, setFormData] = useState({
        title: '',
        company: '',
        location: '',
        salary: '',
        type: 'Tiempo Completo',
        recruiterPhone: '',
        description: ''
    });

    useEffect(() => {
        loadJobs();
    }, []);

    const loadJobs = async () => {
        try {
            const res = await fetch('/api/bolsa');
            const data = await res.json();
            if (data.success) {
                setJobs(data.data || []);
            }
        } catch (error) {
            console.error('Error loading bolsa jobs:', error);
            showToast('Error al cargar la bolsa de empleo', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenCreate = () => {
        setEditingJob(null);
        setFormData({
            title: '',
            company: '',
            location: '',
            salary: '',
            type: 'Tiempo Completo',
            recruiterPhone: '',
            description: ''
        });
        setIsModalOpen(true);
    };

    const handleEdit = (job) => {
        setEditingJob(job);
        setFormData({
            title: job.title || '',
            company: job.company || '',
            location: job.location || '',
            salary: job.salary || '',
            type: job.type || 'Tiempo Completo',
            recruiterPhone: job.recruiterPhone || '',
            description: job.description || ''
        });
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.title || !formData.company || !formData.recruiterPhone) {
            showToast('El título, compañía y teléfono son obligatorios', 'error');
            return;
        }

        setSaving(true);
        try {
            const isEditing = !!editingJob;
            const method = isEditing ? 'PUT' : 'POST';
            const body = isEditing ? { ...formData, id: editingJob.id } : formData;

            const res = await fetch('/api/bolsa', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            if (data.success) {
                showToast(isEditing ? 'Vacante actualizada' : 'Vacante creada', 'success');
                setIsModalOpen(false);
                loadJobs();
            } else {
                showToast(data.error || 'Error al guardar', 'error');
            }
        } catch (error) {
            console.error('Error saving job:', error);
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (job) => {
        try {
            const res = await fetch('/api/bolsa', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: job.id, active: !job.active })
            });
            if (res.ok) {
                showToast(job.active !== false ? 'Vacante pausada' : 'Vacante activada', 'success');
                loadJobs();
            }
        } catch (error) {
            console.error('Error updating job:', error);
            showToast('Error al actualizar', 'error');
        }
    };

    const handleDelete = async (id) => {
        const confirmed = await showConfirm({
            title: 'Eliminar Vacante',
            message: '¿Seguro que deseas eliminar esta vacante de la app móvil?',
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            variant: 'danger'
        });
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/bolsa?id=${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                showToast('Vacante eliminada', 'success');
                loadJobs();
            }
        } catch (error) {
            console.error('Error deleting job:', error);
            showToast('Error al eliminar', 'error');
        }
    };

    return (
        <div className="space-y-4 w-full pb-8">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl shadow-lg p-6 flex flex-col md:flex-row items-center justify-between gap-4 text-white">
                <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <Smartphone className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold uppercase tracking-tight">Bolsa de Empleo (APP)</h2>
                        <p className="text-blue-100 text-sm mt-1">
                            Administra los trabajos visibles para los candidatos en la App Móvil.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleOpenCreate}
                        className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 rounded-xl font-bold shadow-sm hover:scale-105 transition-all"
                    >
                        <Plus className="w-5 h-5" />
                        Crear Vacante
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            ) : jobs.length === 0 ? (
                <Card>
                    <div className="text-center py-12">
                        <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
                            <Smartphone className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                            Bolsa de Empleo Vacía
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                            Publica tu primer trabajo para que los candidatos lo vean en su celular.
                        </p>
                        <Button onClick={handleOpenCreate} variant="outline">
                            Crear Vacante
                        </Button>
                    </div>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {jobs.map((job) => (
                        <Card key={job.id} className="relative overflow-hidden group hover:shadow-lg transition-all border border-gray-100 dark:border-gray-800">
                            <div className="absolute top-4 right-4 z-10">
                                <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${job.active !== false
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400'}`}>
                                    {job.active !== false ? 'Pública' : 'Oculta'}
                                </span>
                            </div>

                            <div className="mb-4 pr-16">
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-tight mb-1">{job.title}</h3>
                                <div className="flex items-center text-gray-500 dark:text-gray-400 text-sm">
                                    <Building2 className="w-4 h-4 mr-1.5" />
                                    {job.company}
                                </div>
                            </div>

                            <div className="space-y-2 mb-6">
                                {job.location && (
                                    <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                                        <Tag className="w-4 h-4 mr-2 text-blue-500" />
                                        {job.location}
                                    </div>
                                )}
                                <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                                    <Briefcase className="w-4 h-4 mr-2 text-blue-500" />
                                    {job.type} • {job.salary}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 mt-auto pt-4 border-t border-gray-100 dark:border-gray-800">
                                <button
                                    onClick={() => handleToggleActive(job)}
                                    className={`flex-1 py-2 rounded-lg flex items-center justify-center transition-all ${job.active !== false
                                        ? 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600'
                                        : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                                >
                                    <Power className="w-4 h-4 mr-1.5" />
                                    <span className="text-xs font-bold">{job.active !== false ? 'Pausar' : 'Publicar'}</span>
                                </button>
                                <button
                                    onClick={() => handleEdit(job)}
                                    className="p-2 bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-all"
                                >
                                    <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleDelete(job.id)}
                                    className="p-2 bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600 rounded-lg transition-all"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingJob ? "Editar Vacante" : "Nueva Vacante App"}>
                <div className="space-y-4">
                    <Input
                        label="Título del Puesto *"
                        value={formData.title}
                        onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="Ej. Gerente de Ventas"
                    />
                    <Input
                        label="Empresa *"
                        value={formData.company}
                        onChange={(e) => setFormData(prev => ({ ...prev, company: e.target.value }))}
                        placeholder="Ej. TechCorp"
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Ubicación"
                            value={formData.location}
                            onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                            placeholder="Ej. Monterrey / Remoto"
                        />
                        <Input
                            label="Sueldo"
                            value={formData.salary}
                            onChange={(e) => setFormData(prev => ({ ...prev, salary: e.target.value }))}
                            placeholder="Ej. $20k - $30k"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
                            <select
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                value={formData.type}
                                onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}
                            >
                                <option value="Tiempo Completo">Tiempo Completo</option>
                                <option value="Medio Tiempo">Medio Tiempo</option>
                                <option value="Remoto">Remoto</option>
                                <option value="Híbrido">Híbrido</option>
                            </select>
                        </div>
                        <Input
                            label="WhatsApp del Reclutador *"
                            value={formData.recruiterPhone}
                            onChange={(e) => setFormData(prev => ({ ...prev, recruiterPhone: e.target.value }))}
                            placeholder="Ej. 8112345678"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Descripción (Opcional)</label>
                        <textarea
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-h-[100px]"
                            value={formData.description}
                            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                            placeholder="Requisitos, beneficios, etc."
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-700">
                        <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} loading={saving}>
                            {saving ? 'Guardando...' : 'Guardar Vacante'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {confirmModalJSX}
        </div>
    );
};

export default BolsaSection;
