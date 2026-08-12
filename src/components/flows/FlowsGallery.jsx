import React, { useState, useEffect } from 'react';
import { Plus, Workflow, Trash2, Zap, ListChecks } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { useToastContext } from '../../contexts/ToastContext';
import { getFlows, createFlow, deleteFlow, updateFlow } from '../../services/flowsService';

const formatDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const FlowsGallery = ({ onOpenFlow }) => {
    const { showToast } = useToastContext();
    const [flows, setFlows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [rootTypeDraft, setRootTypeDraft] = useState('live');

    const load = async () => {
        setLoading(true);
        const res = await getFlows();
        if (res.success) setFlows(res.flows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
        else showToast('Error cargando flujos', 'error');
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const openCreateModal = () => {
        setNameDraft('');
        setRootTypeDraft('live');
        setShowCreateModal(true);
    };

    const handleCreate = async () => {
        if (!nameDraft.trim()) return;
        setCreating(true);
        const res = await createFlow(nameDraft.trim(), rootTypeDraft === 'lista' ? 'lista' : undefined);
        setCreating(false);
        if (res.success) {
            setShowCreateModal(false);
            showToast('Flujo creado', 'success');
            onOpenFlow(res.flow.id);
        } else {
            showToast('Error al crear el flujo', 'error');
        }
    };

    const handleToggleActive = async (flow, e) => {
        e.stopPropagation();
        const nextActive = !flow.active;
        setFlows(prev => prev.map(f => f.id === flow.id ? { ...f, active: nextActive } : f));
        const res = await updateFlow(flow.id, { active: nextActive });
        if (!res.success) {
            setFlows(prev => prev.map(f => f.id === flow.id ? { ...f, active: flow.active } : f));
            showToast('Error al cambiar el estado', 'error');
        }
    };

    const handleDelete = async (flow, e) => {
        e.stopPropagation();
        if (!confirm(`¿Eliminar el flujo "${flow.name}"?`)) return;
        setFlows(prev => prev.filter(f => f.id !== flow.id));
        const res = await deleteFlow(flow.id);
        if (!res.success) {
            showToast('Error al eliminar', 'error');
            load();
        }
    };

    return (
        <div className="max-w-5xl mx-auto p-4 sm:p-8">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Flows</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Automatiza acciones cuando un candidato completa su perfil</p>
                </div>
                <Button onClick={openCreateModal} icon={Plus}>Nuevo flujo</Button>
            </div>

            {loading ? (
                <div className="text-center text-gray-400 py-16 text-sm">Cargando...</div>
            ) : flows.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700">
                    <Workflow className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">Todavía no tienes ningún flujo</p>
                    <Button onClick={openCreateModal} icon={Plus}>Crear el primero</Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {flows.map(flow => (
                        <div
                            key={flow.id}
                            onClick={() => onOpenFlow(flow.id)}
                            className="group bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 cursor-pointer hover:shadow-md transition-shadow"
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 flex items-center justify-center">
                                    <Workflow className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                </div>
                                <button
                                    onClick={(e) => handleDelete(flow, e)}
                                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-opacity"
                                    title="Eliminar flujo"
                                >
                                    <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-600" />
                                </button>
                            </div>
                            <h3 className="font-semibold text-gray-900 dark:text-white truncate mb-1">{flow.name}</h3>
                            <p className="text-xs text-gray-400 mb-3">Editado {formatDate(flow.updatedAt)}</p>
                            <button
                                onClick={(e) => handleToggleActive(flow, e)}
                                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                                    flow.active
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-700'
                                        : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'
                                }`}
                            >
                                <span className={`w-2 h-2 rounded-full ${flow.active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                {flow.active ? 'Activo' : 'Inactivo'}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Nuevo flujo">
                <div className="space-y-4">
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 block">Nombre</label>
                        <input
                            autoFocus
                            type="text"
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && nameDraft.trim()) handleCreate(); }}
                            placeholder="Ej. Recordatorio de entrevista"
                            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs text-gray-500 dark:text-gray-400 block">Tipo de flujo</label>
                        <button
                            onClick={() => setRootTypeDraft('live')}
                            className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
                                rootTypeDraft === 'live'
                                    ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-600'
                                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                        >
                            <Zap className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                            <span>
                                <span className="block text-sm font-semibold text-gray-900 dark:text-white">En vivo</span>
                                <span className="block text-xs text-gray-500 dark:text-gray-400">Se dispara solo cuando un candidato completa su perfil.</span>
                            </span>
                        </button>
                        <button
                            onClick={() => setRootTypeDraft('lista')}
                            className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
                                rootTypeDraft === 'lista'
                                    ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-600'
                                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                        >
                            <ListChecks className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                            <span>
                                <span className="block text-sm font-semibold text-gray-900 dark:text-white">Lista filtrada (manual)</span>
                                <span className="block text-xs text-gray-500 dark:text-gray-400">Para candidatos que ya existen ("del pasado"). No se dispara solo — filtras, cargas la lista y le das Run.</span>
                            </span>
                        </button>
                    </div>

                    <Button onClick={handleCreate} loading={creating} disabled={!nameDraft.trim()} icon={Plus} className="w-full justify-center">
                        Crear flujo
                    </Button>
                </div>
            </Modal>
        </div>
    );
};

export default FlowsGallery;
