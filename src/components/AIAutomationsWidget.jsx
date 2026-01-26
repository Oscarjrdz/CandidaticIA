import React, { useState, useEffect } from 'react';
import { Sparkles, Trash2, PauseCircle, PlayCircle, Loader2, AlertCircle } from 'lucide-react';
import Button from './ui/Button';

/**
 * 🧱 Indestructible Error Shield
 */
class ErrorShield extends React.Component {
    constructor(props) { super(props); this.state = { crashed: false }; }
    static getDerivedStateFromError() { return { crashed: true }; }
    render() {
        if (this.state.crashed) {
            return (
                <div className="p-10 bg-gray-900 border border-red-500 rounded-3xl text-center">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h3 className="text-white font-bold">System Halt</h3>
                    <p className="text-gray-400 text-xs mt-2">La interfaz colapsó. Haz clic para reiniciar.</p>
                    <button onClick={() => window.location.reload()} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-full text-xs font-bold">REBOOT SYSTEM</button>
                </div>
            );
        }
        return this.props.children;
    }
}

/**
 * 🖥️ AIAutomationsWidget (Professional Grade)
 */
const AIAutomationsWidgetContent = ({ showToast }) => {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [creating, setCreating] = useState(false);
    const [history, setHistory] = useState(null);

    const pull = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/ai/automations');
            const data = await res.json();
            if (data && Array.isArray(data.automations)) setRules(data.automations);
            else setRules([]);
        } catch (e) { setRules([]); }
        finally { setLoading(false); }
    };

    useEffect(() => { pull(); }, []);

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
                showToast?.('Rule Optimized & Deployed', 'success');
                setPrompt('');
                pull();
            }
        } catch (e) { showToast?.('Upload failed', 'error'); }
        finally { setCreating(false); }
    };

    const onDelete = async (id) => {
        if (!id || !window.confirm('¿Confirmar destrucción de la regla?')) return;
        try {
            const res = await fetch(`/api/ai/automations?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast?.('Rule Erased', 'default');
                pull();
            }
        } catch (e) { showToast?.('Delete failed', 'error'); }
    };

    const onToggle = async (rule) => {
        if (!rule?.id) return;
        try {
            const upd = { ...rule, active: !rule.active };
            await fetch('/api/ai/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(upd)
            });
            pull();
        } catch (e) { pull(); }
    };

    const onRun = async () => {
        if (!window.confirm('¿Iniciar secuencia de inteligencia?')) return;
        setRunning(true);
        setHistory(['[INIT] Cargando motor de intenciones...', '[SEARCH] Buscando coincidencias rápidas...']);
        try {
            const res = await fetch('/api/ai/automations/run', { method: 'POST' });
            const data = await res.json();
            if (data?.success) {
                setHistory(data.logs || ['Done.']);
                showToast?.(data.sent > 0 ? `Rocket: Sent ${data.sent}` : 'Sequence Complete', 'success');
            } else {
                setHistory([`[ERROR] ${data?.error || 'Unknown fatal error'}`]);
                showToast?.('Engine failed', 'error');
            }
        } catch (e) {
            setHistory(['[FATAL] Error de conexión o Timeout.']);
            showToast?.('Network failure', 'error');
        } finally { setRunning(false); }
    };

    return (
        <div className="space-y-8">
            {/* Input Station */}
            <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-xl shadow-blue-500/5 relative overflow-hidden">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-black text-gray-900 flex items-center tracking-tighter text-xl">
                        <Sparkles className="w-6 h-6 text-blue-600 mr-2" />
                        AI AUTOMATIONS
                    </h3>
                    <div className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[8px] font-black uppercase tracking-widest">
                        Zuckerberg Edition v4.0
                    </div>
                </div>

                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Escribe tu comando... Ej: 'Saluda al candidato 8116038195'"
                    className="w-full h-28 p-6 rounded-3xl bg-gray-50/50 border border-gray-100 outline-none text-sm font-medium transition-all focus:ring-4 focus:ring-blue-100 focus:bg-white placeholder:text-gray-300"
                />

                <div className="mt-6 flex justify-end">
                    <button
                        onClick={onCreate}
                        disabled={creating || !prompt?.trim()}
                        className="bg-black hover:bg-gray-800 text-white px-10 py-3.5 rounded-full font-bold text-xs shadow-2xl transition-all disabled:opacity-20"
                    >
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'DEPLOY RULE'}
                    </button>
                </div>
            </div>

            {/* List Terminal */}
            <div className="space-y-4">
                <div className="flex justify-between items-center px-2">
                    <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Active Rules Console ({rules?.length || 0})</span>
                    </div>
                    <button
                        onClick={onRun}
                        disabled={running || !rules?.length}
                        className="bg-green-500 hover:bg-green-600 text-white px-8 py-2.5 rounded-full font-black text-[10px] uppercase tracking-widest shadow-lg shadow-green-500/20 active:scale-95 transition-all"
                    >
                        {running ? 'PROCESADO...' : 'FAST RUN'}
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    {rules && rules.map((r, i) => (
                        <div key={r?.id || i} className={`p-6 rounded-[32px] border transition-all duration-300 flex items-center justify-between ${r?.active ? 'bg-white border-gray-100 shadow-sm' : 'bg-gray-50 border-transparent opacity-40 grayscale'
                            }`}>
                            <div className="truncate flex-1 pr-8">
                                <h4 className="font-bold text-base text-gray-900 truncate mb-0.5">{r?.name || 'Comando Automático'}</h4>
                                <p className="text-[11px] text-gray-400 font-medium truncate opacity-60 italic">"{r?.prompt || '...'}"</p>
                            </div>
                            <div className="flex items-center space-x-1 shrink-0">
                                <button onClick={() => onToggle(r)} className={`p-3.5 rounded-2xl transition-all ${r?.active ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                                    {r?.active ? <PauseCircle className="w-6 h-6" /> : <PlayCircle className="w-6 h-6" />}
                                </button>
                                <button onClick={() => onDelete(r?.id)} className="p-3.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all">
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    ))}
                    {rules?.length === 0 && (
                        <div className="text-center py-16 bg-gray-50/50 border-2 border-dashed border-gray-100 rounded-[40px]">
                            <p className="text-xs text-gray-300 font-bold uppercase tracking-widest italic">Sequence empty.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* AI Monitor Output */}
            {history && (
                <div className="bg-gray-950 rounded-[40px] overflow-hidden shadow-2xl border border-white/5 p-8 animate-in slide-in-from-bottom-5">
                    <div className="flex justify-between items-center mb-6 opacity-30">
                        <span className="text-[10px] font-black text-blue-500 uppercase tracking-[0.3em]">Candidatic AI Intelligence Console</span>
                        <button onClick={() => setHistory(null)} className="text-white hover:text-red-500 font-bold">DISCONNECT</button>
                    </div>
                    <div className="font-mono text-[11px] leading-relaxed space-y-2 max-h-48 overflow-y-auto">
                        {history.map((line, i) => (
                            <div key={i} className={`flex space-x-4 ${line.includes('✅') || line.includes('✨') ? 'text-green-400' :
                                    line.includes('❌') || line.includes('⚠️') ? 'text-red-400' :
                                        'text-gray-500'
                                }`}>
                                <span className="opacity-10 shrink-0 select-none">{String(i).padStart(3, '0')}</span>
                                <span className="break-words font-medium">{line}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// EXPORT WITH SHIELD
const AIAutomationsWidget = (props) => (
    <ErrorShield>
        <AIAutomationsWidgetContent {...props} />
    </ErrorShield>
);

export default AIAutomationsWidget;
