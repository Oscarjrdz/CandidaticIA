import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Power, Save, X, Brain } from 'lucide-react';
import Button from './ui/Button';
import {
    getAutomationRules,
    createAutomationRule,
    updateAutomationRule,
    deleteAutomationRule,
    getFields,
    createField
} from '../services/automationsService';

const AutomationsSection = ({ showToast }) => {
    // --- STATE ---
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [fields, setFields] = useState([]);
    const [showCreateModal, setShowCreateModal] = useState(false);

    // Editing State
    const [editingId, setEditingId] = useState(null);
    const [editingField, setEditingField] = useState('prompt'); // 'prompt', 'field', 'description'
    const [editValue, setEditValue] = useState('');

    // --- EFFECTS ---
    useEffect(() => {
        loadRules();
        loadFields();
    }, []);

    // --- LOADERS ---
    const loadFields = async () => {
        const result = await getFields();
        if (result.success && Array.isArray(result.fields)) {
            setFields(result.fields);
        } else {
            console.error('Failed to load fields:', result);
            setFields([]);
        }
    };

    const handleCreateField = async () => {
        const label = prompt("Nombre del nuevo campo:");
        if (!label) return;

        // Simple slugify
        const value = label.toLowerCase()
            .replace(/[^\w\s-]/g, '') // Remove non-word chars
            .replace(/\s+/g, '_');    // Replace spaces with _

        // Optimistic update
        const newField = { label, value, type: 'text' };
        setFields(prev => [...prev, newField]);

        const result = await createField(label);
        if (result.success) {
            showToast('Campo creado', 'success');
            // Reload to get potential server-side adjustments
            loadFields();
        } else {
            showToast('Error al crear campo', 'error');
            // Revert optimistic update if needed, but for now just reload
            loadFields();
        }
    };

    const loadRules = async () => {
        setLoading(true);
        try {
            const result = await getAutomationRules();
            if (result.success && Array.isArray(result.rules)) {
                setRules(result.rules);
            } else {
                console.error('Failed to load rules:', result);
                setRules([]); // Prevent crash
                showToast('Error cargando reglas', 'error');
            }
        } catch (error) {
            console.error('Error loading rules:', error);
            showToast('Error cargando reglas', 'error');
            setRules([]);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleEnabled = async (rule) => {
        const updates = { enabled: !rule.enabled };
        // Optimistic update
        setRules(prev => prev.map(r => r.id === rule.id ? { ...r, ...updates } : r));

        const result = await updateAutomationRule(rule.id, updates);
        if (!result.success) {
            showToast('Error al actualizar estado', 'error');
            loadRules(); // Revert
        }
    };

    const handleDelete = async (ruleId) => {
        if (!confirm('¿Eliminar esta regla?')) return;

        // Optimistic update
        setRules(prev => prev.filter(r => r.id !== ruleId));

        const result = await deleteAutomationRule(ruleId);
        if (!result.success) {
            showToast('Error al eliminar', 'error');
            loadRules(); // Revert
        }
    };

    const startEditing = (rule, field) => {
        setEditingId(rule.id);
        setEditingField(field);
        setEditValue(rule[field] || '');
    };

    const saveEdit = async () => {
        if (!editingId) return;

        const updates = { [editingField]: editValue };

        // Optimistic update
        setRules(prev => prev.map(r => r.id === editingId ? { ...r, ...updates } : r));
        setEditingId(null);
        setEditValue('');

        const result = await updateAutomationRule(editingId, updates);
        if (!result.success) {
            showToast('Error al guardar cambios', 'error');
            loadRules(); // Revert
        }
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditValue('');
    };

    if (loading) {
        return (
            <div className="p-6">
                <div className="text-center py-10">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">Cargando reglas...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6">
            {/* Command Bar: Standardized Style */}
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 flex flex-col md:flex-row items-center justify-between gap-4 min-h-[82px] mb-6">
                <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-500/20 flex items-center justify-center transition-all">
                        <Brain className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight uppercase tracking-tight">EXTRACCIÓN INTELIGENTE</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                            <p className="text-[10px] font-black tracking-widest uppercase text-indigo-600 dark:text-indigo-400">
                                MOTOR DE IA ACTIVO
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        onClick={() => setShowCreateModal(true)}
                        icon={Plus}
                        className="rounded-2xl shadow-lg shadow-indigo-500/20 hover:scale-105 transition-all duration-300 bg-indigo-600 hover:bg-indigo-700"
                    >
                        Nueva Regla
                    </Button>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm w-1/3">
                                Instrucción de Captura (Prompt)
                            </th>
                            <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm w-48">
                                Campo Destino
                            </th>
                            <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm">
                                Descripción
                            </th>
                            <th className="text-center py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm w-24">
                                Estado
                            </th>
                            <th className="text-center py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm w-24">
                                Acciones
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rules.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="py-10 text-center text-gray-500 dark:text-gray-400">
                                    No hay reglas configuradas. Crea tu primera automatización.
                                </td>
                            </tr>
                        ) : (
                            rules.map((rule) => (
                                <tr
                                    key={rule.id}
                                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                                >
                                    {/* Prompt Column */}
                                    <td className="py-3 px-4">
                                        {editingId === rule.id && editingField === 'prompt' ? (
                                            <div className="flex flex-col space-y-2">
                                                <textarea
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    className="w-full px-3 py-2 border border-blue-500 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50"
                                                    rows={2}
                                                    autoFocus
                                                />
                                                <div className="flex items-center space-x-2">
                                                    <button
                                                        onClick={saveEdit}
                                                        className="px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded text-xs font-semibold flex items-center"
                                                    >
                                                        <Save className="w-3 h-3 mr-1" /> Guardar
                                                    </button>
                                                    <button
                                                        onClick={cancelEdit}
                                                        className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-semibold flex items-center"
                                                    >
                                                        <X className="w-3 h-3 mr-1" /> Cancelar
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center group/prompt">
                                                <div
                                                    onClick={() => startEditing(rule, 'prompt')}
                                                    className="flex-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded-xl transition-all min-h-[44px] flex items-center"
                                                    title="Click para editar instrucción"
                                                >
                                                    <span className="text-xs text-gray-700 dark:text-gray-300 font-medium leading-relaxed">
                                                        {rule.prompt || 'Sin instrucción...'}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </td>

                                    {/* Field Column */}
                                    <td className="py-3 px-4">
                                        {editingId === rule.id && editingField === 'field' ? (
                                            <div className="flex items-center space-x-2">
                                                <select
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    className="flex-1 px-2 py-1 border border-blue-500 rounded text-xs bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50"
                                                    autoFocus
                                                >
                                                    {fields.map(f => (
                                                        <option key={f.value} value={f.value}>{f.label}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={handleCreateField}
                                                    className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                                    title="Crear nuevo campo"
                                                >
                                                    <Plus className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={saveEdit}
                                                    className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                                                    title="Guardar"
                                                >
                                                    <Save className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={cancelEdit}
                                                    className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                                    title="Cancelar"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <span
                                                onClick={() => startEditing(rule, 'field')}
                                                className="inline-block px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-semibold cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                                                title="Click para cambiar campo"
                                            >
                                                {rule.fieldLabel || rule.field}
                                            </span>
                                        )}
                                    </td>

                                    {/* Description Column */}
                                    <td className="py-3 px-4">
                                        {editingId === rule.id && editingField === 'description' ? (
                                            <div className="flex items-center space-x-2">
                                                <input
                                                    type="text"
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    className="flex-1 px-2 py-1 border border-blue-500 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50"
                                                    autoFocus
                                                />
                                                <button
                                                    onClick={saveEdit}
                                                    className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                                                >
                                                    <Save className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={cancelEdit}
                                                    className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div
                                                onClick={() => startEditing(rule, 'description')}
                                                className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded transition-colors"
                                                title="Click para editar"
                                            >
                                                {rule.description || <span className="italic text-gray-400">Sin descripción</span>}
                                            </div>
                                        )}
                                    </td>

                                    {/* Status Column */}
                                    <td className="py-3 px-4 text-center">
                                        <button
                                            onClick={() => handleToggleEnabled(rule)}
                                            className={`inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${rule.enabled
                                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                                                }`}
                                            title={rule.enabled ? 'Click para desactivar' : 'Click para activar'}
                                        >
                                            <Power className="w-3 h-3" />
                                            <span>{rule.enabled ? 'ON' : 'OFF'}</span>
                                        </button>
                                    </td>

                                    {/* Actions Column */}
                                    <td className="py-3 px-4 text-center">
                                        <button
                                            onClick={() => handleDelete(rule.id)}
                                            className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                            title="Eliminar regla"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create Modal */}
            {
                showCreateModal && (
                    <CreateRuleModal
                        onClose={() => setShowCreateModal(false)}
                        fields={fields}
                        onCreateField={handleCreateField}
                        onSuccess={() => {
                            setShowCreateModal(false);
                            loadRules();
                        }}
                    />
                )
            }
        </div>
    );
};

/**
 * Modal for creating new automation rule
 */
const CreateRuleModal = ({ onClose, onSuccess, fields, onCreateField }) => {
    const [promptText, setPromptText] = useState('');
    const [field, setField] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!promptText.trim() || !field) {
            setError('Debes escribir una instrucción y seleccionar un campo');
            return;
        }

        setSaving(true);

        const fieldObj = fields.find(f => f.value === field);
        const result = await createAutomationRule({
            prompt: promptText.trim(),
            field,
            fieldLabel: fieldObj?.label || field,
            description
        });

        if (result.success) {
            onSuccess();
        } else {
            setError(result.error);
        }
        setSaving(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                        Crear Nueva Automatización
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Instrucción de Captura (Prompt) *
                        </label>
                        <textarea
                            value={promptText}
                            onChange={(e) => setPromptText(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:outline-none"
                            placeholder="Ej: Extrae el nombre completo y apellidos del candidato"
                            rows={3}
                            required
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Describe de forma clara qué información debe buscar la IA en la conversación para esta columna.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Campo Destino *
                        </label>
                        <div className="flex space-x-2">
                            <select
                                value={field}
                                onChange={(e) => setField(e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:outline-none"
                                required
                            >
                                <option value="">Selecciona un campo...</option>
                                {fields.map(f => (
                                    <option key={f.value} value={f.value}>{f.label}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={onCreateField}
                                className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400"
                                title="Crear nuevo campo"
                            >
                                <Plus className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Descripción (opcional)
                        </label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:outline-none"
                            placeholder="Breve descripción de qué captura esta regla"
                        />
                    </div>

                    <div className="flex items-center justify-end space-x-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            Cancelar
                        </button>
                        <Button type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : 'Crear Regla'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AutomationsSection;
