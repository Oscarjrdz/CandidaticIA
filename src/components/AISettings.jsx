import React, { useState, useEffect } from 'react';
import { Brain, Save, Loader2, Key, CheckCircle, XCircle, RefreshCw, Sparkles } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';

const AISettings = ({ showToast }) => {
    const [config, setConfig] = useState({ geminiApiKey: '' });
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
                if (data.data.geminiApiKey) {
                    validateKey(data.data.geminiApiKey);
                }
            }
        } catch (error) {
            console.error('Error loading AI config:', error);
        } finally {
            setLoading(false);
        }
    };

    const validateKey = async (keyToValidate = config.geminiApiKey) => {
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
                showToast('Configuración de AI guardada', 'success');
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
                        <div className="bg-purple-100 dark:bg-purple-900/40 p-2 rounded-lg">
                            <Brain className="w-5 h-5 text-purple-600 dark:text-purple-300" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Candidatic Intelligence</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Configuración de Inteligencia Artificial (Gemini)</p>
                        </div>
                    </div>

                    {/* Status Badge */}
                    <div className="flex items-center">
                        {status === 'valid' && (
                            <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-full border border-green-100 dark:border-green-800 animate-in zoom-in-95">
                                <CheckCircle className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Conectado</span>
                            </div>
                        )}
                        {status === 'invalid' && (
                            <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-full border border-red-100 dark:border-red-800 animate-in zoom-in-95">
                                <XCircle className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Llave Inválida</span>
                            </div>
                        )}
                        {status === 'loading' && (
                            <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-gray-50 dark:bg-gray-800 text-gray-400 rounded-full border border-gray-200 dark:border-gray-700">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Verificando...</span>
                            </div>
                        )}
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Gemini API Key
                                </label>
                                <button
                                    onClick={() => validateKey()}
                                    disabled={validating || !config.geminiApiKey}
                                    className="text-[10px] text-purple-600 hover:text-purple-700 font-bold flex items-center space-x-1 disabled:opacity-50"
                                >
                                    <RefreshCw className={`w-3 h-3 ${validating ? 'animate-spin' : ''}`} />
                                    <span>Verificar Ahora</span>
                                </button>
                            </div>
                            <div className="relative">
                                <Key className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="password"
                                    placeholder="AIzaSy..."
                                    className={`w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-800 border rounded-lg focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all dark:text-gray-200 ${status === 'valid' ? 'border-green-200 dark:border-green-800' :
                                        status === 'invalid' ? 'border-red-200 dark:border-red-800' :
                                            'border-gray-200 dark:border-gray-700'
                                        }`}
                                    value={config.geminiApiKey}
                                    onChange={(e) => {
                                        setConfig({ ...config, geminiApiKey: e.target.value });
                                        if (status !== 'idle') setStatus('idle');
                                    }}
                                />
                            </div>

                            {status === 'invalid' && errorMessage && (
                                <p className="mt-1.5 text-[10px] text-red-500 font-medium bg-red-50 dark:bg-red-900/10 p-1.5 rounded border border-red-100 dark:border-red-900/20">
                                    Error: {errorMessage}
                                </p>
                            )}

                            <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-500 italic">
                                Esta llave se utiliza para procesar búsquedas en lenguaje natural. Se guarda de forma segura en tu base de datos Redis.
                            </p>
                        </div>

                        <div className="pt-2">
                            <Button
                                onClick={handleSave}
                                loading={saving}
                                className="w-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center space-x-2 shadow-sm shadow-purple-200 dark:shadow-none transition-all"
                            >
                                <Save className="w-4 h-4" />
                                <span>Guardar Configuración IA</span>
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
};

export default AISettings;
