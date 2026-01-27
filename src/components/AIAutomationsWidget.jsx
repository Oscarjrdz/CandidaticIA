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

    // Auto-scroll logs
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
                showToast?.('Regla eliminada del sistema', 'default');
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
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* 🧙 Input Station */}
            <div className="bg-white dark:bg-gray-900 p-6 rounded-[32px] border border-blue-100 dark:border-blue-900/30 shadow-2xl relative overflow-hidden">
                <div className="flex justify-between items-center mb-4 relative z-10">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center tracking-tight">
                        <Command className="w-5 h-5 text-blue-500 mr-2" />
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
                        className="w-full h-24 p-5 rounded-2xl bg-gray-50/50 dark:bg-black/20 border border-gray-100 dark:border-gray-800 outline-none text-sm transition-all focus:border-blue-300 placeholder:text-gray-300"
                    />
                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={onCreate}
                            disabled={creating || !prompt?.trim()}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2.5 rounded-full font-bold text-xs shadow-lg shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-30"
                        >
                            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'CONECCIÓN MAGIC'}
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
                    <button
                        onClick={onRunNow}
                        disabled={running || !rules?.length}
                        className="bg-gray-900 dark:bg-black text-white px-5 py-2 rounded-full text-xs font-bold hover:bg-blue-600 transition-all flex items-center space-x-2"
                    >
                        {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                        <span>{running ? 'EJECUTANDO...' : 'PROCESAR AHORA'}</span>
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                    {rules?.length === 0 && !loading && (
                        <div className="py-12 text-center rounded-3xl border-2 border-dashed border-gray-100 dark:border-gray-800 opacity-40">
                            <RefreshCcw className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                            <p className="text-xs font-medium">No hay secuencias IA configuradas.</p>
                        </div>
                    )}

                    {rules?.map((r) => (
                        <div key={r?.id} className={`p-5 rounded-3xl border transition-all duration-300 flex items-center justify-between ${r?.active ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm' : 'bg-gray-50 dark:bg-black/10 border-transparent opacity-50'
                            }`}>
                            <div className="truncate flex-1 pr-6">
                                <h4 className="font-bold text-sm text-gray-900 dark:text-white truncate">{r?.name || 'Regla'}</h4>
                                <p className="text-[10px] text-gray-400 italic truncate italic">"{r?.prompt || '...'}"</p>
                            </div>

                            {deletingId === r.id ? (
                                <div className="flex items-center space-x-1 animate-in slide-in-from-right-2">
                                    <button onClick={() => confirmDelete(r.id)} className="px-3 py-1.5 bg-red-500 text-white text-[10px] font-bold rounded-lg">SI, BORRAR</button>
                                    <button onClick={() => setDeletingId(null)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-lg">NO</button>
                                </div>
                            ) : (
                                <div className="flex items-center space-x-1">
                                    <button onClick={() => onToggle(r)} className={`p-2 rounded-xl ${r?.active ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400'}`}>
                                        {r?.active ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                                    </button>
                                    <button onClick={() => setDeletingId(r.id)} className="p-2 text-gray-300 hover:text-red-500 transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* 📟 Trace Console */}
            {logs && (
                <div className="bg-gray-950 dark:bg-black rounded-3xl overflow-hidden border border-gray-800 shadow-2xl animate-in zoom-in-95">
                    <div className="flex justify-between items-center px-5 py-3 bg-gray-900/50 border-b border-gray-800">
                        <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">AI Trace Monitoring</span>
                        <button onClick={() => setLogs(null)} className="text-[10px] font-bold text-gray-600 hover:text-white">CLOSE [x]</button>
                    </div>
                    <div ref={scrollRef} className="p-6 font-mono text-[10px] text-gray-400 max-h-48 overflow-y-auto leading-relaxed custom-scrollbar">
                        {logs.map((l, i) => (
                            <div key={i} className={`mb-1 flex space-x-3 ${l.includes('✅') || l.includes('🚀') ? 'text-green-500' :
                                l.includes('❌') || l.includes('🛑') || l.includes('🛑') ? 'text-red-500 font-bold' :
                                    l.includes('🤔') ? 'text-blue-400' : ''
                                }`}>
                                <span className="opacity-20 shrink-0">[{i}]</span>
                                <span className="break-words">{l}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AIAutomationsWidget;
