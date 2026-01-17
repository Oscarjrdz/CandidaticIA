import { Users, Search, Trash2, RefreshCw, User, MessageCircle, Settings, Clock } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import ChatWindow from './ChatWindow';
import { getCandidates, deleteCandidate, CandidatesSubscription } from '../services/candidatesService';
import { getChatHistory, uploadFile, deleteFile, getFiles } from '../services/assistantService';
import { saveExportSettings, getExportSettings, saveExportStatus, getExportStatus } from '../utils/storage';

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

    // Configuración de Exportación
    const [showSettings, setShowSettings] = useState(false);
    const [exportTimer, setExportTimer] = useState(0); // Minutos. 0 = Desactivado.
    const [exportingMap, setExportingMap] = useState({}); // { candidateId: true/false }

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

    // --- AUTO-EXPORT LOGIC ---
    useEffect(() => {
        if (!exportTimer || exportTimer <= 0 || !credentials || candidates.length === 0) return;

        const checkAndExport = async () => {
            const exportStatus = getExportStatus();
            const now = new Date();

            for (const candidate of candidates) {
                if (!candidate.ultimoMensaje) continue;

                const lastMsgTime = new Date(candidate.ultimoMensaje);
                const diffMinutes = (now - lastMsgTime) / 60000;

                // Si ha pasado el tiempo configurado desde el último mensaje
                if (diffMinutes >= exportTimer) {

                    // Chequear si ya se exportó ESTADO actual de este candidato
                    // Usamos timestamp del ultimo mensaje como "hash" de version
                    const lastExportStats = exportStatus[candidate.id];

                    // Si ya exportamos este "estado" exacto (mismo timestamp de último mensaje), saltamos
                    if (lastExportStats && lastExportStats.lastMessageTime === candidate.ultimoMensaje) {
                        continue;
                    }

                    // Iniciamos exportación
                    // console.log(`Triggering export for ${candidate.nombre} (Idle: ${diffMinutes.toFixed(1)}m)`);

                    setExportingMap(prev => ({ ...prev, [candidate.id]: true }));

                    try {
                        // 1. Obtener chat completo
                        const hist = await getChatHistory(candidate.id);
                        if (!hist.success) throw new Error('Error fetching chat');

                        // 2. Formatear a TXT
                        // Formato: [Fecha] Autor: Mensaje
                        const content = hist.messages.map(msg =>
                            `[${new Date(msg.timestamp).toLocaleString()}] ${msg.from === 'me' ? 'Bot' : 'Candidato'}: ${msg.content}`
                        ).join('\n');

                        const blob = new Blob([content], { type: 'text/plain' });
                        const filename = `${candidate.whatsapp}.txt`;
                        const file = new File([blob], filename, { type: 'text/plain' });

                        // 3. Subir (uploadFile ya maneja el POST)
                        // NOTA: Para reemplazar limpio, idealmente borraríamos el anterior primero.
                        // Pero no sabemos el ID del archivo anterior fácilmente sin listar todo.
                        // La API de assistantService no tiene 'deleteByName'.
                        // Sin embargo, si subimos con mismo nombre, BuilderBot API suele crear duplicado o renombrar.
                        // Para cumplir el requisito "validar si existe, borrarlo y subir nuevo":

                        // Lista rápida (optimizable: cachear lista de archivos)
                        const filesList = await getFiles(credentials);
                        if (filesList.success) {
                            const existing = filesList.files.find(f => f.filename === filename || f.name === filename);
                            if (existing) {
                                await deleteFile(credentials, existing.id);
                            }
                        }

                        // Subir nuevo
                        const uploadRes = await uploadFile(credentials, file);

                        if (uploadRes.success) {
                            // Guardar estado de éxito
                            saveExportStatus(candidate.id, {
                                lastExport: now.toISOString(),
                                lastMessageTime: candidate.ultimoMensaje
                            });
                            // showToast(`Historial de ${candidate.nombre} exportado`, 'info'); // Opcional: muy ruidoso
                        }

                    } catch (e) {
                        console.error('Auto-export error:', e);
                    } finally {
                        setExportingMap(prev => ({ ...prev, [candidate.id]: false }));
                    }
                }
            }
        };

        // Correr check cada 30s
        const interval = setInterval(checkAndExport, 30000);
        // Correr uno inicial a los 2s
        const initialTimeout = setTimeout(checkAndExport, 2000);

        return () => {
            clearInterval(interval);
            clearTimeout(initialTimeout);
        };

    }, [candidates, exportTimer, credentials]); // Re-run si cambia la lista o el timer

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
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        onClick={() => setShowSettings(!showSettings)}
                        variant="outline"
                        size="sm"
                        icon={Settings}
                        className={exportTimer > 0 ? "text-green-600 border-green-200 bg-green-50" : ""}
                    >
                        {exportTimer > 0 ? `${exportTimer}m` : 'Off'}
                    </Button>

                    {lastUpdate && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
                            {lastUpdate.toLocaleTimeString()}
                        </span>
                    )}
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
            </div>

            {/* Settings Modal (Inline) */}
            {showSettings && (
                <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 animate-fade-in">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <Clock className="w-5 h-5 text-gray-500" />
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
            )}

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
                                    <th className="text-center py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Mensajes</th>
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
                                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                                {formatDate(candidate.ultimoMensaje)}
                                            </div>
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                                {candidate.totalMensajes}
                                            </span>
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
        </div >
    );
};

export default CandidatesSection;
