import React, { useState, useEffect, useRef } from 'react';
import { Users, Search, Trash2, RefreshCw, User, MessageCircle, Settings, Clock, FileText, Loader2, CheckCircle, Sparkles, Send } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import ChatWindow from './ChatWindow';
import ChatHistoryModal from './ChatHistoryModal';
import MagicSearch from './MagicSearch';
import { getCandidates, deleteCandidate, CandidatesSubscription } from '../services/candidatesService';
import { getFields } from '../services/automationsService';
import { getExportSettings, saveExportSettings, getChatFileId, saveChatFileId, deleteChatFileId, saveLocalChatFile, getLocalChatFile, deleteLocalChatFile } from '../utils/storage';
import { exportChatToFile, deleteOldChatFile, generateChatHistoryText } from '../services/chatExportService';

/**
 * Sección de Candidatos con Auto-Exportación
 */
const CandidatesSection = ({ showToast }) => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [fields, setFields] = useState([]); // Dynamic fields
    const [search, setSearch] = useState('');
    const [aiFilteredCandidates, setAiFilteredCandidates] = useState(null); // Results from AI
    const [aiExplanation, setAiExplanation] = useState('');
    const [lastUpdate, setLastUpdate] = useState(null);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const LIMIT = 50;

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
    // AI Action Flow
    const [exportingMap, setExportingMap] = useState({}); // { whatsapp: 'uploading'|'uploaded'|'error' }
    const [fileStatusMap, setFileStatusMap] = useState({}); // { whatsapp: fileId }
    const [aiActionOpen, setAiActionOpen] = useState(false);
    const [aiActionContext, setAiActionContext] = useState(null); // { candidates }

    // Timers para cada candidato (se reinician con mensajes salientes)
    const exportTimersRef = useRef({});
    const [exportSchedules, setExportSchedules] = useState({}); // { whatsapp: { scheduledTime: timestamp, lastOutgoing: timestamp } }
    const [currentTime, setCurrentTime] = useState(Date.now()); // For countdown updates
    const [localChatFiles, setLocalChatFiles] = useState({}); // { whatsapp: true/false } - tracks which candidates have local files
    const previousTimerStates = useRef({}); // Track previous timer states to detect green transitions

    const uploadingRef = useRef({}); // Track which candidates are currently being uploaded { whatsapp: true/false }

    useEffect(() => {
        const loadInitialData = async () => {
            // Cargar credenciales
            const savedCreds = localStorage.getItem('builderbot_credentials');
            if (savedCreds) setCredentials(JSON.parse(savedCreds));

            // Cargar timer guardado (async - from Redis)
            const savedTimer = await getExportSettings();
            setExportTimer(savedTimer);



            // Cargar archivos locales existentes
            const existingFiles = {};
            const allLocalFiles = JSON.parse(localStorage.getItem('local_chat_files') || '{}');
            Object.keys(allLocalFiles).forEach(whatsapp => {
                existingFiles[whatsapp] = true;
            });
            setLocalChatFiles(existingFiles);

            // Cargar estados de timers previos
            try {
                const savedTimerStates = localStorage.getItem('timer_states');
                if (savedTimerStates) {
                    previousTimerStates.current = JSON.parse(savedTimerStates);
                }
            } catch (e) {
                console.warn('Error loading timer states:', e);
            }

            // Cargar candidatos
            loadCandidates();

            // Cargar campos dinámicos
            loadFields();
        };

        const loadFields = async () => {
            const result = await getFields();
            if (result.success) {
                setFields(result.fields);
            }
        };

        loadInitialData();

        // Polling de candidatos
        const subscription = new CandidatesSubscription((newCandidates) => {
            // Only update if not searching/filtering (polling refreshes full list)
            if (!search && !aiFilteredCandidates) {
                // Determine if we need to refresh the current page view
                // For simplicity in this version, we might not auto-update list content to avoid jumping
                // But we can update stats or indicators.

                // NOTE: If we want real-time updates while paginate, we need a smarter subscription 
                // that respects the current page. For now, we'll keep it simple: 
                // Manual refresh or page change triggers reload.
            }
        }, 10000); // 10s interval

        // subscription.start(); // Disable auto-poll for now to avoid pagination conflict? 
        // Or better: CandidatesService poll fetches everything? 
        // The current service fetches strictly 50 items.
        // Let's rely on manual refresh + loadCandidates for now to ensure stability.

        subscription.start();

        return () => subscription.stop();
    }, []);

    // Update current time every second for countdown display
    useEffect(() => {
        if (!exportTimer || exportTimer <= 0 || candidates.length === 0) return;

        const processGreenTimers = async () => {
            const promises = candidates.map(async (candidate) => {
                if (!candidate.ultimoMensajeBot) return;

                // Calculate if timer is ready (green)
                const lastMessageTime = new Date(candidate.ultimoMensajeBot).getTime();
                const targetTime = lastMessageTime + (exportTimer * 60 * 1000);
                const isReady = currentTime >= targetTime;

                // Get previous state
                const wasReady = previousTimerStates.current[candidate.whatsapp];

                // Detect transition from red to green (or first time reaching green)
                if (isReady && !wasReady) {
                    console.log(`🟢 Timer reached green for ${candidate.whatsapp}, creating chat history file...`);

                    try {
                        // Fetch messages for the candidate
                        const res = await fetch(`/api/chat?candidateId=${candidate.id}`);
                        const data = await res.json();

                        if (data.success && data.messages) {
                            const candidateWithMessages = { ...candidate, messages: data.messages };

                            // Generate chat history text with actual messages
                            const chatContent = generateChatHistoryText(candidateWithMessages);

                            // Delete old file if exists
                            deleteLocalChatFile(candidate.whatsapp);

                            // Save new file
                            const result = saveLocalChatFile(candidate.whatsapp, chatContent);

                            if (result.success) {
                                console.log(`✅ Chat history file created: ${candidate.whatsapp}.txt`);
                                console.log(`ℹ️ Backend cron will upload to BuilderBot automatically`);
                                setLocalChatFiles(prev => ({ ...prev, [candidate.whatsapp]: true }));
                            } else {
                                console.error(`❌ Error creating chat history file for ${candidate.whatsapp}`);
                            }
                        } else {
                            console.warn(`⚠️ Could not fetch messages for ${candidate.whatsapp}`);
                        }
                    } catch (error) {
                        console.error(`❌ Error fetching messages for ${candidate.whatsapp}:`, error);
                    }
                }

                // Update previous state inside the map? No, side-effects tricky in map.
                // We will return the result and update ref outside? 
                // Better: update the ref here, assuming sequential or non-conflicting updates.
                // Since this runs often, we must be careful with async.
                previousTimerStates.current[candidate.whatsapp] = isReady;

                // Persist to localStorage to survive section navigation
                try {
                    localStorage.setItem('timer_states', JSON.stringify(previousTimerStates.current));
                } catch (e) {
                    console.warn('Error saving timer states:', e);
                }
            });

            await Promise.all(promises);
        };

        processGreenTimers();
    }, [currentTime, candidates, exportTimer, credentials]);

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
            // Fetch messages for the candidate first
            const res = await fetch(`/api/chat?candidateId=${candidate.id}`);
            const data = await res.json();

            if (!data.success || !data.messages || data.messages.length === 0) {
                console.warn(`No messages found for ${candidate.whatsapp}, skipping export`);
                setExportingMap(prev => ({ ...prev, [candidate.whatsapp]: 'error' }));
                return;
            }

            // Create candidate object with messages
            const candidateWithMessages = { ...candidate, messages: data.messages };


            // Export and upload new file (deduplication handled inside exportChatToFile)
            console.log(`📤 Starting export for ${candidate.whatsapp}...`);
            console.log(`📊 Messages count: ${candidateWithMessages.messages.length}`);
            console.log(`🔑 Credentials:`, {
                hasBotId: !!creds.botId,
                hasAnswerId: !!creds.answerId,
                hasApiKey: !!creds.apiKey
            });

            const result = await exportChatToFile(candidateWithMessages, creds);

            console.log(`📥 Export result:`, result);

            if (result.success) {
                saveChatFileId(candidate.whatsapp, result.fileId);
                setFileStatusMap(prev => ({ ...prev, [candidate.whatsapp]: result.fileId }));
                setExportingMap(prev => ({ ...prev, [candidate.whatsapp]: 'uploaded' }));

                // Update cloud file status
                const prefix = String(candidate.whatsapp).substring(0, 13);
                // setCloudFileStatus(prev => ({ ...prev, [prefix]: true })); // This state doesn't exist in the provided code

                // Refresh all cloud statuses after 1 second to ensure sync
                // setTimeout(() => checkCloudFileStatus(candidates), 1000); // This function doesn't exist
            } else {
                setExportingMap(prev => ({ ...prev, [candidate.whatsapp]: 'error' }));
            }
        } catch (error) {
            console.error('Auto-export error:', error);
            setExportingMap(prev => ({ ...prev, [candidate.whatsapp]: 'error' }));
        }
    };

    const handleViewHistory = async (candidate) => {
        setHistoryModalCandidate(candidate);
        setHistoryModalOpen(true);
        setHistoryModalContent('Cargando historial...');

        console.log("🔍 Fetching fresh history for modal...");

        try {
            const res = await fetch(`/api/chat?candidateId=${candidate.id}`);
            const data = await res.json();

            if (data.success && data.messages) {
                const candidateWithMessages = { ...candidate, messages: data.messages };
                const content = generateChatHistoryText(candidateWithMessages);
                setHistoryModalContent(content);

                // Optional: Update local storage with this fresh content
                saveLocalChatFile(candidate.whatsapp, content);
            } else {
                const content = generateChatHistoryText(candidate);
                setHistoryModalContent(content);
            }
        } catch (error) {
            console.error("Error fetching history:", error);
            // Backup: use local file only if API fails
            const localFile = getLocalChatFile(candidate.whatsapp);
            if (localFile && localFile.content) {
                setHistoryModalContent(localFile.content);
            } else {
                setHistoryModalContent(generateChatHistoryText(candidate));
            }
        }
    };

    const handleSaveSettings = async () => {
        await saveExportSettings(exportTimer);
        setShowSettings(false);
        showToast(`Timer configurado a ${exportTimer} minutos`, 'success');
    };

    const handleAiAction = async (query) => {
        try {
            const context = {
                candidateCount: displayedCandidates.length,
                candidateIds: displayedCandidates.map(c => c.id)
            };

            console.log('🚀 [AI Action] Triggered with query:', query);
            const res = await fetch('/api/ai/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, context })
            });

            console.log('🚀 [AI Action] API Status:', res.status);

            const data = await res.json();

            if (data.success && data.action) {
                const { intent, filters, message, explanation } = data.action;

                setAiActionOpen(false); // Close AI Input

                if (intent === 'REFINE_FILTER') {
                    showToast(explanation || 'Refinando filtros...', 'info');
                    const result = await aiQuery(query);
                    if (result.success) {
                        setAiFilteredCandidates(result.candidates);
                        setAiExplanation(result.ai?.explanation || 'Refinado por IA');
                    }
                } else if (intent === 'BULK_MESSAGE') {
                    showToast(explanation || 'Preparando envío masivo...', 'success');
                    if (window.confirm(`IA Sugiere enviar este mensaje:\n\n"${message}"\n\n¿Ir a la sección de Envíos Masivos (Bulks)?`)) {
                        localStorage.setItem('draft_bulk_message', message);

                        // Save the currently filtered IDs to context
                        const currentIds = displayedCandidates.map(c => c.id);
                        localStorage.setItem('draft_bulk_ids', JSON.stringify(currentIds));

                        showToast('Mensaje y destinatarios copiados a borrador', 'success');
                    }
                } else {
                    showToast('No entendí la acción. Intenta de nuevo.', 'warning');
                }
            }
        } catch (e) {
            console.error('AI Action Error', e);
            showToast('Error procesando acción', 'error');
        }
    };

    const loadCandidates = async (page = 1) => {
        setLoading(true);
        const offset = (page - 1) * LIMIT;

        try {
            const result = await getCandidates(LIMIT, offset, search);

            if (result.success) {
                setCandidates(result.candidates);
                // Fix: use 'total' (filtered/global count) instead of 'count' (page size)
                setTotalItems(result.total || result.count || 0);
                setLastUpdate(new Date());
            } else {
                showToast('Error cargando candidatos', 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Error de conexión', 'error');
        } finally {
            setLoading(false);
        }
    };

    // Trigger load on Search or Page Change
    useEffect(() => {
        loadCandidates(currentPage);
    }, [currentPage, search]); // Reload when page or search changes




    const handleSearch = (e) => {
        setSearch(e.target.value);
        setCurrentPage(1); // Reset to page 1
    };

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        loadCandidates();
    };

    const handleDelete = async (id, nombre) => {
        if (!window.confirm(`¿Estás seguro de eliminar a "${nombre}" permanentemente?\n\nEsta acción no se puede deshacer.`)) {
            return;
        }

        // Find candidate to get whatsapp number
        const candidate = candidates.find(c => c.id === id);

        const result = await deleteCandidate(id);

        if (result.success) {
            // Delete from BuilderBot cloud if credentials available
            if (candidate && credentials) {
                try {
                    // List files to find the one for this candidate
                    const listParams = new URLSearchParams({
                        botId: credentials.botId,
                        answerId: credentials.answerId,
                        apiKey: credentials.apiKey,
                        type: 'files'
                    });

                    const listRes = await fetch(`/api/assistant?${listParams}`);

                    if (listRes.ok) {
                        const files = await listRes.json();

                        if (Array.isArray(files)) {
                            const prefix = String(candidate.whatsapp).substring(0, 13);
                            const candidateFiles = files.filter(f =>
                                f.filename && f.filename.startsWith(prefix)
                            );

                            // Delete all matching files
                            for (const file of candidateFiles) {
                                await deleteOldChatFile(file.id || file.file_id, credentials);
                                console.log(`🗑️ Deleted cloud file: ${file.filename}`);
                            }
                        }
                    }
                } catch (error) {
                    console.warn('Error deleting cloud file:', error);
                }
            }
            // Delete local file
            if (candidate) {
                deleteLocalChatFile(candidate.whatsapp);
                deleteChatFileId(candidate.whatsapp);

                // Update cloud status immediately
                const prefix = String(candidate.whatsapp).substring(0, 13);
                // setCloudFileStatus(prev => { // This state doesn't exist
                //     const updated = { ...prev };
                //     delete updated[prefix];
                //     return updated;
                // });
            }

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
        const months = Math.floor(days / 30);
        const years = Math.floor(days / 365);

        if (minutes < 1) return 'Ahora';
        if (minutes < 60) return `Hace ${minutes}m`;
        if (hours < 24) return `Hace ${hours}h`;
        if (days < 30) return `Hace ${days}d`;
        if (months < 12) return `Hace ${months} mes${months !== 1 ? 'es' : ''}`;
        if (years < 100) return `Hace ${years} año${years !== 1 ? 's' : ''}`;

        return 'Hace siglos';
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

    const calculateAge = (dob) => {
        if (!dob) return '-';
        let birthDate = new Date(dob);

        // Intentar parsear si la fecha estándar falló
        if (isNaN(birthDate.getTime())) {
            const cleanDob = dob.toLowerCase().trim();

            // 1. Formato "19 de 05 de 1983" o "19 de mayo de 1983"
            const deRegex = /(\d{1,2})\s+de\s+([a-z0-9áéíóú]+)\s+de\s+(\d{4})/;
            const match = cleanDob.match(deRegex);

            if (match) {
                const day = parseInt(match[1]);
                let month = match[2];
                const year = parseInt(match[3]);
                let monthIndex = -1;

                // Si mes es número
                if (!isNaN(month)) {
                    monthIndex = parseInt(month) - 1;
                } else {
                    // Si mes es texto
                    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                    // Buscar coincidencia parcial (ej. "sep" o "septiembre")
                    monthIndex = months.findIndex(m => m.startsWith(month.slice(0, 3)));
                }

                if (monthIndex >= 0) {
                    birthDate = new Date(year, monthIndex, day);
                }
            }

            // 2. Fallback a DD/MM/YYYY o DD-MM-YYYY si lo anterior falló
            if (isNaN(birthDate.getTime())) {
                const parts = dob.split(/[/-]/);
                if (parts.length === 3) {
                    birthDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                }
            }
        }

        if (isNaN(birthDate.getTime())) return '-';

        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return isNaN(age) ? '-' : `${age} años`;
    };

    // Displayed candidates is just 'candidates' (current page) or AI filtered
    const displayedCandidates = aiFilteredCandidates || candidates;

    const totalPages = Math.ceil(totalItems / LIMIT);

    return (
        <div className="h-[calc(100vh-theme(spacing.24))] flex flex-col space-y-4">
            {/* Sticky Header Wrapper */}
            <div className="flex-none space-y-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg">
                                <Users className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                    Candidatos
                                </h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {totalItems} candidato{totalItems !== 1 ? 's' : ''} registrado{totalItems !== 1 ? 's' : ''}
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
                <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 items-center">
                    <MagicSearch
                        onResults={(results, ai) => {
                            console.log('🔮 AI Results received:', results.length, 'candidates');
                            setAiFilteredCandidates(results);
                            setAiExplanation(ai?.explanation || 'Búsqueda completada');

                            // Trigger Follow-up Action after small delay
                            if (results.length > 0) {
                                setTimeout(() => {
                                    setAiActionOpen(true);
                                }, 1500);
                            }
                        }}
                        showToast={showToast}
                    />

                    {/* AI Action Modal (Follow-up) */}
                    {aiActionOpen && (
                        <MagicSearch
                            initialMode="action"
                            customTitle={`¿Qué hacemos con estos ${displayedCandidates.length} candidatos?`}
                            customPlaceholder="Ej: 'Filtrar solo los que sepan Inglés' o 'Enviarles un saludo'..."
                            onAction={handleAiAction}
                            isOpenProp={true}
                            onClose={() => setAiActionOpen(false)}
                            showToast={showToast}
                        />
                    )}

                    <div className="relative w-full sm:w-64 group">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 group-focus-within:text-gray-600 transition-colors" />
                        <input
                            type="text"
                            placeholder="Buscar candidato..."
                            className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:border-gray-400 dark:focus:border-gray-500 outline-none transition-all dark:text-gray-200"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                if (aiFilteredCandidates) setAiFilteredCandidates(null);
                            }}
                        />
                    </div>

                    <button
                        onClick={() => {
                            setSearch('');
                            setAiFilteredCandidates(null);
                            loadCandidates();
                        }}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                        title="Recargar"
                    >
                        <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {/* Alerta de filtrado por IA: iOS Style */}
                {aiFilteredCandidates && (
                    <div className="mb-2 animate-spring-in">
                        <div className="ios-glass p-3 rounded-[16px] flex items-center justify-between shadow-ios border-gray-200 dark:border-gray-700/50">
                            <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 bg-blue-600 dark:bg-blue-500 rounded-[10px] flex items-center justify-center shadow-sm">
                                    <Sparkles className="w-4 h-4 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                        {displayedCandidates.length} Resultados IA
                                    </h3>
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium truncate max-w-[200px]">
                                        {aiExplanation}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    setAiFilteredCandidates(null);
                                    setAiExplanation('');
                                    setCurrentPage(1);
                                    loadCandidates(1);
                                }}
                                className="text-xs font-bold text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800 px-3 py-1.5 rounded-full transition-colors"
                            >
                                Limpiar
                            </button>
                        </div>
                    </div>
                )}

            </div>

            {/* Tabla con Sticky Header */}
            <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col min-h-0">
                <div className="flex-1 overflow-auto">
                    {displayedCandidates.length === 0 ? (
                        <div className="text-center py-12">
                            <User className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                            <p className="text-gray-500 dark:text-gray-400">
                                {search || aiFilteredCandidates ? 'No se encontraron candidatos con los filtros aplicados' : 'No hay candidatos registrados aún'}
                            </p>
                            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                                Los candidatos se agregarán automáticamente cuando recibas mensajes de WhatsApp
                            </p>
                        </div>
                    ) : (
                        <table className="w-full relative">
                            <thead className="sticky top-0 z-20 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm shadow-sm ring-1 ring-black/5">
                                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs uppercase tracking-wider text-gray-500">
                                    <th className="text-left py-1 px-4 font-semibold text-gray-700 dark:text-gray-300">WhatsApp</th>
                                    <th className="text-left py-1 px-4 font-semibold text-gray-700 dark:text-gray-300">Nombre de WhatsApp</th>

                                    {/* Dynamic Headers */}
                                    {fields.map(field => (
                                        <React.Fragment key={field.value}>
                                            <th className="text-left py-1 px-4 font-semibold text-gray-700 dark:text-gray-300">
                                                {field.label}
                                            </th>
                                            {/* Special Case: Age column after Birth Date */}
                                            {field.value === 'fechaNacimiento' && (
                                                <th className="text-left py-1 px-4 font-semibold text-gray-700 dark:text-gray-300">
                                                    Edad
                                                </th>
                                            )}
                                        </React.Fragment>
                                    ))}

                                    <th className="text-left py-1 px-4 font-semibold text-gray-700 dark:text-gray-300">Último Mensaje</th>
                                    <th className="text-center py-1 px-4 font-semibold text-gray-700 dark:text-gray-300">Timer</th>
                                    <th className="text-center py-1 px-4 font-semibold text-gray-700 dark:text-gray-300">Historial</th>
                                    <th className="text-center py-1 px-4 font-semibold text-gray-700 dark:text-gray-300">Chat</th>
                                    <th className="text-center py-1 px-4 font-semibold text-gray-700 dark:text-gray-300">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedCandidates.map((candidate) => (
                                    <tr
                                        key={candidate.id}
                                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 smooth-transition relative"
                                    >
                                        {exportingMap[candidate.id] && (
                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 animate-pulse rounded-r-full" title="Exportando historial..."></div>
                                        )}
                                        <td className="py-1 px-4">
                                            <div className="text-sm text-gray-900 dark:text-white font-mono font-medium">
                                                {formatPhone(candidate.whatsapp)}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                Desde {formatDate(candidate.primerContacto)}
                                            </div>
                                        </td>
                                        <td className="py-1 px-4">
                                            <div className="text-sm text-gray-900 dark:text-white font-medium">
                                                {candidate.nombre}
                                            </div>
                                        </td>

                                        {/* Dynamic Cells */}
                                        {fields.map(field => (
                                            <React.Fragment key={field.value}>
                                                <td className="py-1 px-4">
                                                    <div className="text-sm text-gray-900 dark:text-white font-medium">
                                                        {candidate[field.value] || <span className="text-gray-400 italic font-normal">-</span>}
                                                    </div>
                                                </td>
                                                {/* Special Case: Age calculation */}
                                                {field.value === 'fechaNacimiento' && (
                                                    <td className="py-1 px-4">
                                                        <div className="text-sm text-gray-900 dark:text-white font-medium">
                                                            {calculateAge(candidate.fechaNacimiento)}
                                                        </div>
                                                    </td>
                                                )}
                                            </React.Fragment>
                                        ))}

                                        <td className="py-1 px-4">
                                            <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                                                {formatDateTime(candidate.ultimoMensaje)}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                                {formatDate(candidate.ultimoMensaje)}
                                            </div>
                                        </td>
                                        <td className="py-1 px-4 text-center">
                                            {(() => {
                                                // Si no hay timer configurado, mostrar "-"
                                                if (!exportTimer || exportTimer <= 0) {
                                                    return <span className="text-xs text-gray-400">-</span>;
                                                }

                                                // Si no hay último mensaje, no podemos calcular
                                                const timerTimestamp = candidate.ultimoMensajeBot;

                                                if (!timerTimestamp) {
                                                    return <span className="text-xs text-gray-400">-</span>;
                                                }

                                                // Calcular hora objetivo (último mensaje BOT + minutos configurados)
                                                const lastMessageTime = new Date(timerTimestamp).getTime();
                                                const targetTime = lastMessageTime + (exportTimer * 60 * 1000);
                                                const now = currentTime;

                                                // Determinar si ya se cumplió el tiempo
                                                const isReady = now >= targetTime;

                                                // Formatear hora objetivo
                                                const targetDate = new Date(targetTime);
                                                const targetTimeStr = targetDate.toLocaleTimeString('es-MX', {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    second: '2-digit',
                                                    hour12: false
                                                });

                                                return (
                                                    <div className="flex flex-col items-center justify-center space-y-1">
                                                        <div className={`w-4 h-4 rounded-full ${isReady
                                                            ? 'bg-green-500 dark:bg-green-400'
                                                            : 'bg-red-500 dark:bg-red-400'
                                                            }`} title={
                                                                isReady
                                                                    ? 'Tiempo de inactividad cumplido'
                                                                    : 'Esperando tiempo de inactividad'
                                                            } />
                                                        <div className="text-xs text-gray-600 dark:text-gray-400 font-mono">
                                                            {targetTimeStr}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="py-1 px-4 text-center">
                                            {exportingMap[candidate.whatsapp] === 'uploading' ? (
                                                <Loader2 className="w-5 h-5 text-blue-500 animate-spin mx-auto" title="Subiendo historial..." />
                                            ) : localChatFiles[candidate.whatsapp] || exportingMap[candidate.whatsapp] === 'uploaded' || getChatFileId(candidate.whatsapp) ? (
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

                                        <td className="py-1 px-4 text-center">
                                            <button
                                                onClick={() => handleOpenChat(candidate)}
                                                className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 rounded-lg smooth-transition group relative"
                                                title="Abrir chat"
                                            >
                                                <MessageCircle className="w-5 h-5" />
                                                <span className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse border border-white dark:border-gray-800"></span>
                                            </button>
                                        </td>
                                        <td className="py-1 px-4 text-center">
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

                {/* Pagination Footer */}
                {totalItems > 0 && !aiFilteredCandidates && (
                    <div className="border-t border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center text-sm sticky bottom-0 z-20">
                        <div className="text-gray-500 dark:text-gray-400">
                            Mostrando <span className="font-medium text-gray-900 dark:text-white">{((currentPage - 1) * LIMIT) + 1}</span> - <span className="font-medium text-gray-900 dark:text-white">{Math.min(currentPage * LIMIT, totalItems)}</span> de <span className="font-medium text-gray-900 dark:text-white">{totalItems}</span>
                        </div>
                        <div className="flex space-x-2">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1 || loading}
                                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Anterior
                            </button>
                            <div className="px-2 py-1.5 text-gray-600 dark:text-gray-400 font-medium">
                                Página {currentPage}
                            </div>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage >= totalPages || loading}
                                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Siguiente
                            </button>
                        </div>
                    </div>
                )}
            </div>


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
