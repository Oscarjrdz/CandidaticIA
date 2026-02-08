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
        <div className="space-y-6 w-full pb-24 animate-in fade-in duration-700">
            {/* Master Bot Controller: Fluid Width */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center space-x-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${isActive ? 'bg-blue-600 shadow-lg shadow-blue-500/20' : 'bg-gray-100 dark:bg-gray-700'}`}>
                        <Bot className={`w-6 h-6 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">Estado del Bot IA</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                            <p className={`text-xs font-bold tracking-tight ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                                {isActive ? 'MOTOR ACTIVO Y PROCESANDO' : 'MODO STANDBY (INACTIVO)'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-900/50 p-2 rounded-2xl border border-gray-100 dark:border-gray-800">
                    <button
                        onClick={toggleActive}
                        className={`
                            relative inline-flex h-8 w-16 items-center rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                            ${isActive ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
                        `}
                    >
                        <span
                            className={`
                                inline-block h-6 w-6 transform rounded-full bg-white transition-transform shadow-md
                                ${isActive ? 'translate-x-9' : 'translate-x-1'}
                            `}
                        />
                    </button>
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-black uppercase tracking-widest mr-2">
                        {isActive ? 'On' : 'Off'}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* 1. Assistant Brain: Premium Refactor */}
                <Card
                    title={<span className="text-gray-900 dark:text-white font-bold">Cerebro del Asistente</span>}
                    icon={SettingsIcon}
                    className="shadow-xl border-gray-100 dark:border-gray-700/50 rounded-3xl"
                >
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between px-1">
                                <label className="text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.15em]">
                                    Fase 1: Brenda Capturista 📑
                                </label>
                                <span className="text-[9px] font-bold bg-blue-50 dark:bg-blue-900/20 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100/50 dark:border-blue-800/30 uppercase">Extracción de Datos</span>
                            </div>
                            <textarea
                                className="w-full h-48 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/40 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none transition-all leading-relaxed font-medium"
                                placeholder="..."
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between px-1">
                                <label className="text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.15em]">
                                    Assistant 2.0 (Intention) 👩‍💻✨
                                </label>
                                <span className="text-[9px] font-bold bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 px-2 py-0.5 rounded-full border border-indigo-100/50 dark:border-indigo-800/30 uppercase">Lógica de Diálogo</span>
                            </div>
                            <textarea
                                className="w-full h-48 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/40 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none transition-all leading-relaxed font-medium"
                                placeholder="..."
                                value={assistantPrompt}
                                onChange={(e) => setAssistantPrompt(e.target.value)}
                            />
                        </div>

                        <div className="pt-2">
                            <select
                                value={aiModel}
                                onChange={(e) => setAiModel(e.target.value)}
                                className="w-full p-3.5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 text-sm font-bold shadow-sm"
                            >
                                <option value="gemini-2.0-flash">🚀 Gemini 2.0 Flash (Recomendado)</option>
                                <option value="gemini-1.5-flash">⚡ Gemini 1.5 Flash</option>
                                <option value="gemini-1.5-pro">🧠 Gemini 1.5 Pro</option>
                            </select>
                        </div>
                    </div>
                </Card>

                {/* 2. Automated Follow-up: Design Consolidation */}
                <Card
                    title={
                        <div className="flex items-center justify-between w-full pr-1">
                            <span className="text-gray-900 dark:text-white font-bold">Seguimiento Automático</span>

                            <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900/50 px-3 py-1.5 rounded-2xl border border-gray-100 dark:border-gray-800 scale-90">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">IA Auto</span>
                                <button
                                    type="button"
                                    onClick={toggleProactive}
                                    className={`
                                        relative inline-flex h-6 w-11 items-center rounded-full transition-all
                                        ${proactiveEnabled ? 'bg-blue-600 shadow-md shadow-blue-500/20' : 'bg-gray-300 dark:bg-gray-600'}
                                    `}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${proactiveEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    }
                    icon={Sparkles}
                    className="shadow-xl border-gray-100 dark:border-gray-700/50 rounded-3xl"
                >
                    <div className="space-y-6">
                        {/* Hook: Refined */}
                        <div className="bg-blue-50/20 dark:bg-blue-900/5 p-5 rounded-3xl border border-blue-100/30 dark:border-blue-800/20">
                            <label className="flex items-center justify-between text-[11px] font-black text-blue-900 dark:text-blue-100 mb-3 uppercase tracking-[0.10em]">
                                Hook de Brenda 👩‍💼🎯
                            </label>
                            <textarea
                                className="w-full h-36 p-5 rounded-2xl border border-blue-200/50 dark:border-blue-800/30 bg-white dark:bg-gray-900/60 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 text-sm resize-none shadow-sm font-medium leading-relaxed"
                                placeholder="..."
                                value={proactivePrompt}
                                onChange={(e) => setProactivePrompt(e.target.value)}
                            />
                        </div>

                        {/* Professional Stats: Neutral Homogenization */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {[
                                { label: 'Enviados', val: stats.totalSent, icon: Send, color: 'text-blue-600' },
                                { label: 'ROI', val: stats.totalRecovered || 0, icon: RefreshCw, color: 'text-emerald-600' },
                                { label: 'Pendientes', val: stats.pending || 0, icon: Clock, color: 'text-amber-600' },
                                { label: 'Completos', val: stats.complete || 0, icon: CheckCircle, color: 'text-indigo-600' }
                            ].map((s, i) => (
                                <div key={i} className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm transition-all hover:border-blue-200 dark:hover:border-blue-900/30 group">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className={`p-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 ${s.color} group-hover:scale-110 transition-transform`}>
                                            <s.icon className="w-3.5 h-3.5" />
                                        </div>
                                    </div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-0.5">{s.label}</p>
                                    <h4 className="text-2xl font-black text-gray-900 dark:text-white leading-none tracking-tight">{s.val}</h4>
                                </div>
                            ))}
                        </div>

                        {/* Operative Settings: Integrated Design */}
                        <div className="bg-gray-50 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-100 dark:border-gray-800">
                            <div className="grid grid-cols-2 gap-8">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 mb-2 text-gray-500 dark:text-gray-400">
                                        <Clock className="w-4 h-4" />
                                        <span className="text-[10px] font-black uppercase tracking-widest">Operación</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            value={operativeConfig.startHour}
                                            onChange={(e) => setOperativeConfig({ ...operativeConfig, startHour: parseInt(e.target.value) })}
                                            className="w-12 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-black text-gray-900 dark:text-white p-2 focus:ring-blue-500 text-center shadow-sm"
                                        />
                                        <span className="text-gray-400 font-bold">-</span>
                                        <input
                                            type="number"
                                            value={operativeConfig.endHour}
                                            onChange={(e) => setOperativeConfig({ ...operativeConfig, endHour: parseInt(e.target.value) })}
                                            className="w-12 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-black text-gray-900 dark:text-white p-2 focus:ring-blue-500 text-center shadow-sm"
                                        />
                                        <span className="text-[11px] font-black text-gray-400">HRS</span>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 mb-2 text-red-500/80">
                                        <Shield className="w-4 h-4" />
                                        <span className="text-[10px] font-black uppercase tracking-widest">Límite Diario</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            value={operativeConfig.dailyLimit}
                                            onChange={(e) => setOperativeConfig({ ...operativeConfig, dailyLimit: parseInt(e.target.value) })}
                                            className="w-full bg-white dark:bg-gray-800 border-2 border-red-500/30 dark:border-red-900/30 rounded-lg text-base font-black text-red-600 dark:text-red-400 p-2 focus:ring-red-500 shadow-sm"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Timeline Protocol: Refined Horizontal Scroll */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between px-1">
                                <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Protocolo de Reactivación</h4>
                                <button
                                    onClick={() => setInactiveStages([...inactiveStages, { hours: 24, label: 'Recordatorio' }])}
                                    className="px-3 py-1 text-[10px] font-black bg-blue-600 text-white rounded-full shadow-lg shadow-blue-500/20 hover:scale-105 transition-transform"
                                >
                                    + AÑADIR ETAPA
                                </button>
                            </div>

                            <div className="relative pt-16 pb-8 min-h-[160px] flex items-start overflow-x-auto no-scrollbar bg-gray-50/50 dark:bg-gray-900/30 rounded-[32px] px-8 border border-gray-100 dark:border-gray-800">
                                <div className="absolute top-[48px] left-0 right-0 h-0.5 bg-gray-200 dark:bg-gray-800 mx-12"></div>
                                <div className="flex items-start gap-12">
                                    {inactiveStages.map((stage, idx) => (
                                        <div key={idx} className="relative flex flex-col items-center min-w-[150px] group">
                                            <div className={`absolute top-[18px] w-4 h-4 rounded-full border-4 border-white dark:border-gray-900 shadow-md z-10 
                                                ${idx % 2 === 0 ? 'bg-blue-600' : 'bg-indigo-600'}`}
                                            ></div>

                                            <button
                                                onClick={() => setInactiveStages(inactiveStages.filter((_, i) => i !== idx))}
                                                className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-all text-red-500 p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>

                                            <div className="flex flex-col items-center gap-3 w-full pt-10">
                                                <div className="flex items-center gap-1.5 bg-white dark:bg-gray-800 px-3.5 py-1.5 rounded-xl shadow-md border border-gray-100 dark:border-gray-700">
                                                    <input
                                                        type="number"
                                                        value={stage.hours}
                                                        onChange={(e) => {
                                                            const newStages = [...inactiveStages];
                                                            newStages[idx].hours = parseInt(e.target.value) || 0;
                                                            setInactiveStages(newStages);
                                                        }}
                                                        className="w-10 bg-transparent border-none text-base font-black text-gray-900 dark:text-white p-0 focus:ring-0 text-right"
                                                    />
                                                    <span className="text-sm font-black text-blue-600">HRS</span>
                                                </div>
                                                <textarea
                                                    value={stage.label}
                                                    rows={2}
                                                    onChange={(e) => {
                                                        const newStages = [...inactiveStages];
                                                        newStages[idx].label = e.target.value;
                                                        setInactiveStages(newStages);
                                                    }}
                                                    className="w-full bg-transparent border-none text-[11px] font-bold text-gray-600 dark:text-gray-400 leading-tight italic text-center p-0 focus:ring-0 resize-none overflow-hidden"
                                                    placeholder="Etiqueta..."
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

            {/* Sticky Action Footer: Candidatic Pattern */}
            <div className="fixed bottom-6 left-1/2 md:left-[calc(50%+130px)] -translate-x-1/2 z-[40] w-[calc(100%-48px)] max-w-7xl">
                <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl p-4 px-8 rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-white/50 dark:border-gray-700/50 flex items-center justify-between">
                    <div className="hidden md:flex flex-col">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] leading-none mb-1">Panel de Configuración de IA</p>
                        <p className="text-[12px] font-bold text-gray-600 dark:text-gray-300">Asegúrate de guardar tus reglas antes de salir.</p>
                    </div>
                    <Button
                        onClick={handleSave}
                        loading={loading}
                        icon={Save}
                        size="lg"
                        className="bg-blue-600 hover:bg-blue-700 text-white h-14 px-12 rounded-[22px] text-sm font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 transform hover:scale-[1.02] active:scale-95 transition-all"
                    >
                        Guardar Cambios
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default BotIASection;
