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
                    // Polling now ONLY updates statistics to prevent overwriting user edits in progress.
                }
            } catch (error) {
                console.error('Error polling stats:', error);
            }
        };

        loadSettings();

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

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {/* 1. Assistant Brain: Ultra Compact */}
                <Card
                    title={<span className="text-gray-900 dark:text-white font-bold text-sm">Cerebro del Asistente</span>}
                    icon={SettingsIcon}
                    className="shadow-sm border-gray-100 dark:border-gray-700 rounded-3xl"
                    headerClassName="h-20"
                >
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between px-1">
                                <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                                    Fase 1: Brenda 📑
                                </label>
                                <span className="text-[8px] font-bold text-blue-600 uppercase">Extractora</span>
                            </div>
                            <textarea
                                className="w-full h-[175px] p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/40 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 text-xs resize-none transition-all leading-relaxed font-medium"
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between px-1">
                                <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                                    Assistant 2.0 👩‍💻✨
                                </label>
                                <span className="text-[8px] font-bold text-indigo-600 uppercase">Diálogo</span>
                            </div>
                            <textarea
                                className="w-full h-[175px] p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/40 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 text-xs resize-none transition-all leading-relaxed font-medium"
                                value={assistantPrompt}
                                onChange={(e) => setAssistantPrompt(e.target.value)}
                            />
                        </div>

                        <div className="pt-1">
                            <select
                                value={aiModel}
                                onChange={(e) => setAiModel(e.target.value)}
                                className="w-full p-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-bold shadow-sm"
                            >
                                <option value="gemini-2.0-flash">🚀 Gemini 2.0 Flash</option>
                                <option value="gemini-1.5-flash">⚡ Gemini 1.5 Flash</option>
                                <option value="gemini-1.5-pro">🧠 Gemini 1.5 Pro</option>
                            </select>
                        </div>
                    </div>
                </Card>

                {/* 2. Automated Follow-up: Styled Denstiy */}
                <Card
                    title={<span className="text-gray-900 dark:text-white font-bold text-sm">Seguimiento Automático</span>}
                    actions={
                        <div className="flex items-center gap-1">
                            {/* Operative Pill: Hours */}
                            <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-1.5 rounded-xl shadow-sm scale-90 transition-all hover:border-blue-200">
                                <div className="flex flex-col min-w-[42px]">
                                    <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 leading-none">Horario</span>
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={operativeConfig.startHour}
                                            onChange={(e) => setOperativeConfig({ ...operativeConfig, startHour: parseInt(e.target.value.replace(/\D/g, '')) || 0 })}
                                            className="w-4 bg-transparent text-[10px] font-bold text-blue-600 dark:text-blue-400 focus:outline-none text-center p-0"
                                        />
                                        <span className="text-[8px] text-gray-400 font-bold">-</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={operativeConfig.endHour}
                                            onChange={(e) => setOperativeConfig({ ...operativeConfig, endHour: parseInt(e.target.value.replace(/\D/g, '')) || 0 })}
                                            className="w-4 bg-transparent text-[10px] font-bold text-blue-600 dark:text-blue-400 focus:outline-none text-center p-0"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Limit Pill */}
                            <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-1.5 rounded-xl shadow-sm scale-90 transition-all hover:border-red-200">
                                <div className="flex flex-col">
                                    <span className="text-[8px] font-black uppercase tracking-widest text-red-400 leading-none">Límite</span>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={operativeConfig.dailyLimit}
                                        onChange={(e) => setOperativeConfig({ ...operativeConfig, dailyLimit: parseInt(e.target.value.replace(/\D/g, '')) || 0 })}
                                        className="w-10 bg-transparent text-[10px] font-bold text-red-600 dark:text-red-400 focus:outline-none p-0 mt-0.5 font-black text-center"
                                    />
                                </div>
                            </div>

                            {/* Toggle Pill */}
                            <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-1.5 rounded-xl shadow-sm scale-90">
                                <div className="flex flex-col">
                                    <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 leading-none">Seguimiento</span>
                                    <span className={`text-[10px] font-bold ${proactiveEnabled ? 'text-blue-600' : 'text-gray-400'}`}>
                                        {proactiveEnabled ? 'IA AUTO' : 'OFF'}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={toggleProactive}
                                    className={`
                                        relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
                                        ${proactiveEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
                                    `}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${proactiveEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    }
                    icon={Sparkles}
                    className="shadow-sm border-gray-100 dark:border-gray-700 rounded-3xl"
                    headerClassName="h-20"
                >
                    <div className="space-y-4">
                        {/* Hook: Refined */}
                        <div className="bg-gray-50/50 dark:bg-gray-900/20 p-4 rounded-2xl border border-gray-100/50 dark:border-gray-800/30">
                            <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 block">
                                Hook de Brenda 👩‍💼🎯
                            </label>
                            <textarea
                                className="w-full h-[146px] p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 text-xs resize-none font-medium leading-relaxed"
                                value={proactivePrompt}
                                onChange={(e) => setProactivePrompt(e.target.value)}
                            />
                        </div>

                        {/* Professional Stats: Colored Restore */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                            {/* ✈️ PLAN DE VUELO DE HOY - ESPECÍFICO */}
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100/50 dark:border-indigo-900/30 p-2.5 rounded-2xl shadow-sm transition-all hover:scale-[1.01] col-span-1 sm:col-span-2">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                                        <Send className="w-3.5 h-3.5" />
                                        <p className="text-[10px] font-black uppercase tracking-widest leading-none">Plan de Vuelo de Hoy ✈️</p>
                                    </div>
                                    <span className="text-[10px] font-black text-indigo-500 bg-white dark:bg-gray-800 px-2 py-0.5 rounded-full border border-indigo-100 dark:border-indigo-800 shadow-sm">
                                        Total: {stats.flightPlan?.summary?.totalItems || 0}
                                    </span>
                                </div>
                                <div className="space-y-1">
                                    {stats.flightPlan && Object.keys(stats.flightPlan).filter(k => k !== 'summary').length > 0 ? (
                                        Object.keys(stats.flightPlan)
                                            .filter(k => k !== 'summary')
                                            .sort((a, b) => parseInt(a) - parseInt(b))
                                            .map((h, i) => {
                                                const p = stats.flightPlan[h];
                                                return (
                                                    <div key={i} className="flex flex-col gap-0 border-b border-indigo-100/20 dark:border-indigo-900/20 last:border-0 py-0.5">
                                                        <div className="flex items-center justify-between text-[10px]">
                                                            <div className="flex items-center gap-1 font-bold text-gray-700 dark:text-gray-300">
                                                                <span className="truncate max-w-[120px] uppercase opacity-80 tracking-tight">
                                                                    {p.label || `Nivel ${i + 1}`} ({h}h)
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="text-[9px] text-gray-500 font-medium">{p.total} ({p.sent} env.)</span>
                                                                <span className="font-black text-indigo-600 dark:text-indigo-400">{p.percentage}%</span>
                                                            </div>
                                                        </div>
                                                        {/* Ultra Mini bar */}
                                                        <div className="w-full h-[3px] bg-white/40 dark:bg-gray-800/40 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-indigo-500/80 rounded-full transition-all duration-1000"
                                                                style={{ width: `${p.percentage}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })
                                    ) : (
                                        <p className="text-[9px] text-gray-400 italic font-medium px-1">No hay vuelos programados.</p>
                                    )}
                                </div>
                            </div>

                            {/* RESTO DE STATS */}
                            {[
                                { label: 'Pendientes', val: stats.pending || 0, icon: Clock, bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-100/50 dark:border-amber-900/30' },
                                { label: 'Completos', val: stats.complete || 0, icon: CheckCircle, bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-100/50 dark:border-blue-900/30' }
                            ].map((s, i) => (
                                <div key={i} className={`${s.bg} ${s.border} border p-3 rounded-2xl shadow-sm transition-all hover:scale-[1.02] flex flex-col justify-center`}>
                                    <div className="flex items-center justify-between mb-1">
                                        <div className={`${s.text} opacity-70`}>
                                            <s.icon className="w-3.5 h-3.5" />
                                        </div>
                                    </div>
                                    <p className="text-[8px] font-black uppercase tracking-widest text-gray-500/70 mb-0.5">{s.label}</p>
                                    <h4 className={`text-xl font-black ${s.text} leading-none tracking-tight`}>{s.val}</h4>
                                </div>
                            ))}
                        </div>


                        {/* Protocol Stages: Horizontal Centered Clean List */}
                        <div className="space-y-2 pt-2">
                            <div className="flex items-center justify-between px-1">
                                <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                                    Protocolos de Reactivación 📑
                                </label>
                                <button
                                    onClick={addStage}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02] flex items-center gap-2"
                                    title="Añadir seguimiento"
                                >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>Crear Nuevo</span>
                                </button>
                            </div>

                            <div className="flex flex-row gap-3 overflow-x-auto pb-3 custom-scrollbar">
                                {inactiveStages.map((stage, idx) => (
                                    <div key={idx} className="group relative flex-shrink-0 w-44 bg-blue-50/50 dark:bg-blue-900/20 p-4 rounded-3xl border border-blue-100/50 dark:border-blue-800/30 flex flex-col items-center justify-center text-center transition-all hover:scale-[1.02] hover:bg-blue-50 dark:hover:bg-blue-900/30">
                                        <div className="flex flex-col items-center mb-2">
                                            <div className="flex items-center justify-center gap-1 bg-white dark:bg-gray-800 px-3 py-1 rounded-xl shadow-sm border border-blue-100/50 dark:border-blue-700">
                                                <input
                                                    type="number"
                                                    value={stage.hours}
                                                    onChange={(e) => updateStage(idx, 'hours', parseInt(e.target.value))}
                                                    className="w-10 bg-transparent text-center text-sm font-black text-blue-700 dark:text-blue-400 focus:outline-none"
                                                />
                                                <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Hrs</span>
                                            </div>
                                        </div>

                                        <div className="w-full">
                                            <textarea
                                                value={stage.message}
                                                onChange={(e) => updateStage(idx, 'message', e.target.value)}
                                                className="w-full bg-transparent text-[10px] font-bold text-gray-700 dark:text-gray-300 focus:outline-none placeholder-gray-400 text-center resize-none leading-tight"
                                                rows={2}
                                                placeholder="Mensaje de seguimiento..."
                                            />
                                        </div>

                                        <button
                                            onClick={() => removeStage(idx)}
                                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-2 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-all scale-75"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                                {inactiveStages.length === 0 && (
                                    <div className="flex-1 text-center py-6 rounded-3xl border-2 border-dashed border-gray-100 dark:border-gray-800">
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sin seguimientos configurados</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Final Action: Integrated Bottom, No Sticky, No Scroll */}
            <div className="flex justify-end pt-2">
                <Button
                    onClick={handleSave}
                    loading={loading}
                    icon={Save}
                    size="lg"
                    className="bg-blue-600 hover:bg-blue-700 text-white h-12 px-10 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 transition-all hover:scale-[1.02]"
                >
                    Guardar Cambios
                </Button>
            </div>
        </div>
    );
};

export default BotIASection;
