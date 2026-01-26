import React, { useState, useEffect } from 'react';
import { Sparkles, Trash2, PauseCircle, PlayCircle, Loader2, AlertCircle } from 'lucide-react';
import Button from './ui/Button';

// INDESTRUCTIBLE WRAPPER
const AIAutomationsWidget = ({ showToast }) => {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [newRulePrompt, setNewRulePrompt] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [logs, setLogs] = useState(null);
    const [hasCriticalError, setHasCriticalError] = useState(false);

    useEffect(() => {
        loadRules();
    }, []);

    const loadRules = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/ai/automations');
            const data = await res.json();
            if (data && Array.isArray(data.automations)) {
                setRules(data.automations);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!newRulePrompt.trim()) return;
        setIsCreating(true);
        try {
            const name = newRulePrompt.substring(0, 25) + (newRulePrompt.length > 25 ? '...' : '');
            const res = await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, prompt: newRulePrompt, active: true })
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

    const handleDelete = async (id) => {
        if (!id || !window.confirm('¿Eliminar?')) return;

        // SECURE DELETE: No optimistic state for deletion to avoid mapping errors if render crashes
        try {
            const res = await fetch(`/api/ai/automations?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast?.('Eliminado', 'default');
                loadRules(); // Refresh list from source
            }
        } catch (e) {
            showToast?.('Error al borrar', 'error');
        }
    };

    const handleToggle = async (rule) => {
        if (!rule?.id) return;
        try {
            const updated = { ...rule, active: !rule.active };
            await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            });
            loadRules();
        } catch (e) { console.error(e); }
    };

    const handleRun = async () => {
        if (!window.confirm('¿Ejecutar ahora?')) return;
        setIsRunning(true);
        setLogs(['[SYSTEM] Analizando candidatos...']);
        try {
            const res = await fetch('/api/ai/automations/run', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setLogs(data.logs || []);
                showToast?.(data.sent > 0 ? `Rocket: ${data.sent} enviados` : 'Análisis terminado', 'success');
            } else {
                setLogs([`❌ Error: ${data.error || 'Falla del motor'}`]);
                showToast?.('Error en motor de IA', 'error');
            }
        } catch (e) {
            setLogs(['❌ Error de red o tiempo excedido (Timeout)']);
            showToast?.('Error de conexión', 'error');
        } finally {
            setIsRunning(false);
        }
    };

    if (hasCriticalError) {
        return <div className="p-4 bg-red-50 text-red-600 rounded-xl">Error crítico en widget.</div>;
    }

    return (
        <div className="space-y-6">
            {/* Input */}
            <div className="p-6 rounded-2xl bg-white border border-blue-100 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-gray-900 flex items-center">
                        <Sparkles className="w-5 h-5 text-blue-500 mr-2" />
                        IA Automations (Stable)
                    </h3>
                </div>
                <textarea
                    value={newRulePrompt}
                    onChange={(e) => setNewRulePrompt(e.target.value)}
                    placeholder="Ej: Saluda al 8116038195"
                    className="w-full h-20 p-4 rounded-xl bg-gray-50 border border-gray-200 outline-none text-sm"
                />
                <div className="mt-4 flex justify-end">
                    <Button onClick={handleCreate} disabled={isCreating || !newRulePrompt.trim()} className="bg-blue-600 text-white">
                        {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Crear Regla'}
                    </Button>
                </div>
            </div>

            {/* List */}
            <div className="space-y-3">
                <div className="flex justify-between items-center text-[10px] font-bold text-gray-500 uppercase tracking-widest px-1">
                    <span>Reglas Activas ({rules?.length || 0})</span>
                    <button onClick={handleRun} disabled={isRunning || !rules?.length} className="bg-green-500 text-white px-4 py-1.5 rounded-full">
                        {isRunning ? 'Corriendo...' : 'Ejecutar Ahora'}
                    </button>
                </div>

                {rules && rules.map((r, idx) => (
                    <div key={r?.id || idx} className={`p-4 rounded-2xl border flex items-center justify-between ${r?.active ? 'bg-white border-gray-200' : 'bg-gray-50 opacity-60'}`}>
                        <div className="truncate pr-4 flex-1">
                            <h4 className="font-bold text-sm truncate">{r?.name || 'Regla'}</h4>
                            <p className="text-[10px] text-gray-400 italic">"{r?.prompt || '...'}"</p>
                        </div>
                        <div className="flex items-center space-x-2">
                            <button onClick={() => handleToggle(r)} className={r?.active ? 'text-blue-500' : 'text-gray-400'}>
                                {r?.active ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                            </button>
                            <button onClick={() => handleDelete(r?.id)} className="text-gray-400 hover:text-red-500">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Logs */}
            {logs && (
                <div className="bg-gray-900 text-white p-4 rounded-2xl font-mono text-[10px] max-h-40 overflow-y-auto shadow-xl">
                    <div className="flex justify-between mb-2 opacity-50">
                        <span>AI_MONITOR_v3.0</span>
                        <button onClick={() => setLogs(null)}>Cerrar [x]</button>
                    </div>
                    {logs.map((l, i) => (
                        <div key={i} className="mb-1 border-b border-white/5 pb-1">{l}</div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AIAutomationsWidget;
