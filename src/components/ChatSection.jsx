import React, { useState, useEffect, useRef } from 'react';
import { Search, MoreVertical, MessageSquare, Plus, Smile, Paperclip, Mic, ArrowLeft, Send, Tag, Pencil, Check, X, Trash2, Briefcase, Kanban } from 'lucide-react';
import { getCandidates, blockCandidate, deleteCandidate } from '../services/candidatesService';
import ManualProjectsSidepanel from './ManualProjectsSidepanel';
import { formatRelativeDate } from '../utils/formatters';

const safeFormatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const toTitleCase = (str) => {
    if (!str) return '';
    return str.toString().toLowerCase().split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
};

const formatWhatsAppText = (text) => {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*(.*?)\*/g, '<strong class="font-bold">$1</strong>')
        .replace(/_(.*?)_/g, '<em class="italic">$1</em>')
        .replace(/~(.*?)~/g, '<del class="line-through opacity-70">$1</del>')
        .replace(/```(.*?)```/g, '<code class="bg-black/5 dark:bg-black/30 px-1 py-0.5 rounded font-mono text-[11px]">$1</code>');
};

// ─── Componente de Palomitas WhatsApp ────────────────────────────────────────
const MessageStatusTicks = ({ status, size = 'md' }) => {
    const isRead = status === 'seen' || status === 'read';
    const isDelivered = isRead || status === 'delivered';
    const isSent = isDelivered || status === 'sent';

    // Tamaños
    const w = size === 'sm' ? 14 : 17;
    const h = size === 'sm' ? 10 : 11;

    // Colores
    const color = isRead ? '#53bdeb' : '#8696a0';

    if (!isSent) {
        // Reloj / en cola — un solo tilde pequeño gris
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}>
                <svg viewBox="0 0 16 11" width={w} height={h} fill="none">
                    <path d="M15.01 3.316L7.412 11 4.502 8.216 6.6 6.083l1.812 1.758 6.497-6.482L15.01 3.316z" fill={color} />
                </svg>
            </span>
        );
    }

    if (!isDelivered) {
        // Enviado — doble palomita, la segunda más tenue
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}>
                <svg viewBox="0 0 18 11" width={w + 2} height={h} fill="none">
                    {/* primera palomita */}
                    <path d="M17.394 1.755l-8.91 9.03-4.56-4.59 1.42-1.41 3.14 3.16 7.48-7.59 1.43 1.4z" fill={color} />
                    {/* segunda palomita (offset) */}
                    <path d="M12.394 1.755l-5.91 6.03-1.06-1.07 1.42-1.41.82.83 5.48-5.59 1.25 1.21z" fill={color} opacity="0.55" />
                </svg>
            </span>
        );
    }

    // Doble palomita (entregado o leído)
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}>
            <svg viewBox="0 0 18 11" width={w + 2} height={h} fill={color}>
                {/* Palomita derecha */}
                <path d="M17.394 1.755l-8.91 9.03-4.56-4.59 1.42-1.41 3.14 3.16 7.48-7.59 1.43 1.4z" />
                {/* Palomita izquierda (solapada) */}
                <path d="M11.394 1.755l-5.91 6.03-1.56-1.57 1.42-1.41.82.83 5.48-5.59 1.25 1.21z" opacity={isRead ? '1' : '0.55'} />
            </svg>
        </span>
    );
};
// ─────────────────────────────────────────────────────────────────────────────

const ChatSection = ({ showToast }) => {
    const [candidates, setCandidates] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedChat, setSelectedChat] = useState(null);
    const [showRightPanel, setShowRightPanel] = useState(true);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [loadingChats, setLoadingChats] = useState(true);
    const [availableTags, setAvailableTags] = useState([]);
    const [manualProjects, setManualProjects] = useState([]);
    const [newTagInput, setNewTagInput] = useState("");
    const [editingTag, setEditingTag] = useState(null);
    const [editTagName, setEditTagName] = useState("");
    const [editTagColor, setEditTagColor] = useState("#3b82f6");
    const [vacancies, setVacancies] = useState([]);

    const TAG_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#8b5cf6", "#64748b"];

    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    const [showEmojis, setShowEmojis] = useState(false);
    const POPULAR_EMOJIS = ["😀","😂","🤣","😉","😊","😍","😘","🥰","🤔","🤫","👍","👎","👏","🙌","🔥","✨","💯","🎉"];

    // Filter Chips State
    const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'unread', 'label', 'vacancy', 'crm'
    const [filterValue, setFilterValue] = useState(null);
    const [crmStepFilter, setCrmStepFilter] = useState(null);
    const [showDropdown, setShowDropdown] = useState(null);

    // Derive vacancies dynamically safely
    const availableVacancies = [...new Set(
        (candidates || [])
            .map(c => c?.currentVacancyName)
            .filter(v => typeof v === 'string' && v.trim() !== '')
    )];

    // Load Data
    useEffect(() => {
        loadCandidates();
        loadTags();
        loadVacanciesList();
        loadManualProjects();

        // 🟢 Live auto-update for the sidebar (every 3 seconds)
        const interval = setInterval(loadCandidates, 3000);
        return () => clearInterval(interval);
    }, []);

    const loadVacanciesList = async () => {
        try {
            const res = await fetch('/api/vacancies');
            const data = await res.json();
            if (data.success && data.data) {
                // Solo vacantes con "info para el bot"
                setVacancies(data.data.filter(v => v.active && !!v.messageDescription));
            }
        } catch (e) {
            console.error('Error fetching vacancies for injector', e);
        }
    };

    const loadManualProjects = async () => {
        try {
            const res = await fetch('/api/manual_projects');
            const data = await res.json();
            if (data.success && data.data) {
                setManualProjects(data.data);
            }
        } catch (e) {
            console.error('Error fetching manual projects', e);
        }
    };

    const loadTags = async () => {
        try {
            const res = await fetch('/api/tags');
            const data = await res.json();
            if (data.success && data.tags) {
                // Migrate to objects if they are strings
                const migrated = data.tags.map((t, i) => {
                    if (typeof t === 'string') {
                        return { name: t, color: TAG_COLORS[i % TAG_COLORS.length] };
                    }
                    return t;
                });
                setAvailableTags(migrated);
            }
        } catch (e) { console.error('Error fetching tags', e); }
    };

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

    const loadCandidates = async () => {
        try {
            const result = await getCandidates(200, 0, "");
            if (result.success) {
                const fetchedCandidates = result.candidates || [];
                setCandidates(fetchedCandidates);
                if (fetchedCandidates.length > 0) {
                    setSelectedChat(current => {
                        if (!current) return fetchedCandidates[0];
                        return current; // Ya hay uno seleccionado, no forzamos cambio
                    });
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingChats(false);
        }
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

    // Fast search filter for the list with robust safety checks
    const filteredCandidates = (candidates || []).filter(c => {
        const searchVal = (searchQuery || "").toLowerCase();
        const matchesSearch = 
            (c?.nombreReal && String(c.nombreReal).toLowerCase().includes(searchVal)) ||
            (c?.nombre && String(c.nombre).toLowerCase().includes(searchVal)) ||
            (c?.whatsapp && String(c.whatsapp).includes(searchVal));
            
        if (!matchesSearch && searchVal !== "") return false;

        if (activeFilter === 'unread') {
            return c?.hasUnreadMessages === true;
        }
        if (activeFilter === 'label' && filterValue) {
            return Array.isArray(c?.tags) && c.tags.includes(filterValue);
        }
        if (activeFilter === 'vacancy' && filterValue) {
            if (c?.currentVacancyName !== filterValue) return false;
            if (crmStepFilter && c?.manualProjectStepId !== crmStepFilter) return false;
            return true;
        }
        if (activeFilter === 'crm' && filterValue) {
            if (c?.manualProjectId !== filterValue) return false;
            if (crmStepFilter && c?.manualProjectStepId !== crmStepFilter) return false;
            return true;
        }
        if (activeFilter === 'profile') {
            const isComplete = isProfileComplete(c);
            return filterValue === 'complete' ? isComplete : !isComplete;
        }

        return true;
    });

    // Scroll to bottom
    const prevMessagesLength = useRef(0);
    useEffect(() => {
        if (messages.length > prevMessagesLength.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        prevMessagesLength.current = messages.length;
    }, [messages]);

    // Load messages
    useEffect(() => {
        if (selectedChat) {
            loadMessages();
            const interval = setInterval(loadMessages, 3000);
            return () => clearInterval(interval);
        }
    }, [selectedChat]);

    const handleToggleTag = async (tag) => {
        if (!selectedChat) return;

        const currentTags = selectedChat.tags || [];
        let newTags;
        if (currentTags.includes(tag)) {
            newTags = currentTags.filter(t => t !== tag);
        } else {
            newTags = [...currentTags, tag];
        }

        // Optimistic UI
        const updatedChat = { ...selectedChat, tags: newTags };
        setSelectedChat(updatedChat);
        setCandidates(prev => prev.map(c => c.id === updatedChat.id ? updatedChat : c));

        try {
            await fetch('/api/candidates', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: updatedChat.id, tags: newTags })
            });
            showToast && showToast('Etiquetas actualizadas', 'success');
        } catch (error) {
            console.error(error);
            showToast && showToast('Error al actualizar etiquetas', 'error');
        }
    };

    const loadMessages = async () => {
        if (!selectedChat?.id) return;
        try {
            const res = await fetch(`/api/chat?candidateId=${selectedChat.id}`);
            const data = await res.json();
            if (data.success) {
                setMessages(data.messages || []);
            }
        } catch (e) {
            console.error('Failed to poll chat', e);
        }
    };

    const [blockLoading, setBlockLoading] = useState(false);

    const handleBlockToggle = async (chatToBlock, e) => {
        if (e) e.stopPropagation();
        if (!chatToBlock) return;
        const isCurrentlyBlocked = chatToBlock.blocked === true;
        const action = isCurrentlyBlocked ? 'reactivar la IA para' : 'silenciar la IA de';

        if (!window.confirm(`¿Estás seguro de que deseas ${action} este chat?`)) {
            return;
        }

        setBlockLoading(true);
        try {
            const result = await blockCandidate(chatToBlock.id, !isCurrentlyBlocked);
            if (result.success) {
                showToast && showToast(result.message || `Candidato ${isCurrentlyBlocked ? 'reactivado' : 'silenciado'} con éxito`, 'success');

                // Actualizar estado local
                setCandidates(prev => prev.map(c =>
                    c.id === chatToBlock.id ? { ...c, blocked: !isCurrentlyBlocked } : c
                ));
                if (selectedChat?.id === chatToBlock.id) {
                    setSelectedChat(prev => ({ ...prev, blocked: !isCurrentlyBlocked }));
                }
            } else {
                showToast && showToast(`Error al ${isCurrentlyBlocked ? 'reactivar' : 'silenciar'} IA: ${result.error}`, 'error');
            }
        } catch (error) {
            showToast && showToast('Error de red al actualizar estado', 'error');
        } finally {
            setBlockLoading(false);
        }
    };

    const handleDeleteChat = async (chatToDelete, e) => {
        if (e) e.stopPropagation();
        if (!chatToDelete) return;
        
        if (!window.confirm(`¿Estás seguro de que deseas eliminar permanentemente a ${chatToDelete.nombreReal || chatToDelete.nombre || chatToDelete.whatsapp}? Esta acción no se puede deshacer.`)) {
            return;
        }

        try {
            const result = await deleteCandidate(chatToDelete.id);
            if (result.success) {
                showToast && showToast('Chat eliminado correctamente', 'success');
                setCandidates(prev => prev.filter(c => c.id !== chatToDelete.id));
                if (selectedChat?.id === chatToDelete.id) {
                    setSelectedChat(null);
                }
            } else {
                showToast && showToast(`Error al eliminar: ${result.error}`, 'error');
            }
        } catch (error) {
            showToast && showToast('Error de red al eliminar', 'error');
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !selectedChat) return;

        // Reset input immediately so user can select the same file again if needed
        e.target.value = null;

        // Basic validation and determine type
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        const isAudio = file.type.startsWith('audio/');
        
        let msgType = 'document';
        if (isImage) msgType = 'image';
        else if (isVideo) msgType = 'video';
        else if (isAudio) msgType = 'audio';

        // Pre-create a temporary local object URL for instant UI feedback
        const localUrl = URL.createObjectURL(file);
        
        // Optimistic UI Append
        const tempId = `temp_${Date.now()}`;
        const tempMsg = {
            id: tempId,
            from: 'me',
            content: '',
            mediaUrl: localUrl,
            type: msgType,
            status: 'queued',
            timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, tempMsg]);
        setSending(true);

        try {
            // Upload file to local media store first
            const formData = new FormData();
            formData.append('file', file);
            formData.append('candidateId', selectedChat.id);

            const uploadRes = await fetch('/api/media/upload', {
                method: 'POST',
                body: formData
            });
            const uploadData = await uploadRes.json();
            
            if (!uploadRes.ok) throw new Error(uploadData.error || 'Error subiendo archivo');

            // Send via Chat API
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidateId: selectedChat.id,
                    message: '',
                    type: msgType,
                    mediaUrl: uploadData.url || uploadData.mediaUrl
                })
            });

            if (!res.ok) throw new Error('Error al enviar media');
            
            // Reload chats for updated list status
            loadMessages();
            loadCandidates();

        } catch (err) {
            console.error('File send error:', err);
            showToast && showToast('Error al mandar archivo: ' + err.message, 'error');
            // Remove temp msg
            setMessages(prev => prev.filter(m => m.id !== tempId));
        } finally {
            setSending(false);
        }
    };

    const handleSend = async (e) => {
        if (e) e.preventDefault();
        const msg = newMessage.trim();
        if (!msg || sending || !selectedChat) return;

        setSending(true);
        // Optimistic UI updates could go here
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidateId: selectedChat.id, message: msg, type: 'text' })
            });
            const data = await res.json();
            if (data.success) {
                setNewMessage('');
                loadMessages();
            } else {
                showToast && showToast('Error al enviar mensaje', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast && showToast('Error de red', 'error');
        } finally {
            setSending(false);
        }
    };

    const displayMessages = Array.isArray(messages) ? messages.flatMap((msg) => {
        if (!msg) return [];
        let content = msg.content || '';
        if (content.includes('[REACCI')) {
            content = content.replace(/\[REACCI[OÓ]N:\s*.*?\]/gi, '').trim();
            if (!content && !msg.mediaUrl) return [];
        }

        if (content && content.includes('[MSG_SPLIT]')) {
            const parts = content.split('[MSG_SPLIT]').filter(p => p.trim());
            return parts.map((part, index) => ({
                ...msg,
                content: part.trim(),
                mediaUrl: index === 0 ? msg.mediaUrl : null,
                isSplit: true
            }));
        }
        return [{...msg, content}];
    }) : [];

    return (
        <div className="flex h-full w-full bg-[#f0f2f5] dark:bg-[#111b21] font-sans">
            
            {/* LADO IZQUIERDO: LISTA DE CHATS */}
            <div className={`w-full md:w-[30%] lg:w-[35%] xl:w-[400px] flex-col border-r border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] ${selectedChat ? 'hidden md:flex' : 'flex'}`}>
                
                {/* Eliminada la barra Header Izquierdo a petición del usuario */}

                {/* Barra de Búsqueda y Filtros Rápidos */}
                <div className="p-2 bg-white dark:bg-[#111b21] flex flex-col gap-2 border-b border-[#f0f2f5] dark:border-[#222e35] relative z-10">
                    <div className="bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-3 py-1.5 flex items-center">
                        <Search className="w-4 h-4 text-[#54656f] dark:text-[#aebac1] mr-3" />
                        <input 
                            type="text" 
                            placeholder="Buscar un chat o iniciar uno nuevo" 
                            className="flex-1 bg-transparent border-none outline-none text-sm text-[#111b21] dark:text-[#d1d7db] placeholder-[#54656f] dark:placeholder-[#8696a0]"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="text-[#aebac1] hover:text-[#8696a0] p-1 font-bold text-xs">
                                ✕
                            </button>
                        )}
                    </div>

                    {/* Filter Chips */}
                    <div className="flex flex-wrap gap-2 pb-1 pt-0">
                        <button 
                            onClick={() => { setActiveFilter('all'); setFilterValue(null); setCrmStepFilter(null); setShowDropdown(null); }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                activeFilter === 'all' 
                                ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                            }`}
                        >
                            Todos
                        </button>
                        <button 
                            onClick={() => { setActiveFilter('unread'); setFilterValue(null); setShowDropdown(null); }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                activeFilter === 'unread' 
                                ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                            }`}
                        >
                            No leídos
                        </button>
                        <button 
                            onClick={() => { setActiveFilter('profile'); setFilterValue('complete'); setShowDropdown(null); }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                activeFilter === 'profile' && filterValue === 'complete' 
                                ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                            }`}
                        >
                            Completos
                        </button>
                        <button 
                            onClick={() => { setActiveFilter('profile'); setFilterValue('incomplete'); setShowDropdown(null); }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                activeFilter === 'profile' && filterValue === 'incomplete' 
                                ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                            }`}
                        >
                            Incompletos
                        </button>

                        {/* Etiquetas Dropdown */}
                        <div className="relative">
                            <button 
                                onClick={() => setShowDropdown(showDropdown === 'labels' ? null : 'labels')}
                                className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                    activeFilter === 'label' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                            >
                                {activeFilter === 'label' ? filterValue : 'Etiquetas'} <span className="ml-1 text-[9px]">▼</span>
                            </button>
                            {showDropdown === 'labels' && (
                                <div className="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-50 py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                    {(Array.isArray(availableTags) ? availableTags : []).map(tagObj => {
                                        const tName = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                        const tColor = typeof tagObj === 'string' ? '#3b82f6' : tagObj.color;
                                        return (
                                            <div 
                                                key={tName}
                                                onClick={() => { setActiveFilter('label'); setFilterValue(tName); setShowDropdown(null); }}
                                                className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer flex items-center gap-2"
                                            >
                                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tColor }}></span>
                                                {tName}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Vacantes Dropdown */}
                        {availableVacancies.length > 0 && (
                            <div className="relative">
                                <button 
                                    onClick={() => setShowDropdown(showDropdown === 'vacancies' ? null : 'vacancies')}
                                    className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                        activeFilter === 'vacancy' 
                                        ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                        : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                    }`}
                                >
                                    {activeFilter === 'vacancy' ? (String(filterValue || '').slice(0, 15) + (String(filterValue || '').length > 15 ? '...' : '')) : 'Vacantes'} <span className="ml-1 text-[9px]">▼</span>
                                </button>
                                {showDropdown === 'vacancies' && (
                                    <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-50 py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                        {availableVacancies.map(vac => (
                                            <div 
                                                key={vac}
                                                onClick={() => { setActiveFilter('vacancy'); setFilterValue(vac); setCrmStepFilter(null); setShowDropdown(null); }}
                                                className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer truncate"
                                                title={vac}
                                            >
                                                {vac}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* CRM Projects Dropdown */}
                        <div className="relative">
                            <button 
                                onClick={() => setShowDropdown(showDropdown === 'crm' ? null : 'crm')}
                                className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                    activeFilter === 'crm' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                            >
                                {activeFilter === 'crm' ? (manualProjects.find(p => p.id === filterValue)?.name?.slice(0, 15) + (manualProjects.find(p => p.id === filterValue)?.name?.length > 15 ? '...' : '') || 'CRM') : 'CRM'} <span className="ml-1 text-[9px]">▼</span>
                            </button>
                            {showDropdown === 'crm' && (
                                <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-50 py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                    {manualProjects.length === 0 ? (
                                        <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay proyectos</div>
                                    ) : (
                                        manualProjects.map(project => (
                                            <div
                                                key={project.id}
                                                onClick={() => {
                                                    setActiveFilter('crm');
                                                    setFilterValue(project.id);
                                                    setCrmStepFilter(null);
                                                    setShowDropdown(null);
                                                }}
                                                className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer truncate"
                                                title={project.name}
                                            >
                                                {project.name}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Sub-dropdown para Pasos del CRM activo o Vacante activa */}
                        {(activeFilter === 'crm' || activeFilter === 'vacancy') && filterValue && (
                            <div className="relative">
                                {(() => {
                                    // Determinar el proyecto activo según el tipo de filtro
                                    const activeProject = activeFilter === 'crm' 
                                        ? manualProjects.find(p => p.id === filterValue)
                                        : manualProjects.find(p => p.name === filterValue);

                                    if (!activeProject) return null;

                                    return (
                                        <>
                                            <button 
                                                onClick={() => setShowDropdown(showDropdown === 'crmStep' ? null : 'crmStep')}
                                                className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                                    crmStepFilter 
                                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                                }`}
                                            >
                                                {crmStepFilter ? (activeProject.steps?.find(s => s.id === crmStepFilter)?.name?.slice(0, 15) || 'Paso') : 'Todos los Pasos'} <span className="ml-1 text-[9px]">▼</span>
                                            </button>
                                            {showDropdown === 'crmStep' && (
                                                <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-50 py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                                    <div
                                                        onClick={() => { setCrmStepFilter(null); setShowDropdown(null); }}
                                                        className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-[#111b21] font-medium"
                                                    >
                                                        Todos los Pasos
                                                    </div>
                                                    {activeProject.steps?.length === 0 ? (
                                                        <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay pasos creados</div>
                                                    ) : (
                                                        activeProject.steps?.map(step => (
                                                            <div
                                                                key={step.id}
                                                                onClick={() => { setCrmStepFilter(step.id); setShowDropdown(null); }}
                                                                className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer truncate"
                                                                title={step.name}
                                                            >
                                                                {step.name}
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        )}

                    </div>
                </div>

                {/* Lista de Contactos */}
                <div className="flex-1 overflow-y-auto bg-white dark:bg-[#111b21] custom-scrollbar">
                    {loadingChats ? (
                        <div className="p-4 text-center text-sm text-[#8696a0]">Cargando chats...</div>
                    ) : (
                        filteredCandidates.map(chat => (
                            <div 
                                key={chat.id} 
                                onClick={() => setSelectedChat(chat)}
                                className={`flex items-center px-3 py-3 cursor-pointer hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] transition-colors ${selectedChat?.id === chat.id ? 'bg-[#f0f2f5] dark:bg-[#2a3942]' : ''}`}
                            >
                                <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0 flex items-center justify-center mr-3 relative overflow-hidden">
                                    <img 
                                        src={chat.profilePic || `https://ui-avatars.com/api/?name=${encodeURIComponent(chat.nombre || 'C')}&background=random&color=fff`} 
                                        className="w-full h-full object-cover" 
                                        alt="profile" 
                                        onError={(e)=>{e.target.onerror=null; e.target.src='https://ui-avatars.com/api/?name=User';}}
                                    />
                                    {/* chat.online is mock, remove for now or derive */}
                                </div>
                                <div className="flex-1 min-w-0 border-b border-[#f0f2f5] dark:border-[#222e35] pb-3 pt-1">
                                    <div className="flex justify-between items-baseline mb-1">
                                        <h3 className="text-[17px] text-[#111b21] dark:text-[#e9edef] truncate">{toTitleCase(chat.nombreReal || chat.nombre) || chat.whatsapp}</h3>
                                        <div className="flex items-center gap-1 shrink-0 ml-2">
                                            {/* Palomitas en el preview si el último mensaje fue saliente */}
                                            {chat.lastMessageFrom === 'me' || chat.lastMessageFrom === 'bot' ? (
                                                <MessageStatusTicks status={chat.lastMessageStatus} size="sm" />
                                            ) : null}
                                            <span className={`text-xs whitespace-nowrap text-[#667781] dark:text-[#8696a0]`}>{formatRelativeDate(chat.ultimoMensaje)}</span>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center mt-0.5">
                                        <div className="flex items-center gap-1.5 truncate">
                                            <p className="text-[13px] text-[#667781] dark:text-[#8696a0] truncate">
                                                {chat.currentVacancyName || 'WhatsApp'}
                                            </p>
                                            <span className={`text-[11px] font-light tracking-wide shrink-0 font-sans ${isProfileComplete(chat) ? 'text-green-500/90 dark:text-green-400/80' : 'text-red-400/90 dark:text-red-400/70'}`}>
                                                • {isProfileComplete(chat) ? 'Perfil completo' : 'Perfil incompleto'}
                                            </span>
                                        </div>
                                        <div className="flex items-center shrink-0 ml-1">
                                            <button
                                                onClick={(e) => handleBlockToggle(chat, e)}
                                                disabled={blockLoading}
                                                className={`w-7 h-3.5 rounded-full relative transition-colors duration-200 focus:outline-none flex items-center shadow-inner ${chat.blocked ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                                                title={chat.blocked ? 'Reactivar Chat IA' : 'Silenciar Chat IA'}
                                            >
                                                <div className={`absolute w-2.5 h-2.5 rounded-full bg-white shadow transition-transform duration-200 ${chat.blocked ? 'translate-x-[16px]' : 'translate-x-0.5'}`}></div>
                                            </button>
                                            <button
                                                onClick={(e) => handleDeleteChat(chat, e)}
                                                className="ml-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                                title="Eliminar chat"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* LADO DERECHO: CHAT BODY */}
            {selectedChat ? (
                <div className={`flex-1 flex flex-col bg-[#efeae2] dark:bg-[#0b141a] h-full relative ${!selectedChat ? 'hidden md:flex' : 'flex'}`}>
                    
                    {/* Header Chat */}
                    <div className="h-[59px] px-4 py-2 flex items-center justify-between bg-[#f0f2f5] dark:bg-[#202c33] z-20 shadow-sm">
                        <div className="flex items-center cursor-pointer">
                            <button 
                                className="md:hidden mr-2 p-1 text-[#54656f] dark:text-[#aebac1]"
                                onClick={() => setSelectedChat(null)}
                            >
                                <ArrowLeft className="w-6 h-6" />
                            </button>
                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center mr-3 font-bold text-blue-600 overflow-hidden">
                                <img 
                                    src={selectedChat.profilePic || `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedChat.nombre || 'C')}&background=random&color=fff`} 
                                    className="w-full h-full object-cover" 
                                    alt="profile" 
                                />
                            </div>
                            <div className="flex flex-col">
                                <h2 className="text-[17px] font-medium text-[#111b21] dark:text-[#e9edef] flex items-center gap-2 max-w-full">
                                    <span className="truncate">
                                        {toTitleCase(selectedChat.nombreReal || selectedChat.nombre) || selectedChat.whatsapp}
                                    </span>
                                    <div className="flex items-center gap-1 overflow-hidden shrink-0 hide-scrollbar" style={{ maskImage: 'linear-gradient(to right, black 80%, transparent)' }}>
                                        {selectedChat.tags && selectedChat.tags.map(t => {
                                            const tObj = availableTags.find(at => (typeof at === 'string' ? at : at.name) === t);
                                            const tColor = tObj ? (tObj.color || '#3b82f6') : '#3b82f6';
                                            return (
                                                <span key={t} className="text-[9px] px-2 py-[2px] rounded-full text-white font-bold tracking-wider uppercase whitespace-nowrap opacity-90 shadow-sm" style={{ backgroundColor: tColor }}>
                                                    {t}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </h2>
                                <p className="text-xs text-[#667781] dark:text-[#8696a0] truncate mt-0.5">
                                    {selectedChat.whatsapp} • últ. msj {formatRelativeDate(selectedChat.ultimoMensaje)}
                                </p>
                            </div>
                        </div>
                        <div className="flex space-x-3 text-[#54656f] dark:text-[#aebac1] items-center">
                            {/* Silenciar IA Toggle */}
                            <div className="flex items-center gap-2 mr-2">
                                <span className={`text-xs font-medium ${selectedChat.blocked ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'} select-none`}>
                                    {selectedChat.blocked ? 'IA Silenciada' : 'IA Dinámica'}
                                </span>
                                <button
                                    onClick={(e) => handleBlockToggle(selectedChat, e)}
                                    disabled={blockLoading}
                                    className={`w-8 h-4 rounded-full relative transition-colors duration-200 focus:outline-none flex items-center ${selectedChat.blocked ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                                    title={selectedChat.blocked ? 'Reactivar Chat IA' : 'Silenciar Chat IA'}
                                >
                                    <div className={`absolute w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${selectedChat.blocked ? 'translate-x-4' : 'translate-x-0.5'}`}>
                                    </div>
                                </button>
                            </div>

                            {/* Vacancies Injector Menu */}
                            <div className="relative group/vacmenu">
                                <button className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors" title="Inyectar información de Vacante">
                                    <Briefcase className="w-5 h-5 text-gray-500 hover:text-blue-500 transition-colors" />
                                </button>
                                {/* Dropdown de Vacantes */}
                                <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-[#202c33] rounded-lg shadow-xl opacity-0 group-hover/vacmenu:opacity-100 pointer-events-none group-hover/vacmenu:pointer-events-auto transition-opacity z-50 border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col">
                                    <div className="px-3 py-2 text-xs font-bold text-[#8696a0] border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-[#111b21]">
                                        Inyectar Info de Vacante
                                    </div>
                                    <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                        {vacancies.length === 0 ? (
                                            <div className="px-3 py-4 text-center text-xs text-gray-400">
                                                No hay vacantes configuradas con "Info para el bot"
                                            </div>
                                        ) : (
                                            vacancies.map(vac => (
                                                <div
                                                    key={vac.id}
                                                    onClick={() => setNewMessage(prev => (prev ? prev + '\n\n' : '') + vac.messageDescription)}
                                                    className="px-3 py-2.5 flex flex-col text-sm text-[#111b21] dark:text-[#e9edef] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border-b border-gray-50 dark:border-gray-800 last:border-0"
                                                    title={vac.name}
                                                >
                                                    <span className="font-semibold truncate">{vac.name}</span>
                                                    <span className="text-[11px] text-gray-400 truncate">{vac.company}</span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="relative group/menu">
                                <button className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                                    <Tag className="w-5 h-5" />
                                </button>
                                {/* Dropdown para Etiquetas */}
                                <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-[#202c33] rounded-lg shadow-xl opacity-0 group-hover/menu:opacity-100 pointer-events-none group-hover/menu:pointer-events-auto transition-opacity z-50 border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col">
                                    <div className="px-3 py-2 text-xs font-bold text-[#8696a0] border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-[#111b21]">
                                        <span>Etiquetar candidato</span>
                                    </div>
                                    <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                        {availableTags.map(tagObj => {
                                            const tName = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                            const tColor = typeof tagObj === 'string' ? '#3b82f6' : tagObj.color;
                                            const isActive = selectedChat.tags?.includes(tName);
                                            const isEditing = editingTag === tName;

                                            if (isEditing) {
                                                return (
                                                    <div key={tName} className="px-3 py-2 bg-gray-50 dark:bg-[#111b21] flex flex-col gap-2">
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
                                                                            // Update global tags
                                                                            const newGlobal = availableTags.map(t => 
                                                                                (typeof t === 'string' ? t : t.name) === tName 
                                                                                ? { name: editTagName.trim(), color: editTagColor } 
                                                                                : t
                                                                            );
                                                                            saveTagsGlobal(newGlobal);
                                                                            
                                                                            // Also update this candidate's tags if they had the old note
                                                                            if (isActive && editTagName.trim() !== tName) {
                                                                                const newCandidateTags = (selectedChat.tags || []).filter(t => t !== tName);
                                                                                newCandidateTags.push(editTagName.trim());
                                                                                setSelectedChat({ ...selectedChat, tags: newCandidateTags });
                                                                                // Save to db (fetch put)
                                                                                fetch('/api/candidates', {
                                                                                    method: 'PUT',
                                                                                    headers: { 'Content-Type': 'application/json' },
                                                                                    body: JSON.stringify({ id: selectedChat.id, tags: newCandidateTags })
                                                                                }).catch(console.error);
                                                                            }
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
                                                    key={tName} 
                                                    className="px-3 py-2 text-sm text-[#111b21] dark:text-[#e9edef] hover:bg-gray-50 dark:hover:bg-[#202c33] flex items-center justify-between group/item cursor-pointer"
                                                    onClick={() => handleToggleTag(tName)}
                                                >
                                                    <div className="flex-1 flex items-center gap-2">
                                                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tColor }}></span>
                                                        <span className="truncate">{tName}</span>
                                                        {isActive && <Check className="w-4 h-4 text-blue-500 ml-1" />}
                                                    </div>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingTag(tName);
                                                                setEditTagName(tName);
                                                                setEditTagColor(tColor);
                                                            }}
                                                            className="p-1 text-gray-400 hover:text-blue-500"
                                                            title="Editar etiqueta"
                                                        >
                                                            <Pencil className="w-3 h-3" />
                                                        </button>
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const newGlobal = availableTags.filter(t => (typeof t === 'string' ? t : t.name) !== tName);
                                                                saveTagsGlobal(newGlobal);
                                                            }}
                                                            className="p-1 text-gray-400 hover:text-red-500"
                                                            title="Eliminar etiqueta"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
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
                                                onChange={(e) => setNewTagInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && newTagInput.trim()) {
                                                        e.preventDefault();
                                                        const exists = availableTags.some(t => (typeof t === 'string' ? t : t.name).toLowerCase() === newTagInput.trim().toLowerCase());
                                                        if (!exists) {
                                                            saveTagsGlobal([...availableTags, { name: newTagInput.trim(), color: editTagColor || TAG_COLORS[0] }]);
                                                        }
                                                        setNewTagInput("");
                                                    }
                                                }}
                                                placeholder="Nueva etiqueta..."
                                                className="flex-1 text-xs px-2 py-1.5 focus:outline-none dark:bg-[#202c33] dark:text-white rounded border border-transparent focus:border-blue-500 transition-colors bg-white dark:bg-[#202c33]"
                                            />
                                            <button 
                                                onClick={() => {
                                                    if (newTagInput.trim()) {
                                                        const exists = availableTags.some(t => (typeof t === 'string' ? t : t.name).toLowerCase() === newTagInput.trim().toLowerCase());
                                                        if (!exists) {
                                                            saveTagsGlobal([...availableTags, { name: newTagInput.trim(), color: editTagColor || TAG_COLORS[0] }]);
                                                        }
                                                        setNewTagInput("");
                                                    }
                                                }}
                                                className="ml-1 px-2 text-blue-500 hover:text-blue-600 font-bold bg-blue-50 dark:bg-blue-900/30 rounded"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <button 
                                onClick={() => setShowRightPanel(!showRightPanel)}
                                className={`p-2 rounded-full transition-colors ml-1 ${showRightPanel ? 'bg-indigo-50 text-indigo-500 dark:bg-indigo-500/20' : 'hover:bg-black/5 dark:hover:bg-white/5 text-[#54656f] dark:text-[#aebac1]'}`}
                                title="CRM Manual"
                            >
                                <Kanban className="w-5 h-5" />
                            </button>
                            <button className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                                <Search className="w-5 h-5" />
                            </button>
                            <button className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                                <MoreVertical className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* WhatsApp Background Pattern */}
                    <div 
                        className="absolute inset-0 z-0 opacity-[0.4] dark:opacity-[0.05] pointer-events-none"
                        style={{
                            backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")',
                            backgroundRepeat: 'repeat',
                            backgroundSize: '350px'
                        }}
                    ></div>

                    {/* Mensajes */}
                    <div className="flex-1 overflow-y-auto p-[5%] z-10 space-y-[2px]">
                        <div className="text-center py-2 bg-[#ffeed0] dark:bg-[#cca868]/10 text-[#111b21] dark:text-[#f7cd73]/70 rounded-lg mx-auto w-fit px-4 shadow-sm select-none mb-4 border border-black/5 dark:border-white/5">
                            <p className="text-[12px] leading-tight">Los mensajes están protegidos de extremo a extremo por Candidatic y la IA.</p>
                        </div>

                        {displayMessages.map((msg, i) => {
                            if (!msg) return null;
                            const isMe = msg.from === 'me' || msg.from === 'bot';
                            const prevMsg = i > 0 ? displayMessages[i - 1] : null;
                            const isPrevMe = prevMsg ? (prevMsg.from === 'me' || prevMsg.from === 'bot') : null;
                            const isFirstInSeries = !prevMsg || isMe !== isPrevMe;

                            return (
                                <div key={msg.id + '-' + i} className={`flex ${isMe ? 'justify-end' : 'justify-start'} group max-w-full relative ${!isFirstInSeries ? '-mt-1.5' : 'mt-1'}`}>
                                    <div className={`
                                        max-w-[75%] rounded-[7.5px] px-2 pt-1.5 pb-1 shadow-[0_1px_0.5px_rgba(11,20,26,.13)] relative text-[14.2px] z-10
                                        ${isMe
                                            ? `bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] ${isFirstInSeries ? 'rounded-tr-none' : ''}`
                                            : `bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] ${isFirstInSeries ? 'rounded-tl-none' : ''}`}
                                    `}>
                                        {/* Tail */}
                                        {isFirstInSeries && (
                                            <div 
                                                className={`absolute top-0 w-[11px] h-[13px] overflow-hidden ${isMe ? '-right-[11px] text-[#d9fdd3] dark:text-[#005c4b]' : '-left-[11px] text-white dark:text-[#202c33]'}`}
                                            >
                                                <svg viewBox="0 0 8 13" width="8" height="13" className={`fill-current ${isMe ? 'float-left' : 'float-right scale-x-[-1]'}`}><path d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z"></path></svg>
                                            </div>
                                        )}

                                        <div className="relative inline-block min-w-[50px] max-w-full group/msgbody">
                                            {/* Media Rendering */}
                                            {msg.mediaUrl && (
                                                <div className="mb-0.5 rounded overflow-hidden mt-1 cursor-pointer">
                                                    {(msg.type === 'image' || msg.type === 'sticker') && (
                                                        <img src={msg.mediaUrl} alt="media" className="max-w-[260px] max-h-[260px] object-cover rounded shadow-sm bg-transparent" />
                                                    )}
                                                    {msg.type === 'video' && (
                                                        <video src={msg.mediaUrl} controls className="max-w-[260px] max-h-[260px] rounded shadow-sm bg-black" />
                                                    )}
                                                    {(msg.type === 'audio' || msg.type === 'ptt' || msg.type === 'voice') && (
                                                        <audio src={msg.mediaUrl} controls className="max-w-[240px] h-[35px] mt-1 mb-1" />
                                                    )}
                                                    {msg.type === 'document' && (
                                                        <a href={msg.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 bg-black/5 dark:bg-white/5 rounded text-blue-500 hover:text-blue-600 font-medium break-all">
                                                            <Paperclip className="w-4 h-4 shrink-0" /> DOCUMENTO ADJUNTO
                                                        </a>
                                                    )}
                                                </div>
                                            )}

                                            {/* Text Rendering */}
                                            {msg.content && (
                                                <div className="whitespace-pre-wrap leading-[1.35] inline-block break-words" style={{ paddingBottom: '10px', paddingRight: '48px', paddingTop: msg.mediaUrl ? '2px' : '0' }} dangerouslySetInnerHTML={{ __html: formatWhatsAppText(msg.content) }}></div>
                                            )}
                                            {!msg.content && <div style={{ paddingBottom: '10px', paddingRight: '48px' }}></div>}
                                            
                                            {/* Reaction Badges */}
                                            {msg.reactions && msg.reactions.length > 0 && (
                                                <div className="absolute -bottom-2.5 right-0 bg-white dark:bg-[#202c33] shadow-md rounded-full px-1.5 py-0.5 text-[11px] z-20 flex gap-0.5 border border-gray-100 dark:border-gray-800">
                                                    {msg.reactions.map((r, rIdx) => <span key={rIdx}>{r.emoji || r}</span>)}
                                                </div>
                                            )}
                                        </div>

                                        <div className={`flex items-center space-x-1 select-none pr-1 absolute bottom-[3px] right-2`}>
                                            <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-medium leading-none">
                                                {safeFormatTime(msg.timestamp)}
                                            </p>
                                            {isMe && (
                                                <MessageStatusTicks status={msg.status} />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <form onSubmit={handleSend} className="min-h-[62px] px-4 py-[10px] bg-[#f0f2f5] dark:bg-[#202c33] z-20 flex items-end shadow-sm relative">
                        {/* Emojis Menu */}
                        {showEmojis && (
                            <div className="absolute bottom-[70px] left-2 bg-white dark:bg-[#2a3942] rounded-lg shadow-xl border border-gray-100 dark:border-gray-700 p-2 w-[220px] grid grid-cols-6 gap-1 z-50">
                                {POPULAR_EMOJIS.map(emoji => (
                                    <button 
                                        key={emoji} type="button" 
                                        onClick={() => { setNewMessage(prev => prev + emoji); setShowEmojis(false); }}
                                        className="text-xl hover:bg-black/5 dark:hover:bg-white/5 rounded p-1 transition-colors"
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="flex space-x-3 text-[#54656f] dark:text-[#8696a0] items-center mb-1 mr-2 px-1">
                            <button type="button" onClick={() => setShowEmojis(!showEmojis)} className={`hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors ${showEmojis ? 'text-blue-500' : ''}`}><Smile className="w-[26px] h-[26px] stroke-[1.5]" /></button>
                            <button type="button" onClick={() => fileInputRef.current?.click()} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors"><Plus className="w-[26px] h-[26px] stroke-[1.5]" /></button>
                            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                        </div>
                        
                        <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-lg border-none shadow-[0_1px_0_rgba(11,20,26,.05)] focus-within:shadow-[0_1px_2px_rgba(11,20,26,.1)] transition-shadow">
                            <input 
                                className="w-full bg-transparent border-none outline-none py-2.5 px-4 text-[#111b21] dark:text-[#d1d7db] placeholder-[#8696a0] resize-none overflow-hidden text-[15px]" 
                                placeholder="Escribe un mensaje"
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                            />
                        </div>
                        
                        <div className="ml-3 mb-[6px] text-[#54656f] dark:text-[#8696a0]">
                            {newMessage.trim() ? (
                                <button type="submit" disabled={sending} className="p-1 text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors">
                                    <Send className="w-6 h-6" />
                                </button>
                            ) : (
                                <button type="button" className="p-1 hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors">
                                    <Mic className="w-6 h-6" />
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            ) : (
                <div className="hidden md:flex flex-1 flex-col items-center justify-center bg-[#f0f2f5] dark:bg-[#222e35] border-l border-[#d1d7db] dark:border-[#222e35]">
                    {/* Placeholder when no chat selected */}
                    <div className="flex flex-col items-center">
                        <MessageSquare className="w-[84px] h-[84px] opacity-20 text-[#41525d] dark:text-[#e9edef] mb-8" strokeWidth={1} />
                        <h1 className="text-3xl text-[#41525d] dark:text-[#e9edef] font-light mb-4">Candidatic Web</h1>
                        <p className="text-[#667781] dark:text-[#8696a0] text-sm text-center max-w-[400px]">
                            Envía y recibe mensajes sin mantener tu teléfono conectado.
                            <br/>Usa Candidatic Web de forma autónoma con la AI.
                        </p>
                    </div>
                </div>
            )}

            {/* RIGHT PANEL: CRM Manual Projects */}
            {showRightPanel && (
                <ManualProjectsSidepanel
                    selectedChat={selectedChat}
                    onClose={() => setShowRightPanel(false)}
                    showToast={showToast}
                    onCandidateUpdated={(updatedCandidate) => {
                        // Optimistically update the candidate in the local list and selected reference
                        setCandidates(prev => prev.map(c => c.id === updatedCandidate.id ? updatedCandidate : c));
                        if(selectedChat?.id === updatedCandidate.id) setSelectedChat(updatedCandidate);
                    }}
                />
            )}
        </div>
    );
};

export default ChatSection;
