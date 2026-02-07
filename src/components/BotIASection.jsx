import React, { useState, useEffect } from 'react';
import { Bot, Save, Power, Settings as SettingsIcon, MessageSquare, Smartphone, Clock, Shield, Sparkles } from 'lucide-react';
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
                body: JSON.stringify({ proactivePrompt })
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
        <div className="space-y-3">
            {/* Header Status Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 flex flex-col md:flex-row items-center justify-between gap-3">
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* AI Configuration */}
                <Card title="Cerebro del Asistente" icon={SettingsIcon}>
                    <div className="space-y-3">
                        <div>
                            <label className="flex items-center justify-between text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                <span>Fase 1: Brenda Capturista 📝</span>
                                <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">Extracción de Datos</span>
                            </label>
                            <textarea
                                className="w-full h-32 p-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-sm resize-none shadow-inner font-mono"
                                placeholder="Reglas de extracción de datos..."
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                            />
                            <p className="text-[10px] text-gray-500 mt-1 italic">
                                Este "Cerebro" gobierna la recolección de Nombre, Municipio, Edad y Categoría una vez que el candidato ya respondió.
                            </p>
                        </div>

                        <div>
                            <label className="flex items-center justify-between text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                <span>Assistant 2.0 (Intention) 🕵️‍♀️✨</span>
                                <span className="text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">Perfil 100% Completo</span>
                            </label>
                            <textarea
                                className="w-full h-32 p-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-sm resize-none shadow-inner font-mono"
                                placeholder="Personalidad para el seguimiento..."
                                value={assistantPrompt}
                                onChange={(e) => setAssistantPrompt(e.target.value)}
                            />
                            <p className="text-[10px] text-gray-500 mt-1 italic">
                                Úsalo para definir su personalidad de embajadora.
                                <span className="font-bold text-blue-500 ml-1 underline">Tip:</span> Usa <code className="bg-gray-200 px-1 rounded">{"{{Mission}}"}</code> para inyectar una tarea aleatoria.
                            </p>
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

                {/* Follow-up Rules Reference */}
                <Card
                    title={
                        <div className="flex items-center justify-between w-full pr-1">
                            <span className="flex items-center gap-2">Control de Seguimiento <Sparkles className="w-4 h-4 text-blue-500" /></span>

                            {/* Proactive Follow-up Toggle - Exact Look from CandidatesSection */}
                            <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-1.5 rounded-xl shadow-sm scale-90 origin-right">
                                <div className="flex flex-col">
                                    <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 leading-none">Seguimiento</span>
                                    <span className={`text-[10px] font-bold ${proactiveEnabled ? 'text-blue-600' : 'text-gray-400'}`}>
                                        {proactiveEnabled ? 'AUTO' : 'OFF'}
                                    </span>
                                </div>
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
                        {/* Nuevo: Prompt de Seguimiento (Hook) */}
                        <div className="bg-blue-50/30 dark:bg-blue-900/10 p-4 rounded-2xl border border-blue-100/50 dark:border-blue-800/30">
                            <label className="flex items-center justify-between text-sm font-bold text-blue-900 dark:text-blue-100 mb-2">
                                <span className="flex items-center gap-2">Regla 1: El Hook de Brenda 🎯</span>
                                <span className="text-[9px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full uppercase tracking-tighter">Primer Contacto</span>
                            </label>
                            <textarea
                                className="w-full h-24 p-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-sm resize-none shadow-sm font-mono"
                                placeholder="Ej: 'Hola! Soy Brenda de Candidatic, vi que iniciaste tu registro...'"
                                value={proactivePrompt}
                                onChange={(e) => setProactivePrompt(e.target.value)}
                            />
                            <p className="text-[10px] text-blue-600/70 dark:text-blue-400/70 mt-2 italic px-1">
                                <Sparkles className="w-3 h-3 inline mr-1" />
                                Este prompt es el "Gancho" inicial. Se usa para motivar al candidato a responder cuando hay inactividad.
                            </p>
                        </div>
                        {/* Mini Dashboard Impacto */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="bg-gradient-to-br from-purple-500/10 to-indigo-500/5 dark:from-purple-500/20 dark:to-indigo-500/10 p-4 rounded-2xl border border-purple-100/50 dark:border-purple-800/30">
                                <p className="text-[10px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-1">Total Enviados</p>
                                <div className="flex items-baseline gap-2">
                                    <h4 className="text-xl font-bold text-gray-900 dark:text-white">{stats.totalSent}</h4>
                                    <span className="text-[10px] text-purple-400 font-medium">Hoy: {stats.today}</span>
                                </div>
                            </div>
                            <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 dark:from-green-500/20 dark:to-emerald-500/10 p-4 rounded-2xl border border-green-100/50 dark:border-green-800/30">
                                <p className="text-[10px] font-black uppercase tracking-widest text-green-600 dark:text-green-400 mb-1">Datos Recuperados</p>
                                <div className="flex items-baseline gap-2">
                                    <h4 className="text-xl font-bold text-gray-900 dark:text-white">{stats.totalRecovered || 0}</h4>
                                    <span className="text-[10px] text-green-400 font-medium leading-none">ROI Éxito</span>
                                </div>
                            </div>
                            <div className="bg-gradient-to-br from-orange-500/10 to-amber-500/5 dark:from-orange-500/20 dark:to-amber-500/10 p-4 rounded-2xl border border-orange-100/50 dark:border-orange-800/30">
                                <p className="text-[10px] font-black uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">Candidatos Pendientes</p>
                                <div className="flex items-baseline gap-2">
                                    <h4 className="text-xl font-bold text-gray-900 dark:text-white">{stats.pending || 0}</h4>
                                    <span className="text-[10px] text-orange-400 font-medium leading-none">Incompletos</span>
                                </div>
                            </div>
                            <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/5 dark:from-blue-500/20 dark:to-cyan-500/10 p-4 rounded-2xl border border-blue-100/50 dark:border-blue-800/30">
                                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-1">Candidatos Completos</p>
                                <div className="flex items-baseline gap-2">
                                    <h4 className="text-xl font-bold text-gray-900 dark:text-white">{stats.complete || 0}</h4>
                                    <span className="text-[10px] text-blue-400 font-medium leading-none">Perfil 100%</span>
                                </div>
                            </div>
                        </div>

                        {/* Operative Rules */}
                        <div className="bg-gray-50 dark:bg-gray-900/40 p-3 rounded-2xl border border-gray-100 dark:border-gray-800/50">
                            <h4 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Shield className="w-4 h-4 text-blue-500" /> Configuración Operativa
                            </h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter italic">Ventana Horaria</p>
                                    <p className="text-xs font-black text-gray-700 dark:text-gray-300">07:00 - 23:00</p>
                                    <p className="text-[9px] text-gray-500">Hora CDMX</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter italic">Seguridad Anti-Spam</p>
                                    <p className="text-xs font-black text-gray-700 dark:text-gray-300 text-red-500/80">Máx 200 / Día</p>
                                    <p className="text-[9px] text-gray-500">Límite por cuenta</p>
                                </div>
                            </div>
                        </div>

                        {/* Protocol Timeline - Horizontal Layout */}
                        <div className="space-y-3">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Ciclo de Inactividad</h4>
                            <div className="relative pt-6 pb-1 grid grid-cols-4 gap-2">
                                {/* Horizontal Line */}
                                <div className="absolute top-[13px] left-[12.5%] right-[12.5%] h-0.5 bg-gray-100 dark:bg-gray-800"></div>

                                <div className="relative flex flex-col items-center text-center">
                                    <div className="absolute -top-[23px] w-4 h-4 rounded-full bg-blue-600 border-4 border-white dark:border-gray-800 shadow-sm z-10"></div>
                                    <p className="text-[9px] font-bold text-gray-900 dark:text-white uppercase tracking-tighter">Etapa 1: 24h</p>
                                    <p className="text-[8px] text-gray-500 dark:text-gray-400 leading-tight italic mt-1">Recordatorio (Lic. Brenda)</p>
                                </div>

                                <div className="relative flex flex-col items-center text-center">
                                    <div className="absolute -top-[23px] w-4 h-4 rounded-full bg-blue-500 border-4 border-white dark:border-gray-800 shadow-sm z-10"></div>
                                    <p className="text-[9px] font-bold text-gray-900 dark:text-white uppercase tracking-tighter">Etapa 2: 48h</p>
                                    <p className="text-[8px] text-gray-500 dark:text-gray-400 leading-tight italic mt-1">Re-confirmación interés</p>
                                </div>

                                <div className="relative flex flex-col items-center text-center">
                                    <div className="absolute -top-[23px] w-4 h-4 rounded-full bg-indigo-500 border-4 border-white dark:border-gray-800 shadow-sm z-10"></div>
                                    <p className="text-[9px] font-bold text-gray-900 dark:text-white uppercase tracking-tighter">Etapa 3: 72h</p>
                                    <p className="text-[8px] text-gray-500 dark:text-gray-400 leading-tight italic mt-1">Último aviso de vacante</p>
                                </div>

                                <div className="relative flex flex-col items-center text-center">
                                    <div className="absolute -top-[23px] w-4 h-4 rounded-full bg-slate-500 border-4 border-white dark:border-gray-800 shadow-sm z-10"></div>
                                    <p className="text-[9px] font-bold text-gray-900 dark:text-white uppercase tracking-tighter text-slate-600 dark:text-slate-400">Etapa 4: 7d</p>
                                    <p className="text-[8px] text-gray-500 dark:text-gray-400 leading-tight italic mt-1">Limpieza de base</p>
                                </div>
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
