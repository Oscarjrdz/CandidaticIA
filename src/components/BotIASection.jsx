import React, { useState, useEffect } from 'react';
import { Bot, Save, Power, Settings as SettingsIcon, MessageSquare, Smartphone, Clock, Shield, Sparkles, Trash2, Send, RefreshCw, CheckCircle } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Skeleton from './ui/Skeleton';
import { useToast } from '../hooks/useToast';

const BotIASection = ({ showToast }) => {
    // Bot Status & Config
    const [isActive, setIsActive] = useState(false);
    const [loading, setLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true); // NEW: Prevent ghosting

    // AI Settings
    const [systemPrompt, setSystemPrompt] = useState('');
    const [aiModel, setAiModel] = useState('gpt-4o-mini');
    const [gptConfig, setGptConfig] = useState({
        openaiApiKey: '',
        openaiModel: 'gpt-4o-mini',
        gptHostEnabled: false,
        gptHostPrompt: ''
    });

    // Advanced Internal Protocols
    const [extractionRules, setExtractionRules] = useState('');
    const [cerebro1Rules, setCerebro1Rules] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const res = await fetch('/api/bot-ia/settings');
                if (res.ok) {
                    const data = await res.json();
                    setSystemPrompt(data.systemPrompt || '');
                    setIsActive(data.isActive);
                    setExtractionRules(data.extractionRules || '');
                    setCerebro1Rules(data.cerebro1Rules || '');
                    setAiModel(data.aiModel || 'gpt-4o-mini');
                }
            } catch (error) {
                console.error('Error loading settings:', error);
            }
        };


        const loadGptConfig = async () => {
            try {
                const res = await fetch('/api/settings?type=ai_config');
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.data) {
                        setGptConfig({
                            openaiApiKey: data.data.openaiApiKey || '',
                            openaiModel: data.data.openaiModel || 'gpt-4o-mini',
                            gptHostEnabled: data.data.gptHostEnabled === true,
                            gptHostPrompt: data.data.gptHostPrompt || ''
                        });
                    }
                }
            } catch (error) {
                console.error('Error loading GPT config:', error);
            }
        };

        const init = async () => {
            setIsInitialLoading(true);
            await Promise.all([loadSettings(), loadGptConfig()]);
            setIsInitialLoading(false);
        };
        init();
    }, []);

    const handleSave = async () => {
        setLoading(true);
        try {
            // 1. Bot Behavior & Rules (Consolidated)
            const resConfig = await fetch('/api/bot-ia/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemPrompt,
                    extractionRules,
                    cerebro1Rules,
                    aiModel,
                    isActive // Added missing field
                })
            });

            // 2. GPT Config (Host Mode)
            const resGpt = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'ai_config',
                    data: gptConfig
                })
            });

            if (resConfig.ok && resGpt.ok) {
                showToast('Configuraciones guardadas correctamente', 'success');
            } else {
                // Determine which one failed for better debugging (silent for user if preferred but here we fix the logic)
                showToast('Error guardando configuración', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('Error de conexión', 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggleActive = async () => {
        const newValue = !isActive;
        setIsActive(newValue);
        try {
            await fetch('/api/bot-ia/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: newValue })
            });
        } catch (error) {
            console.error('Error toggling Master Bot:', error);
            showToast('Error al cambiar estado del Bot', 'error');
            setIsActive(!newValue); // Rollback
        }
    };

    // ⚡ Auto-Save for GPT Host Toggle
    const toggleGptHost = async () => {
        const newValue = !gptConfig.gptHostEnabled;
        // 1. Optimistic Update
        setGptConfig(prev => ({ ...prev, gptHostEnabled: newValue }));

        // 2. Persist to Server
        try {
            await fetch('/api/bot-ia/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gptHostEnabled: newValue
                })
            });
            showToast(newValue ? 'Sala de Espera Activada' : 'Sala de Espera Desactivada', 'success');
        } catch (error) {
            console.error('Error saving GPT Host toggle:', error);
            showToast('Error al guardar cambio', 'error');
            // Rollback
            setGptConfig(prev => ({ ...prev, gptHostEnabled: !newValue }));
        }
    };

    return (
        <div className="space-y-4 w-full pb-8 animate-in fade-in duration-700">
            {/* Master Bot Controller: Compact Native */}
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 flex flex-col md:flex-row items-center justify-between gap-4 min-h-[82px]">
                <div className="flex items-center space-x-4">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${isActive ? 'bg-green-500 shadow-lg shadow-green-500/20' : 'bg-gray-100 dark:bg-gray-700'}`}>
                        <Bot className={`w-5 h-5 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight uppercase tracking-tight">BOT IA</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                            <p className={`text-[10px] font-black tracking-widest uppercase ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                                {isActive ? 'MOTOR ACTIVO' : 'STANDBY'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-1.5 rounded-xl shadow-sm">
                    <div className="flex flex-col">
                        <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 leading-none">Candidatic</span>
                        <span className={`text-[10px] font-bold ${isActive ? 'text-green-600' : 'text-gray-400'}`}>
                            {isActive ? 'ACTIVADO' : 'DESACTIVADO'}
                        </span>
                    </div>
                    <button
                        onClick={toggleActive}
                        className={`
                            relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
                            ${isActive ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}
                        `}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 1. Prompt Extracción */}
                <Card
                    title={<span className="text-gray-900 dark:text-white font-bold text-sm">Prompt Extracción</span>}
                    icon={Bot}
                    className="shadow-sm border-gray-100 dark:border-gray-700 rounded-3xl"
                    headerClassName="h-16"
                >
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest px-1">
                                    PROMPT BRENDA EXTRACCIÓN 📑✨
                                </label>
                                <span className="text-[8px] font-bold text-gray-400 uppercase">OpenAI Powered</span>
                            </div>
                            {isInitialLoading ? (
                                <Skeleton className="w-full h-80 rounded-2xl" />
                            ) : (
                                <textarea
                                    className="w-full h-80 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/40 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 text-xs resize-none leading-relaxed font-medium transition-all"
                                    value={systemPrompt}
                                    onChange={(e) => setSystemPrompt(e.target.value)}
                                    placeholder="Escribe aquí las directivas maestras..."
                                />
                            )}
                        </div>

                        <div className="pt-1">
                            <select
                                value={aiModel}
                                onChange={(e) => setAiModel(e.target.value)}
                                className="w-full p-2.5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-bold shadow-sm"
                            >
                                <option value="gpt-4o-mini">🚀 GPT-4o Mini (Recomendado)</option>
                                <option value="gpt-4o">⚡ GPT-4o (Premium)</option>
                                <option value="gpt-4-turbo">🧠 GPT-4 Turbo</option>
                            </select>
                        </div>
                    </div>
                </Card>

                {/* 3. Prompt de Sala de Espera (GPT Host) */}
                <Card
                    title={<span className="text-gray-900 dark:text-white font-bold text-sm">Prompt de Sala de Espera</span>}
                    icon={Bot}
                    className="shadow-sm border-gray-100 dark:border-gray-700 rounded-3xl"
                    headerClassName="h-16"
                    actions={
                        <button
                            type="button"
                            onClick={toggleGptHost} // ⚡ Auto-Save Bound
                            className={`
                                relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none
                                ${gptConfig.gptHostEnabled ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}
                            `}
                        >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${gptConfig.gptHostEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                    }
                >
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest px-1">
                                    PROMPT SALA DE ESPERA ✨
                                </label>
                                <span className="text-[8px] font-bold text-gray-400 uppercase">OpenAI Powered</span>
                            </div>
                            {isInitialLoading ? (
                                <Skeleton className="w-full h-80 rounded-2xl" />
                            ) : (
                                <textarea
                                    className="w-full h-80 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/40 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 text-xs resize-none leading-relaxed font-medium transition-all"
                                    value={gptConfig.gptHostPrompt}
                                    onChange={(e) => setGptConfig({ ...gptConfig, gptHostPrompt: e.target.value })}
                                    placeholder="Define la actitud social del Host..."
                                />
                            )}
                        </div>

                        {/* GPT Model Selector */}
                        <div className="pt-1">
                            <select
                                value={gptConfig.openaiModel}
                                onChange={(e) => setGptConfig({ ...gptConfig, openaiModel: e.target.value })}
                                className="w-full p-2.5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-bold shadow-sm"
                            >
                                <option value="gpt-4o-mini">🚀 GPT-4o Mini (Recomendado)</option>
                                <option value="gpt-4o">⚡ GPT-4o (Premium)</option>
                                <option value="gpt-4-turbo">🧠 GPT-4 Turbo</option>
                            </select>
                        </div>
                    </div>
                </Card>
            </div>


            {/* Final Action: Integrated Bottom */}
            <div className="flex justify-end pt-2">
                <Button
                    onClick={handleSave}
                    loading={loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white h-12 px-10 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 transition-all hover:scale-[1.02]"
                >
                    <Save className="w-4 h-4 mr-2" />
                    <span>Guardar Cambios</span>
                </Button>
            </div>
        </div>
    );
};

export default BotIASection;
