import React, { useState, useEffect } from 'react';
import { Bot, Save, Power, Settings as SettingsIcon, MessageSquare, Smartphone, Clock, Shield, Sparkles, Trash2, Send, RefreshCw, CheckCircle } from 'lucide-react';
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
    const [proactivePrompt, setProactivePrompt] = useState('');
    const [proactiveEnabled, setProactiveEnabled] = useState(false);
    const [aiModel, setAiModel] = useState('gemini-2.0-flash');
    const [stats, setStats] = useState({ today: 0, totalSent: 0, totalRecovered: 0 });
    const [operativeConfig, setOperativeConfig] = useState({ startHour: 7, endHour: 23, dailyLimit: 300 });
    const [inactiveStages, setInactiveStages] = useState([]);
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
                    setProactivePrompt(data.proactivePrompt || '');
                    setIsActive(data.isActive);
                    setProactiveEnabled(data.proactiveEnabled);
                    setExtractionRules(data.extractionRules || '');
                    setCerebro1Rules(data.cerebro1Rules || '');
                    if (data.stats) setStats(data.stats);
                    if (data.operativeConfig) setOperativeConfig(data.operativeConfig);
                    if (data.inactiveStages) setInactiveStages(data.inactiveStages);
                }
            } catch (error) {
                console.error('Error loading settings:', error);
            }
        };

        const loadStats = async () => {
            try {
                const res = await fetch('/api/bot-ia/settings');
                if (res.ok) {
                    const data = await res.json();
                    if (data.stats) setStats(data.stats);
                    // Polling now ONLY updates statistics to prevent overwriting user edits in progress.
                }
            } catch (error) {
                console.error('Error polling stats:', error);
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

        loadSettings();
        loadGptConfig();

        // SSE for Live Stats & Flight Plan
        const eventSource = new EventSource('/api/bot-ia/stats-stream');
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data) setStats(data);
            } catch (err) {
                console.error('SSE Parse Error:', err);
            }
        };

        return () => {
            eventSource.close();
        };
    }, []);

    const handleSave = async () => {
        setLoading(true);
        try {
            // 1. Bot Behavior & Rules (Consolidated)
            const resConfig = await fetch('/api/bot-ia/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemPrompt, // Added systemPrompt here
                    proactivePrompt,
                    operativeConfig,
                    inactiveStages,
                    extractionRules,
                    cerebro1Rules
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

    const toggleProactive = async () => {
        const newValue = !proactiveEnabled;
        setProactiveEnabled(newValue);
        try {
            await fetch('/api/bot-ia/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proactiveEnabled: newValue })
            });
        } catch (error) {
            console.error('Error toggling Proactive:', error);
            showToast('Error al cambiar seguimiento', 'error');
            setProactiveEnabled(!newValue); // Rollback
        }
    };

    const addStage = () => {
        const newStages = [...inactiveStages, { hours: 24, message: '¡Hola! Sigues interesado?' }];
        setInactiveStages(newStages);
    };

    const removeStage = (index) => {
        const newStages = inactiveStages.filter((_, i) => i !== index);
        setInactiveStages(newStages);
    };

    const updateStage = (index, field, value) => {
        const newStages = [...inactiveStages];
        newStages[index] = { ...newStages[index], [field]: value };
        setInactiveStages(newStages);
    };

    return (
        <div className="space-y-4 w-full pb-8 animate-in fade-in duration-700">
            {/* Master Bot Controller: Compact Native */}
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center space-x-4">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${isActive ? 'bg-green-500 shadow-lg shadow-green-500/20' : 'bg-gray-100 dark:bg-gray-700'}`}>
                        <Bot className={`w-5 h-5 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">BOT IA</h2>
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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* 1. Prompt Extracción (Gemini) */}
                <Card
                    title={<span className="text-gray-900 dark:text-white font-bold text-sm">Prompt Extracción</span>}
                    icon={Sparkles}
                    className="shadow-sm border-gray-100 dark:border-gray-700 rounded-3xl"
                    headerClassName="h-16"
                >
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest px-1">
                                    PROMPT BRENDA EXTRACCIÓN 📑✨
                                </label>
                                <span className="text-[8px] font-bold text-gray-400 uppercase">Gemini Powered</span>
                            </div>
                            <textarea
                                className="w-full h-80 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/40 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 text-xs resize-none leading-relaxed font-medium transition-all"
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                                placeholder="Escribe aquí las directivas maestras..."
                            />
                        </div>

                        <div className="pt-1">
                            <select
                                value={aiModel}
                                onChange={(e) => setAiModel(e.target.value)}
                                className="w-full p-2.5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-bold shadow-sm"
                            >
                                <option value="gemini-2.0-flash">🚀 Gemini 2.0 Flash</option>
                                <option value="gemini-1.5-flash">⚡ Gemini 1.5 Flash</option>
                                <option value="gemini-1.5-pro">🧠 Gemini 1.5 Pro</option>
                            </select>
                        </div>
                    </div>
                </Card>

                {/* 2. Prompt de Seguimiento (Gemini) */}
                <Card
                    title={<span className="text-gray-900 dark:text-white font-bold text-sm">Prompt de Seguimiento</span>}
                    icon={Sparkles}
                    className="shadow-sm border-gray-100 dark:border-gray-700 rounded-3xl"
                    headerClassName="h-16"
                    actions={
                        <button
                            type="button"
                            onClick={toggleProactive}
                            className={`
                                relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none
                                ${proactiveEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
                            `}
                        >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${proactiveEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                    }
                >
                    <div className="space-y-3">
                        {/* 1. Hook */}
                        <div className="bg-gray-50/50 dark:bg-gray-900/20 p-2.5 rounded-2xl border border-gray-100/50 dark:border-gray-800/30">
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest block">
                                    PROMPT DE SEGUIMIENTO 🎯
                                </label>
                                <span className="text-[8px] font-bold text-gray-400 uppercase">Gemini Powered</span>
                            </div>
                            <textarea
                                className="w-full h-20 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 text-[10px] resize-none font-medium transition-all"
                                value={proactivePrompt}
                                onChange={(e) => setProactivePrompt(e.target.value)}
                                placeholder="Mensaje inicial..."
                            />
                        </div>

                        {/* 2. Flight Plan (Compact) */}
                        <div className="bg-indigo-50/30 dark:bg-indigo-900/10 border border-indigo-100/30 dark:border-indigo-900/20 p-2.5 rounded-2xl">
                            <div className="flex items-center justify-between mb-1.5">
                                <div className="text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                                    <Send className="w-3 h-3" />
                                    <p className="text-[9px] font-black uppercase tracking-widest">Plan de Vuelo ✈️</p>
                                </div>
                                <span className="text-[8px] font-black text-indigo-500 bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded-full border border-indigo-100/50">
                                    Total: {stats.flightPlan?.summary?.totalItems || 0}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                {stats.flightPlan && Object.keys(stats.flightPlan).filter(k => k !== 'summary').slice(0, 4).map((h, i) => {
                                    const p = stats.flightPlan[h];
                                    return (
                                        <div key={i} className="flex flex-col gap-0.5">
                                            <div className="flex justify-between text-[8px] font-bold">
                                                <span className="text-gray-500 opacity-70 uppercase">{h}h</span>
                                                <span className="text-indigo-600">{p.percentage}%</span>
                                            </div>
                                            <div className="w-full h-1 bg-white dark:bg-gray-800 rounded-full overflow-hidden">
                                                <div className="h-full bg-indigo-500/80 rounded-full" style={{ width: `${p.percentage}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 3. Reactivation Protocols */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between px-1">
                                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Protocolos 📑</label>
                                <button onClick={addStage} className="text-blue-600 hover:text-blue-700 text-[8px] font-black uppercase tracking-widest flex items-center gap-1">
                                    <Sparkles className="w-2.5 h-2.5" />
                                    <span>Añadir</span>
                                </button>
                            </div>
                            <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                {inactiveStages.map((stage, idx) => (
                                    <div key={idx} className="group relative flex-shrink-0 w-32 bg-blue-50/40 dark:bg-blue-900/20 p-2 rounded-xl border border-blue-100/30 dark:border-blue-800/30 flex flex-col items-center">
                                        <div className="flex items-center justify-between w-full mb-1">
                                            <input
                                                type="text"
                                                value={stage.label || ''}
                                                onChange={(e) => updateStage(idx, 'label', e.target.value)}
                                                className="w-16 bg-transparent text-[8px] font-black uppercase text-blue-600 focus:outline-none"
                                                placeholder={`P${idx + 1}`}
                                            />
                                            <input
                                                type="number"
                                                value={stage.hours}
                                                onChange={(e) => updateStage(idx, 'hours', parseInt(e.target.value))}
                                                className="w-6 bg-white dark:bg-gray-800 rounded text-center text-[8px] font-black text-gray-700 focus:outline-none"
                                            />
                                        </div>
                                        <textarea
                                            value={stage.message}
                                            onChange={(e) => updateStage(idx, 'message', e.target.value)}
                                            className="w-full bg-transparent text-[8px] text-gray-600 focus:outline-none placeholder-gray-300 resize-none h-6 leading-tight"
                                            placeholder="Mensaje..."
                                        />
                                        <button onClick={() => removeStage(idx)} className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 bg-red-500 text-white rounded-full p-0.5"><Trash2 className="w-2 h-2" /></button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 px-1 pt-1 opacity-80">
                            <div className="flex flex-col">
                                <span className="text-[7px] font-black uppercase text-gray-400">Rango Horario</span>
                                <div className="flex items-center gap-1">
                                    <input
                                        type="number"
                                        value={operativeConfig.startHour}
                                        onChange={(e) => setOperativeConfig({ ...operativeConfig, startHour: parseInt(e.target.value) || 0 })}
                                        className="w-4 bg-transparent text-[9px] font-black text-blue-600 focus:outline-none"
                                    />
                                    <span className="text-[7px] text-gray-400">-</span>
                                    <input
                                        type="number"
                                        value={operativeConfig.endHour}
                                        onChange={(e) => setOperativeConfig({ ...operativeConfig, endHour: parseInt(e.target.value) || 0 })}
                                        className="w-4 bg-transparent text-[9px] font-black text-blue-600 focus:outline-none"
                                    />
                                </div>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-[7px] font-black uppercase text-red-400">Límite Diario</span>
                                <div className="flex items-center gap-1">
                                    <input
                                        type="number"
                                        value={operativeConfig.dailyLimit}
                                        onChange={(e) => setOperativeConfig({ ...operativeConfig, dailyLimit: parseInt(e.target.value) || 0 })}
                                        className="w-8 bg-transparent text-[9px] font-black text-red-600 focus:outline-none text-right"
                                    />
                                    <span className="text-[7px] text-gray-400 uppercase font-black">msg</span>
                                </div>
                            </div>
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
                            onClick={(e) => setGptConfig({ ...gptConfig, gptHostEnabled: !gptConfig.gptHostEnabled })}
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
                                <label className="text-[10px] font-black text-purple-600 dark:text-purple-400 uppercase tracking-widest">
                                    PROMPT SALA DE ESPERA ✨
                                </label>
                                <span className="text-[8px] font-bold text-gray-400 uppercase">OpenAI Powered</span>
                            </div>
                            <textarea
                                className="w-full h-80 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-purple-500 text-xs resize-none font-medium leading-relaxed transition-all"
                                value={gptConfig.gptHostPrompt}
                                onChange={(e) => setGptConfig({ ...gptConfig, gptHostPrompt: e.target.value })}
                                placeholder="Define la actitud social del Host..."
                            />
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
