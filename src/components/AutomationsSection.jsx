import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Power, PowerOff, Save, X, AlertCircle } from 'lucide-react';
import Button from './ui/Button';
import {
    getAutomationRules,
    createAutomationRule,
    updateAutomationRule,
    deleteAutomationRule,
    getFields,
    createField
} from '../services/automationsService';
import PhraseTagInput from './ui/PhraseTagInput';
import { phrasesToPattern, patternToPhrases } from '../utils/regex';

import {
    getScheduledRules,
    createScheduledRule,
    updateScheduledRule,
    deleteScheduledRule
} from '../services/scheduledMessagesService';
import { Clock, MessageSquare, Timer } from 'lucide-react';
const AutomationsSection = () => {
    const [rules, setRules] = useState([]);
    const [schedRules, setSchedRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [schedLoading, setSchedLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showSchedModal, setShowSchedModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editingField, setEditingField] = useState('pattern');
    const [editValue, setEditValue] = useState('');

    // Dynamic Fields State
    const [fields, setFields] = useState([]);
    const [loadingFields, setLoadingFields] = useState(true);
    const [schedEditingId, setSchedEditingId] = useState(null);
    const [schedEditingField, setSchedEditingField] = useState(''); // 'name', 'userMinutes', 'botMinutes', 'message'
    const [schedEditValue, setSchedEditValue] = useState('');

    // Load rules and fields on mount
    useEffect(() => {
        loadRules();
        loadSchedRules();
        loadFields();
    }, []);

    const loadFields = async () => {
        setLoadingFields(true);
        const result = await getFields();
        if (result.success) {
            setFields(result.fields);
        } else {
            console.error('Error loading fields:', result.error);
        }
        setLoadingFields(false);
    };

    const handleCreateField = async () => {
        const label = prompt('Nombre del nuevo campo (ej. Nivel de Inglés):');
        if (!label) return;

        const result = await createField(label);
        if (result.success) {
            // Reload fields to get the new one
            await loadFields();
            // If we are editing, set the value to the new field
            if (editingId) {
                setEditValue(result.field.value);
            }
        } else {
            alert('Error creando campo: ' + result.error);
        }
    };

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

    const loadSchedRules = async () => {
        setSchedLoading(true);
        const result = await getScheduledRules();
        if (result.success) {
            setSchedRules(result.rules);
        }
        setSchedLoading(false);
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

    // --- SCHEDULED MESSAGES HANDLERS ---

    const handleSchedToggle = async (rule) => {
        const result = await updateScheduledRule(rule.id, { enabled: !rule.enabled });
        if (result.success) loadSchedRules();
        else alert('Error: ' + result.error);
    };

    const handleSchedDelete = async (ruleId) => {
        if (!confirm('¿Eliminar esta regla de mensaje programado?')) return;
        const result = await deleteScheduledRule(ruleId);
        if (result.success) loadSchedRules();
        else alert('Error: ' + result.error);
    };

    const startSchedEditing = (rule, field) => {
        setSchedEditingId(rule.id);
        setSchedEditingField(field);
        setSchedEditValue(rule[field]);
    };

    const saveSchedEdit = async () => {
        if (!schedEditingId) return;

        const updates = { [schedEditingField]: schedEditValue };
        const result = await updateScheduledRule(schedEditingId, updates);

        if (result.success) {
            loadSchedRules();
            setSchedEditingId(null);
            setSchedEditValue('');
        } else {
            alert('Error guardando: ' + result.error);
        }
    };

    const cancelSchedEdit = () => {
        setSchedEditingId(null);
        setSchedEditValue('');
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

            {/* --- SCHEDULED MESSAGES SECTION --- */}
            <div className="mt-12">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                            <Clock className="w-6 h-6 mr-2 text-blue-600" />
                            Mensajes Programados
                        </h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            Configura mensajes de seguimiento automático basados en inactividad
                        </p>
                    </div>
                    <Button onClick={() => setShowSchedModal(true)} className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700">
                        <Plus className="w-4 h-4" />
                        <span>Crear Seguimiento</span>
                    </Button>
                </div>

                {/* Scheduled Table */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                                <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm">Nombre</th>
                                <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm text-center">Inactividad<br /><span className="text-xs font-normal text-gray-500">(Usuario min)</span></th>
                                <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm text-center">Inactividad<br /><span className="text-xs font-normal text-gray-500">(Bot min)</span></th>
                                <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm w-1/3">Mensaje</th>
                                <th className="text-center py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm w-20">Tipo</th>
                                <th className="text-center py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm w-24">Estado</th>
                                <th className="text-center py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-sm w-20">Acción</th>
                            </tr>
                        </thead>
                        <tbody>
                            {schedLoading ? (
                                <tr><td colSpan="7" className="text-center py-8">Cargando...</td></tr>
                            ) : schedRules.length === 0 ? (
                                <tr><td colSpan="7" className="text-center py-8 text-gray-500">No hay mensajes programados</td></tr>
                            ) : (
                                schedRules.map(rule => (
                                    <tr key={rule.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                                        {/* Name */}
                                        <td className="py-3 px-4">
                                            {schedEditingId === rule.id && schedEditingField === 'name' ? (
                                                <div className="flex items-center space-x-1">
                                                    <input
                                                        value={schedEditValue}
                                                        onChange={e => setSchedEditValue(e.target.value)}
                                                        className="w-full text-xs p-1 border rounded dark:bg-gray-900 dark:border-gray-600"
                                                        autoFocus
                                                    />
                                                    <button onClick={saveSchedEdit}><Save className="w-3 h-3 text-green-600" /></button>
                                                </div>
                                            ) : (
                                                <span
                                                    onClick={() => startSchedEditing(rule, 'name')}
                                                    className="font-medium text-gray-900 dark:text-gray-100 text-sm cursor-pointer hover:underline"
                                                >
                                                    {rule.name}
                                                </span>
                                            )}
                                        </td>

                                        {/* User Inactivity */}
                                        <td className="py-3 px-4 text-center">
                                            {schedEditingId === rule.id && schedEditingField === 'userInactivityMinutes' ? (
                                                <div className="flex items-center justify-center space-x-1">
                                                    <input
                                                        type="number"
                                                        value={schedEditValue}
                                                        onChange={e => setSchedEditValue(e.target.value)}
                                                        className="w-16 text-xs p-1 border rounded dark:bg-gray-900 dark:border-gray-600"
                                                        autoFocus
                                                    />
                                                    <button onClick={saveSchedEdit}><Save className="w-3 h-3 text-green-600" /></button>
                                                </div>
                                            ) : (
                                                <span
                                                    onClick={() => startSchedEditing(rule, 'userInactivityMinutes')}
                                                    className="inline-block px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono cursor-pointer hover:bg-gray-200"
                                                >
                                                    {rule.userInactivityMinutes}
                                                </span>
                                            )}
                                        </td>

                                        {/* Bot Inactivity */}
                                        <td className="py-3 px-4 text-center">
                                            {schedEditingId === rule.id && schedEditingField === 'botInactivityMinutes' ? (
                                                <div className="flex items-center justify-center space-x-1">
                                                    <input
                                                        type="number"
                                                        value={schedEditValue}
                                                        onChange={e => setSchedEditValue(e.target.value)}
                                                        className="w-16 text-xs p-1 border rounded dark:bg-gray-900 dark:border-gray-600"
                                                        autoFocus
                                                    />
                                                    <button onClick={saveSchedEdit}><Save className="w-3 h-3 text-green-600" /></button>
                                                </div>
                                            ) : (
                                                <span
                                                    onClick={() => startSchedEditing(rule, 'botInactivityMinutes')}
                                                    className="inline-block px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono cursor-pointer hover:bg-gray-200"
                                                >
                                                    {rule.botInactivityMinutes}
                                                </span>
                                            )}
                                        </td>

                                        {/* Message */}
                                        <td className="py-3 px-4">
                                            {schedEditingId === rule.id && schedEditingField === 'message' ? (
                                                <div className="flex flex-col space-y-2">
                                                    <textarea
                                                        value={schedEditValue}
                                                        onChange={e => setSchedEditValue(e.target.value)}
                                                        className="w-full text-xs p-2 border rounded dark:bg-gray-900 dark:border-gray-600"
                                                        rows={2}
                                                        autoFocus
                                                    />
                                                    <div className="flex space-x-2">
                                                        <button onClick={saveSchedEdit} className="text-xs text-green-600 font-bold flex items-center"><Save className="w-3 h-3 mr-1" /> Guardar</button>
                                                        <button onClick={cancelSchedEdit} className="text-xs text-red-600 flex items-center"><X className="w-3 h-3 mr-1" /> Cancelar</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div
                                                    onClick={() => startSchedEditing(rule, 'message')}
                                                    className="text-xs text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 p-1 rounded"
                                                >
                                                    {rule.message}
                                                </div>
                                            )}
                                        </td>

                                        {/* Type (One Time) */}
                                        <td className="py-3 px-4 text-center">
                                            {rule.oneTime ? (
                                                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded-full border border-purple-200 uppercase tracking-wider">
                                                    1 Vez
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-full border border-indigo-200 uppercase tracking-wider">
                                                    Ciclo
                                                </span>
                                            )}
                                        </td>

                                        {/* Status */}
                                        <td className="py-3 px-4 text-center">
                                            <button
                                                onClick={() => handleSchedToggle(rule)}
                                                className={`p-1.5 rounded-full transition-colors ${rule.enabled
                                                    ? 'bg-green-100 text-green-600 hover:bg-green-200'
                                                    : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                                                    }`}
                                                title={rule.enabled ? 'Desactivar' : 'Activar'}
                                            >
                                                <Power className="w-4 h-4" />
                                            </button>
                                        </td>

                                        {/* Actions */}
                                        <td className="py-3 px-4 text-center">
                                            <button
                                                onClick={() => handleSchedDelete(rule.id)}
                                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
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
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <CreateRuleModal
                    onClose={() => setShowCreateModal(false)}
                    fields={fields}
                    onCreateField={handleCreateField}
                    onSuccess={() => {
                        setShowCreateModal(false);
                        loadRules();
                    }}
                />
            )}

            {/* Create Scheduled Modal */}
            {showSchedModal && (
                <CreateScheduledRuleModal
                    onClose={() => setShowSchedModal(false)}
                    onSuccess={() => {
                        setShowSchedModal(false);
                        loadSchedRules();
                    }}
                />
            )}
        </div>
    );
};

/**
 * Modal for creating new automation rule
 */
const CreateRuleModal = ({ onClose, onSuccess, fields, onCreateField }) => {
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

        const fieldObj = fields.find(f => f.value === field);
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
                        <div className="flex space-x-2">
                            <select
                                value={field}
                                onChange={(e) => setField(e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
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

const CreateScheduledRuleModal = ({ onClose, onSuccess }) => {
    const [name, setName] = useState('');
    const [userMinutes, setUserMinutes] = useState(1440); // 24h default
    const [botMinutes, setBotMinutes] = useState(0);
    const [message, setMessage] = useState('');
    const [oneTime, setOneTime] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSaving(true);

        const result = await createScheduledRule({
            name,
            userInactivityMinutes: userMinutes,
            botInactivityMinutes: botMinutes,
            message,
            oneTime
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
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center">
                        <Clock className="w-5 h-5 mr-2 text-indigo-500" />
                        Crear Mensaje Programado
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X className="w-5 h-5" /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && <div className="p-3 bg-red-50 text-red-600 rounded border border-red-200 text-sm">{error}</div>}

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Nombre del Seguimiento *</label>
                        <input
                            value={name} onChange={e => setName(e.target.value)} required
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            placeholder="Ej: Recordatorio 24h"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Min. Inactividad Usuario</label>
                            <input
                                type="number" min="0" required
                                value={userMinutes} onChange={e => setUserMinutes(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">1440 min = 24 horas</p>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Min. Inactividad Bot (Opcional)</label>
                            <input
                                type="number" min="0" required
                                value={botMinutes} onChange={e => setBotMinutes(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">Tiempo min. desde último mensaje nuestro</p>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Mensaje a enviar *</label>
                        <textarea
                            value={message} onChange={e => setMessage(e.target.value)} required rows={3}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            placeholder="Hola, ¿sigues interesado en la vacante?"
                        />
                    </div>

                    <div className="flex items-center space-x-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center h-5">
                            <input
                                id="oneTime"
                                type="checkbox"
                                checked={oneTime}
                                onChange={(e) => setOneTime(e.target.checked)}
                                className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                            />
                        </div>
                        <div className="ml-2 text-sm">
                            <label htmlFor="oneTime" className="font-medium text-gray-900 dark:text-gray-100">Regla de una sola ocasión</label>
                            <p className="text-gray-500 dark:text-gray-400 text-xs">Si se activa, el mensaje se enviará solo una vez por candidato cuando se cumpla la condición.</p>
                        </div>
                    </div>

                    <div className="flex justify-end space-x-3 pt-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">Cancelar</button>
                        <Button type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : 'Crear Programación'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};
