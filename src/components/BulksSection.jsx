import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Trash2, Copy, Sparkles, Send, PauseCircle, PlayCircle, XCircle } from 'lucide-react';
import { getCandidates } from '../services/candidatesService';

const BulksSection = ({ showToast }) => {
    // Col 1: Candidates
    const [candidates, setCandidates] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loadingChats, setLoadingChats] = useState(true);
    const [selectedCandIds, setSelectedCandIds] = useState(new Set());
    const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'complete', 'incomplete'
    const [mobileTab, setMobileTab] = useState('candidates'); // 'candidates', 'messages', 'settings'

    // Col 2: Messages
    const [messages, setMessages] = useState([{ id: Date.now(), text: '' }]);
    const [cloningId, setCloningId] = useState(null);
    const messagesEndRef = useRef(null);

    // Col 3: Settings & Status
    const [minDelay, setMinDelay] = useState(3);
    const [maxDelay, setMaxDelay] = useState(7);
    const [pauseEvery, setPauseEvery] = useState(10);
    const [pauseFor, setPauseFor] = useState(10);
    
    // Engine State
    const [engineState, setEngineState] = useState(null);

    // History Modal State
    const [showHistory, setShowHistory] = useState(false);
    const [historyList, setHistoryList] = useState([]);

    const POPULAR_EMOJIS = ["😀","😂","🤣","😉","😊","😍","😘","🥰","🤔","🤫","👍","👎","👏","🙌","🔥","✨","💯","🎉"];

    // Guard para evitar polls concurrentes (race condition)
    const isFetchingRef = useRef(false);

    // Load Candidates & Persistence
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
                    if (parsed.messages) setMessages(parsed.messages);
                    if (parsed.minDelay != null) setMinDelay(Number(parsed.minDelay) || 3);
                    if (parsed.maxDelay != null) setMaxDelay(Number(parsed.maxDelay) || 7);
                    if (parsed.pauseEvery != null) setPauseEvery(Number(parsed.pauseEvery) || 10);
                    if (parsed.pauseFor != null) setPauseFor(Number(parsed.pauseFor) || 10);
                    if (parsed.selectedCandIds) setSelectedCandIds(new Set(parsed.selectedCandIds));
                }
            })
            .catch(e => console.error("Could not load draft", e));

        return () => {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
        };
    }, []);

    // Save draft state on change
    useEffect(() => {
        const draft = {
            messages,
            minDelay,
            maxDelay,
            pauseEvery,
            pauseFor,
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
    }, [messages, minDelay, maxDelay, pauseEvery, pauseFor, selectedCandIds]);

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
        if (isFetchingRef.current) return; // Guard contra polls concurrentes
        isFetchingRef.current = true;
        try {
            const res = await fetch('/api/bulks?action=status');
            const data = await res.json();
            if (data.success) {
                setEngineState(data.state);
            }
        } catch (e) {
            // Network error — silencioso
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
        // El historial guarda messages como strings planos ["Hola", "Buenos días"]
        // El frontend necesita objetos {id, text} — convertir si es necesario
        const rawMsgs = camp.messages || [];
        const normalizedMsgs = rawMsgs.length > 0
            ? rawMsgs.map((m, i) => {
                if (typeof m === 'string') return { id: Date.now() + i, text: m };
                if (m && typeof m === 'object' && m.text !== undefined) return { ...m, id: m.id || Date.now() + i };
                return { id: Date.now() + i, text: String(m || '') };
            })
            : [{ id: Date.now(), text: '' }];

        setMessages(normalizedMsgs);
        setMinDelay(Number(camp.minDelay) || 3);
        setMaxDelay(Number(camp.maxDelay) || 7);
        setPauseEvery(Number(camp.pauseEvery) || 10);
        setPauseFor(Number(camp.pauseFor) || 10);
        setSelectedCandIds(new Set());
        setShowHistory(false);
        showToast && showToast("Plantilla cargada. Selecciona a tus destinatarios.", "success");
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

    // Messages Logic
    const addEmptyMessage = () => {
        setMessages(prev => [...prev, { id: Date.now(), text: '' }]);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    };

    const updateMessage = (id, text) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, text } : m));
    };

    const deleteMessage = (id) => {
        if (messages.length <= 1) return;
        setMessages(prev => prev.filter(m => m.id !== id));
    };

    const duplicateMessage = (msg) => {
        setMessages(prev => [...prev, { id: Date.now(), text: msg.text }]);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    };

    const cloneWithAI = async (msg) => {
        if (!msg.text.trim()) {
            showToast && showToast("Escribe algo antes de usar la IA", "error");
            return;
        }
        setCloningId(msg.id);
        try {
            const res = await fetch('/api/bulks?action=clone_ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: msg.text })
            });
            const data = await res.json();
            if (data.success) {
                setMessages(prev => [...prev, { id: Date.now(), text: data.result }]);
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
            } else {
                showToast && showToast(data.error || "Error clonando con IA", "error");
            }
        } catch (e) {
            showToast && showToast("Error de red", "error");
        } finally {
            setCloningId(null);
        }
    };

    const insertEmoji = (id, emoji) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, text: m.text + emoji } : m));
    };

    // Engine Actions
    const startBulk = async () => {
        if (selectedCandIds.size === 0) return showToast && showToast("Selecciona al menos un candidato", "error");
        const validMsgs = messages.filter(m => m.text.trim()).map(m => m.text.trim());
        if (validMsgs.length === 0) return showToast && showToast("Crea al menos un mensaje válido", "error");

        if (!window.confirm(`¿Estás seguro de contactar a ${selectedCandIds.size} candidatos alternando entre ${validMsgs.length} variaciones de mensaje?`)) {
            return;
        }

        const campaignName = prompt("Ingresa un nombre para guardar esta configuración/campaña y usarla en el futuro. (Déjalo en blanco si no quieres guardarlo):", "");

        try {
            const res = await fetch('/api/bulks?action=start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidates: Array.from(selectedCandIds),
                    messages: validMsgs,
                    minDelay, maxDelay, pauseEvery, pauseFor, campaignName
                })
            });
            const data = await res.json();
            if (data.success) {
                showToast && showToast("Campaña iniciada", "success");
                fetchEngineStatus();
            } else {
                showToast && showToast(data.error || "Error al iniciar", "error");
            }
        } catch (e) {
            showToast && showToast("Error de red", "error");
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

    const isRunning = engineState?.isRunning;

    return (
        <div className="flex flex-col lg:flex-row h-full w-full bg-[#f0f2f5] dark:bg-[#111b21] font-sans">
            
            {/* Mobile Tab Bar */}
            <div className="lg:hidden flex border-b border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] shrink-0">
                {[{id:'candidates',label:'Destinatarios',emoji:'👥'},{id:'messages',label:'Mensajes',emoji:'💬'},{id:'settings',label:'Config',emoji:'⚙️'}].map(tab => (
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
            <div className={`${mobileTab === 'candidates' ? 'flex' : 'hidden'} lg:flex w-full lg:w-[33%] flex-col border-r border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] min-h-0`}>
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

            {/* COLUMN 2: MESSAGES */}
            <div className={`${mobileTab === 'messages' ? 'flex' : 'hidden'} lg:flex w-full lg:w-[33%] flex-col border-r border-[#d1d7db] dark:border-[#222e35] bg-[#efeae2] dark:bg-[#0b141a] min-h-0`}>
                <div className="p-3 bg-white dark:bg-[#111b21] border-b border-[#f0f2f5] dark:border-[#222e35] shadow-sm relative z-10 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-[#111b21] dark:text-[#d1d7db]">Variaciones de Mensaje</h2>
                    <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded dark:bg-blue-900 dark:text-blue-300">{messages.length} opciones</span>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                    {messages.map((msg, index) => (
                        <div key={msg.id} className="bg-white dark:bg-[#111b21] rounded-lg shadow-sm p-3 relative border border-transparent focus-within:border-blue-400 dark:focus-within:border-blue-500 transition-colors">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Mensaje {index + 1}</span>
                                <div className="flex gap-1" style={{opacity: isRunning ? 0.3 : 1, pointerEvents: isRunning ? 'none' : 'auto'}}>
                                    <button onClick={() => cloneWithAI(msg)} disabled={cloningId === msg.id} className="text-purple-500 hover:bg-purple-100 p-1.5 rounded-md dark:hover:bg-purple-900/30 transition-colors" title="Clonar con IA">
                                        {cloningId === msg.id ? <span className="animate-spin text-sm">⏳</span> : <Sparkles size={16} />}
                                    </button>
                                    <button onClick={() => duplicateMessage(msg)} className="text-blue-500 hover:bg-blue-100 p-1.5 rounded-md dark:hover:bg-blue-900/30 transition-colors" title="Duplicar">
                                        <Copy size={16} />
                                    </button>
                                    <button onClick={() => deleteMessage(msg.id)} className="text-red-500 hover:bg-red-100 p-1.5 rounded-md dark:hover:bg-red-900/30 transition-colors" title="Eliminar">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                            
                            <textarea
                                value={msg.text}
                                onChange={(e) => updateMessage(msg.id, e.target.value)}
                                disabled={isRunning}
                                placeholder="Escribe tu mensaje aquí..."
                                className="w-full bg-transparent border-none outline-none resize-none min-h-[100px] text-sm text-[#111b21] dark:text-[#d1d7db]"
                            />

                            <div className="mt-2 flex flex-wrap gap-1 border-t border-gray-100 dark:border-gray-800 pt-2" style={{opacity: isRunning ? 0.3 : 1, pointerEvents: isRunning ? 'none' : 'auto'}}>
                                {POPULAR_EMOJIS.map(em => (
                                    <button key={em} onClick={() => insertEmoji(msg.id, em)} className="hover:bg-gray-100 dark:hover:bg-gray-800 p-1 rounded transition-colors text-lg">
                                        {em}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {!isRunning && (
                    <div className="p-4 bg-[#efeae2] dark:bg-[#0b141a]">
                        <button onClick={addEmptyMessage} className="w-full flex items-center justify-center gap-2 bg-white dark:bg-[#202c33] text-[#54656f] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-white font-medium p-3 rounded-lg shadow-sm border border-[#d1d7db] dark:border-[#222e35] transition-all hover:shadow-md">
                            <Plus size={20} />
                            Agregar Mensaje
                        </button>
                    </div>
                )}
            </div>

            {/* COLUMN 3: SETTINGS & STATUS */}
            <div className={`${mobileTab === 'settings' ? 'flex' : 'hidden'} lg:flex w-full lg:w-[34%] flex-col bg-white dark:bg-[#111b21] min-h-0`}>
                <div className="p-3 border-b border-[#f0f2f5] dark:border-[#222e35] flex justify-between items-center bg-[#f0f2f5] dark:bg-[#202c33]">
                    <h2 className="text-lg font-bold text-[#111b21] dark:text-[#d1d7db]">Ejecución y Reglas</h2>
                    <button onClick={openHistory} className="text-sm bg-white dark:bg-[#111b21] hover:bg-gray-50 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 py-1.5 px-3 rounded-lg shadow-sm flex items-center gap-1 font-medium transition-colors">
                        📜 Historial
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {/* Settings Panel */}
                    <div className={`space-y-6 ${isRunning ? 'opacity-50 pointer-events-none' : ''}`}>
                        
                        <div className="bg-[#f0f2f5] dark:bg-[#202c33] p-4 rounded-xl border border-[#d1d7db] dark:border-[#222e35]">
                            <h3 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef] mb-3 flex items-center gap-2">⏱️ Tiempos entre mensajes</h3>
                            <p className="text-xs text-[#54656f] dark:text-[#8696a0] mb-4">Para evitar bloqueos de WhatsApp, los tiempos deben variar. Usaremos un número aleatorio entre el mínimo y máximo.</p>
                            <div className="flex items-center gap-4">
                                <div className="flex-1">
                                    <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Mínimo (Segs)</label>
                                    <input type="number" min="1" value={minDelay} onChange={e=>setMinDelay(parseInt(e.target.value) || 1)} className="w-full bg-white dark:bg-[#111b21] border border-gray-300 dark:border-gray-700 rounded p-2 text-sm outline-none focus:border-blue-500" />
                                </div>
                                <span className="text-gray-400 mt-4">—</span>
                                <div className="flex-1">
                                    <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Máximo (Segs)</label>
                                    <input type="number" min="2" value={maxDelay} onChange={e=>setMaxDelay(parseInt(e.target.value) || 2)} className="w-full bg-white dark:bg-[#111b21] border border-gray-300 dark:border-gray-700 rounded p-2 text-sm outline-none focus:border-blue-500" />
                                </div>
                            </div>
                        </div>

                        <div className="bg-[#f0f2f5] dark:bg-[#202c33] p-4 rounded-xl border border-[#d1d7db] dark:border-[#222e35]">
                            <h3 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef] mb-3 flex items-center gap-2">☕ Descansos de Seguridad</h3>
                            <p className="text-xs text-[#54656f] dark:text-[#8696a0] mb-4">Detener la ráfaga de mensajes cada cierta cantidad protege tu cuenta de Flags anti-spam de Meta.</p>
                            <div className="flex items-center gap-2 text-sm text-[#111b21] dark:text-[#d1d7db]">
                                <span>Descansar cada</span>
                                <input type="number" min="1" value={pauseEvery} onChange={e=>setPauseEvery(parseInt(e.target.value) || 1)} className="w-16 bg-white dark:bg-[#111b21] border border-gray-300 dark:border-gray-700 rounded py-1 px-2 text-center outline-none focus:border-blue-500" />
                                <span>sms por</span>
                                <input type="number" min="1" value={pauseFor} onChange={e=>setPauseFor(parseInt(e.target.value) || 1)} className="w-16 bg-white dark:bg-[#111b21] border border-gray-300 dark:border-gray-700 rounded py-1 px-2 text-center outline-none focus:border-blue-500" />
                                <span>Mins.</span>
                            </div>
                        </div>
                    </div>

                    {/* Status Panel (Visible mostly when running or ended) */}
                    <div className="mt-8">
                        {engineState ? (
                            <div className="border border-indigo-100 dark:border-indigo-900 rounded-xl overflow-hidden bg-white dark:bg-[#111b21] shadow-sm">
                                <div className={`p-3 text-white font-bold flex items-center justify-between ${engineState.isRunning ? 'bg-indigo-600' : 'bg-gray-600'}`}>
                                    <div className="flex items-center gap-2">
                                        {engineState.isRunning ? <span className="animate-spin">⚙️</span> : '⏹️'}
                                        <span>Estado del Motor</span>
                                    </div>
                                    <span className="text-xs bg-black/20 px-2 py-0.5 rounded-full">{engineState.isRunning ? 'Corriendo' : 'Detenido'}</span>
                                </div>
                                <div className="p-4">
                                    <div className="mb-4">
                                        <div className="flex justify-between text-xs font-bold text-gray-500 uppercase mb-1">
                                            <span>Progreso de Contactos</span>
                                            <span>{Math.min(engineState.currentCandidateIndex, engineState.candidates.length)} / {engineState.candidates.length}</span>
                                        </div>
                                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                            <div className="bg-indigo-600 h-2 rounded-full transition-all duration-500" style={{width: `${(engineState.currentCandidateIndex / (engineState.candidates.length || 1)) * 100}%`}}></div>
                                        </div>
                                    </div>
                                    {/* Countdown / Next send indicator */}
                                    {engineState.isRunning && engineState.nextSendAt && (
                                        <div className="mb-3 text-[12px] text-amber-600 dark:text-amber-400 font-medium bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800">
                                            {(() => {
                                                const remaining = Math.max(0, Math.ceil((engineState.nextSendAt - Date.now()) / 1000));
                                                if (remaining > 60) {
                                                    const mins = Math.floor(remaining / 60);
                                                    const secs = remaining % 60;
                                                    return `☕ Descanso — próximo envío en ${mins}m ${secs}s`;
                                                }
                                                return `⏳ Próximo envío en ${remaining}s...`;
                                            })()}
                                        </div>
                                    )}
                                    <div className="text-[13px] text-gray-600 dark:text-gray-300 mb-2 font-medium">
                                        Mensajes enviados exitosamente: <strong className="text-indigo-600 dark:text-indigo-400">{engineState.totalSent}</strong>
                                        <span className="text-gray-400 ml-2">/ {engineState.candidates?.length || 0} contactos</span>
                                    </div>
                                    <div className="bg-gray-900 rounded-lg p-3 h-[150px] overflow-y-auto text-[11px] font-mono text-green-400 mt-2">
                                        {engineState.logs?.length === 0 ? "Esperando acciones..." : engineState.logs.map((log, i) => (
                                            <div key={i} className="mb-1">{log}</div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center p-6 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
                                <p className="text-sm text-gray-500">El motor está en espera.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="p-4 border-t border-[#f0f2f5] dark:border-[#222e35] bg-[#f0f2f5] dark:bg-[#202c33]">
                    {isRunning ? (
                        <button 
                            onClick={abortBulk}
                            className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition-transform transform active:scale-95 flex items-center justify-center gap-2 text-lg"
                        >
                            <XCircle size={24} />
                            ABORTAR ENVÍOS
                        </button>
                    ) : (
                        <button 
                            onClick={startBulk}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition-transform transform active:scale-95 flex items-center justify-center gap-2 text-lg"
                        >
                            <Send size={24} />
                            INICIAR CAMPAÑA
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
                                        <div key={h.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-[#202c33] transition-colors">
                                            <div>
                                                <h3 className="font-bold text-gray-800 dark:text-gray-200">{h.name || "Campaña sin nombre"}</h3>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                    {new Date(h.date).toLocaleDateString()} • {h.status === 'running' ? '🚀' : h.status === 'completed' ? '✅' : '🛑'} {h.totalSent}/{h.totalTargets} enviados
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
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            
        </div>
    );
};

export default BulksSection;
