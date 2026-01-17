import React, { useState, useEffect, useRef } from 'react';
import { Users, Search, Trash2, RefreshCw, User, MessageCircle, Settings, Clock, FileText, Loader2, CheckCircle } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import ChatWindow from './ChatWindow';
import ChatHistoryModal from './ChatHistoryModal';
import { getCandidates, deleteCandidate, CandidatesSubscription } from '../services/candidatesService';
import { getExportSettings, saveExportSettings, getChatFileId, saveChatFileId, deleteChatFileId } from '../utils/storage';
import { exportChatToFile, deleteOldChatFile, generateChatHistoryText } from '../services/chatExportService';

/**
 * Sección de Candidatos con Auto-Exportación
 */
const CandidatesSection = ({ showToast }) => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [lastUpdate, setLastUpdate] = useState(null);

    // Estado para el chat
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [credentials, setCredentials] = useState(null);

    // Estado para historial modal
    const [historyModalOpen, setHistoryModalOpen] = useState(false);
    const [historyModalCandidate, setHistoryModalCandidate] = useState(null);
    const [historyModalContent, setHistoryModalContent] = useState('');

    // Configuración de Exportación
    const [showSettings, setShowSettings] = useState(false);
    const [exportTimer, setExportTimer] = useState(0); // Minutos. 0 = Desactivado.
    const [exportingMap, setExportingMap] = useState({}); // { whatsapp: 'uploading'|'uploaded'|'error' }
    const [fileStatusMap, setFileStatusMap] = useState({}); // { whatsapp: fileId }

    // Timers para cada candidato (se reinician con mensajes salientes)
    const exportTimersRef = useRef({});
    const [exportSchedules, setExportSchedules] = useState({}); // { whatsapp: { scheduledTime: timestamp, lastOutgoing: timestamp } }
    const [currentTime, setCurrentTime] = useState(Date.now()); // For countdown updates

    useEffect(() => {
        // Cargar credenciales
        const savedCreds = localStorage.getItem('builderbot_credentials');
        if (savedCreds) setCredentials(JSON.parse(savedCreds));

        // Cargar timer guardado
        const savedTimer = getExportSettings();
        setExportTimer(savedTimer);

        // Cargar candidatos
        loadCandidates();

        // Polling de candidatos
        const subscription = new CandidatesSubscription((newCandidates) => {
            setCandidates(newCandidates);
            setLastUpdate(new Date());
        }, 2000);

        subscription.start();

        return () => subscription.stop();
    }, []);

    // Update current time every second for countdown display
    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Auto-export logic - triggers when candidates change and timer is configured
    useEffect(() => {
        if (!exportTimer || exportTimer <= 0 || !credentials || candidates.length === 0) return;

        candidates.forEach(candidate => {
            if (!candidate.messages || candidate.messages.length === 0) return;

            // Find last outgoing message
            const outgoingMessages = candidate.messages.filter(msg => !msg.incoming);
            if (outgoingMessages.length === 0) return;

            const lastOutgoing = outgoingMessages[outgoingMessages.length - 1];
            const lastOutgoingTime = new Date(lastOutgoing.timestamp).getTime();

            // Check if this is a NEW outgoing message (different from what we tracked)
            const currentSchedule = exportSchedules[candidate.whatsapp];
            const isNewMessage = !currentSchedule || currentSchedule.lastOutgoing !== lastOutgoingTime;

            if (isNewMessage) {
                const scheduledTime = Date.now() + (exportTimer * 60 * 1000);
                console.log(`[Auto-Export] New outgoing message for ${candidate.whatsapp}, resetting timer`);
                console.log(`[Auto-Export] Timer will fire in ${exportTimer} minutes at ${new Date(scheduledTime).toLocaleTimeString('es-MX')}`);

                // Clear existing timer
                if (exportTimersRef.current[candidate.whatsapp]) {
                    clearTimeout(exportTimersRef.current[candidate.whatsapp]);
                }

                // Calculate scheduled export time
                const timerMs = exportTimer * 60 * 1000;

                // Update schedule tracking
                setExportSchedules(prev => ({
                    ...prev,
                    [candidate.whatsapp]: {
                        lastOutgoing: lastOutgoingTime,
                        scheduledTime: scheduledTime
                    }
                }));

                // Set new timer
                exportTimersRef.current[candidate.whatsapp] = setTimeout(() => {
                    console.log(`[Auto-Export] ⏰ Timer fired for ${candidate.whatsapp}`);
                    console.log(`[Auto-Export] Starting auto-export process...`);
                    handleAutoExport(candidate, credentials);
                }, timerMs);
            }
        });

        // Cleanup timers on unmount
        return () => {
            Object.values(exportTimersRef.current).forEach(timer => clearTimeout(timer));
            exportTimersRef.current = {};
        };
    }, [candidates, exportTimer, credentials]);

    const handleAutoExport = async (candidate, creds) => {
        if (!creds) return;

        setExportingMap(prev => ({ ...prev, [candidate.whatsapp]: 'uploading' }));

        try {
            // Delete old file if exists
            const oldFileId = getChatFileId(candidate.whatsapp);
            if (oldFileId) {
                await deleteOldChatFile(oldFileId, creds);
                deleteChatFileId(candidate.whatsapp);
            }

            // Export and upload new file
            const result = await exportChatToFile(candidate, creds);

            if (result.success) {
                saveChatFileId(candidate.whatsapp, result.fileId);
                setFileStatusMap(prev => ({ ...prev, [candidate.whatsapp]: result.fileId }));
                setExportingMap(prev => ({ ...prev, [candidate.whatsapp]: 'uploaded' }));
            } else {
                setExportingMap(prev => ({ ...prev, [candidate.whatsapp]: 'error' }));
            }
        } catch (error) {
            console.error('Auto-export error:', error);
            setExportingMap(prev => ({ ...prev, [candidate.whatsapp]: 'error' }));
        }
    };

    const handleViewHistory = (candidate) => {
        const content = generateChatHistoryText(candidate);
        setHistoryModalCandidate(candidate);
        setHistoryModalContent(content);
        setHistoryModalOpen(true);
    };

    const handleSaveSettings = () => {
        saveExportSettings(exportTimer);
        setShowSettings(false);
        showToast(`Timer configurado a ${exportTimer} minutos`, 'success');
    };

    const loadCandidates = async () => {
        setLoading(true);
        const result = await getCandidates(50, 0, search);

        if (result.success) {
            setCandidates(result.candidates);
            setLastUpdate(new Date());
        } else {
            showToast('Error cargando candidatos', 'error');
        }

        setLoading(false);
    };

    const handleSearch = (e) => {
        setSearch(e.target.value);
    };

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        loadCandidates();
    };

    const handleDelete = async (id, nombre) => {
        if (!window.confirm(`¿Estás seguro de eliminar a "${nombre}" permanentemente?\n\nEsta acción no se puede deshacer.`)) {
            return;
        }

        const result = await deleteCandidate(id);

        if (result.success) {
            showToast('Candidato eliminado correctamente', 'success');
            loadCandidates();
        } else {
            showToast(`Error: ${result.error}`, 'error');
        }
    };

    const handleOpenChat = (candidate) => {
        if (!credentials) {
            showToast('Configura tus credenciales de BuilderBot primero para usar el chat', 'warning');
            return;
        }
        setSelectedCandidate(candidate);
    };

    const formatPhone = (phone) => {
        // Formatear número de teléfono
        if (phone.startsWith('52')) {
            return `+${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;
        }
        return phone;
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Ahora';
        if (minutes < 60) return `Hace ${minutes}m`;
        if (hours < 24) return `Hace ${hours}h`;
        if (days < 7) return `Hace ${days}d`;
        return date.toLocaleDateString();
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);

        // Formato: "17 Ene 2026, 16:30"
        const dateStr = date.toLocaleDateString('es-MX', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });

        const timeStr = date.toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        return `${dateStr}, ${timeStr}`;
    };

    return (
        <div className="space-y-6">
            {/* Header con búsqueda */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                            <Users className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                Candidatos
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {candidates.length} candidato{candidates.length !== 1 ? 's' : ''} registrado{candidates.length !== 1 ? 's' : ''}
                            </p>
                        </div>
                    </div>
                    <Button
                        onClick={loadCandidates}
                        icon={RefreshCw}
                        variant="outline"
                        size="sm"
                        disabled={loading}
                    >
                        Refrescar
                    </Button>
                </div>

                {/* Timer Settings - Always Visible */}
                <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 mb-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <Button
                                variant="outline"
                                size="sm"
                                icon={Settings}
                                className={exportTimer > 0 ? "text-green-600 border-green-200 bg-green-50" : ""}
                                disabled
                            >
                                {exportTimer > 0 ? `${exportTimer}m` : 'Off'}
                            </Button>
                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Auto-Exportar Historial (Minutos de inactividad)
                                </label>
                                <p className="text-xs text-gray-400">
                                    0 = Desactivado. Se creará un .txt en Archivos si el chat está inactivo.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            <input
                                type="number"
                                min="0"
                                max="1440"
                                value={exportTimer}
                                onChange={(e) => setExportTimer(parseInt(e.target.value) || 0)}
                                className="w-20 px-2 py-1 border rounded text-center"
                            />
                            <Button size="sm" onClick={handleSaveSettings}>Guardar</Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Búsqueda */}
            <form onSubmit={handleSearchSubmit} className="flex items-center space-x-2">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={handleSearch}
                        placeholder="Buscar por nombre o número..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>
                <Button type="submit" size="sm">
                    Buscar
                </Button>
            </form>


            {/* Tabla de candidatos */}
            <Card>
                <div className="overflow-x-auto">
                    {candidates.length === 0 ? (
                        <div className="text-center py-12">
                            <User className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                            <p className="text-gray-500 dark:text-gray-400">
                                {search ? 'No se encontraron candidatos' : 'No hay candidatos registrados aún'}
                            </p>
                            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                                Los candidatos se agregarán automáticamente cuando recibas mensajes de WhatsApp
                            </p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-gray-700">
                                    <th className="text-left py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Foto</th>
                                    <th className="text-left py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Nombre</th>
                                    <th className="text-left py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">WhatsApp</th>
                                    <th className="text-left py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Último Mensaje</th>
                                    <th className="text-center py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Timer</th>
                                    <th className="text-center py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Historial</th>
                                    <th className="text-center py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Chat</th>
                                    <th className="text-center py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {candidates.map((candidate) => (
                                    <tr
                                        key={candidate.id}
                                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 smooth-transition relative"
                                    >
                                        {exportingMap[candidate.id] && (
                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 animate-pulse rounded-r-full" title="Exportando historial..."></div>
                                        )}
                                        <td className="py-4 px-4">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold">
                                                {candidate.foto ? (
                                                    <img
                                                        src={candidate.foto}
                                                        alt={candidate.nombre}
                                                        className="w-10 h-10 rounded-full object-cover"
                                                    />
                                                ) : (
                                                    <span>{candidate.nombre.charAt(0).toUpperCase()}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-4 px-4">
                                            <div className="font-medium text-gray-900 dark:text-white">
                                                {candidate.nombre}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                Desde {formatDate(candidate.primerContacto)}
                                            </div>
                                        </td>
                                        <td className="py-4 px-4">
                                            <div className="text-sm text-gray-700 dark:text-gray-300 font-mono">
                                                {formatPhone(candidate.whatsapp)}
                                            </div>
                                        </td>
                                        <td className="py-4 px-4">
                                            <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                                                {formatDateTime(candidate.ultimoMensaje)}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                                {formatDate(candidate.ultimoMensaje)}
                                            </div>
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            {(() => {
                                                // Si no hay timer configurado, mostrar "-"
                                                if (!exportTimer || exportTimer <= 0) {
                                                    return <span className="text-xs text-gray-400">-</span>;
                                                }

                                                // Si no hay último mensaje, no podemos calcular
                                                if (!candidate.ultimoMensaje) {
                                                    return <span className="text-xs text-gray-400">-</span>;
                                                }

                                                // Calcular hora objetivo (último mensaje + minutos configurados)
                                                const lastMessageTime = new Date(candidate.ultimoMensaje).getTime();
                                                const targetTime = lastMessageTime + (exportTimer * 60 * 1000);
                                                const now = currentTime;

                                                // Determinar si ya se cumplió el tiempo
                                                const isReady = now >= targetTime;

                                                return (
                                                    <div className="flex items-center justify-center">
                                                        <div className={`w-4 h-4 rounded-full ${isReady
                                                                ? 'bg-green-500 dark:bg-green-400'
                                                                : 'bg-red-500 dark:bg-red-400'
                                                            }`} title={
                                                                isReady
                                                                    ? 'Tiempo de inactividad cumplido'
                                                                    : 'Esperando tiempo de inactividad'
                                                            } />
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            {exportingMap[candidate.whatsapp] === 'uploading' ? (
                                                <Loader2 className="w-5 h-5 text-blue-500 animate-spin mx-auto" title="Subiendo historial..." />
                                            ) : exportingMap[candidate.whatsapp] === 'uploaded' || getChatFileId(candidate.whatsapp) ? (
                                                <button
                                                    onClick={() => handleViewHistory(candidate)}
                                                    className="p-2 hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg smooth-transition"
                                                    title="Ver historial"
                                                >
                                                    <FileText className="w-5 h-5" />
                                                </button>
                                            ) : exportingMap[candidate.whatsapp] === 'error' ? (
                                                <div className="text-red-500 text-xs" title="Error al exportar">
                                                    Error
                                                </div>
                                            ) : (
                                                <div className="text-gray-400 text-xs">
                                                    -
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <button
                                                onClick={() => handleOpenChat(candidate)}
                                                className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 rounded-lg smooth-transition group relative"
                                                title="Abrir chat"
                                            >
                                                <MessageCircle className="w-5 h-5" />
                                                <span className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse border border-white dark:border-gray-800"></span>
                                            </button>
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <button
                                                onClick={() => handleDelete(candidate.id, candidate.nombre)}
                                                className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg smooth-transition group"
                                                title="Eliminar permanentemente"
                                            >
                                                <Trash2 className="w-4 h-4 text-gray-400 group-hover:text-red-600 dark:group-hover:text-red-400" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </Card>

            {/* Ventana Flotante de Chat */}
            <ChatWindow
                isOpen={!!selectedCandidate}
                onClose={() => setSelectedCandidate(null)}
                candidate={selectedCandidate}
                credentials={credentials}
            />

            {/* Modal de Historial */}
            <ChatHistoryModal
                isOpen={historyModalOpen}
                onClose={() => setHistoryModalOpen(false)}
                candidate={historyModalCandidate}
                chatContent={historyModalContent}
            />
        </div >
    );
};

export default CandidatesSection;
