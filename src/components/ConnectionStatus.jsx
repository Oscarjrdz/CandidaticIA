import React, { useState, useEffect } from 'react';
import { Activity, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { verifyConnection } from '../services/builderbot';
import { saveConnectionHistory, getConnectionHistory } from '../utils/storage';

/**
 * Sección de Verificación de Conexión
 */
const ConnectionStatus = ({ botId, apiKey, showToast }) => {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(false);
    const [lastCheck, setLastCheck] = useState(null);
    const [webhookData, setWebhookData] = useState(null);
    const [history, setHistory] = useState([]);

    useEffect(() => {
        setHistory(getConnectionHistory());
    }, []);

    const handleVerify = async () => {
        if (!botId || !apiKey) {
            showToast('Por favor, configura tus credenciales primero', 'error');
            return;
        }

        setLoading(true);

        const result = await verifyConnection(botId, apiKey);

        setLoading(false);
        setStatus(result);
        setLastCheck(new Date());

        if (result.success) {
            setWebhookData(result.data);
            showToast('Conexión verificada correctamente', 'success');

            // Guardar en historial
            const historyEntry = {
                timestamp: new Date().toISOString(),
                status: 'success',
                httpCode: result.status,
            };
            saveConnectionHistory(historyEntry);
            setHistory([historyEntry, ...history].slice(0, 5));
        } else {
            setWebhookData(null);
            showToast(result.error, 'error');

            // Guardar en historial
            const historyEntry = {
                timestamp: new Date().toISOString(),
                status: 'error',
                httpCode: result.status,
                error: result.error,
            };
            saveConnectionHistory(historyEntry);
            setHistory([historyEntry, ...history].slice(0, 5));
        }
    };

    const formatTimestamp = (date) => {
        if (!date) return 'Nunca';

        const now = new Date();
        const diff = Math.floor((now - date) / 1000); // segundos

        if (diff < 60) return 'Hace unos segundos';
        if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
        if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} horas`;
        return date.toLocaleDateString('es-ES', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <Card
            title="Estado de Conexión"
            icon={Activity}
            actions={
                <Button
                    onClick={handleVerify}
                    loading={loading}
                    icon={RefreshCw}
                    size="sm"
                    variant="outline"
                >
                    Verificar Ahora
                </Button>
            }
        >
            <div className="space-y-4">
                {/* Estado actual */}
                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <div className="flex items-center space-x-3">
                        {status?.success ? (
                            <CheckCircle className="w-8 h-8 text-success" />
                        ) : status === null ? (
                            <Activity className="w-8 h-8 text-gray-400" />
                        ) : (
                            <XCircle className="w-8 h-8 text-error" />
                        )}
                        <div>
                            <p className="font-semibold text-gray-900 dark:text-white">
                                {status?.success ? '🟢 Conectado' : status === null ? '⚪ Sin verificar' : '🔴 Desconectado'}
                            </p>
                            <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center">
                                <Clock className="w-3 h-3 mr-1" />
                                {formatTimestamp(lastCheck)}
                            </p>
                        </div>
                    </div>

                    {status && (
                        <div className="text-right">
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Código HTTP
                            </p>
                            <p className={`text-lg font-bold ${status.success ? 'text-success' : 'text-error'}`}>
                                {status.status}
                            </p>
                        </div>
                    )}
                </div>

                {/* Datos del webhook actual */}
                {webhookData && (
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">
                            📄 Configuración Actual del Webhook
                        </h3>
                        <pre className="text-xs text-blue-800 dark:text-blue-200 overflow-x-auto">
                            {JSON.stringify(webhookData, null, 2)}
                        </pre>
                    </div>
                )}

                {/* Historial de verificaciones */}
                {history.length > 0 && (
                    <div>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            📊 Historial de Verificaciones
                        </h3>
                        <div className="space-y-2">
                            {history.map((entry, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900 rounded text-sm"
                                >
                                    <div className="flex items-center space-x-2">
                                        {entry.status === 'success' ? (
                                            <CheckCircle className="w-4 h-4 text-success" />
                                        ) : (
                                            <XCircle className="w-4 h-4 text-error" />
                                        )}
                                        <span className="text-gray-600 dark:text-gray-400">
                                            {new Date(entry.timestamp).toLocaleString('es-ES')}
                                        </span>
                                    </div>
                                    <span className={`font-medium ${entry.status === 'success' ? 'text-success' : 'text-error'}`}>
                                        HTTP {entry.httpCode}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
};

export default ConnectionStatus;
