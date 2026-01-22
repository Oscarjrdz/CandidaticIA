import React, { useState, useEffect } from 'react';
import { Brain, Save, Loader2, Key } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';

const AISettings = ({ showToast }) => {
    const [config, setConfig] = useState({ geminiApiKey: '' });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

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
            }
        } catch (error) {
            console.error('Error loading AI config:', error);
        } finally {
            setLoading(false);
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
                showToast('Configuración de AI guardada en Redis', 'success');
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
                <div className="flex items-center space-x-3 mb-6">
                    <div className="bg-purple-100 dark:bg-purple-900/40 p-2 rounded-lg">
                        <Brain className="w-5 h-5 text-purple-600 dark:text-purple-300" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Candidatic Intelligence</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Configuración de Inteligencia Artificial (Gemini)</p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Gemini API Key
                            </label>
                            <div className="relative">
                                <Key className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="password"
                                    placeholder="AIzaSy..."
                                    className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all dark:text-gray-200"
                                    value={config.geminiApiKey}
                                    onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
                                />
                            </div>
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
