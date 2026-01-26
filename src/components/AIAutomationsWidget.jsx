import React, { useState, useEffect } from 'react';
import { Sparkles, Plus, Trash2, Power, PauseCircle, PlayCircle, BrainCircuit, Activity } from 'lucide-react';
import Button from './ui/Button';

const AIAutomationsWidget = ({ showToast }) => {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(false);
    const [newRulePrompt, setNewRulePrompt] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        loadRules();
    }, []);

    const loadRules = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/ai/automations');
            const data = await res.json();
            if (data.success) {
                setRules(data.automations);
            }
        } catch (error) {
            console.error('Failed to load AI rules', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateRule = async () => {
        if (!newRulePrompt.trim()) return;
        setIsCreating(true);

        try {
            // Auto-generate a name from the prompt (first few words)
            const name = newRulePrompt.split(' ').slice(0, 5).join(' ') + '...';

            const res = await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    prompt: newRulePrompt,
                    active: true
                })
            });

            if (res.ok) {
                showToast('✨ Regla mágica creada correctamente', 'success');
                setNewRulePrompt('');
                loadRules();
            } else {
                showToast('Error al crear la regla', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setIsCreating(false);
        }
    };

    const handleRunAnalysis = async () => {
        if (!window.confirm('¿Ejecutar análisis de todas las reglas activas ahora?\n\nEsto enviará mensajes reales a los candidatos que cumplan las condiciones.')) return;
        setLoading(true);
        try {
            const res = await fetch('/api/ai/automations/run', {
                method: 'POST'
            });
            const data = await res.json();
            if (res.ok) {
                showToast(`✅ Análisis completo: ${data.sent} mensajes enviados de ${data.evaluated} evaluados`, 'success');
            } else {
                showToast('Error en ejecución: ' + (data.error || 'Unknown'), 'error');
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteRule = async (id) => {
        if (!window.confirm('¿Eliminar esta regla de automatización?')) return;
        try {
            await fetch(`/api/ai/automations?id=${id}`, { method: 'DELETE' });
            showToast('Regla eliminada', 'default');
            loadRules();
        } catch (e) {
            showToast('Error eliminando regla', 'error');
        }
    };

    const toggleRule = async (rule) => {
        try {
            const updated = { ...rule, active: !rule.active };

            // Optimistic update
            setRules(prev => prev.map(r => r.id === rule.id ? updated : r));

            await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            });
        } catch (e) {
            loadRules(); // Revert on error
        }
    };

    return (
        <div className="space-y-6">

            {/* 🪄 Creation Area */}
            <div className="ios-glass p-6 rounded-2xl border border-blue-100 dark:border-blue-900/30 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <BrainCircuit className="w-32 h-32 text-blue-500" />
                </div>

                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center mb-4 relative z-10">
                    <Sparkles className="w-5 h-5 text-blue-500 mr-2 animate-pulse" />
                    Crear Nueva Automatización IA
                </h3>

                <div className="relative z-10">
                    <textarea
                        value={newRulePrompt}
                        onChange={(e) => setNewRulePrompt(e.target.value)}
                        placeholder="Ej: 'Si un candidato no ha contestado en 3 días y le falta el CV, mándale un recordatorio amable...'"
                        className="w-full h-24 p-4 rounded-xl bg-white/50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500/50 outline-none resize-none text-sm transition-all"
                    />

                    <div className="mt-4 flex justify-end">
                        <Button
                            onClick={handleCreateRule}
                            disabled={isCreating || !newRulePrompt.trim()}
                            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/30"
                        >
                            {isCreating ? 'Analizando...' : '✨ Crear Regla Mágica'}
                        </Button>
                    </div>
                </div>
            </div>

            {/* 📋 Active Rules List */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 ml-1">
                        Reglas Activas ({rules.length})
                    </h4>
                    <button
                        onClick={handleRunAnalysis}
                        className="text-xs flex items-center space-x-1 text-blue-500 hover:text-blue-600 font-medium px-2 py-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    >
                        <PlayCircle className="w-3.5 h-3.5" />
                        <span>Ejecutar Ahora</span>
                    </button>
                </div>

                {rules.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 dark:text-gray-600 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-xl">
                        <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No hay automatizaciones activas</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        {rules.map(rule => (
                            <div key={rule.id} className={`p-4 rounded-xl border transition-all duration-300 ${rule.active
                                ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm'
                                : 'bg-gray-50 dark:bg-gray-900 border-gray-100 dark:border-gray-800 opacity-60 grayscale'
                                }`}>
                                <div className="flex justify-between items-start">
                                    <div className="flex-1 pr-4">
                                        <div className="flex items-center space-x-2 mb-1">
                                            <span className={`w-2 h-2 rounded-full ${rule.active ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                                            <h4 className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-1">
                                                {rule.name}
                                            </h4>
                                        </div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                                            "{rule.prompt}"
                                        </p>
                                    </div>

                                    <div className="flex items-center space-x-2">
                                        <button
                                            onClick={() => toggleRule(rule)}
                                            className={`p-2 rounded-lg transition-colors ${rule.active
                                                ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                                                : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                                                }`}
                                            title={rule.active ? "Pausar" : "Activar"}
                                        >
                                            {rule.active ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                                        </button>

                                        <button
                                            onClick={() => handleDeleteRule(rule.id)}
                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                            title="Eliminar"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AIAutomationsWidget;
