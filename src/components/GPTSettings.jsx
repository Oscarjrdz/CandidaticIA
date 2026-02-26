import React, { useState, useEffect } from 'react';
import { Sparkles, Save, Loader2, Key, CheckCircle, XCircle, RefreshCw, Zap, Bot } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';

const GPTSettings = ({ showToast }) => {
    const [config, setConfig] = useState({ openaiApiKey: '', openaiModel: 'gpt-4o-mini' });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [validating, setValidating] = useState(false);
    const [status, setStatus] = useState('idle'); // idle | loading | valid | invalid
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/settings?type=ai_config');
            const data = await response.json();
            if (data.success && data.data) {
                setConfig(data.data);
                if (data.data.openaiApiKey) {
                    validateKey(data.data.openaiApiKey);
                }
            }
        } catch (error) {
            console.error('Error loading AI config:', error);
        } finally {
            setLoading(false);
        }
    };

    const validateKey = async (keyToValidate = config.openaiApiKey) => {
        if (!keyToValidate) return;
        setValidating(true);
        setStatus('loading');
        try {
            const response = await fetch('/api/ai/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: keyToValidate })
            });
            const data = await response.json();
            if (data.success) {
                setStatus('valid');
                setErrorMessage('');
            } else {
                setStatus('invalid');
                setErrorMessage(data.error || 'Llave inválida');
            }
        } catch (error) {
            setStatus('invalid');
            setErrorMessage('Error de conexión');
        } finally {
            setValidating(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'ai_config',
                    data: config
                })
            });
            const data = await response.json();
            if (data.success) {
                showToast('Configuración de GPT guardada', 'success');
                validateKey();
            } else {
                showToast(data.error || 'Error al guardar', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-3">
                        <div className="bg-[#10a37f]/10 dark:bg-[#10a37f]/20 p-2.5 rounded-xl border border-[#10a37f]/20">
                            <Sparkles className="w-5 h-5 text-[#10a37f]" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                GPT Credenciales
                                <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-extrabold">OpenAI Official</span>
                            </h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Configuración Central de Inteligencia</p>
                        </div>
                    </div>

                    {/* Status Badge */}
                    <div className="flex items-center">
                        {status === 'valid' && (
                            <div className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-full border border-emerald-100 dark:border-emerald-800 shadow-sm animate-in zoom-in-95">
                                <CheckCircle className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Online</span>
                            </div>
                        )}
                        {status === 'invalid' && (
                            <div className="flex items-center space-x-1.5 px-3 py-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-full border border-red-100 dark:border-red-800 shadow-sm animate-in zoom-in-95">
                                <XCircle className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Error de Llave</span>
                            </div>
                        )}
                        {status === 'loading' && (
                            <div className="flex items-center space-x-1.5 px-3 py-1 bg-gray-50 dark:bg-gray-800 text-gray-400 rounded-full border border-gray-200 dark:border-gray-700">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Checando...</span>
                            </div>
                        )}
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-[#10a37f]" />
                    </div>
                ) : (
                    <div className="space-y-5">
                        {/* OpenAI Section (Central Brain Technical Settings) */}
                        <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700/50">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center space-x-2">
                                    <Zap className="w-4 h-4 text-[#10a37f]" />
                                    <label className="block text-[11px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                        OpenAI Global Parameters
                                    </label>
                                </div>
                                <Bot className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Secret API Key</label>
                                    <div className="relative group">
                                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-[#10a37f] transition-colors" />
                                        <input
                                            type="password"
                                            placeholder="sk-...."
                                            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#10a37f]/20 focus:border-[#10a37f] dark:text-gray-100 transition-all shadow-sm"
                                            value={config.openaiApiKey || ''}
                                            onChange={(e) => setConfig({ ...config, openaiApiKey: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Motor GPT</label>
                                    <select
                                        className="w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none cursor-pointer focus:ring-2 focus:ring-[#10a37f]/20 focus:border-[#10a37f] dark:text-gray-100 transition-all shadow-sm"
                                        value={config.openaiModel || 'gpt-4o-mini'}
                                        onChange={(e) => setConfig({ ...config, openaiModel: e.target.value })}
                                    >
                                        <option value="gpt-4o-mini">GPT-4o Mini (Veloz)</option>
                                        <option value="gpt-4o">GPT-4o (Inteligente)</option>
                                        <option value="o1-mini">o1 Mini (Lógico)</option>
                                    </select>
                                </div>
                            </div>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 italic bg-white dark:bg-gray-900/50 p-2 rounded border border-gray-100 dark:border-gray-800">
                                💡 Estas credenciales alimentan el motor principal del asistente Brenda y el módulo "The Host".
                            </p>
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="w-full h-11 bg-gradient-to-r from-[#10a37f] to-[#0a8264] hover:from-[#13b18a] hover:to-[#0c9674] disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all"
                            >
                                {saving ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Save className="w-4 h-4" />
                                )}
                                <span>Guardar Cambios de Inteligencia</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
};

export default GPTSettings;
