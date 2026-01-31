import React, { useState, useEffect } from 'react';
import { Bot, Save, Power, Settings as SettingsIcon, MessageSquare, Smartphone, Clock, Shield } from 'lucide-react';
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
    const [stats, setStats] = useState({ today: 0, totalSent: 0, totalRecovered: 0 });

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const res = await fetch('/api/bot-ia/settings');
                if (res.ok) {
                    const data = await res.json();
                    setSystemPrompt(data.systemPrompt || '');
                    setIsActive(data.isActive);
                    if (data.stats) setStats(data.stats);
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

                {/* Follow-up Rules Reference */}
                <Card title="Impacto y Directrices Brenda" icon={Clock}>
                    <div className="space-y-6">
                        {/* Mini Dashboard Impacto */}
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
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
                            <div className="bg-gradient-to-br from-orange-500/10 to-amber-500/5 dark:from-orange-500/20 dark:to-amber-500/10 p-4 rounded-2xl border border-orange-100/50 dark:border-orange-800/30 col-span-2 lg:col-span-1">
                                <p className="text-[10px] font-black uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">Candidatos Pendientes</p>
                                <div className="flex items-baseline gap-2">
                                    <h4 className="text-xl font-bold text-gray-900 dark:text-white">{stats.pending || 0}</h4>
                                    <span className="text-[10px] text-orange-400 font-medium leading-none">Por Procesar</span>
                                </div>
                            </div>
                        </div>

                        {/* Operative Rules */}
                        <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-2xl border border-gray-100 dark:border-gray-800/50">
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
                                    <p className="text-xs font-black text-gray-700 dark:text-gray-300 text-red-500/80">Máx 100 / Día</p>
                                    <p className="text-[9px] text-gray-500">Límite por cuenta</p>
                                </div>
                            </div>
                        </div>

                        {/* Protocol Timeline */}
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Ciclo de Inactividad</h4>
                            <div className="relative pl-6 space-y-5">
                                {/* Vertical Line */}
                                <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-gray-100 dark:bg-gray-800"></div>

                                <div className="relative">
                                    <div className="absolute -left-[19px] top-1 w-4 h-4 rounded-full bg-blue-600 border-4 border-white dark:border-gray-800 shadow-sm"></div>
                                    <p className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-tighter">Etapa 1: 24 Horas</p>
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed italic">Recordatorio humano y servicial (Lic. Brenda).</p>
                                </div>

                                <div className="relative">
                                    <div className="absolute -left-[19px] top-1 w-4 h-4 rounded-full bg-blue-500 border-4 border-white dark:border-gray-800 shadow-sm"></div>
                                    <p className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-tighter">Etapa 2: 48 Horas</p>
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed italic">Re-confirmación de interés y vacantes.</p>
                                </div>

                                <div className="relative">
                                    <div className="absolute -left-[19px] top-1 w-4 h-4 rounded-full bg-blue-400 border-4 border-white dark:border-gray-800 shadow-sm"></div>
                                    <p className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-tighter">Etapa 3: 72 Horas</p>
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed italic">Aviso de perfil incompleto (Última llamada).</p>
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
