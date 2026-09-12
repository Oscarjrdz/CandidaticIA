import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useConfirmModal } from './ui/ConfirmModal';
import { Search, Trash2, Send, XCircle, Tag, X, ChevronDown, CheckCircle2, Users, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useToastContext } from '../contexts/ToastContext';
import { extractTemplateVariables, renderMetaTemplatePreviewText } from '../utils/metaTemplatePreview';

const getCandidateTimestamp = (c) => {
    // Priority: primerContacto (real creation date) > createdAt > ID-embedded timestamp
    let timestamp = c.primerContacto || c.createdAt || c.timestamp;

    if (!timestamp && c.id && String(c.id).startsWith('cand_')) {
        const parts = String(c.id).split('_');
        if (parts.length > 1 && !isNaN(parseInt(parts[1]))) {
            timestamp = parseInt(parts[1]);
        }
    }

    if (!timestamp) return 0;
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? 0 : date.getTime();
};

const getRelativeTime = (c) => {
    const ts = getCandidateTimestamp(c);
    if (!ts) return '';
    const date = new Date(ts);

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

// ─── Faceta: dimensiones y estado inicial ──────────────────────────────────────
const EMPTY_SELECTION = { genero: [], municipio: [], escolaridad: [], edadRange: { min: '', max: '' }, tags: [], estatus: '', ventana24h: false };

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

// ─── Dropdown multi-select con conteos drill-down ──────────────────────────────
const MultiSelectDropdown = ({ title, icon, values, counts, selected, onToggle, onClear, searchable = false, colorForValue, disabled }) => {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const ref = useRef(null);

    useEffect(() => {
        const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, []);

    if (!values || values.length === 0) return null;

    const list = searchable && q ? values.filter(v => v.toLowerCase().includes(q.toLowerCase())) : values;
    const summary = selected.length === 0 ? 'Todas' : (selected.length === 1 ? selected[0] : `${selected.length} seleccionadas`);

    return (
        <div className="relative" ref={ref}>
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                {icon}{title}
                {selected.length > 0 && <span className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full normal-case">{selected.length}</span>}
            </label>
            <button
                type="button"
                onClick={() => !disabled && setOpen(o => !o)}
                disabled={disabled}
                className={`w-full flex items-center justify-between bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-3 py-2.5 text-sm text-left transition-colors border ${
                    selected.length > 0 ? 'border-[#25d366]/60 text-[#111b21] dark:text-[#e9edef]' : 'border-transparent text-[#54656f] dark:text-[#aebac1]'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#e9edef] dark:hover:bg-[#2a3942] cursor-pointer'}`}
            >
                <span className="truncate">{summary}</span>
                <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute z-[60] left-0 right-0 mt-1 bg-white dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl py-1.5 animate-expand-in origin-top">
                    {searchable && (
                        <div className="px-2 pb-1.5">
                            <div className="bg-[#f0f2f5] dark:bg-[#111b21] rounded-lg px-2.5 py-1.5 flex items-center">
                                <Search className="w-3.5 h-3.5 text-[#54656f] dark:text-[#aebac1] mr-2" />
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder={`Buscar ${title.toLowerCase()}...`}
                                    className="flex-1 bg-transparent border-none outline-none text-xs text-[#111b21] dark:text-[#d1d7db]"
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                    {selected.length > 0 && (
                        <button onClick={() => onClear && onClear()} className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1">
                            <X className="w-3 h-3" /> Limpiar selección
                        </button>
                    )}
                    <div className="max-h-60 overflow-y-auto custom-scrollbar">
                        {list.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-gray-400">Sin coincidencias</div>
                        ) : list.map(v => {
                            const isSel = selected.includes(v);
                            const count = counts?.[v] ?? 0;
                            return (
                                <div
                                    key={v}
                                    onClick={() => onToggle(v)}
                                    className={`px-3 py-2 flex items-center gap-2.5 cursor-pointer text-sm transition-colors ${isSel ? 'bg-[#d9fdd3]/50 dark:bg-[#0a332c]/60' : 'hover:bg-gray-50 dark:hover:bg-[#111b21]'}`}
                                >
                                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isSel ? 'bg-[#25d366] border-[#25d366]' : 'border-gray-300 dark:border-gray-600'}`}>
                                        {isSel && <CheckCircle2 className="w-3 h-3 text-white" />}
                                    </span>
                                    {colorForValue && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorForValue(v) }} />}
                                    <span className={`flex-1 truncate ${isSel ? 'font-semibold text-[#111b21] dark:text-[#e9edef]' : 'text-gray-700 dark:text-gray-300'}`}>{v}</span>
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-gray-500 dark:text-gray-400">{count}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

const BulksSection = () => {
    const { showToast } = useToastContext();
    const { _confirmModalJSX, showConfirm } = useConfirmModal();

    // Col 1: Filtrado facetado (segmento)
    const [selection, setSelection] = useState(EMPTY_SELECTION);
    const [excludeIds, setExcludeIds] = useState(new Set()); // destildados dentro de la vista previa
    const [facetData, setFacetData] = useState({ total: 0, counts: {}, meta: { dims: {} }, preview: [] });
    const [facetLoading, setFacetLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState(""); // localizador dentro de la vista previa
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

    const POPULAR_EMOJIS = ["😀","😂","🤣","😉","😊","😍","😘","🥰","🤔","🤫","👍","👎","👏","🙌","🔥","✨","💯","🎉"];

    // Guard para evitar polls concurrentes (race condition)
    const isFetchingRef = useRef(false);
    const fastPollStartRef = useRef(null);
    const fastPollStopRef = useRef(null);
    // Aborta peticiones de facetas obsoletas (debounce + cancelación)
    const facetAbortRef = useRef(null);

    // Load tags
    useEffect(() => {
        const loadTags = () => fetch('/api/tags')
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
        loadTags().catch(e => console.error('Error fetching tags', e));
    }, []);

    // ─── Motor de facetas: consulta debounced al servidor ───────────────────────
    const fetchFacets = useCallback(async (sel) => {
        // Cancela la petición anterior si sigue en vuelo (evita respuestas fuera de orden)
        if (facetAbortRef.current) facetAbortRef.current.abort();
        const controller = new AbortController();
        facetAbortRef.current = controller;
        setFacetLoading(true);
        try {
            const res = await fetch('/api/bulks?action=facets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ selection: sel }),
                signal: controller.signal
            });
            const data = await res.json();
            if (data.success) {
                setFacetData({
                    total: data.total || 0,
                    counts: data.counts || {},
                    meta: data.meta || { dims: {} },
                    preview: data.preview || []
                });
            }
        } catch (e) {
            if (e.name !== 'AbortError') console.error('Error fetching facets', e);
        } finally {
            setFacetLoading(false);
        }
    }, []);

    // Debounce de 350ms sobre cambios de selección
    useEffect(() => {
        const t = setTimeout(() => fetchFacets(selection), 350);
        return () => clearTimeout(t);
    }, [selection, fetchFacets]);

    useEffect(() => {
        // Fast polling ONLY when campaign is active (2s = responsive + bandwidth-friendly)
        const workerCode = `
            self.onmessage = function(e) {
                if (e.data === 'start') {
                    setInterval(() => self.postMessage('tick'), 2000);
                }
            };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        let worker = null;

        const startFastPoll = () => {
            if (worker) return; // Already running
            worker = new Worker(workerUrl);
            worker.onmessage = () => {
                if (!isFetchingRef.current) fetchEngineStatus();
            };
            worker.postMessage('start');
        };

        const stopFastPoll = () => {
            if (worker) { worker.terminate(); worker = null; }
        };

        fastPollStartRef.current = startFastPoll;
        fastPollStopRef.current = stopFastPoll;

        // Slow poll when idle — 30s (App.jsx ya hace polling adaptativo)
        const slowPoll = setInterval(() => {
            if (!isFetchingRef.current) fetchEngineStatus();
        }, 30000);

        // Initial status check
        fetchEngineStatus();

        // Recover draft from redis
        fetch('/api/bulks?action=get_draft')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.draft) {
                    const parsed = data.draft;
                    if (parsed.messageText) setMessageText(parsed.messageText);
                    if (parsed.selection) setSelection({ ...EMPTY_SELECTION, ...parsed.selection });
                    if (Array.isArray(parsed.excludeIds)) setExcludeIds(new Set(parsed.excludeIds));
                }
            })
            .catch(e => console.error("Could not load draft", e));

        // Fetch Meta Templates
        fetch('/api/whatsapp/templates')
            .then(res => res.json())
            .then(data => { if(data.success && data.data) setMetaTemplates(data.data.filter(t => t.status==='APPROVED')); })
            .catch(() => {});

        return () => {
            stopFastPoll();
            clearInterval(slowPoll);
            URL.revokeObjectURL(workerUrl);
            if (facetAbortRef.current) facetAbortRef.current.abort();
        };
    }, []);

    // Save draft state on change (selección + exclusiones + texto)
    useEffect(() => {
        const draft = {
            messageText,
            selection,
            excludeIds: Array.from(excludeIds)
        };
        const timer = setTimeout(() => {
            fetch('/api/bulks?action=save_draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft)
            }).catch(e => console.error("Could not save draft", e));
        }, 1200);

        return () => clearTimeout(timer);
    }, [messageText, selection, excludeIds]);

    // 🏎️ BANDWIDTH SAVER: Toggle fast Worker polling based on campaign state
    useEffect(() => {
        if (engineState?.isRunning) {
            fastPollStartRef.current?.();
        } else {
            fastPollStopRef.current?.();
        }
    }, [engineState?.isRunning]);

    // Auto-alert on campaign complete
    const prevEngineStateRef = useRef(null);
    useEffect(() => {
        if (engineState) {
            const isCurrentlyCompleted = !engineState.isRunning && (engineState.currentCandidateIndex >= (engineState.candidates?.length || 1));
            const wasRunning = prevEngineStateRef.current && prevEngineStateRef.current.isRunning;

            if (isCurrentlyCompleted && wasRunning) {
                setTimeout(() => {
                    setShowCompletionModal(true);
                }, 300);
            }
        }
        prevEngineStateRef.current = engineState;
    }, [engineState]);

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
        showToast && showToast("Campaña cargada. Ajusta tus filtros de destinatarios.", "success");
    };

    const deleteCampaign = async (id) => {
        const ok = await showConfirm({
            title: 'Eliminar Historial',
            message: '¿Seguro que quieres borrar este historial de campaña? Esta acción no se puede deshacer.',
            confirmText: 'Eliminar',
            variant: 'danger'
        });
        if (!ok) return;
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

    const isRunning = engineState?.isRunning;

    // ─── Handlers de selección (limpian exclusiones al cambiar el segmento) ──────
    const toggleFacetValue = (dim, value) => {
        if (isRunning) return;
        setExcludeIds(new Set());
        setSelection(prev => {
            const cur = prev[dim] || [];
            const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
            return { ...prev, [dim]: next };
        });
    };

    const setEstatus = (value) => {
        if (isRunning) return;
        setExcludeIds(new Set());
        setSelection(prev => ({ ...prev, estatus: prev.estatus === value ? '' : value }));
    };

    const toggleVentana24h = () => {
        if (isRunning) return;
        setExcludeIds(new Set());
        setSelection(prev => ({ ...prev, ventana24h: !prev.ventana24h }));
    };

    const setEdadRange = (field, value) => {
        if (isRunning) return;
        // Solo dígitos, máx 2 (edades 15-99)
        const clean = String(value).replace(/\D/g, '').slice(0, 3);
        setExcludeIds(new Set());
        setSelection(prev => ({ ...prev, edadRange: { ...prev.edadRange, [field]: clean } }));
    };

    const clearFacet = (dim) => {
        if (isRunning) return;
        setExcludeIds(new Set());
        setSelection(prev => ({ ...prev, [dim]: [] }));
    };

    const clearAllFilters = () => {
        if (isRunning) return;
        setExcludeIds(new Set());
        setSelection(EMPTY_SELECTION);
    };

    const toggleExclude = (id) => {
        if (isRunning) return;
        setExcludeIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const insertEmoji = (emoji) => {
        setMessageText(prev => prev + emoji);
    };

    // Total del segmento y cuántos se enviarán (segmento menos exclusiones dentro de la vista previa)
    const segmentTotal = facetData.total || 0;
    const sendCount = Math.max(0, segmentTotal - excludeIds.size);

    // Vista previa filtrada por el buscador (localizador — no redefine el segmento)
    const previewList = (facetData.preview || []).filter(c => {
        const v = (searchQuery || "").toLowerCase();
        if (!v) return true;
        return (c?.nombreReal && String(c.nombreReal).toLowerCase().includes(v)) ||
               (c?.nombre && String(c.nombre).toLowerCase().includes(v)) ||
               (c?.whatsapp && String(c.whatsapp).includes(v));
    });

    const dims = facetData.meta?.dims || {};
    const counts = facetData.counts || {};
    const tagColor = (name) => (availableTags.find(t => (typeof t === 'string' ? t : t.name) === name)?.color) || '#64748b';

    // Engine Actions
    const handleStartClick = () => {
        if (sendCount === 0) return showToast && showToast("No hay destinatarios en el segmento", "error");

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
            count: sendCount,
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
                    // El servidor resuelve la lista COMPLETA del segmento (sin subir miles de IDs)
                    segment: { selection, excludeIds: Array.from(excludeIds) },
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
        const ok = await showConfirm({
            title: 'Abortar Campaña',
            message: '¿SEGURO QUE QUIERES ABORTAR TODOS LOS ENVÍOS RESTANTES? Los mensajes ya enviados no se pueden revertir.',
            confirmText: 'Abortar',
            variant: 'warning'
        });
        if (!ok) return;
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
            setExcludeIds(new Set());
            setCustomCampaignName('');
            setTemplateParams({});
        } catch(e) {}
    };

    const isCompleted = engineState && !engineState.isRunning && (engineState.currentCandidateIndex >= (engineState.candidates?.length || 1) || engineState.isAborted);

    const edadActive = (selection.edadRange?.min || selection.edadRange?.max) ? 1 : 0;
    const activeFilterCount = selection.genero.length + selection.municipio.length + selection.escolaridad.length +
        edadActive + selection.tags.length + (selection.estatus ? 1 : 0) + (selection.ventana24h ? 1 : 0);

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
                        {tab.id === 'candidates' && sendCount > 0 && (
                            <span className="ml-1 bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{sendCount}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* COLUMN 1: SEGMENTO (filtros facetados) */}
            <div className={`${mobileTab === 'candidates' ? 'flex' : 'hidden'} lg:flex w-full lg:w-[40%] flex-col border-r border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] min-h-0`}>
                <div className="p-3 bg-white dark:bg-[#111b21] border-b border-[#f0f2f5] dark:border-[#222e35]">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="text-lg font-bold text-[#111b21] dark:text-[#d1d7db] flex items-center gap-2">
                            <SlidersHorizontal className="w-4 h-4 text-[#25d366]" /> Segmento
                        </h2>
                        {activeFilterCount > 0 && (
                            <button onClick={clearAllFilters} disabled={isRunning} className="text-xs flex items-center gap-1 text-gray-500 hover:text-red-500 transition-colors disabled:opacity-40">
                                <RotateCcw className="w-3.5 h-3.5" /> Limpiar ({activeFilterCount})
                            </button>
                        )}
                    </div>

                    {/* Total del segmento */}
                    <div className="bg-gradient-to-br from-[#25d366]/10 to-[#0a5c4a]/5 dark:from-[#0a332c] dark:to-[#0b141a] border border-[#25d366]/30 dark:border-[#0a5c4a] rounded-xl p-3 flex items-center gap-3 mb-3">
                        <div className="w-11 h-11 rounded-full bg-[#25d366]/20 flex items-center justify-center shrink-0">
                            <Users className="w-5 h-5 text-[#0a5c4a] dark:text-[#25d366]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-2xl font-black text-[#111b21] dark:text-[#e9edef] leading-none flex items-center gap-2">
                                {facetLoading ? <span className="text-base text-gray-400 animate-pulse">calculando…</span> : segmentTotal.toLocaleString('es-MX')}
                            </div>
                            <div className="text-[11px] text-[#54656f] dark:text-[#8696a0] font-medium mt-0.5">
                                {segmentTotal === 1 ? 'candidato coincide' : 'candidatos coinciden'}
                                {excludeIds.size > 0 && ` · enviarás a ${sendCount.toLocaleString('es-MX')}`}
                            </div>
                        </div>
                    </div>

                    {/* Estatus */}
                    <div className="flex flex-wrap gap-2 mb-2">
                        {[
                            { key: '', label: 'Todos' },
                            { key: 'completo', label: 'Completos' },
                            { key: 'incompleto', label: 'Incompletos' }
                        ].map(opt => (
                            <button
                                key={opt.key || 'all'}
                                onClick={() => setEstatus(opt.key)}
                                disabled={isRunning}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                    (selection.estatus || '') === opt.key
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]'
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                            >
                                {opt.label}{opt.key ? ` (${counts.estatus?.[opt.key] ?? 0})` : ''}
                            </button>
                        ))}
                        {/* Ventana 24h */}
                        <button
                            onClick={toggleVentana24h}
                            disabled={isRunning}
                            title="Solo quienes te escribieron en las últimas 24h (necesario para texto libre)"
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${
                                selection.ventana24h
                                ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800'
                                : 'bg-[#f0f2f5] text-[#54656f] border-transparent hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                            }`}
                        >
                            🕒 Últimas 24h ({counts.ventana24h?.si ?? 0})
                        </button>
                    </div>

                    {/* Filtros (dropdowns multi-select + rango de edad) */}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <MultiSelectDropdown title="Género" icon="👤" values={dims.genero || []} counts={counts.genero}
                            selected={selection.genero} onToggle={(v) => toggleFacetValue('genero', v)} onClear={() => clearFacet('genero')} disabled={isRunning} />
                        {/* Edad: desde / hasta */}
                        <div>
                            <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                                🎂 Edad {edadActive > 0 && <span className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full normal-case">1</span>}
                            </label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="number" inputMode="numeric" min="15" max="99" placeholder="Desde" disabled={isRunning}
                                    value={selection.edadRange.min}
                                    onChange={(e) => setEdadRange('min', e.target.value)}
                                    className="w-full bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-2.5 py-2.5 text-sm text-center outline-none border border-transparent focus:border-[#25d366]/60 text-[#111b21] dark:text-[#e9edef] disabled:opacity-50"
                                />
                                <span className="text-gray-400 text-xs">—</span>
                                <input
                                    type="number" inputMode="numeric" min="15" max="99" placeholder="Hasta" disabled={isRunning}
                                    value={selection.edadRange.max}
                                    onChange={(e) => setEdadRange('max', e.target.value)}
                                    className="w-full bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-2.5 py-2.5 text-sm text-center outline-none border border-transparent focus:border-[#25d366]/60 text-[#111b21] dark:text-[#e9edef] disabled:opacity-50"
                                />
                            </div>
                        </div>
                        <MultiSelectDropdown title="Escolaridad" icon="🎓" values={dims.escolaridad || []} counts={counts.escolaridad}
                            selected={selection.escolaridad} onToggle={(v) => toggleFacetValue('escolaridad', v)} onClear={() => clearFacet('escolaridad')} disabled={isRunning} />
                        <MultiSelectDropdown title="Municipio" icon="📍" values={dims.municipio || []} counts={counts.municipio}
                            selected={selection.municipio} onToggle={(v) => toggleFacetValue('municipio', v)} onClear={() => clearFacet('municipio')} searchable disabled={isRunning} />
                        <div className="col-span-2">
                            <MultiSelectDropdown title="Etiquetas" icon={<Tag className="w-3 h-3 inline" />} values={dims.tags || []} counts={counts.tags}
                                selected={selection.tags} onToggle={(v) => toggleFacetValue('tags', v)} onClear={() => clearFacet('tags')} searchable colorForValue={tagColor} disabled={isRunning} />
                        </div>
                    </div>
                </div>

                {/* Vista previa del segmento (~100 más recientes) */}
                <div className="px-3 pt-2 pb-1 border-b border-[#f0f2f5] dark:border-[#202c33]">
                    <div className="bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-3 py-1.5 flex items-center">
                        <Search className="w-4 h-4 text-[#54656f] dark:text-[#aebac1] mr-3" />
                        <input
                            type="text"
                            placeholder="Buscar en la vista previa..."
                            className="flex-1 bg-transparent border-none outline-none text-sm text-[#111b21] dark:text-[#d1d7db]"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-[#54656f] dark:text-[#8696a0] mt-1.5 px-1">
                        <span>Vista previa ({previewList.length} de {segmentTotal.toLocaleString('es-MX')})</span>
                        {excludeIds.size > 0 && (
                            <button onClick={() => setExcludeIds(new Set())} className="text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1">
                                <RotateCcw className="w-3 h-3" /> Incluir {excludeIds.size} excluidos
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {facetLoading && previewList.length === 0 ? (
                        <div className="p-6 text-center text-[#54656f] text-sm">Calculando segmento…</div>
                    ) : previewList.length === 0 ? (
                        <div className="p-6 text-center text-[#54656f] text-sm">
                            {segmentTotal === 0 ? 'Ningún candidato coincide con estos filtros.' : 'Nadie coincide con la búsqueda en la vista previa.'}
                        </div>
                    ) : (
                        previewList.map(c => {
                            const excluded = excludeIds.has(c.id);
                            return (
                                <div
                                    key={c.id}
                                    onClick={() => toggleExclude(c.id)}
                                    className={`flex items-center gap-3 p-3 border-b border-[#f0f2f5] dark:border-[#202c33] cursor-pointer hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] transition-colors ${excluded ? 'opacity-45' : ''} ${isRunning ? 'cursor-not-allowed' : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={!excluded}
                                        readOnly
                                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-lg shadow-sm shrink-0">
                                        {(c.nombreReal || c.nombre || c.whatsapp || "?").charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start mb-0.5">
                                            <h3 className="font-semibold text-sm text-[#111b21] dark:text-[#e9edef] truncate pr-2 pt-0.5">
                                                {c.nombreReal || c.nombre || c.whatsapp}
                                            </h3>
                                            <div className="flex flex-col items-end shrink-0">
                                                {getRelativeTime(c) && (
                                                    <span className="text-[11px] text-[#8696a0] whitespace-nowrap font-medium" title="Fecha de captura">
                                                        {getRelativeTime(c)}
                                                    </span>
                                                )}
                                                {c.campaignName && (
                                                    <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold whitespace-nowrap mt-0.5" title={`Campaña Masiva: ${c.campaignName}`}>
                                                        Campaña Masiva: {c.campaignName}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-[13px] text-[#54656f] dark:text-[#8696a0] truncate">
                                            {c.whatsapp}{c.municipio ? ` • ${c.municipio}` : ''}{c.edad ? ` • ${c.edad}a` : ''}
                                        </p>
                                    </div>
                                </div>
                            );
                        })
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
                                            return renderMetaTemplatePreviewText(tData, templateParams, 'Candidato');
                                        })()}
                                    </div>
                                    {(() => {
                                        const tData = metaTemplates.find(t => t.id === selectedTemplateId);
                                        const uniqueVars = extractTemplateVariables(tData);
                                        if (uniqueVars.length > 0) {
                                            return (
                                                <div className="mt-3 flex flex-col gap-2">
                                                    <div className="text-[11px] font-bold text-gray-500 uppercase">Valores de Variables</div>
                                                    {uniqueVars.map((v, idx) => {
                                                        const varNum = v;
                                                        return (
                                                            <div key={idx} className="flex items-center gap-2">
                                                                <span className="text-xs font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded font-bold shrink-0">{`{{${v}}}`}</span>
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
                            disabled={sendCount === 0 || isSubmitting}
                        >
                            {isSubmitting ? <span className="animate-spin text-2xl">⏳</span> : <Send size={24} />}
                            {isSubmitting ? 'PREPARANDO ENVÍOS...' : `INICIAR CAMPAÑA (${sendCount.toLocaleString('es-MX')})`}
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
                            ¿Estás seguro de contactar a <strong className="text-gray-800 dark:text-gray-200">{startModalData.count.toLocaleString('es-MX')}</strong> candidatos {startModalData.qtyMsgStr}?
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

            {/* Diálogo de confirmación (Abortar campaña / Eliminar historial) */}
            {_confirmModalJSX}
        </div>
    );
};

export default BulksSection;
