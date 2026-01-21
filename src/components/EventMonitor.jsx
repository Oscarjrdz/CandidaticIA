import React, { useState, useEffect } from 'react';
import { Radio, Eye, Code, RefreshCw } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { saveEventSettings, getEventSettings } from '../utils/storage';
import { getEvents, EventSubscription, sendTestWebhook } from '../services/webhookService';

/**
 * Eventos disponibles en BuilderBot
 */
const AVAILABLE_EVENTS = [
    {
        name: 'status.ready',
        description: 'Bot en línea y listo',
        emoji: '🟢',
        status: 'Activo',
        payload: {
            event: 'status.ready',
            timestamp: '2024-01-16T12:00:00Z',
            botId: 'bc080642-8cc1-4de8-9771-73c16fe5c5da',
            status: 'ready'
        }
    },
    {
        name: 'status.require_action',
        description: 'QR listo para escanear',
        emoji: '🟡',
        status: 'Esperando',
        payload: {
            event: 'status.require_action',
            timestamp: '2024-01-16T12:00:00Z',
            botId: 'bc080642-8cc1-4de8-9771-73c16fe5c5da',
            action: 'scan_qr',
            qrCode: 'data:image/png;base64,...'
        }
    },
    {
        name: 'status.disconnect',
        description: 'Bot desconectado',
        emoji: '🔴',
        status: 'Inactivo',
        payload: {
            event: 'status.disconnect',
            timestamp: '2024-01-16T12:00:00Z',
            botId: 'bc080642-8cc1-4de8-9771-73c16fe5c5da',
            reason: 'logout'
        }
    },
    {
        name: 'message.incoming',
        description: 'Mensaje recibido',
        emoji: '📨',
        status: 'Activo',
        payload: {
            event: 'message.incoming',
            timestamp: '2024-01-16T12:00:00Z',
            botId: 'bc080642-8cc1-4de8-9771-73c16fe5c5da',
            from: '521234567890',
            message: {
                type: 'text',
                content: 'Hola, ¿cómo estás?'
            }
        }
    },
    {
        name: 'message.calling',
        description: 'Llamada recibida',
        emoji: '📞',
        status: 'Activo',
        payload: {
            event: 'message.calling',
            timestamp: '2024-01-16T12:00:00Z',
            botId: 'bc080642-8cc1-4de8-9771-73c16fe5c5da',
            from: '521234567890',
            callType: 'voice'
        }
    },
    {
        name: 'message.outgoing',
        description: 'Mensaje enviado',
        emoji: '📤',
        status: 'Activo',
        payload: {
            event: 'message.outgoing',
            timestamp: '2024-01-16T12:00:00Z',
            botId: 'bc080642-8cc1-4de8-9771-73c16fe5c5da',
            to: '521234567890',
            message: {
                type: 'text',
                content: 'Mensaje de prueba'
            }
        }
    }
];

/**
 * Sección de Monitor de Eventos
 */
const EventMonitor = ({ showToast }) => {
    const [enabledEvents, setEnabledEvents] = useState({});
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [realEvents, setRealEvents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showRealEvents, setShowRealEvents] = useState(true);
    const [lastUpdate, setLastUpdate] = useState(null);

    const loadRealEvents = async () => {
        setLoading(true);
        const result = await getEvents(50, 0);

        if (result.success) {
            setRealEvents(result.events);
            setLastUpdate(new Date());
            if (result.events.length > 0) {
                showToast(`${result.events.length} eventos cargados`, 'success');
            }
        } else {
            showToast('Error cargando eventos reales', 'error');
        }

        setLoading(false);
    };

    useEffect(() => {
        const checkSaved = () => {
            const saved = getEventSettings();
            if (Object.keys(saved).length > 0) {
                setEnabledEvents(saved);
            } else {
                const defaultSettings = {};
                AVAILABLE_EVENTS.forEach(event => {
                    defaultSettings[event.name] = true;
                });
                setEnabledEvents(defaultSettings);
            }
        };
        checkSaved();
        loadRealEvents();

        // Polling cada 5 segundos
        const subscription = new EventSubscription((events) => {
            setRealEvents(events);
            setLastUpdate(new Date());
        }, 5000);

        subscription.start();

        return () => {
            subscription.stop();
        };
    }, []);

    const toggleEvent = (eventName) => {
        const newSettings = {
            ...enabledEvents,
            [eventName]: !enabledEvents[eventName]
        };
        setEnabledEvents(newSettings);
        saveEventSettings(newSettings);

        showToast(
            `Evento ${eventName} ${newSettings[eventName] ? 'activado' : 'desactivado'}`,
            'info'
        );
    };

    const handleTestWebhook = async (event) => {
        showToast(`Enviando evento de prueba: ${event.name}`, 'info');

        const result = await sendTestWebhook(event.name);

        if (result.success) {
            showToast('Evento de prueba enviado correctamente', 'success');
            // Recargar eventos después de 1 segundo
            setTimeout(loadRealEvents, 1000);
        } else {
            showToast(`Error: ${result.error}`, 'error');
        }
    };

    return (
        <Card
            title="Monitor de Eventos"
            icon={Radio}
        >
            <div className="space-y-4">
                {/* Controles */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center space-x-4">
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showRealEvents}
                                onChange={(e) => setShowRealEvents(e.target.checked)}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Mostrar eventos reales ({realEvents.length})
                            </span>
                        </label>
                        {lastUpdate && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                Última actualización: {lastUpdate.toLocaleTimeString()}
                            </span>
                        )}
                    </div>
                    <Button
                        onClick={loadRealEvents}
                        icon={RefreshCw}
                        variant="outline"
                        size="sm"
                        disabled={loading}
                    >
                        {loading ? 'Cargando...' : 'Refrescar'}
                    </Button>
                </div>

                {/* Mostrar eventos reales si están disponibles y activados */}
                {showRealEvents && realEvents.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                            📡 Eventos Recibidos en Tiempo Real
                        </h3>
                        <div className="max-h-96 overflow-y-auto space-y-2">
                            {realEvents.map((event) => (
                                <div
                                    key={event.id}
                                    className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <code className="text-xs bg-blue-100 dark:bg-blue-800 px-2 py-1 rounded font-semibold">
                                            {event.event}
                                        </code>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                            {new Date(event.receivedAt).toLocaleString()}
                                        </span>
                                    </div>
                                    <pre className="text-xs text-gray-700 dark:text-gray-300 overflow-x-auto bg-white dark:bg-gray-900 p-2 rounded">
                                        {JSON.stringify(event, null, 2)}
                                    </pre>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Mensaje si no hay eventos reales */}
                {showRealEvents && realEvents.length === 0 && (
                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                        <p className="text-sm text-yellow-800 dark:text-yellow-400">
                            ℹ️ No hay eventos reales aún. Configura el webhook en BuilderBot o envía un evento de prueba usando los botones de abajo.
                        </p>
                    </div>
                )}

                {/* Tabla de eventos de ejemplo */}
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        📋 Eventos Disponibles (Ejemplos para Testing)
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-gray-700">
                                    <th className="text-left py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">Evento</th>
                                    <th className="text-left py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">Descripción</th>
                                    <th className="text-center py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">Estado</th>
                                    <th className="text-center py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">Activo</th>
                                    <th className="text-center py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {AVAILABLE_EVENTS.map((event) => (
                                    <tr
                                        key={event.name}
                                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 smooth-transition"
                                    >
                                        <td className="py-3 px-2">
                                            <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                                                {event.name}
                                            </code>
                                        </td>
                                        <td className="py-3 px-2 text-gray-600 dark:text-gray-400">
                                            {event.emoji} {event.description}
                                        </td>
                                        <td className="py-3 px-2 text-center">
                                            <span className={`text-xs font-medium px-2 py-1 rounded ${event.status === 'Activo' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                                event.status === 'Esperando' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                                }`}>
                                                {event.status}
                                            </span>
                                        </td>
                                        <td className="py-3 px-2 text-center">
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={enabledEvents[event.name] || false}
                                                    onChange={() => toggleEvent(event.name)}
                                                    className="sr-only peer"
                                                />
                                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                                            </label>
                                        </td>
                                        <td className="py-3 px-2 text-center">
                                            <div className="flex items-center justify-center space-x-1">
                                                <button
                                                    onClick={() => setSelectedEvent(selectedEvent?.name === event.name ? null : event)}
                                                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded smooth-transition"
                                                    title="Ver payload"
                                                >
                                                    <Eye className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                                                </button>
                                                <button
                                                    onClick={() => handleTestWebhook(event)}
                                                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded smooth-transition"
                                                    title="Probar webhook"
                                                >
                                                    <Code className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Vista previa del payload */}
                    {selectedEvent && (
                        <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800 animate-fade-in">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-300">
                                    📋 Payload de {selectedEvent.name}
                                </h3>
                                <Button
                                    onClick={() => {
                                        navigator.clipboard.writeText(JSON.stringify(selectedEvent.payload, null, 2));
                                        showToast('Payload copiado al portapapeles', 'success');
                                    }}
                                    size="sm"
                                    variant="outline"
                                >
                                    Copiar
                                </Button>
                            </div>
                            <pre className="text-xs text-purple-800 dark:text-purple-200 overflow-x-auto bg-white dark:bg-gray-900 p-3 rounded">
                                {JSON.stringify(selectedEvent.payload, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
};

export default EventMonitor;
