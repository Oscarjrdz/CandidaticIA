import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles, Trash2, PauseCircle, PlayCircle, BrainCircuit, Activity, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';
import Button from './ui/Button';

// Zuckerberg Edition: Built-in safety wrapper to prevent white screens
class RuleErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError(error) { return { hasError: true }; }
    componentDidCatch(error, errorInfo) { console.error("Rule Widget Crash:", error, errorInfo); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-10 text-center bg-red-50 dark:bg-red-900/10 border border-red-200 rounded-2xl">
                    <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
                    <h3 className="text-red-900 dark:text-red-100 font-bold">Error en la interfaz</h3>
                    <p className="text-sm text-red-600 dark:text-red-400 mt-2">La vista de reglas experimentó un problema técnico. Intenta recargar la página.</p>
                    <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm">Recargar Todo</button>
                </div>
            );
        }
        return this.props.children;
    }
}

const AIAutomationsWidgetContent = ({ showToast }) => {
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
            if (!res.ok) throw new Error('Unreachable');
            const data = await res.json();
            setRules(Array.isArray(data.automations) ? data.automations : []);
        } catch (error) {
            console.error('Failed to load rules:', error);
            setRules([]);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateRule = async () => {
        const p = newRulePrompt?.trim();
        if (!p) return;
        setIsCreating(true);
        try {
            const name = p.length > 30 ? p.substring(0, 30) + '...' : p;
            const res = await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, prompt: p, active: true })
            });

            if (res.ok) {
                showToast?.('Regla creada', 'success');
                setNewRulePrompt('');
                loadRules();
            }
        } catch (e) {
            showToast?.('Error al crear', 'error');
        } finally {
            setIsCreating(false);
        }
    };

    const handleRunAnalysis = async () => {
        if (!window.confirm('¿Ejecutar análisis inteligente?')) return;
        setIsRunning(true);
        setExecLogs(['[SISTEMA] Iniciando análisis...']);
        try {
            const res = await fetch('/api/ai/automations/run', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setExecLogs(data.logs || []);
                showToast?.(data.sent > 0 ? `Rocket: ${data.sent} mensajes enviados` : 'Análisis terminado', 'success');
            } else {
                throw new Error(data.error || 'Falla del motor');
            }
        } catch (e) {
            setExecLogs(prev => [...(prev || []), `❌ ERROR: ${e.message}`]);
            showToast?.('Análisis fallido', 'error');
        } finally {
            setIsRunning(false);
        }
    };

    const handleDeleteRule = async (id) => {
        if (!id || !window.confirm('¿Eliminar esta regla?')) return;

        // Optimistic and Bulletproof
        const original = [...rules];
        setRules(curr => (curr || []).filter(r => r.id !== id));

        try {
            const res = await fetch(`/api/ai/automations?id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Fail');
            showToast?.('Regla eliminada', 'default');
        } catch (e) {
            setRules(original);
            showToast?.('Error al borrar', 'error');
        }
    };

    const toggleRule = async (rule) => {
        if (!rule?.id) return;
        const upd = { ...rule, active: !rule.active };
        setRules(curr => (curr || []).map(r => r.id === rule.id ? upd : r));
        try {
            await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(upd)
            });
        } catch (e) { loadRules(); }
    };

    const safeRules = Array.isArray(rules) ? rules : [];

    return (
        <div className="space-y-6">
            <div className="p-6 rounded-2xl border border-blue-100 bg-white dark:bg-gray-900 relative shadow-sm">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold flex items-center">
                        <Sparkles className="w-5 h-5 text-blue-500 mr-2" />
                        IA Automations
                    </h3>
                </div>
                <textarea
                    value={newRulePrompt}
                    onChange={(e) => setNewRulePrompt(e.target.value)}
                    placeholder="Ej: 'Saluda al 8116038195'"
                    className="w-full h-24 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-black/20 outline-none text-sm"
                />
                <div className="mt-4 flex justify-end">
                    <Button onClick={handleCreateRule} disabled={isCreating || !newRulePrompt?.trim()} className="bg-blue-600 text-white px-6">
                        {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : '✨ Crear Regla'}
                    </Button>
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex justify-between items-center px-1">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Activas ({safeRules.length})</h4>
                    <button onClick={handleRunAnalysis} disabled={isRunning} className="text-xs bg-green-500 text-white px-4 py-2 rounded-full font-bold shadow-sm">
                        {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Ejecutar Ahora'}
                    </button>
                </div>

                {safeRules.map(rule => (
                    <div key={rule.id} className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex justify-between items-center shadow-sm">
                        <div className="flex-1 truncate pr-4">
                            <h4 className="font-bold text-sm truncate">{rule.name}</h4>
                            <p className="text-[10px] text-gray-400 italic">"{rule.prompt}"</p>
                        </div>
                        <div className="flex items-center space-x-1">
                            <button onClick={() => toggleRule(rule)} className={`p-2 rounded-lg ${rule.active ? 'text-blue-500' : 'text-gray-400'}`}>
                                {rule.active ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                            </button>
                            <button onClick={() => handleDeleteRule(rule.id)} className="p-2 text-gray-400 hover:text-red-500">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {execLogs && (
                <div className="bg-black rounded-2xl border border-gray-800 p-4 font-mono text-[10px] text-gray-400 max-h-40 overflow-y-auto">
                    {execLogs.map((log, i) => (
                        <div key={i} className="py-0.5 border-b border-gray-800/20">{log}</div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Main Export with Error Boundary
const AIAutomationsWidget = (props) => (
    <RuleErrorBoundary>
        <AIAutomationsWidgetContent {...props} />
    </RuleErrorBoundary>
);

export default AIAutomationsWidget;
