import React, { useState, useEffect } from 'react';
import { Bot, Save, Power, Settings as SettingsIcon, MessageSquare, Smartphone, Clock, Shield, Sparkles, Trash2 } from 'lucide-react';
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
    const [assistantPrompt, setAssistantPrompt] = useState('');
    const [proactivePrompt, setProactivePrompt] = useState('');
    const [proactiveEnabled, setProactiveEnabled] = useState(false);
    const [aiModel, setAiModel] = useState('gemini-2.0-flash');
    const [stats, setStats] = useState({ today: 0, totalSent: 0, totalRecovered: 0 });
    const [operativeConfig, setOperativeConfig] = useState({ startHour: 7, endHour: 23, dailyLimit: 300 });
    const [inactiveStages, setInactiveStages] = useState([]);

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
                    if (data.stats) setStats(data.stats);
                    if (data.operativeConfig) setOperativeConfig(data.operativeConfig);
                    if (data.inactiveStages) setInactiveStages(data.inactiveStages);
                }

                const resAssistant = await fetch('/api/settings?type=assistant_ai_prompt');
                if (resAssistant.ok) {
                    const data = await resAssistant.json();
                    setAssistantPrompt(data.data || '');
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
                    // Also update statuses in case they changed elsewhere, 
                    // but NOT the prompts to avoid erasing user input
                    setIsActive(data.isActive);
                    setProactiveEnabled(data.proactiveEnabled);
                    if (data.operativeConfig) setOperativeConfig(data.operativeConfig);
                    if (data.inactiveStages) setInactiveStages(data.inactiveStages);
                }
            } catch (error) {
                console.error('Error polling stats:', error);
            }
        };

        loadSettings();

        // Nivel 9/10: Auto-Refresh Dashboard (Stats only)
        const pollInterval = setInterval(loadStats, 15000); // Poll every 15s

        return () => clearInterval(pollInterval);
    }, []);

    const handleSave = async () => {
        setLoading(true);

        localStorage.setItem('bot_ia_prompt', systemPrompt);
        localStorage.setItem('bot_ia_active', isActive);

        try {
            const resConfig = await fetch('/api/bot-ia/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proactivePrompt,
                    operativeConfig,
                    inactiveStages
                })
            });

            const resPrompt = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'ai_prompt',
                    data: systemPrompt
                })
            });

            const resAssistant = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'assistant_ai_prompt',
                    data: assistantPrompt
                })
            });

            if (resConfig.ok && resPrompt.ok && resAssistant.ok) {
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

    return (
        <div className="space-y-2 max-w-7xl mx-auto">
            {/* Header Status Card - Compressed */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-2 px-4 flex flex-col md:flex-row items-center justify-between gap-2">
                <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isActive ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                        <Bot className={`w-5 h-5 ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">Estado del Bot IA</h2>
                        <p className={`text-[11px] font-medium ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                            {isActive ? 'ACTIVO' : 'INACTIVO'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={toggleActive}
                        className={`
                            relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500
                            ${isActive ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}
                        `}
                    >
                        <span
                            className={`
                                inline-block h-5 w-5 transform rounded-full bg-white transition-transform
                                ${isActive ? 'translate-x-6' : 'translate-x-1'}
                            `}
                        />
                    </button>
                    <span className="text-[11px] text-gray-600 dark:text-gray-300 font-bold uppercase">
                        {isActive ? 'On' : 'Off'}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* AI Configuration */}
                <Card title="Cerebro del Asistente" icon={SettingsIcon}>
                    <div className="space-y-3">
                        <div>
                            <label className="flex items-center justify-between text-xs font-bold text-gray-700 dark:text-gray-300 mb-0.5">
                                <span>Fase 1: Brenda Capturista 📝</span>
                                <span className="text-[8px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded-full uppercase tracking-tighter">Extracción</span>
                            </label>
                            <textarea
                                className="w-full h-20 p-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-xs resize-none shadow-inner font-mono"
                                placeholder="Reglas..."
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="flex items-center justify-between text-xs font-bold text-gray-700 dark:text-gray-300 mb-0.5">
                                <span>Assistant 2.0 (Intention) 🕵️‍♀️✨</span>
                                <span className="text-[8px] bg-purple-100 text-purple-600 px-1 py-0.5 rounded-full uppercase tracking-tighter">Seguimiento</span>
                            </label>
                            <textarea
                                className="w-full h-20 p-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-xs resize-none shadow-inner font-mono"
                                placeholder="Personalidad..."
                                value={assistantPrompt}
                                onChange={(e) => setAssistantPrompt(e.target.value)}
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-1">
                            <div>
                                <select
                                    value={aiModel}
                                    onChange={(e) => setAiModel(e.target.value)}
                                    className="w-full p-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-[11px] shadow-sm font-bold"
                                >
                                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                                    <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                                    <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Follow-up Rules Reference */}
                <Card
                    title={
                        <div className="flex items-center justify-between w-full pr-1">
                            <span className="flex items-center gap-2 text-sm">Seguimiento <Sparkles className="w-3 h-3 text-blue-500" /></span>

                            {/* Proactive Follow-up Toggle - Compact */}
                            <div className="flex items-center gap-2 scale-75 origin-right">
                                <button
                                    type="button"
                                    onClick={toggleProactive}
                                    className={`
                                        relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                                        ${proactiveEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
                                    `}
                                >
                                    <span
                                        className={`
                                            inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                                            ${proactiveEnabled ? 'translate-x-6' : 'translate-x-1'}
                                        `}
                                    />
                                </button>
                            </div>
                        </div>
                    }
                    icon={Bot}
                >
                    <div className="space-y-4">
                        {/* Follow-up Hook - Compressed */}
                        <div className="bg-blue-50/30 dark:bg-blue-900/10 p-2.5 rounded-2xl border border-blue-100/50 dark:border-blue-800/30">
                            <label className="flex items-center justify-between text-xs font-bold text-blue-900 dark:text-blue-100 mb-1.5">
                                <span className="flex items-center gap-2 text-[11px]">Hook de Brenda 🎯</span>
                                <span className="text-[8px] bg-blue-600 text-white px-1 py-0.5 rounded-full uppercase tracking-tighter">Contacto</span>
                            </label>
                            <textarea
                                className="w-full h-14 p-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-xs resize-none shadow-sm font-mono"
                                placeholder="Ej: Hola!..."
                                value={proactivePrompt}
                                onChange={(e) => setProactivePrompt(e.target.value)}
                            />
                        </div>
                        {/* Stats - Ultra Compact */}
                        <div className="grid grid-cols-4 gap-2">
                            <div className="bg-gradient-to-br from-purple-500/10 to-indigo-500/5 dark:from-purple-500/20 dark:to-indigo-500/10 p-2 rounded-xl border border-purple-100/50 dark:border-purple-800/30">
                                <p className="text-[8px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-0.5">Enviados</p>
                                <h4 className="text-base font-bold text-gray-900 dark:text-white leading-none">{stats.totalSent}</h4>
                            </div>
                            <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 dark:from-green-500/20 dark:to-emerald-500/10 p-2 rounded-xl border border-green-100/50 dark:border-green-800/30">
                                <p className="text-[8px] font-black uppercase tracking-widest text-green-600 dark:text-green-400 mb-0.5">Recuperados</p>
                                <h4 className="text-base font-bold text-gray-900 dark:text-white leading-none">{stats.totalRecovered || 0}</h4>
                            </div>
                            <div className="bg-gradient-to-br from-orange-500/10 to-amber-500/5 dark:from-orange-500/20 dark:to-amber-500/10 p-2 rounded-xl border border-orange-100/50 dark:border-orange-800/30">
                                <p className="text-[8px] font-black uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-0.5">Pendientes</p>
                                <h4 className="text-base font-bold text-gray-900 dark:text-white leading-none">{stats.pending || 0}</h4>
                            </div>
                            <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/5 dark:from-blue-500/20 dark:to-cyan-500/10 p-2 rounded-xl border border-blue-100/50 dark:border-blue-800/30">
                                <p className="text-[8px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-0.5">Completos</p>
                                <h4 className="text-base font-bold text-gray-900 dark:text-white leading-none">{stats.complete || 0}</h4>
                            </div>
                        </div>

                        {/* Operative Rules - Compressed */}
                        <div className="bg-gray-50 dark:bg-gray-900/40 p-2 rounded-xl border border-gray-100 dark:border-gray-800/50">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex items-center gap-3">
                                    <Clock className="w-3.5 h-3.5 text-blue-500" />
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number"
                                            value={operativeConfig.startHour}
                                            onChange={(e) => setOperativeConfig({ ...operativeConfig, startHour: parseInt(e.target.value) })}
                                            className="w-8 bg-transparent border-none text-[11px] font-black text-gray-700 dark:text-gray-300 p-0 focus:ring-0 text-center"
                                        />
                                        <span className="text-xs text-gray-400">-</span>
                                        <input
                                            type="number"
                                            value={operativeConfig.endHour}
                                            onChange={(e) => setOperativeConfig({ ...operativeConfig, endHour: parseInt(e.target.value) })}
                                            className="w-8 bg-transparent border-none text-[11px] font-black text-gray-700 dark:text-gray-300 p-0 focus:ring-0 text-center"
                                        />
                                        <span className="text-[10px] text-gray-500 uppercase font-bold">h</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Shield className="w-3.5 h-3.5 text-red-500" />
                                    <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-gray-400 font-bold">Límite:</span>
                                        <input
                                            type="number"
                                            value={operativeConfig.dailyLimit}
                                            onChange={(e) => setOperativeConfig({ ...operativeConfig, dailyLimit: parseInt(e.target.value) })}
                                            className="w-10 bg-transparent border-none text-[11px] font-black text-red-500 p-0 focus:ring-0"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <div className="flex items-center justify-between px-1">
                                <h4 className="text-[9px] font-black text-gray-400 uppercase tracking-widest leading-none">Protocolo</h4>
                                <button
                                    onClick={() => setInactiveStages([...inactiveStages, { hours: 24, label: 'Etapa' }])}
                                    className="text-[9px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
                                >
                                    + AÑADIR
                                </button>
                            </div>

                            <div className="relative pt-10 pb-1 min-h-[90px] flex items-start overflow-x-auto no-scrollbar scroll-smooth bg-gray-50/20 dark:bg-gray-900/10 rounded-xl p-2">
                                <div className="absolute top-[28px] left-0 right-0 h-0.5 bg-gray-100 dark:bg-gray-800 mx-4"></div>
                                <div className="flex w-full justify-between items-start px-6 gap-3">
                                    {inactiveStages.map((stage, idx) => (
                                        <div key={idx} className="relative flex flex-col items-center min-w-[100px] group transition-all">
                                            <div className={`absolute top-[13.5px] w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 shadow-sm z-10 
                                                ${idx === 0 ? 'bg-blue-600' : idx === 1 ? 'bg-blue-500' : 'bg-slate-500'}`}
                                            ></div>
                                            <button
                                                onClick={() => setInactiveStages(inactiveStages.filter((_, i) => i !== idx))}
                                                className="absolute -top-1 opacity-0 group-hover:opacity-100 transition-all text-red-500 z-30"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>

                                            <div className="flex flex-col items-center gap-1 w-full pt-6">
                                                <div className="flex items-center justify-center gap-0.5 bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded-lg shadow-sm border border-gray-100">
                                                    <input
                                                        type="number"
                                                        value={stage.hours}
                                                        onChange={(e) => {
                                                            const newStages = [...inactiveStages];
                                                            newStages[idx].hours = parseInt(e.target.value) || 0;
                                                            setInactiveStages(newStages);
                                                        }}
                                                        className="w-7 bg-transparent border-none text-[11px] font-black text-gray-900 dark:text-white p-0 focus:ring-0 text-right"
                                                    />
                                                    <span className="text-[11px] font-black text-blue-600">h</span>
                                                </div>
                                                <textarea
                                                    value={stage.label}
                                                    rows={1}
                                                    onChange={(e) => {
                                                        const newStages = [...inactiveStages];
                                                        newStages[idx].label = e.target.value;
                                                        setInactiveStages(newStages);
                                                    }}
                                                    className="w-full bg-transparent border-none text-[9px] font-bold text-gray-500 dark:text-gray-400 leading-none italic text-center p-0 focus:ring-0 resize-none overflow-hidden"
                                                    placeholder="Etiqueta"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            <div className="flex justify-end pt-1">
                <Button
                    onClick={handleSave}
                    loading={loading}
                    icon={Save}
                    size="sm"
                    className="h-10 px-8 text-[11px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/10"
                >
                    Guardar Cambios
                </Button>
            </div>
        </div>
    );
};

export default BotIASection;
