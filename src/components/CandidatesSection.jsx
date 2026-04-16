import React, { useState, useEffect, useRef } from 'react';
import { Users, Search, Trash2, RefreshCw, User, MessageCircle, Clock, FileText, Loader2, CheckCircle, Check, Sparkles, Send, Zap, Ban, GripVertical, Radio, Tag, ChevronDown, X, Pencil, Plus } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Card from './ui/Card';
import ErrorBoundary from './ui/ErrorBoundary';
import Button from './ui/Button';
import ChatWindow from './ChatWindow';
import MagicSearch from './MagicSearch';
import Skeleton, { CardSkeleton, TableRowSkeleton } from './ui/Skeleton';
import { getCandidates, deleteCandidate, blockCandidate, CandidatesSubscription } from '../services/candidatesService';
import { getFields } from '../services/automationsService';
import { deleteChatFileId, saveLocalChatFile, getLocalChatFile, deleteLocalChatFile } from '../utils/storage';
import { generateChatHistoryText } from '../services/chatExportService';
import { formatPhone, formatRelativeDate, formatDateTime, calculateAge, formatValue } from '../utils/formatters';
import { useCandidatesSSE } from '../hooks/useCandidatesSSE';
import WaStatusCreator from './WaStatusCreator';
import WaStatusViewer from './WaStatusViewer';

/**
 * Sortable Header Sub-component
 */
function SortableHeaderCell({ id, label }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 999 : 'auto',
        opacity: isDragging ? 0.8 : 1,
    };

    return (
        <th
            ref={setNodeRef}
            style={style}
            // Increase px padding slighly to fit grip icon gracefully
            className={`text-left py-1 px-1.5 font-semibold text-gray-700 dark:text-gray-300 relative group select-none ${isDragging ? 'bg-gray-100 dark:bg-gray-700 shadow-md' : ''}`}
        >
            <div className="flex items-center space-x-1">
                <button
                    {...attributes}
                    {...listeners}
                    className="p-1 cursor-grab active:cursor-grabbing hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                    title="Arrastrar columna"
                >
                    <GripVertical className="w-3.5 h-3.5" />
                </button>
                {['nombreReal', 'municipio', 'escolaridad', 'categoria', 'fechaNacimiento'].includes(id) && (
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                )}
                <span>{label}</span>
            </div>
        </th>
    );
}

/**
 * Sección de Candidatos con Auto-Exportación y Columnas Arrastrables
 */

/**
 * Sección de Candidatos con Auto-Exportación
 */

const isProfileComplete = (c) => {
    if (!c) return false;
    const valToStr = (v) => v ? String(v).trim().toLowerCase() : '-';
    const coreFields = ['nombreReal', 'municipio', 'escolaridad', 'categoria', 'genero'];
    
    const hasCoreData = coreFields.every(f => {
        const val = valToStr(c[f]);
        if (val === '-' || val === 'null' || val === 'n/a' || val === 'na' || val === 'ninguno' || val === 'ninguna' || val === 'none' || val === 'desconocido' || val.includes('proporcionado') || val.length < 2) return false;
        if (f === 'escolaridad') {
            const junk = ['kinder', 'ninguna', 'sin estudios', 'no tengo', 'no curse', 'preescolar', 'maternal'];
            if (junk.some(j => val.includes(j))) return false;
        }
        return true;
    });

    const ageVal = valToStr(c.edad || c.fechaNacimiento);
    const hasAgeData = ageVal !== '-' && ageVal !== 'null' && ageVal !== 'n/a' && ageVal !== 'na';
    return hasCoreData && hasAgeData;
};

const areCandidatePropsEqual = (prev, next) => {
    if (prev.candidate !== next.candidate) return false;
    if (prev.columnOrder !== next.columnOrder) return false;
    if (prev.isBlockLoading !== next.isBlockLoading) return false;
    
    for (let col of prev.columnOrder) {
        const key = `${prev.candidate.id}-${col}`;
        if (prev.magicLoading[key] !== next.magicLoading[key]) return false;
    }
    return true;
};

const CandidateRow = React.memo(({ candidate, columnOrder, fieldsMap, magicLoading, isBlockLoading, onOpenChat, onBlockToggle, onDelete, onMagicFix }) => {
    const isComplete = isProfileComplete(candidate);
    return (
        <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 smooth-transition relative">
            <td className="py-0.5 px-1 text-center">
                <div className="flex items-center justify-center">
                    {isComplete ? (
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse"></div>
                    ) : (
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></div>
                    )}
                </div>
            </td>
            <td className="py-0.5 px-2.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                    <img src={candidate.profilePic || `https://ui-avatars.com/api/?name=${encodeURIComponent(candidate.nombre || 'User')}&background=random&color=fff&size=128`}
                         alt="Avatar" className="w-full h-full object-cover"
                         onError={(e) => { e.target.onerror = null; e.target.src = 'https://ui-avatars.com/api/?name=User&background=gray&color=fff'; }} />
                </div>
            </td>
            <td className="py-0.5 px-2.5">
                <div className="text-[10px] text-gray-900 dark:text-white font-mono font-medium">{formatPhone(candidate.whatsapp)}</div>
                <div className="text-[8px] text-gray-500 dark:text-gray-400 mt-0.5 opacity-80">Desde {formatRelativeDate(candidate.primerContacto)}</div>
            </td>
            <td className="py-0.5 px-2.5">
                <div className="text-[10px] text-gray-900 dark:text-white font-medium" title={candidate.nombre}>
                    {candidate.nombre && candidate.nombre.length > 8 ? `${candidate.nombre.substring(0, 8)}...` : (candidate.nombre || '-')}
                </div>
            </td>
            {columnOrder.map(colId => {
                const field = fieldsMap[colId];
                if (!field) return null;
                const mKey = `${candidate.id}-${field.value}`;
                const isMLoading = magicLoading[mKey];
                return (
                    <td className="py-0.5 px-2.5" key={field.value}>
                        {['escolaridad', 'categoria', 'nombreReal', 'municipio'].includes(field.value) ? (
                            <div onClick={() => onMagicFix(candidate.id, field.value, candidate[field.value])}
                                 className={`inline-flex items-center px-2 py-0.5 rounded-md cursor-pointer smooth-transition text-[10px] font-medium ${isMLoading ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 animate-pulse' : 'hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:text-blue-600 dark:text-white'}`}
                                 title="Clic para Magia IA ✨">
                                {isMLoading && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
                                {formatValue(candidate[field.value])}
                                <Sparkles className={`w-2.5 h-2.5 ml-1.5 opacity-0 group-hover:opacity-100 ${isMLoading ? 'hidden' : ''} text-blue-400`} />
                            </div>
                        ) : (
                            <div className="text-[10px] text-gray-900 dark:text-white font-medium">
                                {field.value === 'edad' ? calculateAge(candidate.fechaNacimiento, candidate.edad) : formatValue(candidate[field.value])}
                            </div>
                        )}
                    </td>
                );
            })}
            <td className="py-0.5 px-2.5">
                {(() => {
                    const vacName = candidate.currentVacancyName || candidate.projectMetadata?.currentVacancyName;
                    const stepId = candidate.projectMetadata?.stepId || '';
                    const isNoInteresa = !vacName && (/no.?interesa/i.test(stepId) || /no.?interesa/i.test(candidate.status || '') || /no.?interesa/i.test(candidate.projectMetadata?.stepName || ''));
                    if (isNoInteresa) return <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase italic bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">NO INTERESA</span>;
                    return <div className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase italic whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">{vacName || '-'}</div>;
                })()}
            </td>
            <td className="py-0.5 px-2.5">
                <div className="text-[10px] text-gray-700 dark:text-gray-300 font-medium">{formatDateTime(candidate.ultimoMensaje)}</div>
                <div className="text-[8px] text-gray-500 dark:text-gray-400 mt-0.5 opacity-80">{formatRelativeDate(candidate.ultimoMensaje)}</div>
            </td>
            <td className="py-0.5 px-2.5 text-center">
                <button type="button" onClick={(e) => { e.stopPropagation(); onOpenChat(candidate); }}
                        className="p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 rounded-lg smooth-transition group relative flex items-center justify-center" title="Abrir chat">
                    <div className="relative">
                        <MessageCircle className="w-4 h-4" />
                        {candidate.ultimoMensaje && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse border border-white dark:border-gray-800"></span>}
                    </div>
                </button>
            </td>
            <td className="py-0.5 px-2 text-center">
                <div className="flex justify-center items-center">
                    <button type="button" onClick={(e) => { e.stopPropagation(); onBlockToggle(candidate); }} disabled={isBlockLoading}
                            className={`w-6 h-3 rounded-full relative transition-colors duration-200 focus:outline-none ${candidate.blocked ? 'bg-red-500' : 'bg-gray-200 dark:bg-gray-700'}`}
                            title={candidate.blocked ? 'Reactivar Chat IA' : 'Silenciar Chat IA'}>
                        <div className={`absolute top-0.5 w-2 h-2 rounded-full bg-white shadow-sm transition-transform duration-200 ${candidate.blocked ? 'left-3.5' : 'left-0.5'}`}>
                            {isBlockLoading && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-2 h-2 text-red-500 animate-spin" /></div>}
                        </div>
                    </button>
                </div>
            </td>
            <td className="py-0.5 px-2.5 text-center">
                <button type="button" onClick={(e) => onDelete(e, candidate)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg smooth-transition group" title="Eliminar permanentemente">
                    <Trash2 className="w-3.5 h-3.5 text-gray-400 group-hover:text-red-600 dark:group-hover:text-red-400" />
                </button>
            </td>
        </tr>
    );
}, areCandidatePropsEqual);

const CandidatesSection = ({ showToast }) => {
    const [candidates, setCandidates] = useState([]);
    const [stats, setStats] = useState(null); // Live dashboard stats
    const [loading, setLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true); // NEW: Prevent ghosting
    // Dynamic Fields & Column Order State
    const [fields, setFields] = useState([]);
    const fieldsMap = React.useMemo(() => fields.reduce((acc, f) => ({ ...acc, [f.value]: f }), {}), [fields]);
    const [columnOrder, setColumnOrder] = useState(() => {
        try {
            const saved = localStorage.getItem('candidateColumnOrder');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    // DND Sensors (require slight movement to drag so clicks still work)
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    // DND Drag End Handler
    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        setColumnOrder((prevOrder) => {
            const oldIndex = prevOrder.indexOf(active.id);
            const newIndex = prevOrder.indexOf(over.id);
            const newOrder = arrayMove(prevOrder, oldIndex, newIndex);

            // Save to localStorage
            try { localStorage.setItem('candidateColumnOrder', JSON.stringify(newOrder)); } catch (e) { }
            return newOrder;
        });
    };

    const [search, setSearch] = useState('');
    const [showStatusCreator, setShowStatusCreator] = useState(false);
    const [statusViewerRefresh, setStatusViewerRefresh] = useState(0); // Trigger to fetch latest status
    const [aiFilteredCandidates, setAiFilteredCandidates] = useState(null); // Results from AI
    const [aiExplanation, setAiExplanation] = useState('');
    const [hideIncomplete, setHideIncomplete] = useState(() => {
        // Load initial state from localStorage if available
        try {
            const saved = localStorage.getItem('hideIncompleteCandidates');
            return saved === 'true'; // will be false for 'false' or null
        } catch {
            return false;
        }
    });

    const [openClawActive, setOpenClawActive] = useState(false);
    const [openClawLoading, setOpenClawLoading] = useState(true);

    // Save to localStorage when it changes
    useEffect(() => {
        try {
            localStorage.setItem('hideIncompleteCandidates', hideIncomplete.toString());
        } catch (e) {
            console.warn('Could not save preference to localStorage', e);
        }
    }, [hideIncomplete]);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const LIMIT = 100; // Increased to 100 to show more candidates at once

    // Estado para el chat
    const [selectedCandidate, setSelectedCandidate] = useState(null);

    // --- 🪄 MAGIC AI FIX STATE ---
    const [magicLoading, setMagicLoading] = useState({});
    const [blockLoading, setBlockLoading] = useState({});

    // === TAGS STATE & LOGIC ===
    const TAG_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#8b5cf6", "#64748b"];
    const [availableTags, setAvailableTags] = useState([]);
    const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
    const [bulkTagLoading, setBulkTagLoading] = useState(false);
    const [newTagInput, setNewTagInput] = useState("");
    const [editingTag, setEditingTag] = useState(null);
    const [editTagName, setEditTagName] = useState("");
    const [editTagColor, setEditTagColor] = useState("#3b82f6");
    const tagDropdownRef = useRef(null);

    useEffect(() => {
        const loadTags = async () => {
            try {
                const res = await fetch('/api/tags');
                const data = await res.json();
                if (data.success && data.tags) {
                    const migrated = data.tags.map((t, i) => {
                        if (typeof t === 'string') {
                            return { name: t, color: TAG_COLORS[i % TAG_COLORS.length] };
                        }
                        return t;
                    });
                    setAvailableTags(migrated);
                }
            } catch (e) {
                console.error('Error fetching tags', e);
            }
        };
        loadTags();
    }, []);

    const saveTagsGlobal = async (newGlobalTags) => {
        setAvailableTags(newGlobalTags);
        try {
            await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: newGlobalTags })
            });
        } catch (e) {
            console.error('Error saving global tags', e);
            showToast && showToast('Error al guardar etiquetas', 'error');
        }
    };

    const deleteTagGlobal = async (tagName) => {
        if (!window.confirm(`¿Seguro que deseas eliminar la etiqueta "${tagName}"?\n\nEsta acción eliminará la etiqueta de TODOS los candidatos que la tengan asignada actualmente.`)) {
            return;
        }
        
        try {
            const res = await fetch(`/api/tags?name=${encodeURIComponent(tagName)}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success && data.tags) {
                setAvailableTags(data.tags);
                showToast && showToast('Etiqueta eliminada de la base global', 'success');
            }
        } catch (e) {
            console.error('Error al eliminar etiqueta', e);
            showToast && showToast('Error al eliminar', 'error');
        }
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (tagDropdownRef.current && !tagDropdownRef.current.contains(event.target)) {
                setTagDropdownOpen(false);
            }
        };
        if (tagDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [tagDropdownOpen]);

    const handleBulkTag = async (tagObj) => {
        const displayedCandidatesInner = aiFilteredCandidates || candidates;
        if (!displayedCandidatesInner.length) return;
        const tagName = typeof tagObj === 'string' ? tagObj : tagObj.name;
        setBulkTagLoading(true);
        setTagDropdownOpen(false);
        try {
            const ids = displayedCandidatesInner.map(c => c.id);
            const res = await fetch('/api/candidates/bulk-tag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids, tag: tagName, action: 'add' })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Se agregó la etiqueta "${tagName}" a ${ids.length} candidatos`, 'success');
                // Optimistically update local state
                const applyTags = (c) => {
                    const existingTags = c.tags || [];
                    return { ...c, tags: existingTags.includes(tagName) ? existingTags : [...existingTags, tagName] };
                };
                
                setCandidates(prev => prev ? prev.map(c => ids.includes(c.id) ? applyTags(c) : c) : []);
                if (aiFilteredCandidates) {
                    setAiFilteredCandidates(prev => prev ? prev.map(c => ids.includes(c.id) ? applyTags(c) : c) : null);
                }
            } else {
                showToast(data.error || 'Error aplicando etiquetas', 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Error de red al aplicar etiquetas', 'error');
        } finally {
            setBulkTagLoading(false);
        }
    };


    // 📡 SSE: Real-time candidate updates
    const { newCandidate, updatedCandidate, globalStats } = useCandidatesSSE();

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

    // Listen for updated candidates via SSE
    useEffect(() => {
        if (updatedCandidate && updatedCandidate.candidateId && updatedCandidate.updates) {
            setCandidates(prev => {
                const index = prev.findIndex(c => c.id === updatedCandidate.candidateId);
                if (index === -1) return prev; // Not in list, ignore

                const updatedList = [...prev];
                updatedList[index] = { ...updatedList[index], ...updatedCandidate.updates };
                return updatedList;
            });

            // Si el candidato actualizado es el que está seleccionado en el chat lateral, actualizarlo también
            if (selectedCandidate && selectedCandidate.id === updatedCandidate.candidateId) {
                setSelectedCandidate(prev => ({ ...prev, ...updatedCandidate.updates }));
            }
        }
    }, [updatedCandidate]);

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

            // Cargar settings OpenClaw
            try {
                const res = await fetch('/api/bot-ia/settings');
                const data = await res.json();
                if (res.ok) setOpenClawActive(!!data.openClawActive);
            } catch (e) {
                console.error('Error fetching settings', e);
            } finally {
                setOpenClawLoading(false);
            }
        };

        const loadFields = async () => {
            const result = await getFields();
            if (result.success) {
                // Remove 'foto' and default hidden fields if necessary
                const dynamicFields = result.fields.filter(f => f.value !== 'foto');
                setFields(dynamicFields);

                // Initialize column order if not present in localStorage
                setColumnOrder(prevOrder => {
                    const existingOrderIds = new Set(prevOrder);
                    const newIds = dynamicFields.map(f => f.value).filter(id => !existingOrderIds.has(id));

                    // Keep existing order, append new ones at the end
                    const mergedOrder = [...prevOrder.filter(id => dynamicFields.some(f => f.value === id)), ...newIds];

                    // Save merged order back if it changed
                    if (mergedOrder.length !== prevOrder.length || mergedOrder.some((v, i) => v !== prevOrder[i])) {
                        try { localStorage.setItem('candidateColumnOrder', JSON.stringify(mergedOrder)); } catch (e) { }
                    }
                    return mergedOrder;
                });
            }
        };

        loadInitialData();

        // Polling de candidatos
        const subscription = new CandidatesSubscription((newCandidates, newStats) => {
            // Only update if not filtering by AI (polling refreshes full list based on current page/search)
            if (!aiFilteredCandidates) {
                setCandidates(newCandidates);
                if (newStats) setStats(prev => ({ ...prev, ...newStats })); // Merge live stats
            }
        }, 3000);

        subscription.updateParams(LIMIT, (currentPage - 1) * LIMIT, search);
        subscription.start();

        return () => subscription.stop();
    }, [aiFilteredCandidates]); // Restart/Update subscription when context changes



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
                const { intent, explanation } = data.action;

                setAiActionOpen(false); // Close AI Input

                if (intent === 'REFINE_FILTER') {
                    showToast(explanation || 'Refinando filtros...', 'info');
                    // Removed broken aiQuery reference.
                    // Instead just instruct user to use main search for filtering.
                    showToast('Utiliza la barra de búsqueda superior para refinar mejor', 'info');
                } else {
                    showToast('No entendí la acción. Intenta de nuevo.', 'warning');
                }
            }
        } catch (error) {
            console.error('AI Action Error', error);
            showToast('Error procesando acción', 'error');
        }
    };

    const loadCandidates = async (page = 1) => {
        setLoading(true);
        if (candidates.length === 0) setIsInitialLoading(true);
        const offset = (page - 1) * LIMIT;

        try {
            const result = await getCandidates(LIMIT, offset, search);

            if (result.success) {
                setCandidates(result.candidates);
                setTotalItems(result.total || result.count || 0);
            } else {
                showToast('Error cargando candidatos', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('Error de conexión', 'error');
        } finally {
            setLoading(false);
            setIsInitialLoading(false);
        }
    };

    // Trigger load on Search or Page Change ONLY when changing, not on mount
    const isFirstRun = useRef(true);
    useEffect(() => {
        if (isFirstRun.current) {
            isFirstRun.current = false;
            return;
        }
        loadCandidates(currentPage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, search]);

    const toggleOpenClaw = async () => {
        const newState = !openClawActive;
        setOpenClawLoading(true);
        try {
            const res = await fetch('/api/bot-ia/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ openClawActive: newState })
            });
            if (res.ok) {
                setOpenClawActive(newState);
                showToast && showToast(`Agente OpenClaw (VPS) ${newState ? 'Encendido' : 'Apagado'}`, 'success');
            } else {
                showToast && showToast('Error guardando config', 'error');
            }
        } catch (e) {
            showToast && showToast('Error de red al alternar OpenClaw', 'error');
        } finally {
            setOpenClawLoading(false);
        }
    };

    /**
     * Alternar estado de bloqueo del candidato
     */
    const handleBlockToggle = React.useCallback(async (candidate) => {
        const isCurrentlyBlocked = candidate.blocked === true;
        const action = isCurrentlyBlocked ? 'desbloquear' : 'bloquear';

        setBlockLoading(prev => ({ ...prev, [candidate.id]: true }));
        try {
            const result = await blockCandidate(candidate.id, !isCurrentlyBlocked);
            if (result.success) {
                showToast(result.message || `Candidato ${isCurrentlyBlocked ? 'reactivado' : 'silenciado'} con éxito`, 'success');

                // Actualizar estado local
                setCandidates(prev => prev.map(c =>
                    c.id === candidate.id ? { ...c, blocked: !isCurrentlyBlocked } : c
                ));
                if (aiFilteredCandidates) {
                    setAiFilteredCandidates(prev => prev.map(c =>
                        c.id === candidate.id ? { ...c, blocked: !isCurrentlyBlocked } : c
                    ));
                }
            } else {
                showToast(`Error al ${action} candidato: ${result.error}`, 'error');
            }
        } catch (error) {
            showToast(`Error de red al ${action} candidato`, 'error');
        } finally {
            setBlockLoading(prev => ({ ...prev, [candidate.id]: false }));
        }
    };

    const handleDelete = React.useCallback(async (e, candidate) => {
        const { id, nombre } = candidate;
        if (e && e.stopPropagation) e.stopPropagation();

        if (!window.confirm(`¿Estás seguro de eliminar a "${nombre}" permanentemente?\n\nEsta acción no se puede deshacer.`)) {
            return;
        }

        // Find candidate to get whatsapp number
        
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

    const handleOpenChat = React.useCallback((candidate) => {
        setSelectedCandidate(candidate);
    }, []);

    // --- 🪄 MAGIC AI FIX HANDLER ---
    const handleMagicFix = React.useCallback(async (candidateId, field, currentValue) => {
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
    }, [showToast]);

    // Displayed candidates is just 'candidates' (current page) or AI filtered
    let displayedCandidates = aiFilteredCandidates || candidates;

    if (hideIncomplete) {
        displayedCandidates = displayedCandidates.filter(c => isProfileComplete(c));
    }

    const totalPages = Math.ceil(totalItems / LIMIT);

    return (
        <div className="flex-1 min-h-0 flex flex-col space-y-4">
            {/* Sticky Header Wrapper */}
            <div className="flex-none space-y-4">

                {/* 📊 Live Dashboard - Zuckerberg Style */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {isInitialLoading ? (
                        <>
                            <CardSkeleton />
                            <CardSkeleton />
                            <CardSkeleton />
                        </>
                    ) : (
                        <>
                            {/* Card 1: Candidates */}
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <Users className="w-16 h-16 text-blue-500 transform rotate-12" />
                                </div>
                                <div className="flex flex-col relative z-10">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Total Candidatos</span>
                                    <div className="flex items-center flex-wrap gap-2">
                                        <h3 className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{Number(totalItems).toLocaleString()}</h3>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-[10px] text-emerald-500 font-bold flex items-center bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full border border-emerald-100 dark:border-emerald-800/50">
                                                <CheckCircle className="w-3 h-3 mr-1" /> {Number(stats?.complete || 0).toLocaleString()} Completos
                                            </span>
                                            <span className="text-[10px] text-amber-500 font-bold flex items-center bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full border border-amber-100 dark:border-amber-800/50">
                                                <Clock className="w-3 h-3 mr-1" /> {Number(stats?.pending || 0).toLocaleString()} Incompletos
                                            </span>
                                            <span className="text-[10px] text-blue-500 font-bold flex items-center bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full border border-blue-100 dark:border-blue-800/50">
                                                <Zap className="w-3 h-3 mr-1" /> Activos
                                            </span>
                                        </div>
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
                                            {Number(stats?.incoming || 0).toLocaleString()}
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
                                            {Number(stats?.outgoing || 0).toLocaleString()}
                                        </h3>
                                        <span className="text-[10px] text-purple-500 font-medium flex items-center bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded-full">
                                            <Sparkles className="w-3 h-3 mr-0.5" /> AI & Manual
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Búsqueda */}
                <div className="flex flex-wrap gap-2 sm:gap-4 items-center">
                    <MagicSearch
                        onResults={(results, ai, queryText) => {
                            setAiFilteredCandidates(results);
                            if (queryText) {
                                setAiExplanation(`Buscaste: "${queryText}"`);
                            } else {
                                setAiExplanation(ai?.explanation || 'Búsqueda completada');
                            }
                        }}
                        showToast={showToast}
                    />

                    {/* Hide Incomplete Master Switch */}
                    <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-1.5 rounded-xl shadow-sm cursor-pointer" onClick={() => setHideIncomplete(!hideIncomplete)}>
                        <div className="flex flex-col">
                            <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 leading-none">Incompletos</span>
                            <span className={`text-[10px] font-bold ${!hideIncomplete ? 'text-blue-600' : 'text-gray-400'}`}>
                                {!hideIncomplete ? 'VISIBLES' : 'OCULTOS'}
                            </span>
                        </div>
                        <button
                            type="button"
                            className={`
                                relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
                                ${!hideIncomplete ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
                            `}
                            title="Mostrar u ocultar candidatos con perfil incompleto"
                        >
                            <span
                                className={`
                                    inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                                    ${!hideIncomplete ? 'translate-x-6' : 'translate-x-1'}
                                `}
                            />
                        </button>
                    </div>

                    {/* OpenClaw VPS Agent Toggle */}
                    <div className="flex items-center gap-2 bg-[#f0f2f5] dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)] cursor-pointer" onClick={toggleOpenClaw}>
                        <div className="flex flex-col">
                            <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 leading-none">Agente Externo</span>
                            <span className={`text-[10px] font-bold ${openClawActive ? 'text-green-500' : 'text-gray-400'}`}>
                                OPEN CLAW
                            </span>
                        </div>
                        <button
                            type="button"
                            disabled={openClawLoading}
                            className={`
                                relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shadow-inner
                                ${openClawActive ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-600'}
                            `}
                            title="Encender o apagar envío de webhooks a DigitalOcean OpenClaw"
                        >
                            <span
                                className={`
                                    inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-md
                                    ${openClawActive ? 'translate-x-6' : 'translate-x-1'}
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

                    <div className="relative w-full sm:w-64 group order-first sm:order-none">
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

                    {/* 📡 View WA Status Sub-Component */}
                    <WaStatusViewer triggerRefresh={statusViewerRefresh} />

                    {/* 📡 WhatsApp Status Creator Button */}
                    <button
                        type="button"
                        id="wa-status-creator-btn"
                        onClick={() => setShowStatusCreator(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all border relative overflow-hidden group"
                        style={{
                            background: 'linear-gradient(135deg, #075E54 0%, #25D366 100%)',
                            color: '#fff',
                            border: '1px solid rgba(37,211,102,0.4)',
                            boxShadow: '0 0 12px rgba(37,211,102,0.25)',
                        }}
                        title="Crear estado de WhatsApp"
                    >
                        <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity rounded-xl" />
                        <Radio className="w-3.5 h-3.5 animate-pulse" />
                        <span>Estado WA</span>
                        <Sparkles className="w-3 h-3 opacity-70" />
                    </button>
                </div>

                {/* Alerta de filtrado por IA: iOS Style */}
                {aiFilteredCandidates && (
                    <div className="mb-2 animate-spring-in relative z-[100]">
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
                            <div className="flex items-center gap-2">
                                {/* BULK TAG DROPDOWN */}
                                <div className="relative" ref={tagDropdownRef}>
                                    <button 
                                        onClick={() => setTagDropdownOpen(!tagDropdownOpen)}
                                        disabled={bulkTagLoading}
                                    className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-semibold text-gray-700 dark:text-gray-300 shadow-sm flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                                >
                                    {bulkTagLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Tag className="w-3.5 h-3.5" />}
                                    <span>Etiquetar todos</span>
                                    <ChevronDown className="w-3.5 h-3.5 opacity-50" />
                                </button>

                                {tagDropdownOpen && (
                                    <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-[#202c33] rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden z-50 flex flex-col animate-in fade-in zoom-in duration-200">
                                        <div className="px-3 py-2 bg-gray-50 dark:bg-[#111b21] border-b border-gray-100 dark:border-gray-700">
                                            <span className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest">Añadir a {displayedCandidates.length} cand.</span>
                                        </div>
                                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                            {availableTags.length === 0 ? (
                                                <div className="px-3 py-4 text-center text-xs text-[#8696a0]">No hay etiquetas creadas</div>
                                            ) : (
                                                availableTags.map((tagObj, idx) => {
                                                    const tName = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                                    const tColor = typeof tagObj === 'string' ? '#3b82f6' : tagObj.color;
                                                    const isEditing = editingTag === tName;

                                                    if (isEditing) {
                                                        return (
                                                            <div key={idx} className="px-3 py-2 bg-gray-50 dark:bg-[#111b21] flex flex-col gap-2">
                                                                <div className="flex gap-1">
                                                                    <input 
                                                                        type="text"
                                                                        value={editTagName}
                                                                        onChange={e => setEditTagName(e.target.value)}
                                                                        className="flex-1 text-xs px-2 py-1 focus:outline-none dark:bg-[#202c33] dark:text-white rounded border border-gray-300 dark:border-gray-600"
                                                                        autoFocus
                                                                    />
                                                                </div>
                                                                <div className="flex justify-between items-center">
                                                                    <div className="flex gap-1">
                                                                        {TAG_COLORS.map(c => (
                                                                            <button 
                                                                                key={c}
                                                                                onClick={(e) => { e.stopPropagation(); setEditTagColor(c); }}
                                                                                className={`w-4 h-4 rounded-full ${editTagColor === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                                                                                style={{ backgroundColor: c }}
                                                                            />
                                                                        ))}
                                                                    </div>
                                                                    <div className="flex gap-1">
                                                                        <button onClick={(e) => { e.stopPropagation(); setEditingTag(null); }} className="p-1 text-gray-400 hover:text-gray-600">
                                                                            <X className="w-3.5 h-3.5" />
                                                                        </button>
                                                                        <button 
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                if (editTagName.trim()) {
                                                                                    const newGlobal = availableTags.map(t => 
                                                                                        (typeof t === 'string' ? t : t.name) === tName 
                                                                                        ? { ...t, name: editTagName.trim(), color: editTagColor } 
                                                                                        : t
                                                                                    );
                                                                                    saveTagsGlobal(newGlobal);
                                                                                    setEditingTag(null);
                                                                                }
                                                                            }} 
                                                                            className="p-1 text-green-500 hover:text-green-600"
                                                                        >
                                                                            <Check className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <div 
                                                            key={idx}
                                                            onClick={() => handleBulkTag(tagObj)}
                                                            className="w-full text-left px-3 py-2 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-gray-50 dark:hover:bg-[#202c33] flex items-center justify-between group/item cursor-pointer transition"
                                                        >
                                                            <div className="flex items-center gap-2 truncate">
                                                                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tColor }}></div>
                                                                <span className="font-medium truncate">{tName}</span>
                                                            </div>
                                                            <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setEditingTag(tName);
                                                                        setEditTagName(tName);
                                                                        setEditTagColor(tColor);
                                                                    }}
                                                                    className="p-1 text-[#8696a0] hover:text-blue-500"
                                                                    title="Editar etiqueta"
                                                                >
                                                                    <Pencil className="w-3 h-3" />
                                                                </button>
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        deleteTagGlobal(tName);
                                                                    }}
                                                                    className="p-1 text-[#8696a0] hover:text-red-500"
                                                                    title="Eliminar etiqueta"
                                                                >
                                                                    <X className="w-3.5 h-3.5" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )
                                                })
                                            )}
                                        </div>

                                        {/* Modulo crear nueva etiqueta */}
                                        <div className="p-2 border-t border-gray-100 dark:border-gray-700 flex flex-col gap-2 bg-gray-50 dark:bg-[#111b21]">
                                            <div className="flex justify-between px-1">
                                                {TAG_COLORS.map((c) => (
                                                    <button 
                                                        key={c}
                                                        onClick={(e) => { e.preventDefault(); setEditTagColor(c); }}
                                                        className={`w-3.5 h-3.5 rounded-full hover:scale-110 transition-transform ${editTagColor === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                                                        style={{ backgroundColor: c }}
                                                    />
                                                ))}
                                            </div>
                                            <div className="flex">
                                                <input 
                                                    type="text"
                                                    value={newTagInput}
                                                    onChange={e => setNewTagInput(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && newTagInput.trim()) {
                                                            e.preventDefault();
                                                            const exists = availableTags.some(t => (typeof t === 'string' ? t : t.name).toLowerCase() === newTagInput.trim().toLowerCase());
                                                            if (!exists) {
                                                                const newGlobal = [...availableTags, { name: newTagInput.trim(), color: editTagColor }];
                                                                saveTagsGlobal(newGlobal);
                                                                setNewTagInput('');
                                                            }
                                                        }
                                                    }}
                                                    placeholder="Nueva etiqueta..."
                                                    className="flex-1 text-xs px-2 py-1.5 focus:outline-none dark:bg-[#202c33] dark:text-white rounded-l border-y border-l border-gray-300 dark:border-gray-600 shadow-sm"
                                                />
                                                <button 
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        if (newTagInput.trim()) {
                                                            const exists = availableTags.some(t => (typeof t === 'string' ? t : t.name).toLowerCase() === newTagInput.trim().toLowerCase());
                                                            if (!exists) {
                                                                const newGlobal = [...availableTags, { name: newTagInput.trim(), color: editTagColor }];
                                                                saveTagsGlobal(newGlobal);
                                                                setNewTagInput('');
                                                            }
                                                        }
                                                    }}
                                                    className="bg-blue-500 text-white px-2 py-1.5 rounded-r border-y border-r border-blue-500 hover:bg-blue-600 transition outline-none"
                                                    title="Añadir etiqueta"
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            {/* Botón Cerrar (Resetear) */}
                            <button 
                                onClick={() => {
                                    setAiFilteredCandidates(null);
                                    setSearch('');
                                }}
                                className="p-1.5 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 bg-gray-50 dark:bg-gray-800/50 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-[8px] transition-all border border-gray-200 dark:border-gray-700/50"
                                title="Quitar resultados de IA"
                            >
                                <X className="w-4 h-4" />
                            </button>
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
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                        >
                            <table className="w-full relative">
                                <thead className="sticky top-0 z-20 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm shadow-sm ring-1 ring-black/5">
                                    <tr className="border-b border-gray-200 dark:border-gray-700 text-[10px] uppercase tracking-wider text-gray-500">
                                        <th className="py-1 px-1 w-8"></th>
                                        <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300"></th>
                                        <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">WhatsApp</th>
                                        <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">From</th>

                                        {/* Dynamic Headers (Sortable) */}
                                        <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
                                            {columnOrder.map(colId => {
                                                const field = fields.find(f => f.value === colId);
                                                if (!field) return null;
                                                return <SortableHeaderCell key={field.value} id={field.value} label={field.label} />;
                                            })}
                                        </SortableContext>

                                        <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">Vacante</th>
                                        <th className="text-left py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300">Último Mensaje</th>
                                        <th className="text-center py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300 w-10">
                                            <div className="flex justify-center">
                                                <MessageCircle className="w-4 h-4 opacity-50" />
                                            </div>
                                        </th>
                                        <th className="text-center py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300 w-10">
                                            <div className="flex justify-center">
                                                <Ban className="w-3.5 h-3.5 opacity-50" />
                                            </div>
                                        </th>
                                        <th className="text-center py-1 px-2.5 font-semibold text-gray-700 dark:text-gray-300 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isInitialLoading ? (
                                        <>
                                            {[...Array(8)].map((_, i) => (
                                                <TableRowSkeleton key={i} columns={columnOrder.length + 3} />
                                            ))}
                                        </>
                                    ) :
                                        displayedCandidates.map((candidate) => (
                                        <CandidateRow 
                                            key={candidate.id}
                                            candidate={candidate}
                                            columnOrder={columnOrder}
                                            fieldsMap={fieldsMap}
                                            magicLoading={magicLoading}
                                            isBlockLoading={blockLoading[candidate.id] || false}
                                            onOpenChat={handleOpenChat}
                                            onBlockToggle={handleBlockToggle}
                                            onMagicFix={handleMagicFix}
                                            onDelete={handleDelete}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </DndContext>
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

            {/* 📡 WhatsApp Status Creator Modal */}
            {showStatusCreator && (
                <WaStatusCreator
                    onClose={() => {
                        setShowStatusCreator(false);
                        setStatusViewerRefresh(prev => prev + 1);
                    }}
                    showToast={showToast}
                />
            )}
        </div >
    );
};

export default CandidatesSection;
