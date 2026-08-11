import React, { useState, useEffect } from 'react';
import { Plus, Workflow, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
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

    const load = async () => {
        setLoading(true);
        const res = await getFlows();
        if (res.success) setFlows(res.flows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
        else showToast('Error cargando flujos', 'error');
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const handleCreate = async () => {
        const name = prompt('Nombre del nuevo flujo:');
        if (!name || !name.trim()) return;
        setCreating(true);
        const res = await createFlow(name.trim());
        setCreating(false);
        if (res.success) {
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
                <Button onClick={handleCreate} loading={creating} icon={Plus}>Nuevo flujo</Button>
            </div>

            {loading ? (
                <div className="text-center text-gray-400 py-16 text-sm">Cargando...</div>
            ) : flows.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700">
                    <Workflow className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">Todavía no tienes ningún flujo</p>
                    <Button onClick={handleCreate} icon={Plus}>Crear el primero</Button>
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
        </div>
    );
};

export default FlowsGallery;
