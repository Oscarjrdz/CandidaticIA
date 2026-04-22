import React, { useState, useEffect } from 'react';
import { Sparkles, Save, Loader2, Key, CheckCircle, XCircle } from 'lucide-react';
import Card from './ui/Card';

const GPTSettings = ({ showToast }) => {
    const [config, setConfig] = useState({ openaiApiKey: '', openaiModel: 'gpt-4o-mini' });
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState('idle');

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/settings?type=ai_config');
                const data = await res.json();
                if (data.success && data.data) {
                    setConfig(data.data);
                    if (data.data.openaiApiKey) validateKey(data.data.openaiApiKey);
                }
            } catch (e) {}
        })();
    }, []);

    const validateKey = async (key) => {
        if (!key) return;
        setStatus('loading');
        try {
            const res = await fetch('/api/ai/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: key })
            });
            const data = await res.json();
            setStatus(data.success ? 'valid' : 'invalid');
        } catch {
            setStatus('invalid');
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'ai_config', data: config })
            });
            const data = await res.json();
            if (data.success) {
                showToast('GPT guardado', 'success');
                validateKey(config.openaiApiKey);
            } else {
                showToast(data.error || 'Error', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    const statusBadge = status === 'valid' ? (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-full border border-emerald-100 dark:border-emerald-800">
            <CheckCircle className="w-3 h-3" />
            <span className="text-[9px] font-bold uppercase tracking-wider">Online</span>
        </div>
    ) : status === 'invalid' ? (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-full border border-red-100 dark:border-red-800">
            <XCircle className="w-3 h-3" />
            <span className="text-[9px] font-bold uppercase tracking-wider">Error</span>
        </div>
    ) : status === 'loading' ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
    ) : null;

    return (
        <Card title="GPT" icon={Sparkles} actions={statusBadge}>
            <div className="space-y-2.5 pb-1">
                <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-0.5">API Key</label>
                    <div className="relative">
                        <Key className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                        <input
                            type="password"
                            placeholder="sk-...."
                            className="w-full pl-8 pr-3 py-1.5 bg-[#f0f2f5] dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded text-xs outline-none focus:border-[#10a37f] dark:text-gray-100 transition-colors"
                            value={config.openaiApiKey || ''}
                            onChange={(e) => setConfig({ ...config, openaiApiKey: e.target.value })}
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-0.5">Modelo</label>
                    <select
                        className="w-full px-2.5 py-1.5 bg-[#f0f2f5] dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded text-xs outline-none cursor-pointer focus:border-[#10a37f] dark:text-gray-100 transition-colors"
                        value={config.openaiModel || 'gpt-4o-mini'}
                        onChange={(e) => setConfig({ ...config, openaiModel: e.target.value })}
                    >
                        <option value="gpt-4o-mini">GPT-4o Mini (Veloz)</option>
                        <option value="gpt-4o">GPT-4o (Inteligente)</option>
                        <option value="o1-mini">o1 Mini (Lógico)</option>
                    </select>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full py-1.5 bg-[#10a37f] hover:bg-[#0c9674] disabled:opacity-50 text-white rounded text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>Guardar</span>
                </button>
            </div>
        </Card>
    );
};

export default GPTSettings;
