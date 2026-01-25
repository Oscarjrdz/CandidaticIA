import React, { useState, useEffect } from 'react';
import { Bot, Save, Power, Settings as SettingsIcon, MessageSquare, Smartphone } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import { useToast } from '../hooks/useToast';

const BotIASection = ({ showToast }) => {
    // UltraMsg Credentials
    const [instanceId, setInstanceId] = useState('');
    const [token, setToken] = useState('');
    const [isActive, setIsActive] = useState(false);
    const [loading, setLoading] = useState(false);

    // AI Settings
    const [systemPrompt, setSystemPrompt] = useState('');
    const [aiModel, setAiModel] = useState('gemini-1.5-flash');

    useEffect(() => {
        // Load settings from localStorage (mock for now, later Redis)
        const savedInstance = localStorage.getItem('ultramsg_instance_id');
        const savedToken = localStorage.getItem('ultramsg_token');
        const savedPrompt = localStorage.getItem('bot_ia_prompt');
        const savedStatus = localStorage.getItem('bot_ia_active');

        if (savedInstance) setInstanceId(savedInstance);
        if (savedToken) setToken(savedToken);
        if (savedPrompt) setSystemPrompt(savedPrompt);
        if (savedStatus === 'true') setIsActive(true);
    }, []);

    const handleSave = () => {
        setLoading(true);

        // Save to LocalStorage
        localStorage.setItem('ultramsg_instance_id', instanceId);
        localStorage.setItem('ultramsg_token', token);
        localStorage.setItem('bot_ia_prompt', systemPrompt);
        localStorage.setItem('bot_ia_active', isActive);

        // TODO: Save to Redis via API

        setTimeout(() => {
            setLoading(false);
            showToast('Configuración del Bot IA guardada', 'success');
        }, 800);
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
                {/* UltraMsg Configuration */}
                <Card title="Conexión WhatsApp (UltraMsg)" icon={Smartphone}>
                    <div className="space-y-4">
                        <Input
                            label="Instance ID"
                            placeholder="instance12345"
                            value={instanceId}
                            onChange={(e) => setInstanceId(e.target.value)}
                            helperText="Tu ID de instancia de UltraMsg"
                        />
                        <Input
                            label="Token"
                            type="password"
                            placeholder="token123..."
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            helperText="Tu token de seguridad de UltraMsg"
                        />
                        <div className="pt-2">
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                Webhook URL para UltraMsg:
                            </p>
                            <code className="block w-full p-2 bg-gray-100 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-xs font-mono break-all text-gray-700 dark:text-gray-300">
                                {window.location.origin}/api/webhook/ultramsg
                            </code>
                        </div>
                    </div>
                </Card>

                {/* AI Configuration */}
                <Card title="Cerebro del Asistente" icon={SettingsIcon}>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Prompt del Sistema
                            </label>
                            <textarea
                                className="w-full h-40 p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                                placeholder="Eres un asistente útil de RRHH..."
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                            />
                            <p className="text-xs text-gray-500 mt-1">Defina la personalidad y reglas del bot.</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Modelo
                            </label>
                            <select
                                value={aiModel}
                                onChange={(e) => setAiModel(e.target.value)}
                                className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-sm"
                            >
                                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Rápido)</option>
                                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Potente)</option>
                            </select>
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
