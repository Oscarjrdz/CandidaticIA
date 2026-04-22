import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Trash2, Copy, Sparkles, Send, PauseCircle, PlayCircle, XCircle, Tag, X, ChevronDown, CheckCircle2 } from 'lucide-react';
import { getCandidates } from '../services/candidatesService';

const getRelativeTime = (c) => {
    let timestamp = c.createdAt || c.timestamp;
    
    if (!timestamp && c.id && String(c.id).startsWith('cand_')) {
        const parts = String(c.id).split('_');
        if (parts.length > 1 && !isNaN(parseInt(parts[1]))) {
            timestamp = parseInt(parts[1]);
        }
    }
    
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'hace un momento';
    if (diffMins < 60) return `hace ${diffMins} min`;
    if (diffHours < 24 && now.getDate() === date.getDate()) {
        return `hace ${diffHours} hora${diffHours > 1 ? 's' : ''}`;
    }
    
    if (diffDays === 1 || (diffHours < 48 && now.getDate() !== date.getDate())) return 'ayer';
    if (diffDays < 7) {
        const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        return `el ${days[date.getDay()]}`;
    }
    
    return date.toLocaleDateString();
};

const CampaignHistoryItem = ({ h, reuseCampaign, deleteCampaign }) => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        fetch(`/api/bulks?action=history_stats&id=${h.id}`)
            .then(res => res.json())
            .then(data => {
                if (mounted && data.success) {
                    setStats(data.stats);
                }
                if (mounted) setLoading(false);
            })
            .catch(() => {
                if (mounted) setLoading(false);
            });
        return () => { mounted = false; };
    }, [h.id]);

    return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col hover:bg-gray-50 dark:hover:bg-[#202c33] transition-colors">
            <div className="flex justify-between items-start w-full">
                <div>
                    <h3 className="font-bold text-gray-800 dark:text-gray-200">{h.name || "Campaña sin nombre"}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">
                        {new Date(h.date).toLocaleDateString()} • {h.status === 'running' ? '🚀' : h.status === 'completed' ? '✅' : '🛑'} {h.totalSent}/{h.totalTargets} procesados
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={()=>reuseCampaign(h)} className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:hover:bg-indigo-900/60 dark:text-indigo-300 rounded font-bold text-xs flex items-center gap-1 transition-colors">
                        👁️ Re-usar
                    </button>
                    <button onClick={()=>deleteCampaign(h.id)} className="px-2 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 dark:text-red-400 rounded transition-colors">
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
            {/* Stats Row */}
            <div className="flex gap-6 mt-1 pt-3 border-t border-gray-100 dark:border-white/5">
                <div className="flex flex-col">
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">🟢 Enviados</span>
                    <span className="font-mono text-sm text-gray-700 dark:text-gray-300">{loading ? '...' : (stats?.sent || 0)}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">🔘 Entregados</span>
                    <span className="font-mono text-sm text-gray-700 dark:text-gray-300">{loading ? '...' : (stats?.delivered || 0)}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">💙 Leídos</span>
                    <span className="font-mono text-sm text-blue-600 dark:text-blue-400">{loading ? '...' : (stats?.read || 0)}</span>
                </div>
            </div>
        </div>
    );
};

const BulksSection = ({ showToast }) => {
    // Col 1: Candidates
    const [candidates, setCandidates] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loadingChats, setLoadingChats] = useState(true);
    const [selectedCandIds, setSelectedCandIds] = useState(new Set());
    const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'complete', 'incomplete'
    const [selectedTagFilter, setSelectedTagFilter] = useState(null); // tag name or null
    const [availableTags, setAvailableTags] = useState([]);
    const [mobileTab, setMobileTab] = useState('candidates'); // 'candidates', 'messages'

    // Col 2: Messages & Templates
    const [bulkType, setBulkType] = useState('template'); // 'text' | 'template'
    const [metaTemplates, setMetaTemplates] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [templateParams, setTemplateParams] = useState({});
    const [messageText, setMessageText] = useState('');
    
    // Engine State
    const [engineState, setEngineState] = useState(null);

    // History Modal State
    const [showHistory, setShowHistory] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [customCampaignName, setCustomCampaignName] = useState('');
    const [historyList, setHistoryList] = useState([]);
    
    // Custom UI States
    const [showCompletionModal, setShowCompletionModal] = useState(false);
    const [showStartModal, setShowStartModal] = useState(false);
    const [startModalData, setStartModalData] = useState(null);
    const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
    const tagDropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target)) {
                setTagDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const POPULAR_EMOJIS = ["😀","😂","🤣","😉","😊","😍","😘","🥰","🤔","🤫","👍","👎","👏","🙌","🔥","✨","💯","🎉"];

    // Guard para evitar polls concurrentes (race condition)
    const isFetchingRef = useRef(false);

    // Load Candidates & Persistence
    // Load tags
    useEffect(() => {
        fetch('/api/tags')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.tags) {
                    const migrated = data.tags.map((t, i) => {
                        if (typeof t === 'string') return { name: t, color: ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899','#8b5cf6','#64748b'][i % 9] };
                        return t;
                    });
                    setAvailableTags(migrated);
                }
            })
            .catch(e => console.error('Error fetching tags', e));
    }, []);

    useEffect(() => {
        loadCandidates();
        
        // Web Worker inline — inmune a background tab throttling del navegador
        const workerCode = `
            self.onmessage = function(e) {
                if (e.data === 'start') {
                    setInterval(() => self.postMessage('tick'), 1500);
                }
            };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);

        worker.onmessage = () => {
            if (!isFetchingRef.current) {
                fetchEngineStatus();
            }
        };
        worker.postMessage('start');

        // Recover draft from redis
        fetch('/api/bulks?action=get_draft')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.draft) {
                    const parsed = data.draft;
                    if (parsed.messageText) setMessageText(parsed.messageText);
                    if (parsed.selectedCandIds) setSelectedCandIds(new Set(parsed.selectedCandIds));
                }
            })
            .catch(e => console.error("Could not load draft", e));

        // Fetch Meta Templates
        fetch('/api/whatsapp/templates')
            .then(res => res.json())
            .then(data => { if(data.success && data.data) setMetaTemplates(data.data.filter(t => t.status==='APPROVED')); })
            .catch(() => {});

        return () => {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
        };
    }, []);

    // Save draft state on change
    useEffect(() => {
        const draft = {
            messageText,
            selectedCandIds: Array.from(selectedCandIds)
        };
        const timer = setTimeout(() => {
            fetch('/api/bulks?action=save_draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft)
            }).catch(e => console.error("Could not save draft", e));
        }, 1200);
        
        return () => clearTimeout(timer);
    }, [messageText, selectedCandIds]);

    // Auto-alert on campaign complete
    const prevEngineStateRef = useRef(null);
    useEffect(() => {
        if (engineState) {
            const isCurrentlyCompleted = !engineState.isRunning && (engineState.currentCandidateIndex >= (engineState.candidates?.length || 1));
            const wasRunning = prevEngineStateRef.current && prevEngineStateRef.current.isRunning;
            
            if (isCurrentlyCompleted && wasRunning) {
                setTimeout(() => {
                    setShowCompletionModal(true);
                }, 300); // 300ms delay down below lets React render the 100% progress bar before showing the modal
            }
        }
        prevEngineStateRef.current = engineState;
    }, [engineState]);

    const loadCandidates = async () => {
        try {
            const result = await getCandidates(2000, 0, "");
            if (result.success) {
                setCandidates(result.candidates || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingChats(false);
        }
    };

    const fetchEngineStatus = async () => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        try {
            const res = await fetch('/api/bulks?action=status');
            const data = await res.json();
            if (data.success) {
                setEngineState(data.state);
            }
        } catch (e) {
        } finally {
            isFetchingRef.current = false;
        }
    };

    const loadHistory = async () => {
        try {
            const res = await fetch('/api/bulks?action=history_list');
            const data = await res.json();
            if (data.success) setHistoryList(data.history);
        } catch(e) {}
    };

    const openHistory = () => {
        loadHistory();
        setShowHistory(true);
    };

    const reuseCampaign = (camp) => {
        const rawMsgs = camp.messages || [];
        setMessageText(rawMsgs[0] && typeof rawMsgs[0] === 'string' ? rawMsgs[0] : (rawMsgs[0]?.text || ''));
        
        setBulkType(camp.bulkType || 'text');
        if (camp.bulkType === 'template' && camp.templateData) {
            setSelectedTemplateId(camp.templateData.id);
        }
        
        setShowHistory(false);
        showToast && showToast("Campaña cargada. Selecciona a tus destinatarios.", "success");
    };

    const deleteCampaign = async (id) => {
        if (!window.confirm("¿Seguro que quieres borrar este historial?")) return;
        try {
            await fetch('/api/bulks?action=history_delete', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id})
            });
            showToast && showToast("Eliminado", "info");
            loadHistory();
        } catch(e) {}
    };

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

    // Filter Logic
    const filteredCandidates = (candidates || []).filter(c => {
        const searchVal = (searchQuery || "").toLowerCase();
        let matchesSearch = true;
        if (searchVal) {
            matchesSearch = (c?.nombreReal && String(c.nombreReal).toLowerCase().includes(searchVal)) ||
                            (c?.nombre && String(c.nombre).toLowerCase().includes(searchVal)) ||
                            (c?.whatsapp && String(c.whatsapp).includes(searchVal));
        }

        if (!matchesSearch) return false;

        if (activeFilter === 'complete' && !isProfileComplete(c)) return false;
        if (activeFilter === 'incomplete' && isProfileComplete(c)) return false;

        // Tag filter
        if (selectedTagFilter) {
            const candidateTags = c.tags || [];
            const hasTag = candidateTags.some(t => {
                const tName = typeof t === 'string' ? t : t.name;
                return tName === selectedTagFilter;
            });
            if (!hasTag) return false;
        }

        return true;
    });

    const toggleCandidate = (id) => {
        setSelectedCandIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selectedCandIds.size === filteredCandidates.length) {
            setSelectedCandIds(new Set());
        } else {
            setSelectedCandIds(new Set(filteredCandidates.map(c => c.id)));
        }
    };

    const insertEmoji = (emoji) => {
        setMessageText(prev => prev + emoji);
    };

    // Engine Actions
    const handleStartClick = () => {
        if (selectedCandIds.size === 0) return showToast && showToast("Selecciona al menos un candidato", "error");
        
        let validMsgs = [];
        let tplData = null;

        if (bulkType === 'text') {
            if (!messageText.trim()) return showToast && showToast("Crea un mensaje válido", "error");
            validMsgs = [messageText.trim()];
        } else {
            if (!selectedTemplateId) return showToast && showToast("Selecciona una plantilla válida", "error");
            tplData = metaTemplates.find(t => t.id === selectedTemplateId);
            if (!tplData) return showToast && showToast("Plantilla no encontrada", "error");
        }

        const qtyMsgStr = bulkType === 'text' ? `enviando texto libre` : `usando la plantilla '${tplData.name}'`;
        
        setStartModalData({
            count: selectedCandIds.size,
            qtyMsgStr,
            validMsgs,
            tplData
        });
        setShowStartModal(true);
    };

    const confirmStartBulk = async () => {
        if (!startModalData) return;
        setShowStartModal(false);
        setIsSubmitting(true);
        try {
            const res = await fetch('/api/bulks?action=start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidates: Array.from(selectedCandIds),
                    bulkType,
                    messages: startModalData.validMsgs,
                    templateData: startModalData.tplData,
                    templateParams: Object.keys(templateParams).length > 0 ? templateParams : null,
                    campaignName: customCampaignName.trim() || null
                })
            });
            const data = await res.json();
            if (data.success) {
                showToast && showToast("Campaña iniciada", "success");
                setCustomCampaignName('');
                // Establecer estado localmente para garantizar que wasRunning sea true
                if (data.state) setEngineState(data.state);
                setTimeout(fetchEngineStatus, 1000);
            } else {
                showToast && showToast(data.error || "Error al iniciar", "error");
            }
        } catch (e) {
            showToast && showToast("Error de red", "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const abortBulk = async () => {
        if (!window.confirm("¿SEGURO QUE QUIERES ABORTAR TODOS LOS ENVÍOS RESTANTES?")) return;
        try {
            await fetch('/api/bulks?action=abort', { method: 'POST' });
            showToast && showToast("Campaña abortada", "success");
            fetchEngineStatus();
        } catch(e) {}
    };

    const clearBulk = async () => {
        try {
            await fetch('/api/bulks?action=clear', { method: 'POST' });
            setEngineState(null);
            setSelectedCandIds(new Set());
            setCustomCampaignName('');
            setTemplateParams({});
        } catch(e) {}
    };

    const isRunning = engineState?.isRunning;
    const isCompleted = engineState && !engineState.isRunning && (engineState.currentCandidateIndex >= (engineState.candidates?.length || 1) || engineState.isAborted);

    return (
        <div className="flex flex-col lg:flex-row h-full w-full bg-[#f0f2f5] dark:bg-[#111b21] font-sans">
            
            {/* Mobile Tab Bar */}
            <div className="lg:hidden flex border-b border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] shrink-0">
                {[{id:'candidates',label:'Destinatarios',emoji:'👥'},{id:'messages',label:'Mensaje y Enviar',emoji:'💬'}].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setMobileTab(tab.id)}
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider text-center transition-colors border-b-2 ${
                            mobileTab === tab.id
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'
                        }`}
                    >
                        <span className="mr-1">{tab.emoji}</span>{tab.label}
                        {tab.id === 'candidates' && selectedCandIds.size > 0 && (
                            <span className="ml-1 bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{selectedCandIds.size}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* COLUMN 1: CANDIDATES */}
            <div className={`${mobileTab === 'candidates' ? 'flex' : 'hidden'} lg:flex w-full lg:w-[40%] flex-col border-r border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] min-h-0`}>
                <div className="p-3 bg-white dark:bg-[#111b21] border-b border-[#f0f2f5] dark:border-[#222e35]">
                    <h2 className="text-lg font-bold text-[#111b21] dark:text-[#d1d7db] mb-2">Destinatarios</h2>
                    
                    <div className="bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-3 py-1.5 flex items-center mb-2">
                        <Search className="w-4 h-4 text-[#54656f] dark:text-[#aebac1] mr-3" />
                        <input 
                            type="text" 
                            placeholder="Buscar candidatos..." 
                            className="flex-1 bg-transparent border-none outline-none text-sm text-[#111b21] dark:text-[#d1d7db]"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-wrap gap-2 pb-2">
                        <button 
                            onClick={() => setActiveFilter('all')}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                activeFilter === 'all' 
                                ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                            }`}
                        >Todos</button>
                        <button 
                            onClick={() => setActiveFilter('complete')}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                activeFilter === 'complete' 
                                ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                            }`}
                        >Completos</button>
                        <button 
                            onClick={() => setActiveFilter('incomplete')}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                activeFilter === 'incomplete' 
                                ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                            }`}
                        >Incompletos</button>
                    </div>

                    {/* Tag Filter Dropdown */}
                    {availableTags.length > 0 && (
                        <div className="flex items-center gap-2 pb-2">
                            <div className="relative flex-1" ref={tagDropdownRef}>
                                <div 
                                    onClick={() => setTagDropdownOpen(!tagDropdownOpen)}
                                    className={`w-full bg-[#f0f2f5] dark:bg-[#202c33] border ${selectedTagFilter ? 'border-transparent' : 'border-gray-200 dark:border-gray-700'} rounded-lg pl-9 pr-8 py-2.5 text-sm outline-none font-medium text-left cursor-pointer transition-all flex items-center shadow-sm relative`}
                                    style={selectedTagFilter ? {
                                        boxShadow: `0 0 0 2px ${(availableTags.find(t => (typeof t === 'string' ? t : t.name) === selectedTagFilter))?.color || '#3b82f6'}`,
                                        borderColor: 'transparent'
                                    } : {}}
                                >
                                    <Tag className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${selectedTagFilter ? 'text-[#111b21] dark:text-[#e9edef]' : 'text-gray-400 dark:text-gray-500'}`} style={selectedTagFilter ? { color: (availableTags.find(t => (typeof t === 'string' ? t : t.name) === selectedTagFilter))?.color } : {}} />
                                    <span className="flex-1 truncate text-[#111b21] dark:text-[#e9edef]">{selectedTagFilter || 'Todas las etiquetas'}</span>
                                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${tagDropdownOpen ? 'rotate-180' : ''}`} />
                                </div>
                                
                                {tagDropdownOpen && (
                                    <div className="absolute z-50 w-full mt-2 bg-white dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl py-2 max-h-72 overflow-y-auto custom-scrollbar transform origin-top animate-expand-in">
                                        <div 
                                            onClick={() => { setSelectedTagFilter(null); setTagDropdownOpen(false); }}
                                            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center gap-2 ${!selectedTagFilter ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-bold' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#111b21]'}`}
                                        >
                                            <div className="w-4 h-4 rounded border border-gray-300 dark:border-gray-600 flex items-center justify-center">
                                                {!selectedTagFilter && <div className="w-2 h-2 rounded-sm bg-indigo-500"></div>}
                                            </div>
                                            Todas las etiquetas
                                        </div>
                                        {availableTags.map((tag, idx) => {
                                            const tName = typeof tag === 'string' ? tag : tag.name;
                                            const tColor = typeof tag === 'string' ? '#3b82f6' : tag.color;
                                            const countWithTag = (candidates || []).filter(c =>
                                                (c.tags || []).some(t => (typeof t === 'string' ? t : t.name) === tName)
                                            ).length;
                                            const isSelected = selectedTagFilter === tName;
                                            
                                            // Solo mostrar etiquetas que tienen candidatos en esta vista
                                            if (countWithTag === 0 && !isSelected) return null;
                                            
                                            return (
                                                <div 
                                                    key={idx}
                                                    onClick={() => { setSelectedTagFilter(tName); setTagDropdownOpen(false); }}
                                                    className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#111b21]'}`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: tColor }}></div>
                                                        <span className="truncate">{tName}</span>
                                                    </div>
                                                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#111b21] text-gray-500 dark:text-gray-400">
                                                        {countWithTag}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            {selectedTagFilter && (
                                <button
                                    onClick={() => setSelectedTagFilter(null)}
                                    className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shrink-0"
                                    title="Quitar filtro"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    )}

                    <div className="flex justify-between items-center text-sm px-1">
                        <span className="text-[#54656f] dark:text-[#8696a0] font-medium">{selectedCandIds.size} seleccionados</span>
                        <button onClick={toggleAll} className="text-blue-500 hover:text-blue-600 font-medium cursor-pointer" disabled={isRunning}>
                            {selectedCandIds.size === filteredCandidates.length ? "Deseleccionar todos" : "Seleccionar todos"}
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loadingChats ? (
                        <div className="p-6 text-center text-[#54656f] text-sm">Cargando...</div>
                    ) : filteredCandidates.length === 0 ? (
                        <div className="p-6 text-center text-[#54656f] text-sm">Ningún candidato coincide.</div>
                    ) : (
                        filteredCandidates.map(c => (
                            <div 
                                key={c.id} 
                                onClick={() => !isRunning && toggleCandidate(c.id)}
                                className={`flex items-center gap-3 p-3 border-b border-[#f0f2f5] dark:border-[#202c33] cursor-pointer hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] transition-colors ${selectedCandIds.has(c.id) ? 'bg-[#ebf5ff] dark:bg-[#1c2f3d]' : ''} ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <input 
                                    type="checkbox" 
                                    checked={selectedCandIds.has(c.id)} 
                                    readOnly 
                                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-lg shadow-sm shrink-0">
                                    {(c.nombreReal || c.nombre || c.whatsapp || "?").charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-0.5">
                                        <h3 className="font-semibold text-sm text-[#111b21] dark:text-[#e9edef] truncate pr-2">
                                            {c.nombreReal || c.nombre || c.whatsapp}
                                        </h3>
                                        {getRelativeTime(c) && (
                                            <span className="text-[11px] text-[#8696a0] whitespace-nowrap font-medium" title="Fecha de captura">
                                                {getRelativeTime(c)}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[13px] text-[#54656f] dark:text-[#8696a0] truncate">
                                        {c.whatsapp} • {c.tags?.length || 0} etiquetas
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* COLUMN 2: PLANTILLA & ACTIONS */}
            <div className={`${mobileTab === 'messages' ? 'flex' : 'hidden'} lg:flex w-full lg:w-[60%] flex-col border-r border-[#d1d7db] dark:border-[#222e35] bg-[#efeae2] dark:bg-[#0b141a] min-h-0 relative`}>
                <div className="p-3 bg-white dark:bg-[#111b21] border-b border-[#f0f2f5] dark:border-[#222e35] shadow-sm relative z-10 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <h2 className="text-lg font-bold text-[#111b21] dark:text-[#d1d7db]">Mensaje a enviar</h2>
                        <button 
                            onClick={openHistory} 
                            className="text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 py-1.5 px-3 rounded shadow-sm flex items-center gap-1 font-bold transition-colors"
                        >
                            📜 Historial
                        </button>
                    </div>
                    <button 
                        onClick={() => setBulkType(bulkType === 'text' ? 'template' : 'text')}
                        className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline cursor-pointer"
                        disabled={isRunning}
                    >
                        {bulkType === 'template' ? 'Usar texto libre' : 'Volver a plantillas (Recomendado)'}
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                    {bulkType === 'template' ? (
                        <div className="bg-white dark:bg-[#111b21] rounded-xl shadow-sm p-4 relative border border-green-200 dark:border-green-900 flex flex-col gap-4">
                            <div className="text-sm text-green-700 dark:text-green-400 font-bold bg-green-50 dark:bg-green-900/20 px-3 py-3 rounded-lg flex gap-2 items-center">
                                <span className="text-xl">✅</span>
                                <div>
                                    <span className="block">Las plantillas evaden la regla de 24 horas.</span>
                                    <span className="text-xs font-normal opacity-80 mt-0.5 block">Solo puedes enviar texto libre hacia personas que te escribieron en el último día. Para todo lo demás, usa Plantillas.</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1.5">Selecciona tu plantilla</label>
                                <select 
                                    value={selectedTemplateId} 
                                    onChange={(e) => {
                                        setSelectedTemplateId(e.target.value);
                                        setTemplateParams({});
                                    }}
                                    disabled={isRunning}
                                    className="w-full bg-[#f0f2f5] dark:bg-[#202c33] border-none rounded-lg p-3 text-[15px] text-[#111b21] dark:text-[#e9edef] outline-none font-bold shadow-sm"
                                >
                                    <option value="">-- Elige una plantilla --</option>
                                    {metaTemplates.map(t => (
                                        <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
                                    ))}
                                </select>
                            </div>

                            {selectedTemplateId && (
                                <div className="bg-[#f0f2f5] dark:bg-[#202c33] p-4 rounded-xl border border-[#d1d7db] dark:border-[#222e35]">
                                    <p className="text-[11px] font-bold text-gray-500 uppercase mb-2">Vista Previa</p>
                                    <div className="text-base text-gray-800 dark:text-gray-200 whitespace-pre-wrap bg-white dark:bg-[#111b21] p-4 rounded-lg shadow-sm">
                                        {(() => {
                                            const tData = metaTemplates.find(t => t.id === selectedTemplateId);
                                            const bodyComponent = tData?.components?.find(c => c.type === 'BODY') || tData?.components?.find(c => c.type === 'body');
                                            return bodyComponent ? bodyComponent.text : '[Sin cuerpo texto]';
                                        })()}
                                    </div>
                                    {(() => {
                                        const tData = metaTemplates.find(t => t.id === selectedTemplateId);
                                        const bodyComponent = tData?.components?.find(c => c.type === 'BODY') || tData?.components?.find(c => c.type === 'body');
                                        const hasVars = bodyComponent?.text?.match(/\{\{[^}]+\}\}/g);
                                        if (hasVars) {
                                            const uniqueVars = [...new Set(hasVars)];
                                            return (
                                                <div className="mt-3 flex flex-col gap-2">
                                                    <div className="text-[11px] font-bold text-gray-500 uppercase">Valores de Variables</div>
                                                    {uniqueVars.map((v, idx) => {
                                                        const varNum = v.replace(/[{}]/g, '');
                                                        return (
                                                            <div key={idx} className="flex items-center gap-2">
                                                                <span className="text-xs font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded font-bold shrink-0">{v}</span>
                                                                <input
                                                                    type="text"
                                                                    value={templateParams[varNum] || ''}
                                                                    onChange={(e) => setTemplateParams(prev => ({ ...prev, [varNum]: e.target.value }))}
                                                                    placeholder="Nombre del candidato (auto)"
                                                                    className="flex-1 bg-white dark:bg-[#111b21] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-[#111b21] dark:text-[#e9edef] outline-none focus:border-blue-400 transition-colors"
                                                                    disabled={isRunning}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                    })}
                                                    <div className="flex justify-between items-center mt-1">
                                                        <p className="text-[10px] text-gray-400 dark:text-gray-500">Deja vacío para usar el nombre del candidato.</p>
                                                        <p className="text-[10px] text-green-500 font-bold flex items-center gap-1"><span className="text-[14px]">✓</span> Se guarda al escribir</p>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            )}
                        </div>
                    ) : (
                        // TEXT MODE
                        <div className="bg-white dark:bg-[#111b21] rounded-xl shadow-sm p-4 relative border border-transparent focus-within:border-blue-400 dark:focus-within:border-blue-500 transition-colors h-[40vh] flex flex-col">
                            <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Redactor de Texto Libre</div>
                            <textarea
                                value={messageText}
                                onChange={(e) => setMessageText(e.target.value)}
                                disabled={isRunning}
                                placeholder="Escribe tu mensaje libre aquí. (Recuerda que solo llegará a personas que te enviaron mensaje en las últimas 24 horas)."
                                className="w-full bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg p-3 flex-1 border-none outline-none resize-none text-[15px] text-[#111b21] dark:text-[#e9edef]"
                            />

                            <div className="mt-4 flex flex-wrap gap-2 pt-2" style={{opacity: isRunning ? 0.3 : 1, pointerEvents: isRunning ? 'none' : 'auto'}}>
                                {POPULAR_EMOJIS.map(em => (
                                    <button key={em} onClick={() => insertEmoji(em)} className="hover:bg-gray-100 dark:hover:bg-gray-800 p-2 rounded-lg transition-colors text-xl bg-gray-50 dark:bg-[#1a2329] border border-gray-100 dark:border-gray-800">
                                        {em}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                                {/* Progress Engine Summary */}
                    {engineState && (
                        <div className={`mt-4 border ${engineState.isRunning ? 'border-indigo-100 dark:border-indigo-900/50' : 'border-green-100 dark:border-green-900/50'} rounded-xl overflow-hidden bg-white dark:bg-[#111b21] shadow-sm transition-colors`}>
                            <div className={`p-3 text-white font-bold flex items-center justify-between ${engineState.isRunning ? 'bg-indigo-600' : (engineState.currentCandidateIndex >= (engineState.candidates?.length || 1) ? 'bg-green-600' : 'bg-gray-600')}`}>
                                <div className="flex items-center gap-2">
                                    {engineState.isRunning ? <span className="animate-spin">⚙️</span> : (engineState.currentCandidateIndex >= (engineState.candidates?.length || 1) ? '✅' : '⏹️')}
                                    <span>{engineState.isRunning ? 'Progreso de Envío' : (engineState.currentCandidateIndex >= (engineState.candidates?.length || 1) ? 'Campaña Completada' : 'Envío Detenido')}</span>
                                </div>
                                <span className="text-xs bg-black/20 px-2 py-0.5 rounded-full">{engineState.isRunning ? 'Enviando...' : (engineState.currentCandidateIndex >= (engineState.candidates?.length || 1) ? '100%' : 'Detenido')}</span>
                            </div>
                            <div className="p-4">
                                <div className="mb-4">
                                    <div className="flex justify-between text-sm font-bold text-gray-700 dark:text-gray-300 uppercase mb-2">
                                        <span>Progreso</span>
                                        <span>{Math.min(engineState.currentCandidateIndex, engineState.candidates?.length || 0)} / {engineState.candidates?.length || 0}</span>
                                    </div>
                                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                                        <div className="bg-indigo-600 h-3 rounded-full transition-all duration-300" style={{width: `${(engineState.currentCandidateIndex / (engineState.candidates?.length || 1)) * 100}%`}}></div>
                                    </div>
                                </div>
                                <div className="text-sm text-gray-600 dark:text-gray-300 font-bold bg-gray-50 dark:bg-[#202c33] p-3 rounded-lg border border-gray-100 dark:border-gray-800">
                                    Entregados exitosamente: <strong className="text-indigo-600 dark:text-indigo-400 text-lg ml-1">{engineState.totalSent}</strong>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Primary Action Buttons */}
                <div className="p-4 bg-white dark:bg-[#111b21] border-t border-[#d1d7db] dark:border-[#222e35] shadow-2xl relative z-20">
                    {/* Custom Campaign Name Input */}
                    {!isRunning && !isCompleted && (
                        <div className="mb-4">
                            <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1.5 ml-1">Nombre de la Campaña (Opcional)</label>
                            <input
                                type="text"
                                value={customCampaignName}
                                onChange={(e) => setCustomCampaignName(e.target.value)}
                                placeholder="Ej: Invitación Monterrey"
                                className="w-full bg-[#f0f2f5] dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 focus:border-blue-500 rounded-lg p-3 text-sm text-[#111b21] dark:text-[#e9edef] outline-none transition-colors"
                            />
                        </div>
                    )}

                    {isRunning ? (
                        <button 
                            onClick={abortBulk}
                            className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-4 px-4 rounded-xl shadow-lg transition-transform transform active:scale-[0.98] flex items-center justify-center gap-2 text-xl"
                        >
                            <XCircle size={24} />
                            ABORTAR ENVÍOS
                        </button>
                    ) : isCompleted ? (
                        <button 
                            onClick={clearBulk}
                            className="w-full bg-green-600 hover:bg-green-700 text-white font-black tracking-wide py-4 px-4 rounded-xl shadow-[0_10px_20px_rgba(22,163,74,0.2)] transition-all transform hover:-translate-y-1 active:scale-[0.98] flex items-center justify-center gap-2 text-xl"
                        >
                            <span className="text-2xl">✨</span>
                            CREAR NUEVA CAMPAÑA
                        </button>
                    ) : (
                        <button 
                            onClick={handleStartClick}
                            className={`w-full ${isSubmitting ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'} text-white font-black tracking-wide py-4 px-4 rounded-xl shadow-[0_10px_20px_rgba(37,99,235,0.2)] transition-all transform ${isSubmitting ? '' : 'hover:-translate-y-1 active:scale-[0.98]'} flex items-center justify-center gap-3 text-xl disabled:opacity-50 disabled:cursor-not-allowed`}
                            disabled={selectedCandIds.size === 0 || isSubmitting}
                        >
                            {isSubmitting ? <span className="animate-spin text-2xl">⏳</span> : <Send size={24} />}
                            {isSubmitting ? 'PREPARANDO ENVÍOS...' : 'INICIAR CAMPAÑA INSTANTÁNEA'}
                        </button>
                    )}
                </div>
            </div>
            
            {/* HISTORY MODAL */}
            {showHistory && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-white dark:bg-[#111b21] w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-[#202c33]">
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">📜 Historial de Campañas</h2>
                            <button onClick={()=>setShowHistory(false)} className="text-gray-500 hover:text-gray-800 dark:hover:text-white p-1">
                                <XCircle size={24} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 bg-white dark:bg-[#111b21]">
                            {historyList.length === 0 ? (
                                <p className="text-center text-gray-500 dark:text-gray-400 py-8">No hay campañas guardadas.</p>
                            ) : (
                                <div className="space-y-3">
                                    {historyList.map(h => (
                                        <CampaignHistoryItem 
                                            key={h.id} 
                                            h={h} 
                                            reuseCampaign={reuseCampaign} 
                                            deleteCampaign={deleteCampaign} 
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            
            {/* CONFIRM START MODAL */}
            {showStartModal && startModalData && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" style={{ animation: 'fadeIn 0.2s ease-out' }}>
                    <div className="bg-white dark:bg-[#111b21] w-full max-w-md rounded-[24px] shadow-2xl overflow-hidden p-8 text-center flex flex-col items-center border border-gray-100 dark:border-gray-800" style={{ animation: 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
                        <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-6">
                            <Send className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h2 className="text-2xl font-black text-gray-800 dark:text-white mb-2">Confirmar Lanzamiento</h2>
                        <p className="text-gray-500 dark:text-gray-400 mb-8 font-medium">
                            ¿Estás seguro de contactar a <strong className="text-gray-800 dark:text-gray-200">{startModalData.count}</strong> candidatos {startModalData.qtyMsgStr}?
                            <br/><span className="text-sm mt-2 block opacity-80">(Los envíos serán inmediatos y sin demoras)</span>
                        </p>
                        
                        <div className="flex gap-3 w-full">
                            <button 
                                onClick={() => setShowStartModal(false)}
                                className="flex-1 bg-gray-100 hover:bg-gray-200 dark:bg-[#202c33] dark:hover:bg-[#2a3942] text-gray-700 dark:text-gray-300 font-bold py-4 rounded-xl transition-all text-sm tracking-wide"
                            >
                                CANCELAR
                            </button>
                            <button 
                                onClick={confirmStartBulk}
                                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-[0_8px_16px_rgba(37,99,235,0.2)] transition-all transform hover:-translate-y-1 active:scale-[0.98] text-sm tracking-wide"
                            >
                                SÍ, ENVIAR AHORA
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* COMPLETION MODAL */}
            {showCompletionModal && (
                <>
                    <style>{`
                        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes popIn { 
                            0% { opacity: 0; transform: scale(0.9) translateY(10px); } 
                            100% { opacity: 1; transform: scale(1) translateY(0); } 
                        }
                    `}</style>
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" style={{ animation: 'fadeIn 0.2s ease-out' }}>
                        <div className="bg-white dark:bg-[#111b21] w-full max-w-sm rounded-[24px] shadow-2xl overflow-hidden p-8 text-center flex flex-col items-center border border-gray-100 dark:border-gray-800" style={{ animation: 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
                            <div className="w-20 h-20 bg-[#d9fdd3] dark:bg-[#0a332c] rounded-full flex items-center justify-center mb-6">
                                <CheckCircle2 className="w-10 h-10 text-[#10a37f] dark:text-[#25d366]" />
                            </div>
                            <h2 className="text-2xl font-black text-gray-800 dark:text-white mb-2">¡Campaña Finalizada!</h2>
                            <p className="text-gray-500 dark:text-gray-400 mb-8 font-medium">Los mensajes masivos han sido procesados exitosamente.</p>
                            
                            <button 
                                onClick={() => {
                                    setShowCompletionModal(false);
                                    clearBulk();
                                }}
                                className="w-full bg-[#10a37f] hover:bg-[#0e906f] dark:bg-[#25d366] dark:hover:bg-[#1faa53] dark:text-[#111b21] text-white font-bold py-4 rounded-xl shadow-[0_8px_16px_rgba(16,163,127,0.2)] dark:shadow-[0_8px_16px_rgba(37,211,102,0.1)] transition-all transform hover:-translate-y-1 active:scale-[0.98] text-lg tracking-wide"
                            >
                                ACEPTAR Y LIMPIAR
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default BulksSection;
