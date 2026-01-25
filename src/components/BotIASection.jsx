import React, { useState, useEffect } from 'react';
import { Bot, Save, Power, Settings as SettingsIcon, MessageSquare, Smartphone } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import { useToast } from '../hooks/useToast';
const BotIASection = ({ showToast }) => {
    // Bot Status & Config
    const [isActive, setIsActive] = useState(false);
    const [loading, setLoading] = useState(false);

    // AI Settings
    const [systemPrompt, setSystemPrompt] = useState('');
    const [aiModel, setAiModel] = useState('gemini-2.5-flash');

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const res = await fetch('/api/bot-ia/settings');
                if (res.ok) {
                    const data = await res.json();
                    setSystemPrompt(data.systemPrompt || '');
                    setIsActive(data.isActive);
                }
            } catch (error) {
                console.error('Error loading settings:', error);
            }
        };
        loadSettings();
    }, []);

    const handleSave = async () => {
        setLoading(true);

        localStorage.setItem('bot_ia_prompt', systemPrompt);
        localStorage.setItem('bot_ia_active', isActive);

        try {
            const resConfig = await fetch('/api/bot-ia/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive })
            });

            const resPrompt = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'ai_prompt',
                    data: systemPrompt
                })
            });

            if (resConfig.ok && resPrompt.ok) {
                showToast('Configuraciones guardadas correctamente', 'success');
            } else {
                showToast('Error guardando configuración', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('Error de conexión', 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggleActive = () => {
        setIsActive(!isActive);
    };

    return (
        <div className="space-y-6">
            {/* Header Status Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center space-x-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isActive ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                        <Bot className={`w-6 h-6 ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Estado del Bot IA</h2>
                        <p className={`text-sm font-medium ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                            {isActive ? 'ACTIVO - Respondiendo mensajes' : 'INACTIVO - Pausado'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={toggleActive}
                        className={`
                            relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                            ${isActive ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}
                        `}
                    >
                        <span
                            className={`
                                inline-block h-6 w-6 transform rounded-full bg-white transition-transform
                                ${isActive ? 'translate-x-7' : 'translate-x-1'}
                            `}
                        />
                    </button>
                    <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">
                        {isActive ? 'Encendido' : 'Apagado'}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {/* AI Configuration */}
                <Card title="Cerebro del Asistente" icon={SettingsIcon}>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Prompt del Sistema
                            </label>
                            <textarea
                                className="w-full h-64 p-4 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-sm resize-none shadow-inner"
                                placeholder="Eres un asistente útil de RRHH..."
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                            />
                            <p className="text-xs text-gray-500 mt-1">Defina la personalidad y reglas del bot.</p>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Modelo de Inteligencia Artificial
                                </label>
                                <select
                                    value={aiModel}
                                    onChange={(e) => setAiModel(e.target.value)}
                                    className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-sm shadow-sm"
                                >
                                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recomendado)</option>
                                    <option value="gemini-1.5-flash">Gemini 1.5 Flash (Rápido)</option>
                                    <option value="gemini-1.5-pro">Gemini 1.5 Pro (Potente)</option>
                                </select>
                                <p className="text-[10px] text-gray-500 mt-1.5 px-1 italic">
                                    * La API Key se gestiona globalmente en la sección de Settings.
                                </p>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            <div className="flex justify-end">
                <Button
                    onClick={handleSave}
                    loading={loading}
                    icon={Save}
                    size="lg"
                >
                    Guardar Configuración
                </Button>
            </div>
        </div>
    );
};

export default BotIASection;
