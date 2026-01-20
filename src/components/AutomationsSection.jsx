import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Power, PowerOff, Save, X, AlertCircle } from 'lucide-react';
import Button from './ui/Button';
import {
    getAutomationRules,
    createAutomationRule,
    updateAutomationRule,
    deleteAutomationRule,
    AVAILABLE_FIELDS
} from '../services/automationsService';
import PhraseTagInput from './ui/PhraseTagInput';
import { phrasesToPattern, patternToPhrases } from '../utils/regex';

const AutomationsSection = () => {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editingField, setEditingField] = useState('pattern'); // 'pattern' or 'description'
    const [editValue, setEditValue] = useState('');

    // Load rules on mount
    useEffect(() => {
        loadRules();
    }, []);

    const loadRules = async () => {
        setLoading(true);
        const result = await getAutomationRules();
        if (result.success) {
            setRules(result.rules);
        } else {
            console.error('Error loading rules:', result.error);
        }
        setLoading(false);
    };

    const handleToggleEnabled = async (rule) => {
        const result = await updateAutomationRule(rule.id, {
            enabled: !rule.enabled
        });
        if (result.success) {
            loadRules();
        } else {
            alert('Error actualizando regla: ' + result.error);
        }
    };

    const handleDelete = async (ruleId) => {
        if (!confirm('¿Eliminar esta regla de automatización?')) return;

        const result = await deleteAutomationRule(ruleId);
        if (result.success) {
            loadRules();
        } else {
            alert('Error eliminando regla: ' + result.error);
        }
    };

    const startEditing = (rule, field) => {
        setEditingId(rule.id);
        setEditingField(field);

        // Handle different field types
        if (field === 'field') {
            setEditValue(rule.field || '');
        } else if (field === 'pattern') {
            // Convert regex pattern back to phrases for editing
            const phrases = patternToPhrases(rule.pattern);
            // If parsing fails (complex custom regex), fallback to raw string in array
            setEditValue(phrases.length > 0 ? phrases : [rule.pattern]);
        } else {
            setEditValue(rule[field] || '');
        }
    };

    const saveEdit = async () => {
        if (!editingId) return;

        // Special handling for 'field' change - check for conflicts
        if (editingField === 'field') {
            const newFieldValue = editValue;
            const currentRule = rules.find(r => r.id === editingId);

            // Find if another rule uses this field
            const conflictingRule = rules.find(r =>
                r.id !== editingId &&
                r.field === newFieldValue &&
                r.enabled
            );

            if (conflictingRule) {
                const fieldLabel = AVAILABLE_FIELDS.find(f => f.value === newFieldValue)?.label || newFieldValue;
                const confirmMsg = `El campo "${fieldLabel}" ya está siendo usado por otra regla.\n\n¿Desactivar esa regla y usar este campo aquí?`;

                if (!confirm(confirmMsg)) {
                    cancelEdit();
                    return;
                }

                // Disable conflicting rule
                await updateAutomationRule(conflictingRule.id, { enabled: false });
            }

            // Update field and fieldLabel
            const fieldObj = AVAILABLE_FIELDS.find(f => f.value === newFieldValue);
            const updates = {
                field: newFieldValue,
                fieldLabel: fieldObj?.label || newFieldValue
            };
            const result = await updateAutomationRule(editingId, updates);

            if (result.success) {
                loadRules();
                setEditingId(null);
                setEditingField('pattern');
                setEditValue('');
            } else {
                alert('Error guardando: ' + result.error);
            }
        } else if (editingField === 'pattern') {
            // Handle Pattern save (Tag Input -> Regex)
            let newPattern;

            // Helper to check if it looks like raw regex (contains special chars logic not handled by phrasesToPattern)
            // But for simplicity, we assume user is editing phrases. 
            // If they cleared all tags and typed nothing, we block.
            if (!editValue || editValue.length === 0) {
                alert("Debes agregar al menos una frase clave");
                return;
            }

            newPattern = phrasesToPattern(editValue);

            const updates = { pattern: newPattern };
            const result = await updateAutomationRule(editingId, updates);

            if (result.success) {
                loadRules();
                setEditingId(null);
                setEditingField('pattern');
                setEditValue('');
            } else {
                alert('Error guardando: ' + result.error);
            }
        } else {
            // Normal edit (description)
            const updates = { [editingField]: editValue };
            const result = await updateAutomationRule(editingId, updates);

            if (result.success) {
                loadRules();
                setEditingId(null);
                setEditingField('pattern');
                setEditValue('');
            } else {
                alert('Error guardando: ' + result.error);
            }
        }
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditingField('pattern');
        setEditValue('');
    };

    if (loading) {
        return (
            <div className="p-6">
                <div className="text-center py-10">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">Cargando automatizaciones...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Automatizaciones
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Gestiona las reglas de captura automática de datos desde mensajes del bot
                    </p>
                </div>
                <Button onClick={() => setShowCreateModal(true)} className="flex items-center space-x-2">
                    <Plus className="w-4 h-4" />
                    <span>Crear Nueva</span>
                </Button>
            </div>

            {/* Info Alert */}
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900 dark:text-blue-100">
                    <p className="font-semibold mb-1">Palabras Clave (Triggers)</p>
                    <p>Escribe las frases que activarán la captura. Por ejemplo: "tu nombre es", "su nombre es". El sistema capturará automáticamente el valor que aparezca después de estas frases.</p>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm w-1/3">
                                Frases Clave (Triggers)
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
                                    {/* Pattern Column - TAGS INPUT */}
                                    <td className="py-3 px-4">
                                        {editingId === rule.id && editingField === 'pattern' ? (
                                            <div className="flex flex-col space-y-2">
                                                <PhraseTagInput
                                                    phrases={editValue}
                                                    onChange={setEditValue}
                                                    placeholder="Escribe y presiona Enter..."
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
                                            <div
                                                onClick={() => startEditing(rule, 'pattern')}
                                                className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded transition-colors min-h-[40px]"
                                                title="Click para editar frases"
                                            >
                                                {/* Display Tags */}
                                                <div className="flex flex-wrap gap-1">
                                                    {patternToPhrases(rule.pattern).length > 0 ? (
                                                        patternToPhrases(rule.pattern).map((phrase, idx) => (
                                                            <span key={idx} className="inline-block px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs border border-gray-300 dark:border-gray-600">
                                                                {phrase}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-xs font-mono text-gray-400 bg-gray-50 p-1 rounded border border-gray-100">
                                                            {rule.pattern.length > 30 ? rule.pattern.substring(0, 30) + '...' : rule.pattern}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </td>

                                    {/* Field Column - EDITABLE */}
                                    <td className="py-3 px-4">
                                        {editingId === rule.id && editingField === 'field' ? (
                                            <div className="flex items-center space-x-2">
                                                <select
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    className="flex-1 px-2 py-1 border border-blue-500 rounded text-xs bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    autoFocus
                                                >
                                                    {AVAILABLE_FIELDS.map(f => (
                                                        <option key={f.value} value={f.value}>{f.label}</option>
                                                    ))}
                                                </select>
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
                                                    className="flex-1 px-2 py-1 border border-blue-500 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                                            {rule.enabled ? (
                                                <>
                                                    <Power className="w-3 h-3" />
                                                    <span>ON</span>
                                                </>
                                            ) : (
                                                <>
                                                    <PowerOff className="w-3 h-3" />
                                                    <span>OFF</span>
                                                </>
                                            )}
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
            {showCreateModal && (
                <CreateRuleModal
                    onClose={() => setShowCreateModal(false)}
                    onSuccess={() => {
                        setShowCreateModal(false);
                        loadRules();
                    }}
                />
            )}
        </div>
    );
};

/**
 * Modal for creating new automation rule
 */
const CreateRuleModal = ({ onClose, onSuccess }) => {
    // pattern state is now an array of phrases
    const [phrases, setPhrases] = useState([]);
    const [field, setField] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (phrases.length === 0 || !field) {
            setError('Debes agregar al menos una frase y seleccionar un campo');
            return;
        }

        setSaving(true);

        // Convert tags to regex pattern
        const pattern = phrasesToPattern(phrases);

        const fieldObj = AVAILABLE_FIELDS.find(f => f.value === field);
        const result = await createAutomationRule({
            pattern,
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
                            Frases Clave (Triggers) *
                        </label>
                        <PhraseTagInput
                            phrases={phrases}
                            onChange={setPhrases}
                            placeholder="Ej: tu nombre es"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Escribe una frase y presiona Enter. Agrega tantas variantes como necesites.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Campo Destino *
                        </label>
                        <select
                            value={field}
                            onChange={(e) => setField(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            required
                        >
                            <option value="">Selecciona un campo...</option>
                            {AVAILABLE_FIELDS.map(f => (
                                <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Descripción (opcional)
                        </label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
