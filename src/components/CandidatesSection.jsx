import React, { useState, useEffect, useRef } from 'react';
import { Users, Search, Trash2, RefreshCw, User, MessageCircle, Settings, Clock, FileText, Loader2, CheckCircle, Sparkles, Send, Zap } from 'lucide-react';
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
    const [stats, setStats] = useState(null); // Live dashboard stats
    const [loading, setLoading] = useState(false);
    const [fields, setFields] = useState([]); // Dynamic fields
    const [search, setSearch] = useState('');
    const [aiFilteredCandidates, setAiFilteredCandidates] = useState(null); // Results from AI
    const [aiExplanation, setAiExplanation] = useState('');
    const [lastUpdate, setLastUpdate] = useState(null);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const LIMIT = 100; // Increased to 100 to show more candidates at once

    // Estado para el chat
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [credentials, setCredentials] = useState(null);

    // Estado para historial modal
    const [historyModalOpen, setHistoryModalOpen] = useState(false);
    const [historyModalCandidate, setHistoryModalCandidate] = useState(null);
    const [historyModalContent, setHistoryModalContent] = useState('');

    // --- 🪄 MAGIC AI FIX STATE ---
    const [magicLoading, setMagicLoading] = useState({});

    useEffect(() => {
        const loadInitialData = async () => {
            // Cargar credenciales
            const savedCreds = localStorage.getItem('builderbot_credentials');
            if (savedCreds) setCredentials(JSON.parse(savedCreds));


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
        const subscription = new CandidatesSubscription((newCandidates, newStats) => {
            // Only update if not filtering by AI (polling refreshes full list based on current page/search)
            if (!aiFilteredCandidates) {
                setCandidates(newCandidates);
                if (newStats) setStats(newStats); // Update live stats
                setLastUpdate(new Date());
            }
        }, 3000);

        subscription.updateParams(LIMIT, (currentPage - 1) * LIMIT, search);
        subscription.start();

        return () => subscription.stop();
    }, [currentPage, search, aiFilteredCandidates]); // Restart/Update subscription when context changes


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

    // AI Action Flow
    const [aiActionOpen, setAiActionOpen] = useState(false);

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
                console.log('🔍 API Response:', result); // DEBUG
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

    // --- 🪄 MAGIC AI FIX HANDLER ---
    const handleMagicFix = async (candidateId, field, currentValue) => {
        const key = `${candidateId}-${field}`;
        setMagicLoading(prev => ({ ...prev, [key]: true }));

        try {
            const res = await fetch('/api/ai/magic-fix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidateId, field })
            });
            const data = await res.json();

            if (data.success) {
                // Update local state immediately
                setCandidates(prev => prev.map(c =>
                    c.id === candidateId ? { ...c, [field]: data.newValue } : c
                ));
                showToast(`🪄 ${field.toUpperCase()} Homologado: ${data.newValue}`, 'success');
            } else {
                showToast(data.error || 'Error en la magia IA', 'error');
            }
        } catch (e) {
            console.error('Magic Fix error:', e);
            showToast('Error de conexión', 'error');
        } finally {
            setMagicLoading(prev => ({ ...prev, [key]: false }));
        }
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

    const calculateAge = (dob, storedAge) => {
        // 1. Prefer stored age from NASCAR
        if (storedAge && storedAge !== '-' && storedAge !== 'INVALID') {
            return `${storedAge} años`;
        }

        if (!dob) return '-';
        let birthDate = new Date(dob);

        // Intentar parsear si la fecha estándar falló
        if (isNaN(birthDate.getTime())) {
            const cleanDob = dob.toLowerCase().trim();

            // 1. Formato "19 de 05 de 1983" o "19/05/1983" o "19 / mayo / 1983"
            // Allows: "/", "-", or "de" as separator
            const dateRegex = /(\d{1,2})[\s/-]+(?:de\s+)?([a-z0-9áéíóú]+)[\s/-]+(?:de\s+)?(\d{4})/;
            const match = cleanDob.match(dateRegex);

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

            // 2. Fallback a DD/MM/YYYY directo
            if (isNaN(birthDate.getTime())) {
                const parts = dob.split(/[/-]/);
                if (parts.length === 3) {
                    // Try DD-MM-YYYY
                    const d = parseInt(parts[0]);
                    const m = parseInt(parts[1]) - 1;
                    const y = parseInt(parts[2]);
                    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
                        birthDate = new Date(y, m, d);
                    }
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

                {/* 📊 Live Dashboard - Zuckerberg Style */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                    {/* Card 1: Candidates */}
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Users className="w-16 h-16 text-blue-500 transform rotate-12" />
                        </div>
                        <div className="flex flex-col relative z-10">
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Total Candidatos</span>
                            <div className="flex items-baseline space-x-2">
                                <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{totalItems}</h3>
                                <span className="text-xs text-green-500 font-medium flex items-center bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded-full">
                                    <Zap className="w-3 h-3 mr-0.5" /> Activos
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Card 2: Incoming Messages (Live) */}
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <MessageCircle className="w-16 h-16 text-emerald-500 transform -rotate-12" />
                        </div>
                        <div className="flex flex-col relative z-10">
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Mensajes Entrantes</span>
                            <div className="flex items-baseline space-x-2">
                                <h3 className="text-3xl font-bold text-gray-900 dark:text-white">
                                    {stats?.incoming || 0}
                                </h3>
                                <div className="flex items-center space-x-1">
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                    </span>
                                    <span className="text-xs text-emerald-500 font-medium ml-1">En vivo</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Card 3: Outgoing Messages */}
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Send className="w-16 h-16 text-purple-500 transform rotate-6" />
                        </div>
                        <div className="flex flex-col relative z-10">
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Mensajes Enviados</span>
                            <div className="flex items-baseline space-x-2">
                                <h3 className="text-3xl font-bold text-gray-900 dark:text-white">
                                    {stats?.outgoing || 0}
                                </h3>
                                <span className="text-xs text-purple-500 font-medium flex items-center bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded-full">
                                    <Sparkles className="w-3 h-3 mr-0.5" /> AI & Manual
                                </span>
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
                                    <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">Avatar</th>
                                    <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">WhatsApp</th>
                                    <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">WhatsApp Name</th>
                                    <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">
                                        <div className="flex items-center space-x-1">
                                            <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                                            <span>Género</span>
                                        </div>
                                    </th>

                                    {/* Dynamic Headers */}
                                    {fields.map(field => (
                                        <React.Fragment key={field.value}>
                                            <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">
                                                <div className="flex items-center space-x-1">
                                                    {['nombreReal', 'municipio', 'tieneEmpleo', 'escolaridad', 'categoria', 'fechaNacimiento'].includes(field.value) && (
                                                        <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                                                    )}
                                                    <span>{field.label}</span>
                                                </div>
                                            </th>
                                            {/* Special Case: Age column after Birth Date */}
                                            {field.value === 'fechaNacimiento' && (
                                                <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">
                                                    Edad
                                                </th>
                                            )}
                                        </React.Fragment>
                                    ))}

                                    <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">Último Mensaje</th>
                                    <th className="text-center py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">Chat</th>
                                    <th className="text-center py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedCandidates.map((candidate) => (
                                    <tr
                                        key={candidate.id}
                                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 smooth-transition relative"
                                    >
                                        <td className="py-0.5 px-2.5">
                                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                                                <img
                                                    src={candidate.profilePic || `https://ui-avatars.com/api/?name=${encodeURIComponent(candidate.nombre || 'User')}&background=random&color=fff&size=128`}
                                                    alt="Avatar"
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => {
                                                        e.target.onerror = null;
                                                        e.target.src = 'https://ui-avatars.com/api/?name=User&background=gray&color=fff';
                                                    }}
                                                />
                                            </div>
                                        </td>
                                        <td className="py-0.5 px-2.5">
                                            <div className="text-xs text-gray-900 dark:text-white font-mono font-medium">
                                                {formatPhone(candidate.whatsapp)}
                                            </div>
                                            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 opacity-80">
                                                Desde {formatDate(candidate.primerContacto)}
                                            </div>
                                        </td>
                                        <td className="py-0.5 px-2.5">
                                            <div className="text-xs text-gray-900 dark:text-white font-medium" title={candidate.nombre}>
                                                {candidate.nombre && candidate.nombre.length > 8
                                                    ? `${candidate.nombre.substring(0, 8)}...`
                                                    : (candidate.nombre || '-')}
                                            </div>
                                        </td>
                                        <td className="py-0.5 px-2.5">
                                            <div className="text-xs text-gray-900 dark:text-white font-medium">
                                                {candidate.genero || <span className="text-gray-400 italic font-normal">-</span>}
                                            </div>
                                        </td>

                                        {/* Dynamic Cells */}
                                        {fields.map(field => (
                                            <React.Fragment key={field.value}>
                                                <td className="py-0.5 px-2.5">
                                                    {['escolaridad', 'categoria', 'nombreReal', 'municipio'].includes(field.value) ? (
                                                        <div
                                                            onClick={() => handleMagicFix(candidate.id, field.value, candidate[field.value])}
                                                            className={`
                                                                inline-flex items-center px-2 py-0.5 rounded-md cursor-pointer smooth-transition text-xs font-medium
                                                                ${magicLoading[`${candidate.id}-${field.value}`]
                                                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 animate-pulse'
                                                                    : 'hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:text-blue-600 dark:text-white'}
                                                            `}
                                                            title="Clic para Magia IA ✨"
                                                        >
                                                            {magicLoading[`${candidate.id}-${field.value}`] && (
                                                                <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                                                            )}
                                                            {candidate[field.value] || <span className="text-gray-400 italic font-normal">-</span>}
                                                            <Sparkles className={`w-2.5 h-2.5 ml-1.5 opacity-0 group-hover:opacity-100 ${magicLoading[`${candidate.id}-${field.value}`] ? 'hidden' : ''} text-blue-400`} />
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs text-gray-900 dark:text-white font-medium">
                                                            {candidate[field.value] || <span className="text-gray-400 italic font-normal">-</span>}
                                                        </div>
                                                    )}
                                                </td>
                                                {/* Special Case: Age calculation */}
                                                {field.value === 'fechaNacimiento' && (
                                                    <td className="py-0.5 px-2.5">
                                                        <div className="text-xs text-gray-900 dark:text-white font-medium">
                                                            {calculateAge(candidate.fechaNacimiento, candidate.edad)}
                                                        </div>
                                                    </td>
                                                )}
                                            </React.Fragment>
                                        ))}

                                        <td className="py-0.5 px-2.5">
                                            <div className="text-xs text-gray-700 dark:text-gray-300 font-medium">
                                                {formatDateTime(candidate.ultimoMensaje)}
                                            </div>
                                            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 opacity-80">
                                                {formatDate(candidate.ultimoMensaje)}
                                            </div>
                                        </td>

                                        <td className="py-0.5 px-2.5 text-center">
                                            <button
                                                onClick={() => handleOpenChat(candidate)}
                                                className="p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 rounded-lg smooth-transition group relative"
                                                title="Abrir chat"
                                            >
                                                <MessageCircle className="w-4 h-4" />
                                                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse border border-white dark:border-gray-800"></span>
                                            </button>
                                        </td>
                                        <td className="py-0.5 px-2.5 text-center">
                                            <button
                                                onClick={() => handleDelete(candidate.id, candidate.nombre)}
                                                className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg smooth-transition group"
                                                title="Eliminar permanentemente"
                                            >
                                                <Trash2 className="w-3.5 h-3.5 text-gray-400 group-hover:text-red-600 dark:group-hover:text-red-400" />
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
        </div >
    );
};

export default CandidatesSection;
