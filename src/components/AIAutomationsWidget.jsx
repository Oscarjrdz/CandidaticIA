import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles, Trash2, PauseCircle, PlayCircle, BrainCircuit, Activity, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';
import Button from './ui/Button';

const AIAutomationsWidget = ({ showToast }) => {
    // Zuckerberg Grade: Strict initialization
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
            if (!res.ok) throw new Error('API unreachable');
            const data = await res.json();
            if (data.success && Array.isArray(data.automations)) {
                setRules(data.automations);
            } else {
                setRules([]);
            }
        } catch (error) {
            console.error('Core Logic Error:', error);
            setRules([]);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateRule = async () => {
        const val = newRulePrompt?.trim();
        if (!val) return;

        setIsCreating(true);
        try {
            const name = val.length > 30 ? val.substring(0, 30) + '...' : val;
            const res = await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, prompt: val, active: true })
            });

            if (res.ok) {
                showToast?.('✨ Regla creada con éxito', 'success');
                setNewRulePrompt('');
                loadRules();
            }
        } catch (e) {
            showToast?.('Error de red', 'error');
        } finally {
            setIsCreating(false);
        }
    };

    const handleRunAnalysis = async () => {
        if (!window.confirm('¿Ejecutar análisis inteligente Zuckerberg Edition?')) return;

        setIsRunning(true);
        setExecLogs(['[SYSTEM] Iniciando motor inteligente...', '[SYSTEM] Escaneando por "Intenciones" de búsqueda...']);

        try {
            const res = await fetch('/api/ai/automations/run', { method: 'POST' });

            // Critical: Non-JSON Response Handling (Prevent Crashes)
            const type = res.headers.get("content-type");
            if (!type || !type.includes("application/json")) {
                throw new Error('El motor devolvió una respuesta no válida (Timeout o Error 500)');
            }

            const data = await res.json();
            if (res.ok) {
                setExecLogs(data.logs || []);
                if (data.sent > 0) showToast?.(`🚀 Éxito: ${data.sent} mensajes enviados`, 'success');
                else showToast?.(`Análisis completo: 0 coincidencias en ${data.evaluated} candidatos.`, 'default');
            } else {
                throw new Error(data.error || 'Falla interna del motor');
            }
        } catch (e) {
            setExecLogs(prev => [...(prev || []), `❌ ERROR: ${e.message}`]);
            showToast?.('El análisis falló. Revisa la consola abajo.', 'error');
        } finally {
            setIsRunning(false);
        }
    };

    const handleDeleteRule = async (id) => {
        if (!id) return;
        if (!window.confirm('¿Eliminar esta regla permanentemente?')) return;

        // Indestructible Deletion Pattern
        const backup = [...rules];
        setRules(current => (current || []).filter(r => r.id !== id));

        try {
            const res = await fetch(`/api/ai/automations?id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            showToast?.('Regla eliminada', 'default');
        } catch (e) {
            setRules(backup);
            showToast?.('Error al eliminar regla', 'error');
        }
    };

    const toggleRule = async (rule) => {
        if (!rule?.id) return;
        const updated = { ...rule, active: !rule.active };
        setRules(current => (current || []).map(r => r.id === rule.id ? updated : r));

        try {
            const res = await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            });
            if (!res.ok) throw new Error('Update failed');
        } catch (e) {
            loadRules();
        }
    };

    // Constant safety wrapper
    const safeRules = useMemo(() => Array.isArray(rules) ? rules : [], [rules]);

    return (
        <div className="space-y-6">
            {/* 🧙 Magic Input */}
            <div className="p-6 rounded-2xl border border-blue-100 bg-white/40 dark:bg-gray-900/40 relative overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold flex items-center">
                        <Sparkles className="w-5 h-5 text-blue-500 mr-2" />
                        IA Automations
                    </h3>
                    <span className="text-[9px] font-black bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full uppercase tracking-tighter">Zuckerberg Stability Edition</span>
                </div>

                <textarea
                    value={newRulePrompt}
                    onChange={(e) => setNewRulePrompt(e.target.value)}
                    placeholder="Ej: 'Saluda al candidato 8116038195 (dile hola)'"
                    className="w-full h-24 p-4 rounded-xl bg-white/50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 outline-none resize-none text-sm transition-all shadow-inner"
                />

                <div className="mt-4 flex justify-end">
                    <Button
                        onClick={handleCreateRule}
                        disabled={isCreating || !newRulePrompt?.trim()}
                        className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg px-6"
                    >
                        {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : '✨ Crear Regla'}
                    </Button>
                </div>
            </div>

            {/* 📋 Execution Control */}
            <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500">Reglas Activas ({safeRules.length})</h4>
                    <button
                        onClick={handleRunAnalysis}
                        disabled={isRunning || safeRules.length === 0}
                        className={`text-xs flex items-center space-x-2 font-bold px-4 py-2 rounded-full transition-all ${isRunning ? 'bg-gray-200 text-gray-400' : 'bg-green-500 hover:bg-green-600 text-white'
                            }`}
                    >
                        {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                        <span>{isRunning ? 'Ejecutando...' : 'Ejecutar Ahora'}</span>
                    </button>
                </div>

                {safeRules.length === 0 && !loading ? (
                    <div className="text-center py-10 bg-gray-50 dark:bg-black/20 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
                        <p className="text-xs text-gray-400 font-medium">No hay reglas activas. Crea tu primera magia arriba.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-2.5">
                        {safeRules.map(rule => (
                            <div key={rule.id} className="group p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm flex justify-between items-center transition-all hover:border-blue-300">
                                <div className="flex-1 truncate pr-4">
                                    <h4 className="font-bold text-sm truncate">{rule.name}</h4>
                                    <p className="text-[10px] text-gray-500 truncate opacity-60 italic">"{rule.prompt}"</p>
                                </div>
                                <div className="flex items-center space-x-1">
                                    <button onClick={() => toggleRule(rule)} className={`p-2 rounded-lg ${rule.active ? 'text-blue-500 bg-blue-50' : 'text-gray-400'}`}>
                                        {rule.active ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                                    </button>
                                    <button onClick={() => handleDeleteRule(rule.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 📟 Real-time Monitor */}
            {execLogs && (
                <div className="bg-gray-950 dark:bg-black rounded-2xl border border-gray-800 overflow-hidden shadow-2xl animate-in zoom-in-95">
                    <div className="bg-gray-900 px-4 py-2 border-b border-gray-800 flex justify-between items-center">
                        <span className="text-[9px] font-black text-blue-400 tracking-tighter uppercase">AI Terminal Monitoring</span>
                        <button onClick={() => setExecLogs(null)} className="text-[9px] text-gray-600 hover:text-white rotate-45">+</button>
                    </div>
                    <div className="p-4 font-mono text-[10px] max-h-40 overflow-y-auto space-y-1">
                        {Array.isArray(execLogs) && execLogs.map((log, i) => (
                            <div key={i} className={`flex space-x-2 ${log.includes('✅') ? 'text-green-500' : log.includes('❌') ? 'text-red-500' : 'text-gray-500'}`}>
                                <span className="opacity-30 shrink-0">[{i}]</span>
                                <span className="break-words">{log}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AIAutomationsWidget;
