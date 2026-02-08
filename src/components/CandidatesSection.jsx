import React, { useState, useEffect, useRef } from 'react';
import { Users, Search, Trash2, RefreshCw, User, MessageCircle, Settings, Clock, FileText, Loader2, CheckCircle, Check, Sparkles, Send, Zap } from 'lucide-react';
import Card from './ui/Card';
import ErrorBoundary from './ui/ErrorBoundary';
import Button from './ui/Button';
import ChatWindow from './ChatWindow';
import ChatHistoryModal from './ChatHistoryModal';
import MagicSearch from './MagicSearch';
import { getCandidates, deleteCandidate, CandidatesSubscription } from '../services/candidatesService';
import { getFields } from '../services/automationsService';
import { getExportSettings, saveExportSettings, deleteChatFileId, saveLocalChatFile, getLocalChatFile, deleteLocalChatFile } from '../utils/storage';
import { generateChatHistoryText } from '../services/chatExportService';
import { formatPhone, formatRelativeDate, formatDateTime, calculateAge, formatValue } from '../utils/formatters';
import { useCandidatesSSE } from '../hooks/useCandidatesSSE';

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
    const [proactiveEnabled, setProactiveEnabled] = useState(false);
    const [proactiveLoading, setProactiveLoading] = useState(false);

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

    // 📡 SSE: Real-time candidate updates
    const { newCandidate, globalStats, connected: sseConnected } = useCandidatesSSE();

    // Listen for new candidates via SSE
    useEffect(() => {
        if (newCandidate && newCandidate.id) {
            // Check if candidate already exists (prevent duplicates)
            setCandidates(prev => {
                const exists = prev.some(c => c.id === newCandidate.id);
                if (exists) {
                    console.log('Candidate already exists, skipping:', newCandidate.id);
                    return prev; // Don't add duplicate
                }
                // Prepend new candidate to list
                showToast && showToast('Nuevo candidato recibido 🎉', 'success');
                return [newCandidate, ...prev];
            });
        }
    }, [newCandidate, showToast]);

    // Live Stats Integration: Update dashboard when globalStats pulse arrives
    useEffect(() => {
        if (globalStats) {
            setStats(prev => ({ ...prev, ...globalStats }));
        }
    }, [globalStats]);

    useEffect(() => {
        const loadInitialData = async () => {
            // Cargar candidatos
            loadCandidates();

            // Cargar campos dinámicos
            loadFields();

            // Cargar estatus proactivo
            loadProactiveStatus();
        };

        const loadProactiveStatus = async () => {
            try {
                const res = await fetch('/api/settings?type=bot_proactive_enabled');
                if (res.ok) {
                    const json = await res.json();
                    setProactiveEnabled(json.data === true);
                }
            } catch (error) {
                console.error('Error loading proactive status:', error);
            }
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

    const toggleProactive = async () => {
        setProactiveLoading(true);
        const newValue = !proactiveEnabled;
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'bot_proactive_enabled', data: newValue })
            });
            if (res.ok) {
                setProactiveEnabled(newValue);
                showToast(newValue ? 'Seguimiento IA Activado' : 'Seguimiento IA Desactivado', 'info');
            }
        } catch (error) {
            showToast('Error al cambiar estatus', 'error');
        } finally {
            setProactiveLoading(false);
        }
    };


    const handleViewHistory = async (candidate) => {
        setHistoryModalCandidate(candidate);
        setHistoryModalOpen(true);
        setHistoryModalContent('Cargando historial...');

        try {
            const res = await fetch(`/api/chat?candidateId=${candidate.id}`);
            const data = await res.json();

            if (data.success && data.messages) {
                const candidateWithMessages = { ...candidate, messages: data.messages };
                const content = generateChatHistoryText(candidateWithMessages);
                setHistoryModalContent(content);
                saveLocalChatFile(candidate.whatsapp, content);
            } else {
                setHistoryModalContent(generateChatHistoryText(candidate));
            }
        } catch (error) {
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

            const res = await fetch('/api/ai/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, context })
            });

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

    const handleDelete = async (e, id, nombre) => {
        if (e && e.stopPropagation) e.stopPropagation();

        if (!window.confirm(`¿Estás seguro de eliminar a "${nombre}" permanentemente?\n\nEsta acción no se puede deshacer.`)) {
            return;
        }

        // Find candidate to get whatsapp number
        const candidate = candidates.find(c => c.id === id);

        const result = await deleteCandidate(id);

        if (result.success) {
            // Delete local file
            if (candidate) {
                deleteLocalChatFile(candidate.whatsapp);
                deleteChatFileId(candidate.whatsapp);
            }

            showToast('Candidato eliminado correctamente', 'success');
            loadCandidates();
        } else {
            showToast(`Error: ${result.error}`, 'error');
        }
    };

    const handleOpenChat = (candidate) => {
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
        } finally {
            setMagicLoading(prev => ({ ...prev, [key]: false }));
        }
    };

    // Displayed candidates is just 'candidates' (current page) or AI filtered
    const displayedCandidates = aiFilteredCandidates || candidates;

    const totalPages = Math.ceil(totalItems / LIMIT);

    // --- 🚩 PASO 1 LOGIC ---
    const isProfileComplete = (c) => {
        // Red dot if ANY field is missing, Green dot if ALL fields are present
        const coreFields = ['nombreReal', 'municipio', 'escolaridad', 'categoria', 'genero', 'tieneEmpleo'];
        const hasCoreData = coreFields.every(f => {
            const val = formatValue(c[f]);
            return val !== '-';
        });
        const hasAgeData = !!(c.edad || c.fechaNacimiento) && formatValue(c.edad || c.fechaNacimiento) !== '-';
        return hasCoreData && hasAgeData;
    };

    return (
        <div className="flex-1 min-h-0 flex flex-col space-y-4">
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
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Total Candidatos</span>
                            <div className="flex items-baseline space-x-2">
                                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{totalItems}</h3>
                                <span className="text-[10px] text-green-500 font-medium flex items-center bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded-full">
                                    <Zap className="w-3 h-3 mr-0.5" /> Activos
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Card 2: Incoming Messages (Live) */}
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <MessageCircle className="w-16 h-16 text-green-500 opacity-20 transform -rotate-12" />
                        </div>
                        <div className="flex flex-col relative z-10">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Mensajes Entrantes</span>
                            <div className="flex items-baseline space-x-2">
                                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                                    {stats?.incoming || 0}
                                </h3>
                                <div className="flex items-center space-x-1">
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                                    </span>
                                    <span className="text-[10px] text-green-500 font-medium ml-1">En vivo</span>
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
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Mensajes Enviados</span>
                            <div className="flex items-baseline space-x-2">
                                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                                    {stats?.outgoing || 0}
                                </h3>
                                <span className="text-[10px] text-purple-500 font-medium flex items-center bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded-full">
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
                            setAiFilteredCandidates(results);
                            setAiExplanation(ai?.explanation || 'Búsqueda completada');
                        }}
                        showToast={showToast}
                    />

                    {/* Proactive Follow-up Master Switch */}
                    <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-1.5 rounded-xl shadow-sm">
                        <div className="flex flex-col">
                            <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 leading-none">Seguimiento</span>
                            <span className={`text-[10px] font-bold ${proactiveEnabled ? 'text-blue-600' : 'text-gray-400'}`}>
                                {proactiveEnabled ? 'AUTO' : 'OFF'}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={toggleProactive}
                            disabled={proactiveLoading}
                            className={`
                                relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
                                ${proactiveEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
                                ${proactiveLoading ? 'opacity-50' : 'opacity-100'}
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
                            className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:border-gray-400 dark:focus:border-gray-500 outline-none transition-all dark:text-gray-200 text-[12px]"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                if (aiFilteredCandidates) setAiFilteredCandidates(null);
                            }}
                        />
                    </div>

                    <button
                        type="button"
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
                                    <h3 className="text-[12px] font-bold text-gray-900 dark:text-white">
                                        {displayedCandidates.length} Resultados IA
                                    </h3>
                                    <p className="text-[8px] text-gray-500 dark:text-gray-400 font-medium truncate max-w-[200px]">
                                        {aiExplanation}
                                    </p>
                                </div>
                            </div>
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
                            <p className="text-gray-500 dark:text-gray-400 text-[12px]">
                                {search || aiFilteredCandidates ? 'No se encontraron candidatos con los filtros aplicados' : 'No hay candidatos registrados aún'}
                            </p>
                            <p className="text-[12px] text-gray-400 dark:text-gray-500 mt-2">
                                Los candidatos se agregarán automáticamente cuando recibas mensajes de WhatsApp
                            </p>
                        </div>
                    ) : (
                        <table className="w-full relative">
                            <thead className="sticky top-0 z-20 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm shadow-sm ring-1 ring-black/5">
                                <tr className="border-b border-gray-200 dark:border-gray-700 text-[10px] uppercase tracking-wider text-gray-500">
                                    <th className="py-1 px-1 w-8"></th>
                                    <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300"></th>
                                    <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">WhatsApp</th>
                                    <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">From</th>

                                    {/* Dynamic Headers */}
                                    {fields.filter(f => f.value !== 'foto').map(field => (
                                        <React.Fragment key={field.value}>
                                            <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">
                                                <div className="flex items-center space-x-1">
                                                    {['nombreReal', 'municipio', 'tieneEmpleo', 'escolaridad', 'categoria', 'fechaNacimiento'].includes(field.value) && (
                                                        <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                                                    )}
                                                    <span>{field.label}</span>
                                                </div>
                                            </th>
                                        </React.Fragment>
                                    ))}

                                    <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">Último Mensaje</th>
                                    <th className="text-center py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300 w-10">
                                        <div className="flex justify-center">
                                            <MessageCircle className="w-4 h-4 opacity-50" />
                                        </div>
                                    </th>
                                    <th className="text-center py-1 px-1 font-black text-gray-400 dark:text-gray-500 w-10">
                                        <div className="flex justify-center">
                                            <span className="text-[8px] uppercase tracking-tighter">Seg.</span>
                                        </div>
                                    </th>
                                    <th className="text-center py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedCandidates.map((candidate) => (
                                    <tr
                                        key={candidate.id}
                                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 smooth-transition relative"
                                    >
                                        <td className="py-0.5 px-1 text-center">
                                            <div className="flex items-center justify-center">
                                                {isProfileComplete(candidate) ? (
                                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse"></div>
                                                ) : (
                                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></div>
                                                )}
                                            </div>
                                        </td>
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
                                            <div className="text-[10px] text-gray-900 dark:text-white font-mono font-medium">
                                                {formatPhone(candidate.whatsapp)}
                                            </div>
                                            <div className="text-[8px] text-gray-500 dark:text-gray-400 mt-0.5 opacity-80">
                                                Desde {formatRelativeDate(candidate.primerContacto)}
                                            </div>
                                        </td>
                                        <td className="py-0.5 px-2.5">
                                            <div className="text-[10px] text-gray-900 dark:text-white font-medium" title={candidate.nombre}>
                                                {candidate.nombre && candidate.nombre.length > 8
                                                    ? `${candidate.nombre.substring(0, 8)}...`
                                                    : (candidate.nombre || '-')}
                                            </div>
                                        </td>

                                        {/* Dynamic Cells */}
                                        {fields.filter(f => f.value !== 'foto').map(field => (
                                            <React.Fragment key={field.value}>
                                                <td className="py-0.5 px-2.5">
                                                    {['escolaridad', 'categoria', 'nombreReal', 'municipio'].includes(field.value) ? (
                                                        <div
                                                            onClick={() => handleMagicFix(candidate.id, field.value, candidate[field.value])}
                                                            className={`
                                                                inline-flex items-center px-2 py-0.5 rounded-md cursor-pointer smooth-transition text-[10px] font-medium
                                                                ${magicLoading[`${candidate.id}-${field.value}`]
                                                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 animate-pulse'
                                                                    : 'hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:text-blue-600 dark:text-white'}
                                                            `}
                                                            title="Clic para Magia IA ✨"
                                                        >
                                                            {magicLoading[`${candidate.id}-${field.value}`] && (
                                                                <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                                                            )}
                                                            {formatValue(candidate[field.value])}
                                                            <Sparkles className={`w-2.5 h-2.5 ml-1.5 opacity-0 group-hover:opacity-100 ${magicLoading[`${candidate.id}-${field.value}`] ? 'hidden' : ''} text-blue-400`} />
                                                        </div>
                                                    ) : (
                                                        <div className="text-[10px] text-gray-900 dark:text-white font-medium">
                                                            {field.value === 'edad'
                                                                ? calculateAge(candidate.fechaNacimiento, candidate.edad)
                                                                : formatValue(candidate[field.value])}
                                                        </div>
                                                    )}
                                                </td>
                                            </React.Fragment>
                                        ))}

                                        <td className="py-0.5 px-2.5">
                                            <div className="text-[10px] text-gray-700 dark:text-gray-300 font-medium">
                                                {formatDateTime(candidate.ultimoMensaje)}
                                            </div>
                                            <div className="text-[8px] text-gray-500 dark:text-gray-400 mt-0.5 opacity-80">
                                                {formatRelativeDate(candidate.ultimoMensaje)}
                                            </div>
                                        </td>

                                        <td className="py-0.5 px-2.5 text-center">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOpenChat(candidate);
                                                }}
                                                className="p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 rounded-lg smooth-transition group relative flex items-center justify-center"
                                                title="Abrir chat"
                                            >
                                                <div className="relative">
                                                    <MessageCircle className="w-4 h-4" />
                                                    {candidate.ultimoMensaje && (
                                                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse border border-white dark:border-gray-800"></span>
                                                    )}
                                                </div>
                                            </button>
                                        </td>
                                        <td className="py-0.5 px-2.5 text-center">
                                            {/* Leveled Checkmarks (Separate Column) */}
                                            {candidate.followUps > 0 && (
                                                <div
                                                    className="flex items-center justify-center -space-x-1 cursor-default select-none pointer-events-none"
                                                    title={`${candidate.followUps} seguimientos enviados`}
                                                >
                                                    {(() => {
                                                        let colorClass = "text-blue-500";
                                                        if (candidate.followUps === 2) colorClass = "text-purple-500";
                                                        if (candidate.followUps >= 3) colorClass = "text-orange-500";

                                                        return (
                                                            <div className="flex items-center -space-x-2">
                                                                <Check className={`w-3 h-3 ${colorClass}`} strokeWidth={4} />
                                                                <Check className={`w-3 h-3 ${colorClass} -ml-2`} strokeWidth={4} />
                                                            </div>
                                                        );
                                                    })()}
                                                    {candidate.followUps > 3 && (
                                                        <span className="text-[8px] font-black text-orange-600 dark:text-orange-400 ml-1">
                                                            +{candidate.followUps - 3}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-0.5 px-2.5 text-center">
                                            <button
                                                type="button"
                                                onClick={(e) => handleDelete(e, candidate.id, candidate.nombre)}
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
                    <div className="border-t border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center text-[12px] sticky bottom-0 z-20">
                        <div className="text-gray-500 dark:text-gray-400">
                            Mostrando <span className="font-medium text-gray-900 dark:text-white">{((currentPage - 1) * LIMIT) + 1}</span> - <span className="font-medium text-gray-900 dark:text-white">{Math.min(currentPage * LIMIT, totalItems)}</span> de <span className="font-medium text-gray-900 dark:text-white">{totalItems}</span>
                        </div>
                        <div className="flex space-x-2">
                            <button
                                type="button"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1 || loading}
                                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[12px]"
                            >
                                Anterior
                            </button>
                            <div className="px-2 py-1.5 text-gray-600 dark:text-gray-400 font-medium text-[12px]">
                                Página {currentPage}
                            </div>
                            <button
                                type="button"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage >= totalPages || loading}
                                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[12px]"
                            >
                                Siguiente
                            </button>
                        </div>
                    </div>
                )}
            </div>


            {/* Ventana Flotante de Chat con Protección de Errores */}
            <ErrorBoundary>
                <ChatWindow
                    isOpen={!!selectedCandidate}
                    onClose={() => setSelectedCandidate(null)}
                    candidate={selectedCandidate}
                />
            </ErrorBoundary>
        </div >
    );
};

export default CandidatesSection;
