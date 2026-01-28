import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Trash2, PauseCircle, PlayCircle, Loader2, AlertCircle, RefreshCcw, Command, Zap, Terminal } from 'lucide-react';
import Button from './ui/Button';
import AIEnginePulse from './AIEnginePulse';

/**
 * AIAutomationsWidget v5.0 - THE ZUCKERBERG RIGOR
 * Features: Inline Delete Confirmation, Trace Diagnostic Console, Null-Safe State Machine.
 */
const AIAutomationsWidget = ({ showToast }) => {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [creating, setCreating] = useState(false);
    const [logs, setLogs] = useState(null);
    const [showDebug, setShowDebug] = useState(false);
    const [deletingId, setDeletingId] = useState(null); // Inline delete confirmation

    const scrollRef = useRef(null);

    const pull = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/ai/automations');
            if (!res.ok) throw new Error('API unreachable');
            const data = await res.json();
            setRules(Array.isArray(data?.automations) ? data.automations : []);
        } catch (e) {
            console.error('[AI Widget] Sync Error:', e);
            setRules([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { pull(); }, [pull]);

    // Auto-pull and Live Heartbeat
    useEffect(() => {
        let timer;
        if (rules.length > 0) {
            // Check for new logs/status every 30s
            timer = setInterval(() => {
                pull();
            }, 30000);
        }
        return () => clearInterval(timer);
    }, [rules.length, pull]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [logs]);

    const onCreate = async () => {
        const val = prompt?.trim();
        if (!val) return;
        setCreating(true);
        try {
            const name = val.substring(0, 30) + (val.length > 30 ? '...' : '');
            const res = await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, prompt: val, active: true })
            });
            if (res.ok) {
                showToast?.('✨ Regla activada en el Motor AI', 'success');
                setPrompt('');
                pull();
            }
        } catch (e) {
            showToast?.('Error de comunicación', 'error');
        } finally { setCreating(false); }
    };

    const confirmDelete = async (id) => {
        try {
            setLoading(true);
            const res = await fetch(`/api/ai/automations?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast?.('Regla eliminada del sistema', 'success');
                setDeletingId(null);
                await pull();
            }
        } catch (e) {
            showToast?.('Error al borrar', 'error');
        } finally { setLoading(false); }
    };

    const onToggle = async (rule) => {
        if (!rule?.id) return;
        try {
            const upd = { ...rule, active: !rule.active };
            // Local update for snap response
            setRules(prev => (prev || []).map(r => r.id === rule.id ? upd : r));

            await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(upd)
            });
        } catch (e) { pull(); }
    };

    const onRunNow = async () => {
        setRunning(true);
        setLogs(['[BOOT] Iniciando secuencia de inteligencia...', '[AUTH] Verificando credenciales de UltraMsg/Gemini...']);
        try {
            const res = await fetch('/api/ai/automations/run', { method: 'POST' });
            const data = await res.json();

            if (data?.logs) setLogs(data.logs);

            if (data?.success) {
                if (data.sent > 0) showToast?.(`🚀 Éxito: ${data.sent} mensajes enviados`, 'success');
                else showToast?.('Análisis completo (sin coincidencias)', 'default');
            } else {
                setLogs(prev => [...(prev || []), `❌ ERROR: ${data?.error || 'Unknown'}`, data?.stack ? `\nTRACE:\n${data.stack}` : '']);
                showToast?.('El motor encontró un problema', 'error');
            }
        } catch (e) {
            setLogs(prev => [...(prev || []), `🛑 FATAL: Error de red o tiempo de espera agotado.`]);
            showToast?.('Fallo de conexión', 'error');
        } finally { setRunning(false); }
    };

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* 🧙 Input Station */}
            <div className="bg-white dark:bg-gray-900 p-4 rounded-[24px] border border-blue-100 dark:border-blue-900/30 shadow-xl relative overflow-hidden">
                <div className="flex justify-between items-center mb-3 relative z-10">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center tracking-tight text-sm">
                        <Command className="w-4 h-4 text-blue-500 mr-2" />
                        Candidatic AI Automations
                    </h3>
                    <div className="flex items-center space-x-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">v5.0 Stable</span>
                    </div>
                </div>

                <div className="relative z-10">
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Ej: Si no tiene CV, pídeselo amablemente al 8116038195..."
                        className="w-full h-16 p-3 rounded-xl bg-gray-50/50 dark:bg-black/20 border border-gray-100 dark:border-gray-800 outline-none text-xs transition-all focus:border-blue-300 placeholder:text-gray-300"
                    />
                    <div className="mt-2 flex justify-end">
                        <button
                            onClick={onCreate}
                            disabled={creating || !prompt?.trim()}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-full font-bold text-[10px] shadow-lg shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-30"
                        >
                            {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : 'CONEXIÓN MAGIC'}
                        </button>
                    </div>
                </div>
            </div>

            {/* 📋 Sequence Control */}
            <div className="space-y-3">
                <div className="flex justify-between items-center px-1">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center">
                        <Zap className="w-3 h-3 mr-1.5 text-yellow-500" />
                        Reglas Activas ({rules?.length || 0})
                    </h4>
                    <div className="flex items-center space-x-2 bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-full border border-blue-100 dark:border-blue-900/30 shadow-sm animate-pulse">
                        <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                        <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">Live AI Engine Active</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                    {rules?.length === 0 && !loading && (
                        <div className="py-12 text-center rounded-3xl border-2 border-dashed border-gray-100 dark:border-gray-800 opacity-40">
                            <RefreshCcw className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                            <p className="text-xs font-medium">No hay secuencias IA configuradas.</p>
                        </div>
                    )}

                    {rules?.filter(Boolean).map((r) => (
                        <div key={r?.id} className={`p-3 rounded-2xl border transition-all duration-300 flex items-center justify-between ${r?.active ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm' : 'bg-gray-50 dark:bg-black/10 border-transparent opacity-50'
                            }`}>
                            <div className="truncate flex-1 pr-4">
                                <h4 className="font-bold text-xs text-gray-900 dark:text-white truncate">{r?.name || 'Regla'}</h4>
                                <p className="text-[9px] text-gray-400 truncate italic">"{r?.prompt || '...'}"</p>
                            </div>

                            {deletingId === r?.id ? (
                                <div className="flex items-center space-x-1 animate-in slide-in-from-right-2">
                                    <button onClick={() => confirmDelete(r?.id)} className="px-3 py-1.5 bg-red-500 text-white text-[10px] font-bold rounded-lg hover:bg-red-600">SI, BORRAR</button>
                                    <button onClick={() => setDeletingId(null)} className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold rounded-lg">NO</button>
                                </div>
                            ) : (
                                <div className="flex items-center space-x-1">
                                    <button onClick={() => onToggle(r)} className={`p-2 rounded-xl transition-colors ${r?.active ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                                        {r?.active ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                                    </button>
                                    <button onClick={() => setDeletingId(r?.id)} className="p-2 text-gray-300 hover:text-red-500 transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* 📟 Premium Status & Debug Console */}
            <div className="space-y-3">
                <AIEnginePulse
                    running={running}
                    logs={logs}
                    onShowDebug={() => setShowDebug(!showDebug)}
                />

                {logs && showDebug && (
                    <div className="bg-gray-950 dark:bg-black rounded-3xl overflow-hidden border border-gray-800 shadow-2xl animate-in slide-in-from-top-4">
                        <div className="flex justify-between items-center px-5 py-3 bg-gray-900/50 border-b border-gray-800">
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center">
                                <Terminal className="w-3 h-3 mr-2 text-blue-500" />
                                Debug Trace Console
                            </span>
                            <button onClick={() => setLogs(null)} className="text-[10px] font-bold text-gray-600 hover:text-white">CLOSE [x]</button>
                        </div>
                        <div ref={scrollRef} className="p-6 font-mono text-[9px] text-gray-500 max-h-48 overflow-y-auto leading-relaxed custom-scrollbar bg-black/40">
                            {Array.isArray(logs) && logs.map((l, i) => (
                                <div key={i} className={`mb-1 flex space-x-3 ${String(l).includes('✅') || String(l).includes('🚀') ? 'text-green-900/60' :
                                    String(l).includes('❌') || String(l).includes('🛑') ? 'text-red-500 font-bold' :
                                        String(l).includes('🤔') ? 'text-blue-900/60' : ''
                                    }`}>
                                    <span className="opacity-20 shrink-0">[{i}]</span>
                                    <span className="break-words">{String(l)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AIAutomationsWidget;
