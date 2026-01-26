import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles, Trash2, PauseCircle, PlayCircle, BrainCircuit, Activity, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';
import Button from './ui/Button';

const AIAutomationsWidget = ({ showToast }) => {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [newRulePrompt, setNewRulePrompt] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [execLogs, setExecLogs] = useState(null);

    useEffect(() => {
        loadRules();
    }, []);

    const loadRules = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/ai/automations');
            if (!res.ok) throw new Error('Failed to fetch automations');
            const data = await res.json();
            if (data.success && Array.isArray(data.automations)) {
                setRules(data.automations);
            } else {
                setRules([]);
            }
        } catch (error) {
            console.error('Failed to load AI rules', error);
            showToast?.('Error al conectar con el servidor', 'error');
            setRules([]);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateRule = async () => {
        const trimmedPrompt = newRulePrompt?.trim();
        if (!trimmedPrompt) return;

        setIsCreating(true);
        try {
            const name = trimmedPrompt.length > 40
                ? trimmedPrompt.substring(0, 40) + '...'
                : trimmedPrompt;

            const res = await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, prompt: trimmedPrompt, active: true })
            });

            if (res.ok) {
                showToast?.('✨ Regla mágica creada correctamente', 'success');
                setNewRulePrompt('');
                await loadRules();
            } else {
                showToast?.('Error al guardar la regla', 'error');
            }
        } catch (error) {
            showToast?.('Error de red al crear regla', 'error');
        } finally {
            setIsCreating(false);
        }
    };

    const handleRunAnalysis = async () => {
        if (!window.confirm('¿Ejecutar análisis inteligente ahora?\n\nLa IA buscará candidatos y enviará mensajes automáticamente según tus reglas.')) return;

        setIsRunning(true);
        setExecLogs(['Iniciando motor de inteligencia...']);

        try {
            const res = await fetch('/api/ai/automations/run', { method: 'POST' });

            // Safety: Handle non-JSON responses (Timeouts/Errors)
            const contentType = res.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                const text = await res.text();
                throw new Error(text.substring(0, 100) || 'El servidor no respondió en formato JSON (Posible Timeout)');
            }

            const data = await res.json();

            if (res.ok) {
                setExecLogs(data.logs || []);
                if (data.sent > 0) {
                    showToast?.(`🚀 ¡Éxito! Se enviaron ${data.sent} mensajes.`, 'success');
                } else {
                    showToast?.(`Análisis completo: 0 coincidencias en ${data.evaluated} candidatos.`, 'default');
                }
            } else {
                throw new Error(data.error || 'Error desconocido en el motor');
            }
        } catch (e) {
            console.error('Run Analysis Error:', e);
            showToast?.('El análisis tardó demasiado o falló. Revisa los logs abajo.', 'error');
            setExecLogs(prev => [...(prev || []), `❌ ERROR: ${e.message}`]);
        } finally {
            setIsRunning(false);
        }
    };

    const handleDeleteRule = async (id) => {
        if (!id) return;
        if (!window.confirm('¿Estás seguro de eliminar esta regla de forma permanente?')) return;

        // Optimistic update with deep clone safety
        const rulesBackup = Array.from(rules);
        setRules(current => current.filter(r => r.id !== id));

        try {
            const res = await fetch(`/api/ai/automations?id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            showToast?.('Regla eliminada del servidor', 'default');
        } catch (e) {
            console.error('Delete error:', e);
            showToast?.('Error al eliminar: Restaurando regla', 'error');
            setRules(rulesBackup);
        }
    };

    const toggleRule = async (rule) => {
        if (!rule?.id) return;
        const updated = { ...rule, active: !rule.active };

        // Optimistic update
        setRules(current => current.map(r => r.id === rule.id ? updated : r));

        try {
            const res = await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            });
            if (!res.ok) throw new Error('Toggle failed');
        } catch (e) {
            console.error('Toggle error:', e);
            await loadRules();
        }
    };

    const safeRules = useMemo(() => Array.isArray(rules) ? rules : [], [rules]);

    return (
        <div className="space-y-6 select-none">
            {/* 🪄 Creation Area */}
            <div className="ios-glass p-6 rounded-2xl border border-blue-100 dark:border-blue-900/30 relative overflow-hidden group shadow-sm bg-white/40 dark:bg-gray-900/40">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <BrainCircuit className="w-32 h-32 text-blue-500" />
                </div>

                <div className="flex items-center justify-between mb-4 relative z-10">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                        <Sparkles className="w-5 h-5 text-blue-500 mr-2 animate-pulse" />
                        IA Automations
                    </h3>
                    <span className="text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full uppercase tracking-widest">
                        Zuckerberg Edition
                    </span>
                </div>

                <div className="relative z-10">
                    <textarea
                        value={newRulePrompt}
                        onChange={(e) => setNewRulePrompt(e.target.value)}
                        placeholder="Escribe tu regla en lenguaje natural... Ej: 'Saluda al candidato 8116038195'"
                        className="w-full h-24 p-4 rounded-xl bg-white/60 dark:bg-black/30 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500/50 outline-none resize-none text-sm transition-all placeholder:text-gray-400"
                    />

                    <div className="mt-4 flex justify-end">
                        <Button
                            onClick={handleCreateRule}
                            disabled={isCreating || !newRulePrompt?.trim()}
                            className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 px-6"
                        >
                            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : '✨ Crear Regla'}
                        </Button>
                    </div>
                </div>
            </div>

            {/* 📋 Active Rules List */}
            <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">
                        Reglas Activas ({safeRules.length})
                    </h4>
                    <button
                        onClick={handleRunAnalysis}
                        disabled={isRunning || safeRules.length === 0}
                        className={`text-xs flex items-center space-x-2 font-bold px-3 py-1.5 rounded-full transition-all ${isRunning
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md shadow-blue-500/20'
                            }`}
                    >
                        {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                        <span>{isRunning ? 'Ejecutando...' : 'Ejecutar Ahora'}</span>
                    </button>
                </div>

                {loading && safeRules.length === 0 ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin opacity-20" />
                    </div>
                ) : safeRules.length === 0 ? (
                    <div className="text-center py-10 bg-gray-50/50 dark:bg-black/10 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-2xl">
                        <Activity className="w-8 h-8 mx-auto mb-3 text-gray-300 dark:text-gray-700" />
                        <p className="text-xs text-gray-400 font-medium">No hay automatizaciones programadas</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-2.5">
                        {safeRules.map(rule => (
                            <div key={rule.id} className={`group p-4 rounded-2xl border transition-all duration-300 ${rule.active
                                ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm'
                                : 'bg-gray-50/80 dark:bg-gray-900/50 border-gray-100 dark:border-gray-800 opacity-60'
                                }`}>
                                <div className="flex justify-between items-center">
                                    <div className="flex-1 pr-4 min-w-0">
                                        <div className="flex items-center space-x-2 mb-1">
                                            <div className={`w-1.5 h-1.5 rounded-full ${rule.active ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`}></div>
                                            <h4 className="font-bold text-gray-900 dark:text-white text-sm truncate">
                                                {rule.name}
                                            </h4>
                                        </div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 italic opacity-80 pl-3.5">
                                            "{rule.prompt}"
                                        </p>
                                    </div>

                                    <div className="flex items-center space-x-1">
                                        <button
                                            onClick={() => toggleRule(rule)}
                                            className={`p-2 rounded-xl transition-all ${rule.active
                                                ? 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                                                : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                                                }`}
                                            title={rule.active ? "Pausar" : "Activar"}
                                        >
                                            {rule.active ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                                        </button>

                                        <button
                                            onClick={() => handleDeleteRule(rule.id)}
                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                            title="Eliminar"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>

                                        <div className="pl-1">
                                            <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-700" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 📝 Execution Logs Display */}
            {execLogs && (
                <div className="mt-4 animate-in fade-in zoom-in-95 duration-300">
                    <div className="bg-gray-900 dark:bg-black rounded-2xl overflow-hidden border border-gray-800 shadow-xl">
                        <div className="flex justify-between items-center px-4 py-2 bg-gray-800 border-b border-gray-700">
                            <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">System Monitor Control</span>
                            </div>
                            <button
                                onClick={() => setExecLogs(null)}
                                className="text-[10px] font-bold text-gray-500 hover:text-white transition-colors"
                            >
                                CLOSE [×]
                            </button>
                        </div>
                        <div className="p-4 font-mono text-[10px] leading-relaxed max-h-48 overflow-y-auto scrollbar-hide">
                            {Array.isArray(execLogs) && execLogs.length === 0 ? (
                                <div className="flex items-center space-x-2 text-gray-500 italic">
                                    <AlertCircle className="w-3 h-3" />
                                    <p>Esperando eventos de red...</p>
                                </div>
                            ) : (
                                Array.isArray(execLogs) && execLogs.map((log, idx) => (
                                    <div key={idx} className={`py-0.5 border-b border-gray-800/30 flex space-x-3 ${log.includes('✅') ? 'text-green-400' :
                                            log.includes('❌') ? 'text-red-400' :
                                                log.includes('✨') ? 'text-blue-400 font-bold' :
                                                    'text-gray-400'
                                        }`}>
                                        <span className="opacity-20 shrink-0">[{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                                        <span className="break-words">{log}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                    <p className="text-[9px] text-center mt-2 text-gray-400 italic">Logs generados en tiempo real por el Candidatic AI Engine</p>
                </div>
            )}
        </div>
    );
};

export default AIAutomationsWidget;
