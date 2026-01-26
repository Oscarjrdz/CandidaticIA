import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Trash2, PauseCircle, PlayCircle, Loader2, AlertCircle, RefreshCcw, ShieldCheck } from 'lucide-react';
import Button from './ui/Button';

/**
 * 🧱 RuleErrorBoundary
 * Prevents the "White Screen of Death". If a sub-component crashes, 
 * this catches it and shows a professional recovery message.
 */
class RuleErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) { return { hasError: true, error }; }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 text-center bg-gray-900 rounded-2xl border border-red-500/50 shadow-2xl">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h3 className="text-white font-bold text-lg mb-2">System Collision Detected</h3>
                    <p className="text-gray-400 text-xs mb-6 max-w-xs mx-auto">
                        La interfaz de IA experimentó un error inesperado de renderizado.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-2 bg-blue-600 text-white rounded-full text-xs font-bold hover:bg-blue-700 transition-all flex items-center mx-auto"
                    >
                        <RefreshCcw className="w-3 h-3 mr-2" />
                        Reiniciar Interfaz
                    </button>
                    <pre className="mt-6 p-3 bg-black/50 rounded text-[8px] text-red-400 text-left overflow-auto max-h-24 font-mono">
                        {this.state.error?.toString()}
                    </pre>
                </div>
            );
        }
        return this.props.children;
    }
}

/**
 * 🎛️ AIAutomationsWidgetContent
 * Zuckerberg Style: High durability, high performance.
 */
const AIAutomationsWidgetContent = ({ showToast }) => {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [logs, setLogs] = useState(null);

    const loadRules = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/ai/automations');
            const data = await res.json();
            // Critical: Only update if it's a valid array.
            if (data && Array.isArray(data.automations)) {
                setRules(data.automations);
            } else {
                setRules([]);
            }
        } catch (e) {
            console.error('[System] Load failure:', e);
            setRules([]);
        } finally {
            setLoading(false);
        }
    }, [setRules]);

    useEffect(() => { loadRules(); }, [loadRules]);

    const handleCreate = async () => {
        const text = prompt?.trim();
        if (!text) return;
        setIsCreating(true);
        try {
            const name = text.length > 30 ? text.substring(0, 30) + '...' : text;
            const res = await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, prompt: text, active: true })
            });
            if (res.ok) {
                showToast?.('Regla guardada en la Nube', 'success');
                setPrompt('');
                loadRules();
            } else {
                showToast?.('Error al guardar regla', 'error');
            }
        } catch (e) {
            showToast?.('Error de red', 'error');
        } finally {
            setIsCreating(false);
        }
    };

    const handleDelete = async (id) => {
        if (!id) return;
        if (!window.confirm('¿Eliminar esta automatización de forma permanente?')) return;

        try {
            const res = await fetch(`/api/ai/automations?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast?.('Regla eliminada', 'default');
                loadRules();
            } else {
                showToast?.('No se pudo eliminar', 'error');
            }
        } catch (e) {
            showToast?.('Fallo de conexión', 'error');
        }
    };

    const handleToggle = async (rule) => {
        if (!rule?.id) return;
        const updated = { ...rule, active: !rule.active };
        try {
            await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            });
            loadRules();
        } catch (e) { console.error(e); }
    };

    const handleRun = async () => {
        if (!window.confirm('¿Ejecutar análisis ahora?')) return;
        setIsRunning(true);
        setLogs(['[SYSTEM] Inicializando Candidatic AI Engine...', '[SYSTEM] Verificando rutas de API...']);

        try {
            const res = await fetch('/api/ai/automations/run', { method: 'POST' });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || 'Server Error: ' + res.status);
            }

            const data = await res.json();
            setLogs(data.logs || ['Análisis finalizado sin logs adicionales.']);

            if (data.sent > 0) {
                showToast?.(`🚀 ¡Éxito! ${data.sent} mensajes enviados.`, 'success');
            } else {
                showToast?.('Proceso finalizado (0 coincidencias)', 'default');
            }
        } catch (e) {
            console.error('[Run Error]', e);
            setLogs(prev => [...(prev || []), `❌ ERROR CRÍTICO: ${e.message}`, `💡 Tip: Verifica que la regla mencione un número que esté en la base.`]);
            showToast?.('Falla en la ejecución', 'error');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Input Console */}
            <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 border border-blue-50 dark:border-blue-900/30 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-5 pointer-events-none">
                    <ShieldCheck className="w-40 h-40 text-blue-500" />
                </div>

                <div className="flex justify-between items-center mb-5 relative z-10">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center">
                        <Sparkles className="w-5 h-5 text-blue-500 mr-2" />
                        AI Automations v3.5
                    </h3>
                    <div className="flex items-center space-x-2">
                        <span className="text-[8px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-tighter">Zuckerberg Edition</span>
                    </div>
                </div>

                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Escribe tu regla... Ej: 'Saluda al 8116038195 y dile hola'"
                    className="w-full h-24 p-5 rounded-2xl bg-gray-50/50 dark:bg-black/20 border border-gray-100 dark:border-gray-800 outline-none text-sm transition-all focus:border-blue-400 placeholder:text-gray-400"
                />

                <div className="mt-5 flex justify-end relative z-10">
                    <Button
                        onClick={handleCreate}
                        disabled={isCreating || !prompt?.trim()}
                        className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 px-8 py-3 rounded-full font-bold text-xs"
                    >
                        {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : '✨ Crear Regla Mágica'}
                    </Button>
                </div>
            </div>

            {/* List Control */}
            <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                    <div className="flex items-center space-x-2">
                        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Reglas Activas</h4>
                        <span className="bg-gray-100 text-gray-500 text-[9px] px-2 py-0.5 rounded-full">{Array.isArray(rules) ? rules.length : 0}</span>
                    </div>
                    <button
                        onClick={handleRun}
                        disabled={isRunning || !Array.isArray(rules) || rules.length === 0}
                        className={`text-xs font-black px-6 py-2.5 rounded-full transition-all flex items-center shadow-lg ${isRunning
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-green-500 hover:bg-green-600 text-white shadow-green-500/20'
                            }`}
                    >
                        {isRunning ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                        {isRunning ? 'PROCESANDO...' : 'EJECUTAR AHORA'}
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    {loading && rules.length === 0 ? (
                        <div className="text-center py-10 opacity-30 italic text-xs">Sincronizando con la nube...</div>
                    ) : (Array.isArray(rules) && rules.length === 0) ? (
                        <div className="text-center py-12 rounded-3xl border-2 border-dashed border-gray-100 dark:border-gray-800">
                            <Activity className="w-8 h-8 text-gray-200 mx-auto mb-3" />
                            <p className="text-xs text-gray-400 font-medium">No hay automatizaciones programadas.</p>
                        </div>
                    ) : (
                        Array.isArray(rules) && rules.map((r) => (
                            <div key={r?.id} className={`p-5 rounded-3xl border transition-all duration-300 flex items-center justify-between ${r?.active
                                    ? 'bg-white border-gray-100 shadow-sm hover:border-blue-200'
                                    : 'bg-gray-50 border-transparent opacity-50 grayscale'
                                }`}>
                                <div className="truncate pr-6 flex-1">
                                    <div className="flex items-center space-x-2 mb-1">
                                        <div className={`w-1.5 h-1.5 rounded-full ${r?.active ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`}></div>
                                        <h4 className="font-bold text-sm text-gray-900 truncate">{r?.name || 'Automatización Sin Nombre'}</h4>
                                    </div>
                                    <p className="text-[10px] text-gray-400 italic truncate pl-3.5">"{r?.prompt || '...'}"</p>
                                </div>
                                <div className="flex items-center space-x-1 shrink-0">
                                    <button
                                        onClick={() => handleToggle(r)}
                                        className={`p-3 rounded-2xl transition-all ${r?.active ? 'text-blue-500 bg-blue-50' : 'text-gray-400 hover:bg-gray-100'}`}
                                    >
                                        {r?.active ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                                    </button>
                                    <button
                                        onClick={() => handleDelete(r?.id)}
                                        className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Terminal Monitor */}
            {logs && (
                <div className="bg-black/95 rounded-3xl overflow-hidden shadow-2xl border border-gray-800 animate-in slide-in-from-bottom-5 duration-500">
                    <div className="px-5 py-3 bg-gray-900/50 border-b border-gray-800 flex justify-between items-center">
                        <div className="flex items-center space-x-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                            <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest">System Monitor Engine</span>
                        </div>
                        <button onClick={() => setLogs(null)} className="text-gray-500 hover:text-white text-xs">Cerrar [×]</button>
                    </div>
                    <div className="p-6 font-mono text-[10px] leading-relaxed max-h-56 overflow-y-auto custom-scrollbar">
                        {Array.isArray(logs) && logs.map((l, i) => (
                            <div key={i} className={`mb-1.5 flex space-x-3 ${l.includes('✅') ? 'text-green-400' :
                                    l.includes('❌') ? 'text-red-400' :
                                        l.includes('🎯') || l.includes('🚀') ? 'text-blue-400 font-bold' :
                                            'text-gray-500'
                                }`}>
                                <span className="opacity-20 shrink-0">0x{i.toString(16).padStart(2, '0')}</span>
                                <span className="break-words">{l}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// Final Bulletproof Export
const AIAutomationsWidget = (props) => (
    <RuleErrorBoundary>
        <AIAutomationsWidgetContent {...props} />
    </RuleErrorBoundary>
);

export default AIAutomationsWidget;

// Simple custom CSS for the scrollbar
const style = document.createElement('style');
style.innerHTML = `
    .custom-scrollbar::-webkit-scrollbar { width: 4px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
`;
document.head.appendChild(style);
