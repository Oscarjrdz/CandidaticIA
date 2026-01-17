import React, { useState, useEffect } from 'react';
import { Link, Copy, Check, RefreshCw } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { getWebhookConfig } from '../services/webhookService';

/**
 * Sección de Configuración de Webhooks
 * Muestra la URL del webhook que el usuario debe configurar en BuilderBot
 */
const WebhookConfig = ({ botId, apiKey, showToast }) => {
    const [copied, setCopied] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState('Cargando...');
    const [loading, setLoading] = useState(true);
    const [environment, setEnvironment] = useState('development');

    useEffect(() => {
        loadWebhookConfig();
    }, []);

    const loadWebhookConfig = async () => {
        setLoading(true);
        const result = await getWebhookConfig();

        if (result.success) {
            setWebhookUrl(result.data.webhookUrl);
            setEnvironment(result.data.environment);
        } else {
            setWebhookUrl('Error cargando URL');
            showToast('Error obteniendo configuración del webhook', 'error');
        }

        setLoading(false);
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(webhookUrl);
            setCopied(true);
            showToast('URL copiada al portapapeles', 'success');
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            showToast('Error al copiar URL', 'error');
        }
    };

    return (
        <Card
            title="Configuración de Webhook"
            icon={Link}
        >
            <div className="space-y-4">
                {/* Instrucciones */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">
                        📋 Instrucciones
                    </h4>
                    <p className="text-sm text-blue-800 dark:text-blue-400">
                        Copia la siguiente URL y configúrala <strong>dentro de BuilderBot</strong> para recibir eventos de tu bot.
                    </p>
                </div>

                {/* Webhook URL Display */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Tu Webhook URL
                        </label>
                        <Button
                            onClick={loadWebhookConfig}
                            icon={RefreshCw}
                            variant="outline"
                            size="sm"
                            disabled={loading}
                        >
                            {loading ? 'Cargando...' : 'Refrescar'}
                        </Button>
                    </div>
                    <div className="flex items-center space-x-2">
                        <div className="flex-1 p-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg font-mono text-sm text-gray-800 dark:text-gray-200 break-all">
                            {webhookUrl}
                        </div>
                        <Button
                            onClick={handleCopy}
                            icon={copied ? Check : Copy}
                            variant={copied ? 'success' : 'primary'}
                            size="sm"
                            disabled={loading || webhookUrl === 'Cargando...' || webhookUrl === 'Error cargando URL'}
                        >
                            {copied ? 'Copiado' : 'Copiar'}
                        </Button>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Esta es la URL que BuilderBot usará para enviar eventos a tu aplicación
                        </p>
                        {environment && (
                            <span className={`text-xs px-2 py-1 rounded ${environment === 'production'
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                }`}>
                                {environment}
                            </span>
                        )}
                    </div>
                </div>

                {/* Pasos para configurar en BuilderBot */}
                <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        🔧 Cómo configurar en BuilderBot
                    </h4>
                    <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside">
                        <li>Inicia sesión en tu panel de BuilderBot</li>
                        <li>Ve a la sección de configuración de tu bot</li>
                        <li>Busca la opción "Webhook URL" o "URL de eventos"</li>
                        <li>Pega la URL copiada arriba</li>
                        <li>Guarda los cambios en BuilderBot</li>
                    </ol>
                </div>

                {/* Estado de conexión */}
                {botId && apiKey ? (
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 flex items-center space-x-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <p className="text-sm text-green-800 dark:text-green-400">
                            Credenciales configuradas. Listo para recibir eventos.
                        </p>
                    </div>
                ) : (
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800 flex items-center space-x-2">
                        <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                        <p className="text-sm text-yellow-800 dark:text-yellow-400">
                            Configura tus credenciales primero para activar el webhook
                        </p>
                    </div>
                )}
            </div>
        </Card>
    );
};

export default WebhookConfig;
