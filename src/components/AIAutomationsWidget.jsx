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
    const [deletingId, setDeletingId] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [optimizing, setOptimizing] = useState(false);

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
            });
        } catch (e) {
            pull();
        }
    };

    const onOptimize = async () => {
        if (!prompt || prompt.length < 5) {
            showToast?.('Escribe algo primero para optimizarlo', 'default');
            return;
        }
        setOptimizing(true);
        try {
            const res = await fetch('/api/ai/optimize-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawPrompt: prompt })
            });
            const data = await res.json();
            if (data.success && data.optimizedPrompt) {
                setPrompt(data.optimizedPrompt);
                showToast?.('✨ Prompt optimizado por IA', 'success');
            } else {
                showToast?.('No pudimos optimizar el prompt', 'error');
            }
        } catch (e) {
            showToast?.('Error al conectar con el optimizador', 'error');
        } finally {
            setOptimizing(false);
        }
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

    if (loading && rules.length === 0) return null;

    return (
        <div className="space-y-6">
            {/* Header Homologado */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-400 to-purple-500 flex items-center justify-center mr-3 shadow-lg shadow-purple-500/20">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        Candidatic AI Automations
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Crea reglas inteligentes que actúan sobre tus candidatos automáticamente.
                    </p>
                </div>
                <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2 bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-full border border-blue-100 dark:border-blue-900/30">
                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                        <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">Live AI Active</span>
                    </div>
                    <Button
                        onClick={() => setShowCreateModal(true)}
                        className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700"
                    >
                        <Zap className="w-4 h-4 text-yellow-300" />
                        <span>Crear Seguimiento IA</span>
                    </Button>
                </div>
            </div>

            {/* Listado Principal Homologado */}
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="grid grid-cols-1 divide-y divide-gray-50 dark:divide-gray-700">
                    {rules?.length === 0 && (
                        <div className="py-20 text-center opacity-40">
                            <Brain className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                            <p className="text-sm font-bold uppercase tracking-widest">No hay secuencias IA configuradas.</p>
                        </div>
                    )}

                    {rules?.map((r) => (
                        <div key={r?.id} className={`p-6 transition-all duration-300 flex items-center justify-between group ${r?.active ? 'hover:bg-gray-50 dark:hover:bg-gray-900/40' : 'opacity-50 grayscale'}`}>
                            <div className="flex items-center space-x-4 flex-1 min-w-0">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-sm transition-all ${r?.active ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-100 dark:border-purple-800' : 'bg-gray-100 dark:bg-gray-700 border-gray-200'}`}>
                                    <Sparkles className={`w-5 h-5 ${r?.active ? 'text-purple-500' : 'text-gray-400'}`} />
                                </div>
                                <div className="truncate pr-8">
                                    <h4 className="font-black text-sm text-gray-900 dark:text-white uppercase tracking-tighter flex items-center">
                                        {r?.name || 'Regla'}
                                        {r?.active && <span className="ml-2 w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]"></span>}
                                    </h4>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 italic font-medium">"{r?.prompt}"</p>
                                </div>
                            </div>

                            <div className="flex items-center space-x-2">
                                {deletingId === r?.id ? (
                                    <div className="flex items-center space-x-1 animate-in slide-in-from-right-2">
                                        <button onClick={() => confirmDelete(r?.id)} className="px-4 py-1.5 bg-red-500 text-white text-[10px] font-bold rounded-xl hover:bg-red-600 shadow-lg shadow-red-500/20 uppercase tracking-tighter">Sí, Borrar</button>
                                        <button onClick={() => setDeletingId(null)} className="px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold rounded-xl uppercase tracking-tighter">No</button>
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => onToggle(r)}
                                            className={`p-2.5 rounded-2xl transition-all ${r?.active ? 'text-purple-500 bg-purple-50 dark:bg-purple-900/30 hover:scale-105' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                            title={r?.active ? 'Pausar Regla' : 'Activar Regla'}
                                        >
                                            {r?.active ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                                        </button>
                                        <button
                                            onClick={() => setDeletingId(r?.id)}
                                            className="p-2.5 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-2xl transition-all"
                                            title="Eliminar"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Modal de Creación IA Homologado */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-[40px] shadow-2xl border border-gray-200 dark:border-gray-800 p-8 space-y-6 animate-in zoom-in-95 duration-300">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center space-x-3">
                                <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                                    <Sparkles className="w-6 h-6 text-purple-500" />
                                </div>
                                <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">Nueva Regla IA</h3>
                            </div>
                            <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="relative group">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-2 block">Instrucción Maestra</label>
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="Ej: Si no tiene escolaridad, pregúntale amablemnte su último grado de estudios..."
                                    className="w-full h-32 p-4 pt-4 pr-12 rounded-3xl bg-gray-50 dark:bg-black/20 border border-gray-100 dark:border-gray-800 outline-none text-sm transition-all focus:border-purple-300 focus:ring-2 focus:ring-purple-200 dark:focus:ring-purple-900/20"
                                    autoFocus
                                />
                                <button
                                    onClick={onOptimize}
                                    disabled={optimizing || !prompt?.trim()}
                                    className="absolute top-10 right-3 p-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-purple-100 dark:border-purple-900/30 text-purple-500 hover:scale-110 active:scale-95 transition-all disabled:opacity-30 group-hover:rotate-6"
                                    title="Optimizar con IA"
                                >
                                    {optimizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                </button>
                            </div>
                            <div className="bg-purple-50 dark:bg-purple-900/10 p-4 rounded-2xl border border-purple-100 dark:border-purple-800/30">
                                <div className="flex items-start space-x-3">
                                    <AlertCircle className="w-4 h-4 text-purple-500 mt-1 shrink-0" />
                                    <p className="text-[10px] text-purple-700 dark:text-purple-300 font-medium leading-relaxed">
                                        Consejo: Sé específico con los números de teléfono o condiciones de tiempo. La IA analizará el contexto completo de la conversación antes de actuar.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex space-x-3 gap-1">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="flex-1 px-6 py-4 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 text-gray-600 dark:text-gray-300 font-black uppercase text-xs rounded-2xl transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={onCreate}
                                disabled={creating || !prompt?.trim()}
                                className="flex-1 px-6 py-4 bg-purple-600 hover:bg-purple-700 text-white font-black uppercase text-xs rounded-2xl shadow-xl shadow-purple-500/20 transform active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center space-x-2"
                            >
                                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4" /> <span>Activar Magia</span></>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Debug Console - Homologado al estilo terminal */}
            <div className="pt-6 border-t border-gray-50 dark:border-gray-800">
                <AIEnginePulse
                    running={running}
                    logs={logs}
                    onShowDebug={() => setShowDebug(!showDebug)}
                />

                {logs && showDebug && (
                    <div className="mt-4 bg-gray-950 dark:bg-black rounded-[32px] overflow-hidden border border-gray-800 shadow-2xl animate-in slide-in-from-top-4">
                        <div className="flex justify-between items-center px-6 py-4 bg-gray-900/50 border-b border-gray-800">
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center">
                                <Terminal className="w-4 h-4 mr-2 text-purple-500" />
                                Real-Time Engine Trace
                            </span>
                            <button onClick={() => setLogs(null)} className="text-[10px] font-bold text-gray-600 hover:text-white uppercase">Close Stream</button>
                        </div>
                        <div ref={scrollRef} className="p-8 font-mono text-[10px] text-gray-500 max-h-64 overflow-y-auto leading-relaxed custom-scrollbar bg-black/40">
                            {Array.isArray(logs) && logs.map((l, i) => (
                                <div key={i} className={`mb-1.5 flex space-x-4 ${String(l).includes('✅') || String(l).includes('🚀') ? 'text-green-500/70' :
                                    String(l).includes('❌') || String(l).includes('🛑') ? 'text-red-500 font-bold' :
                                        String(l).includes('🤔') ? 'text-purple-500/70' : ''
                                    }`}>
                                    <span className="opacity-20 shrink-0 font-bold">[{i.toString().padStart(2, '0')}]</span>
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
