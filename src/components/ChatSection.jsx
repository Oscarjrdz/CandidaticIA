import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import ConfirmModal from './ui/ConfirmModal';
import { Search, MoreVertical, MessageSquare, Plus, Smile, Paperclip, Mic, ArrowLeft, Send, Tag, Pencil, Check, X, Trash2, Briefcase, Kanban, BookOpen, Keyboard, Loader2, Edit2, Reply, Zap, Pin } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import { getCandidates, blockCandidate, deleteCandidate } from '../services/candidatesService';
import ManualProjectsSidepanel from './ManualProjectsSidepanel';
import { formatRelativeDate } from '../utils/formatters';
import { useCandidatesSSE, useSSECandidateUpdate } from '../hooks/useCandidatesSSE';
import { Virtuoso } from 'react-virtuoso';

const safeFormatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';

    const timeFormatter = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Monterrey',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    const timeStr = timeFormatter.format(d).replace(' p. m.', ' pm').replace(' a. m.', ' am').toLowerCase();

    // Calculate elapsed days accurately in Monterrey timezone
    const getMid = (dateObj) => {
        const str = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Monterrey', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dateObj);
        const [m, day, y] = str.split('/');
        return new Date(y, m - 1, day);
    };

    const diffDays = Math.round((getMid(new Date()) - getMid(d)) / 86400000);

    if (diffDays === 0) return `Hoy ${timeStr}`;
    if (diffDays === 1) return `Ayer ${timeStr}`;
    if (diffDays > 1 && diffDays < 7) {
        const weekdayStr = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Monterrey', weekday: 'long' }).format(d);
        const capitalized = weekdayStr.charAt(0).toUpperCase() + weekdayStr.slice(1);
        return `${capitalized} ${timeStr}`;
    }

    const dateStrFormatted = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Monterrey',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(d);

    return `${dateStrFormatted} ${timeStr}`;
};

const toTitleCase = (str) => {
    if (!str) return '';
    const trimmed = str.toString().trim();
    const lc = trimmed.toLowerCase();
    if (!trimmed || lc === 'null' || lc === 'undefined' || lc === 'none' || lc === 'n/a' || lc === '-' || lc === '.') return '';
    return trimmed.toLowerCase().split(' ').map(word => 
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
        .replace(/```(.*?)```/g, '<code class="bg-black/5 dark:bg-black/30 px-1 py-0.5 rounded font-mono text-[11px]">$1</code>')
        .replace(/\[Imagen Adjunta:\s*(https?:\/\/[^\s\]]+)\](?:\nCaption:\s*(.*))?/gi, (match, url, caption) => {
            return `<div class="mt-1 mb-1"><img src="${url}" alt="Adjunto" class="max-w-[200px] object-cover rounded shadow-sm bg-transparent" />${caption ? `<div class="text-[11px] text-gray-600 dark:text-gray-300 mt-1">${caption}</div>` : ''}</div>`;
        })
        .replace(/\[Ubicación:\s*(.*?)\s*\(([-.\d]+),\s*([-.\d]+)\)\]/gi, (match, address, lat, lng) => {
            return `<div class="mt-1 mb-1 border border-black/10 dark:border-white/10 rounded overflow-hidden max-w-[220px]">
                <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" class="bg-gray-100 dark:bg-gray-800 p-2 text-blue-500 hover:text-blue-600 text-[11px] flex items-center gap-1 font-medium select-none whitespace-normal"><span class="text-xs shrink-0">📍</span> <span>Google Maps</span></a>
            </div>`;
        })
        .replace(/\[Sticker:\s*([^\s\]]+)\]/gi, (match, url) => {
            return `<div class="mt-1 mb-1"><img src="${url}" alt="Sticker" class="max-w-[120px] max-h-[120px] object-contain rounded bg-transparent" /></div>`;
        });
};

// ─── Componente de Palomitas WhatsApp ────────────────────────────────────────
const MessageStatusTicks = ({ status, size = 'md' }) => {
    const isRead = status === 'seen' || status === 'read';
    const isDelivered = isRead || status === 'delivered';
    const isSent = isDelivered || status === 'sent';

    const color = isRead ? '#53bdeb' : '#8696a0';

    if (status === 'failed') {
        return (
            <span className="inline-flex items-center self-end mb-[1px] ml-1 text-red-500" title="Error de envío">
                <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            </span>
        );
    }

    if (!isSent) {
        // Reloj / en cola
        return (
            <span className="inline-flex items-center self-end mb-[1px] ml-1">
                <svg viewBox="0 0 12 12" width={12} height={12} fill="none" className="animate-[spin_2s_linear_infinite] origin-center">
                    <path d="M6 1a5 5 0 100 10A5 5 0 006 1zm.5 5.5H4V5.25h1.25V3h1.25v3.5z" fill="#8696a0" opacity="0.55" />
                </svg>
            </span>
        );
    }

    if (!isDelivered) {
        // Un solo check (enviado)
        return (
            <span className="inline-flex items-center self-end mb-[1px] ml-1">
                <svg viewBox="0 0 12 11" width={14} height={13} fill="none">
                    <path d="M11.155 1.34l1.345 1.32L5.3 9.858 1.5 6.058l1.345-1.32L5.3 7.193z" fill="#8696a0" />
                </svg>
            </span>
        );
    }

    // Doble palomita (entregado o leído) — checks superpuestos estilo WhatsApp nativo
    return (
        <span className="inline-flex items-center self-end mb-[1px] ml-1">
            <svg viewBox="0 0 16 11" width={18} height={13} fill="none">
                <path d="M11.071 0l-5.45 6.546-1.84-2.21L2.2 5.664 5.619 9.68 12.65 1.328z" fill={color} />
                <path d="M14.871 0l-5.45 6.546-0.635-.762L7.205 7.112l2.217 2.568L16.451 1.328z" fill={color} />
            </svg>
        </span>
    );
};
// ─── Componente Input (Memoizado) ──────────────────────────────────────────────
const MessageInputBox = React.forwardRef(({ onSend, onTyping, fileInputRef, handleFileUpload, replyingToMsg, onCancelReply, metaTemplates = [], onSendTemplate }, ref) => {
    const [localMessage, setLocalMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [showEmojis, setShowEmojis] = useState(false);
    const [showTemplates, setShowTemplates] = useState(false);

    React.useImperativeHandle(ref, () => ({
        injectText: (newText) => {
            setLocalMessage(prev => {
                const baseStr = prev ? prev.trim() + '\n\n' : '';
                return baseStr + newText;
            });
            setTimeout(() => {
                const input = document.getElementById('chat-msg-input');
                if (input) input.focus();
            }, 50);
        },
        clearText: () => setLocalMessage(''),
        setSendingState: (state) => setSending(state)
    }));

    const handleSubmit = (e) => {
        if (e) e.preventDefault();
        const msg = localMessage.trim();
        if (!msg || sending) return;
        onSend(msg);
    };

    return (
        <div className="w-full flex flex-col shadow-[0_-2px_10px_rgba(0,0,0,0.02)] z-20">
            {replyingToMsg && (
                <div className="px-4 py-2 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-gray-800 flex justify-between items-center slide-in-from-bottom-2 duration-200">
                    <div className="flex-1 flex flex-col pl-3 border-l-4 border-blue-500 bg-black/5 dark:bg-white/5 py-1 px-3 rounded-r-lg max-w-[80%]">
                        <span className="text-[11px] font-bold text-blue-500 mb-0.5">Respondiendo a {(replyingToMsg.from === 'me' || replyingToMsg.from === 'bot') ? 'Ti' : 'Candidato'}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{replyingToMsg.content || '📄 Mensaje multimedia'}</span>
                    </div>
                    <button onClick={onCancelReply} className="ml-4 p-2 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}
            <form onSubmit={handleSubmit} className="min-h-[62px] px-4 py-[10px] bg-[#f0f2f5] dark:bg-[#202c33] flex items-end relative">
            {/* Emojis Menu — Lazy loaded */}
            {showEmojis && (
                <div className="absolute bottom-[70px] left-2 shadow-2xl z-[100] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                    <EmojiPicker 
                        onEmojiClick={(eData) => {
                            setLocalMessage(prev => prev + eData.emoji);
                        }}
                        theme="auto"
                        width={320}
                        height={400}
                        searchPlaceholder="Buscar emojis..."
                        lazyLoadEmojis={true}
                        skinTonesDisabled={true}
                    />
                </div>
            )}

            <div className="flex space-x-3 text-[#54656f] dark:text-[#8696a0] items-center mb-1 mr-2 px-1 relative">
                <button type="button" title="Emojis" onClick={() => {setShowEmojis(!showEmojis); setShowTemplates(false);}} className={`hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors ${showEmojis ? 'text-blue-500' : ''}`}><Smile className="w-[26px] h-[26px] stroke-[1.5]" /></button>
                <button type="button" title="Adjuntar Documento" onClick={() => fileInputRef.current?.click()} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors"><Plus className="w-[26px] h-[26px] stroke-[1.5]" /></button>
                
                {/* Template Button */}
                <div className="relative">
                    <button type="button" title="Enviar Plantilla Oficial (Evade 24h)" onClick={() => {setShowTemplates(!showTemplates); setShowEmojis(false);}} className={`hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors ${showTemplates ? 'text-green-500' : ''}`}>
                        <Zap className="w-[24px] h-[24px] stroke-[1.5]" />
                    </button>
                    {showTemplates && (
                        <div className="absolute bottom-10 left-0 w-64 bg-white dark:bg-[#111b21] rounded-lg shadow-xl border border-gray-200 dark:border-gray-800 z-[100] max-h-[300px] flex flex-col overflow-hidden">
                            <div className="px-3 py-2 bg-green-50 dark:bg-green-900/20 text-xs text-green-700 dark:text-green-400 font-bold border-b border-green-100 dark:border-green-800">
                                Plantillas Meta
                            </div>
                            <div className="overflow-y-auto w-full">
                                {metaTemplates.length === 0 ? (
                                    <div className="p-3 text-xs text-gray-400 text-center">Buscando plantillas...</div>
                                ) : (
                                    metaTemplates.map(t => {
                                        const bodyComp = (t.components || []).find(c => (c.type || '').toUpperCase() === 'BODY');
                                        const bodyText = bodyComp?.text || '';
                                        return (
                                            <button 
                                                key={t.id} 
                                                type="button" 
                                                className="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-[#202c33] border-b border-gray-100 dark:border-gray-800 transition-colors"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    onSendTemplate(t);
                                                    setShowTemplates(false);
                                                }}
                                            >
                                                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{t.name}</div>
                                                {bodyText && <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5" title={bodyText}>{bodyText}</div>}
                                                <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-widest mt-1">{t.category}</div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
            </div>
            
            <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-lg border-none shadow-[0_1px_0_rgba(11,20,26,.05)] focus-within:shadow-[0_1px_2px_rgba(11,20,26,.1)] transition-shadow flex items-center pr-1">
                <input 
                    id="chat-msg-input"
                    autoComplete="off"
                    className="w-full bg-transparent border-none outline-none py-2.5 px-4 text-[#111b21] dark:text-[#d1d7db] placeholder-[#8696a0] resize-none overflow-hidden text-[15px]" 
                    placeholder="Escribe un mensaje"
                    value={localMessage}
                    onChange={(e) => {
                        setLocalMessage(e.target.value);
                        onTyping();
                    }}
                />
                {localMessage && (
                    <button 
                        type="button" 
                        title="Limpiar texto"
                        onClick={() => setLocalMessage('')}
                        className="p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded-full mr-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>
            
            <div className="ml-3 mb-[6px] text-[#54656f] dark:text-[#8696a0]">
                {localMessage.trim() ? (
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
    );
});
// ─────────────────────────────────────────────────────────────────────────────

// 🧱 STANDALONE HELPERS (outside component to avoid re-creation on every render)
const checkIfUnreadStandalone = (chat) => {
    if (!chat) return false;
    if (chat.unreadMsgCount > 0) return true;

    // Use ultimoMensaje to guarantee we capture the absolute latest message time if the user spoke last
    const userTime = Math.max(
        chat.lastUserMessageAt ? new Date(chat.lastUserMessageAt).getTime() : 0,
        chat.ultimoMensaje ? new Date(chat.ultimoMensaje).getTime() : 0
    );

    const botTime = Math.max(
        chat.lastBotMessageAt ? new Date(chat.lastBotMessageAt).getTime() : 0, 
        chat.ultimoMensajeBot ? new Date(chat.ultimoMensajeBot).getTime() : 0
    );

    // 1000ms tolerance for DB race conditions when bot writes timestamps sequentially
    return userTime > botTime + 1000;
};

const isProfileCompleteStandalone = (c) => {
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

const AVATAR_COLORS = ['#f9a8d4','#a5b4fc','#86efac','#fcd34d','#fdba74','#c4b5fd','#67e8f9','#f0abfc','#fca5a5','#bef264'];


// ─────────────────────────────────────────────────────────────────────────────
// 🧩 CustomSelect Component
// ─────────────────────────────────────────────────────────────────────────────
const ChevronIcon = () => (
    <div className="flex items-center text-gray-500 dark:text-gray-400 shrink-0 pointer-events-none">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
    </div>
);

const CustomSelect = ({ name, value, options, onChange, placeholder, disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const displayOptions = [...options];
    if (value && !displayOptions.includes(value)) displayOptions.push(value);

    return (
        <div className="relative" ref={dropdownRef}>
            <div 
                onClick={(e) => {
                    e.preventDefault();
                    if (!disabled) setIsOpen(!isOpen);
                }}
                className={`w-full text-sm p-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg outline-none text-[#111b21] dark:text-[#d1d7db] cursor-pointer border ${isOpen ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-transparent'} flex items-center justify-between transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <span className={`truncate select-none ${!value ? 'text-gray-500 dark:text-gray-400' : ''}`}>{value || placeholder}</span>
                <ChevronIcon />
            </div>
            {isOpen && !disabled && (
                <div className="absolute z-[9999] w-full mt-1 bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 rounded-lg shadow-2xl max-h-56 overflow-y-auto custom-scrollbar">
                    {displayOptions.map((opt, idx) => (
                        <div 
                            key={idx}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onChange({ target: { name, value: opt } });
                                setIsOpen(false);
                            }}
                            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between border-b border-gray-50 dark:border-gray-700/50 last:border-0 ${value === opt ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium' : 'text-[#111b21] dark:text-[#d1d7db] hover:bg-[#f5f6f6] dark:hover:bg-[#2a3942]'}`}
                        >
                            <span className="truncate pr-2">{opt}</span>
                            {value === opt && <Check className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// 📝 Profile Edit Modal
// ─────────────────────────────────────────────────────────────────────────────
const ProfileModal = ({ candidate, onClose, onSave }) => {
    const [formData, setFormData] = useState({
        nombreReal: candidate.nombreReal || candidate.nombre || '',
        edad: candidate.edad || candidate.fechaNacimiento || '',
        genero: candidate.genero || '',
        municipio: candidate.municipio || '',
        escolaridad: candidate.escolaridad || '',
        categoria: candidate.categoria || ''
    });

    const [botCategories, setBotCategories] = useState([]);

    useEffect(() => {
        fetch('/api/categories')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.data && data.data.length > 0) {
                    setBotCategories(data.data.map(c => c.name));
                } else {
                    setBotCategories(["Operativo", "Administrativo", "Otro"]);
                }
            })
            .catch(err => setBotCategories(["Operativo", "Administrativo", "Otro"]));
    }, []);

    const GENERO_OPTIONS = ["Hombre", "Mujer"];
    const ESCOLARIDAD_OPTIONS = ["Primaria", "Secundaria", "Preparatoria", "Licenciatura", "Técnica", "Posgrado"];
    const MUNICIPIO_OPTIONS = ["Abasolo", "Agualeguas", "Allende", "Anáhuac", "Apodaca", "Aramberri", "Bustamante", "Cadereyta Jiménez", "Cerralvo", "China", "Ciénega de Flores", "Doctor Arroyo", "Doctor Coss", "Doctor González", "El Carmen", "Galeana", "García", "General Bravo", "General Escobedo", "General Terán", "General Treviño", "General Zaragoza", "General Zuazua", "Guadalupe", "Hidalgo", "Higueras", "Hualahuises", "Iturbide", "Juárez", "Lampazos de Naranjo", "Linares", "Los Aldamas", "Los Herreras", "Los Ramones", "Marín", "Melchor Ocampo", "Mier y Noriega", "Mina", "Montemorelos", "Monterrey", "Parás", "Pesquería", "Rayones", "Sabinas Hidalgo", "Salinas Victoria", "San Nicolás de los Garza", "San Pedro Garza García", "Santa Catarina", "Santiago", "Vallecillo", "Villaldama"];

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

    return (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#202c33] w-full max-w-md rounded-xl shadow-xl flex flex-col">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-[#111b21] flex justify-between items-center rounded-t-xl">
                    <h3 className="font-bold text-[#111b21] dark:text-[#e9edef] truncate pr-4">Perfil del Candidato</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 flex-1 overflow-visible space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase">Nombre Real</label>
                        <input type="text" name="nombreReal" value={formData.nombreReal} onChange={handleChange} className="w-full text-sm p-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg outline-none text-[#111b21] dark:text-[#d1d7db] border border-transparent focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all" placeholder="Nombre completo" />
                    </div>
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase">Edad</label>
                            <input type="text" name="edad" value={formData.edad} onChange={handleChange} className="w-full text-sm p-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg outline-none text-[#111b21] dark:text-[#d1d7db] border border-transparent focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all" placeholder="Ej. 25" />
                        </div>
                        <div className="flex-1">
                            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase">Género</label>
                            <CustomSelect name="genero" value={formData.genero} options={GENERO_OPTIONS} onChange={handleChange} placeholder="Seleccione..." />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase">Municipio</label>
                        <CustomSelect name="municipio" value={formData.municipio} options={MUNICIPIO_OPTIONS} onChange={handleChange} placeholder="Seleccione..." />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase">Escolaridad</label>
                        <CustomSelect name="escolaridad" value={formData.escolaridad} options={ESCOLARIDAD_OPTIONS} onChange={handleChange} placeholder="Seleccione..." />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase">Categoría</label>
                        <CustomSelect name="categoria" value={formData.categoria} options={botCategories} onChange={handleChange} placeholder={botCategories.length === 0 ? "Cargando..." : "Seleccione..."} disabled={botCategories.length === 0} />
                    </div>
                </div>
                <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-[#111b21] rounded-b-xl">
                    <button onClick={onClose} className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors">Cancelar</button>
                    <button onClick={() => onSave(formData)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors">Guardar</button>
                </div>
            </div>
        </div>
    );
};

// 🏎️ MEMOIZED ChatRow — only re-renders when THIS chat's data changes (not the whole list)
const ChatRow = React.memo(({ chat, isSelected, isPinned, onSelect, onBlock, onDelete, onTogglePin, onlineReaders, blockLoading, userId, onOpenProfileModal, onMarkAsRead, onMarkAsUnread }) => {
    const isUnread = checkIfUnreadStandalone(chat);
    const profileComplete = isProfileCompleteStandalone(chat);
    const avatarColor = AVATAR_COLORS[((chat.nombre||'C').charCodeAt(0)*7)%10];
    const isEmptyChat = chat.mensajesTotales === 0 || !chat.ultimoMensaje;

    return (
        <div 
            onClick={() => onSelect(chat)}
            className={`group flex items-center px-3 py-3 cursor-pointer hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] transition-all duration-200 border-l-4 ${isSelected ? 'bg-[#f0f2f5] dark:bg-[#2a3942] border-[#25d366] dark:border-[#00a884] shadow-sm relative z-10' : 'border-transparent'}`}
        >
            <div className={`w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center mr-3 relative overflow-hidden ${isEmptyChat ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[#ffffff] dark:ring-offset-[#111b21]' : ''}`}>
                {chat.profilePic ? (
                    <img src={chat.profilePic} className="w-full h-full object-cover" alt="profile" loading="lazy"
                        onError={(e)=>{e.target.onerror=null; e.target.style.display='none'; e.target.parentElement.innerHTML=`<span class="flex items-center justify-center w-full h-full text-lg font-bold text-white" style="background:${avatarColor}">${(chat.nombre||'C')[0].toUpperCase()}</span>`;}} />
                ) : (
                    <span className="flex items-center justify-center w-full h-full text-lg font-bold text-white rounded-full"
                        style={{ background: avatarColor }}>
                        {(chat.nombre || 'C')[0].toUpperCase()}
                    </span>
                )}
            </div>
            <div className="flex-1 min-w-0 border-b border-[#f0f2f5] dark:border-[#222e35] pb-3 pt-1">
                <div className="flex flex-row justify-between items-center mb-1 w-full min-w-0">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {isPinned && <Pin className="w-3 h-3 text-[#25d366] dark:text-[#00a884] shrink-0 fill-current" />}
                        <h3 className={`text-[17px] truncate flex-1 min-w-0 transition-colors ${isUnread ? 'text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef]'}`}>
                            {toTitleCase(chat.nombreReal || chat.nombre) || chat.whatsapp}
                        </h3>
                        {chat.origen === 'gateway_instance' && (
                            <span className="shrink-0 px-1.5 py-0.5 text-[8px] font-black tracking-wider uppercase bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded border border-violet-200 dark:border-violet-700/50 leading-none">GW</span>
                        )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                        {chat.lastMessageFrom === 'me' || chat.lastMessageFrom === 'bot' ? (
                            <MessageStatusTicks status={chat.lastMessageStatus} size="sm" />
                        ) : null}
                        <span className={`text-xs whitespace-nowrap ${isUnread ? 'text-[#25d366] dark:text-[#00a884] font-medium' : 'text-[#667781] dark:text-[#8696a0]'}`}>
                            {formatRelativeDate(chat.ultimoMensaje)}
                        </span>
                    </div>
                </div>
                <div className="flex justify-between items-center mt-0.5">
                    <div className="flex items-center gap-1.5 truncate">
                        <p className={`text-[13px] truncate ${isUnread ? 'text-[#111b21] dark:text-[#e9edef] font-medium' : 'text-[#667781] dark:text-[#8696a0]'}`}>
                            {chat.currentVacancyName || 'WhatsApp'}
                        </p>
                        <span 
                            onClick={(e) => { e.stopPropagation(); onOpenProfileModal && onOpenProfileModal(chat); }}
                            className={`text-[11px] font-light tracking-wide shrink-0 font-sans cursor-pointer hover:underline ${profileComplete ? 'text-green-500/90 dark:text-green-400/80' : 'text-red-400/90 dark:text-red-400/70'}`}
                            title="Haz clic para ver/editar el perfil extraído por Brenda"
                        >
                            • {profileComplete ? 'Perfil completo' : 'Perfil incompleto'}
                        </span>
                    </div>
                    <div className="flex items-center shrink-0 ml-1 gap-1">
                        {isUnread ? (
                            <>
                                <button 
                                    onClick={(e) => onMarkAsRead(chat, e)}
                                    className="px-1.5 py-0.5 mr-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-[10px] font-medium text-gray-600 dark:text-gray-300 rounded shadow-sm transition-colors shrink-0"
                                    title="Quitar notificación"
                                >
                                    Marcar leído
                                </button>
                                <div className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center mr-1 shadow-sm shrink-0 text-white text-[11px] font-bold">
                                    {chat.unreadMsgCount || 1}
                                </div>
                            </>
                        ) : (
                            <button 
                                onClick={(e) => onMarkAsUnread(chat, e)}
                                className="px-1.5 py-0.5 mr-1 text-[10px] font-normal text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                                title="Marcar como no leído"
                            >
                                No leído
                            </button>
                        )}
                        {onlineReaders.length > 0 && (
                            <div className="flex -space-x-1.5 mr-1 group/presence" title="Viendo este chat">
                                {onlineReaders.map((r, idx) => (
                                    <div key={idx} className="relative group/tooltip">
                                        <div className="w-4 h-4 rounded-full border border-white dark:border-[#202c33] bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-[8px] text-white font-bold shadow-sm ring-1 ring-black/5">
                                            {r.userName ? r.userName.charAt(0).toUpperCase() : '?'}
                                        </div>
                                        <div className="absolute right-0 bottom-full mb-1 opacity-0 group-hover/tooltip:opacity-100 bg-gray-900 text-white text-[10px] py-0.5 px-1.5 rounded pointer-events-none whitespace-nowrap transition-opacity z-50">
                                            {r.userId === userId ? 'Tú lo estás viendo' : `${r.userName} viéndolo`}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); onTogglePin(chat.id); }}
                            className={`p-1 rounded transition-colors ${isPinned ? 'text-[#25d366] dark:text-[#00a884]' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100'}`}
                            title={isPinned ? 'Desfijar chat' : 'Fijar chat (máx 3)'}
                        >
                            <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-current' : ''}`} />
                        </button>
                        <button
                            onClick={(e) => onBlock(chat, e)}
                            disabled={blockLoading}
                            className={`w-7 h-3.5 rounded-full relative transition-colors duration-200 focus:outline-none flex items-center shadow-inner ${chat.blocked ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                            title={chat.blocked ? 'Reactivar Chat IA' : 'Silenciar Chat IA'}
                        >
                            <div className={`absolute w-2.5 h-2.5 rounded-full bg-white shadow transition-transform duration-200 ${chat.blocked ? 'translate-x-[16px]' : 'translate-x-0.5'}`}></div>
                        </button>
                        <button
                            onClick={(e) => onDelete(chat, e)}
                            className="ml-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                            title="Eliminar chat"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-[#8696a0] dark:text-[#697882] truncate">
                    {chat.edad && <span className="shrink-0">{chat.edad} años</span>}
                    {chat.edad && chat.escolaridad && <span className="shrink-0">•</span>}
                    {chat.escolaridad && <span className="truncate shrink-0">{chat.escolaridad}</span>}
                    {(chat.edad || chat.escolaridad) && chat.municipio && <span className="shrink-0">•</span>}
                    {chat.municipio && <span className="truncate shrink-0">{chat.municipio}</span>}
                    {(chat.edad || chat.escolaridad || chat.municipio) && chat.categoria && <span className="shrink-0">•</span>}
                    {chat.categoria && <span className="truncate shrink-0">{toTitleCase(chat.categoria)}</span>}
                </div>
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparator: only re-render if visual data changed
    // This prevents re-renders caused by function reference changes (handleBlockToggle etc.)
    return (
        prevProps.chat === nextProps.chat &&
        prevProps.isSelected === nextProps.isSelected &&
        prevProps.isPinned === nextProps.isPinned &&
        prevProps.blockLoading === nextProps.blockLoading &&
        prevProps.onlineReaders.length === nextProps.onlineReaders.length &&
        prevProps.userId === nextProps.userId
    );
});

// ─────────────────────────────────────────────────────────────────────────────

export default function ChatSection({ showToast, user, rolePermissions, onlineUsers = [] }) {
    const canManageTags = user?.role === 'SuperAdmin' || user?.can_manage_tags === true;
    const { newCandidate: sseNewCandidate } = useCandidatesSSE();
    const [candidates, setCandidates] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);

    // Broadcast active chat changes back to global Presence (App.jsx)
    useEffect(() => {
        window.dispatchEvent(new CustomEvent('presence_chat_change', { detail: { chatId: selectedChat?.id || null } }));
    }, [selectedChat]);

    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [candidateTyping, setCandidateTyping] = useState(false);
    const [showRightPanel, setShowRightPanel] = useState(true);
    const [messages, setMessages] = useState([]);
    const messageInputRef = useRef(null);
    const [sending, setSending] = useState(false);
    const [loadingChats, setLoadingChats] = useState(true);
    const [availableTags, setAvailableTags] = useState([]);
    const [manualProjects, setManualProjects] = useState([]);
    const [newTagInput, setNewTagInput] = useState("");
    const [editingTag, setEditingTag] = useState(null);
    const [editTagName, setEditTagName] = useState("");
    const [editTagColor, setEditTagColor] = useState("#3b82f6");
    const [vacancies, setVacancies] = useState([]);
    const [editingVac, setEditingVac] = useState(null);
    const [chatLocks, setChatLocks] = useState({});
    const [reactionPopupId, setReactionPopupId] = useState(null);
    const [replyingToMsg, setReplyingToMsg] = useState(null);
    const [profileModalCandidate, setProfileModalCandidate] = useState(null);
    // 🎨 Styled Confirm Modal (replaces ugly window.confirm)
    const [confirmModal, setConfirmModal] = useState(null);

    // Typing Indicators

    const [recruiterTypingName, setRecruiterTypingName] = useState('');
    const [metaTemplates, setMetaTemplates] = useState([]);
    const typingTimersRef = useRef({});

    // ═══ INSTANCE MAP for I01/I02 badges ═══


    const TAG_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#8b5cf6", "#64748b"];

    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);
    const lastPresenceTimeRef = useRef(0);

    const handleTyping = () => {
        if (!selectedChat) return;
        const now = Date.now();
        if (now - lastPresenceTimeRef.current > 8000) {
            lastPresenceTimeRef.current = now;
            fetch('/api/chat', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'presence', candidateId: selectedChat.id, status: 'composing' })
            }).catch(() => {});
        }
    };

    const POPULAR_EMOJIS = ["😀","😂","🤣","😉","😊","😍","😘","🥰","🤔","🤫","👍","👎","👏","🙌","🔥","✨","💯","🎉"];

    // Quick Replies (Banco de Respuestas)
    const [quickReplies, setQuickReplies] = useState([]);
    const [showQuickRepliesPanel, setShowQuickRepliesPanel] = useState(false);
    const [editingQuickReply, setEditingQuickReply] = useState(null); // null = creating, object = editing
    const [qrForm, setQrForm] = useState({ name: '', message: '', shortcut: '' });
    const [qrSaving, setQrSaving] = useState(false);
    const [capturingShortcut, setCapturingShortcut] = useState(false);

    // Toolbar icon order (drag & drop)
    const TOOLBAR_ICON_IDS = ['vacancies', 'tags', 'crm_manual', 'quick_replies'];
    const [toolbarOrder, setToolbarOrder] = useState(() => {
        try {
            const saved = localStorage.getItem('candidatic:toolbar_order');
            if (saved) {
                const parsed = JSON.parse(saved);
                // Ensure all IDs are present (handles new icons added later)
                const merged = [...parsed.filter(id => TOOLBAR_ICON_IDS.includes(id)), ...TOOLBAR_ICON_IDS.filter(id => !parsed.includes(id))];
                return merged;
            }
        } catch {}
        return TOOLBAR_ICON_IDS;
    });
    const [draggedIcon, setDraggedIcon] = useState(null);

    // Filter Chips State
    const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'label', 'profile'
    const [filterValue, setFilterValue] = useState(null);
    const activeFilterRef = useRef('all');
    const filterValueRef = useRef(null);
    const selectedChatRef = useRef(null);

    // 📌 PINNING SYSTEM (WhatsApp-native, max 3, persisted in localStorage)
    const [pinnedChats, setPinnedChats] = useState(() => {
        try { return JSON.parse(localStorage.getItem('candidatic:pinned_chats') || '[]'); } catch { return []; }
    });
    const togglePin = useCallback((chatId) => {
        setPinnedChats(prev => {
            const next = prev.includes(chatId)
                ? prev.filter(id => id !== chatId)
                : prev.length >= 3 ? prev : [...prev, chatId];
            localStorage.setItem('candidatic:pinned_chats', JSON.stringify(next));
            return next;
        });
    }, []);

    useEffect(() => {
        selectedChatRef.current = selectedChat;
    }, [selectedChat]);

    useEffect(() => {
        activeFilterRef.current = activeFilter;
        filterValueRef.current = filterValue;
        loadCandidates();
    }, [activeFilter, filterValue]);
    
    // Marketing (Briefcase) Filters - Route A
    const [aiProjectFilter, setAiProjectFilter] = useState(null);
    const [aiStepFilter, setAiStepFilter] = useState(null);
    const [aiProjectCandidates, setAiProjectCandidates] = useState(null);

    // Manual CRM (Kanban) Filters - Route B
    const [manualPipelineFilter, setManualPipelineFilter] = useState(null);
    const [manualStepFilter, setManualStepFilter] = useState(null);

    const [showDropdown, setShowDropdown] = useState(null);
    const [projects, setProjects] = useState([]); // Colección maestra de marketing (maletín)

    // RBAC: base-level candidate restriction
    const [roleAllowedCandidateIds, setRoleAllowedCandidateIds] = useState(null); // null = no restriction, Set = restricted

    // Helper for RBAC
    const canSeeFilter = (filterKey) => {
        if (!user || user.role === 'SuperAdmin') return true;
        if (!rolePermissions) return true;
        return rolePermissions[filterKey] === true;
    };

    // Filter projects by user-level assignment
    const filteredProjects = (() => {
        if (!user || user.role === 'SuperAdmin') return projects;
        const allowed = user?.allowed_projects;
        if (!Array.isArray(allowed) || allowed.length === 0) return projects; // no restriction set yet
        return projects.filter(p => allowed.includes(p.id));
    })();

    const filteredManualProjects = (() => {
        if (!user || user.role === 'SuperAdmin') return manualProjects;
        const allowed = user?.allowed_crm_projects;
        if (!Array.isArray(allowed) || allowed.length === 0) return manualProjects;
        return manualProjects.filter(p => allowed.includes(p.id));
    })();

    // Debounce search input (300ms)
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Optimistic unread clearance
    useEffect(() => {
        const handleReply = (e) => {
            const { candidateId } = e.detail;
            const now = new Date().toISOString();
            setCandidates(prev => prev.map(c => 
                c.id === candidateId 
                    ? { ...c, unreadMsgCount: 0, lastBotMessageAt: now, ultimoMensajeBot: now } 
                    : c
            ));
        };
        window.addEventListener('candidate_replied', handleReply);
        return () => window.removeEventListener('candidate_replied', handleReply);
    }, []);

    // Load Data
    useEffect(() => {
        loadCandidates();
        loadTags();
        loadVacanciesList();
        loadManualProjects();
        loadProjects();

        // Fetch Meta Templates in background
        fetch('/api/whatsapp/templates')
            .then(res => res.json())
            .then(data => { if(data.success && data.data) setMetaTemplates(data.data.filter(t => t.status==='APPROVED')); })
            .catch(() => {});

        // 🚀 POLLING REMOVED: Trust the SSE `sseUpdate` for real-time candidate list updates.

        // 🔔 Poll chat stats (unread counts + locks) — now O(1) on backend
        const statsInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/chat-stats');
                const data = await res.json();
                    setChatLocks(data.locks || {});
            } catch (e) { /* silent */ }
        }, 5000);
        // Initial fetch
        (async () => {
            try {
                const res = await fetch('/api/chat-stats');
                const data = await res.json();
                if (data.success) {
                    setChatLocks(data.locks || {});
                }
            } catch (e) { /* silent */ }
        })();

        return () => { clearInterval(statsInterval); };
    }, []);

    // RBAC: Load candidate IDs from all allowed projects to create base filter
    useEffect(() => {
        if (!user || user.role === 'SuperAdmin' || rolePermissions?.['filter_todos'] === true) {
            setRoleAllowedCandidateIds(null);
            return;
        }
        const allowedProjects = user?.allowed_projects;
        const allowedCrm = user?.allowed_crm_projects;
        const hasProjectRestriction = Array.isArray(allowedProjects) && allowedProjects.length > 0;
        const hasCrmRestriction = Array.isArray(allowedCrm) && allowedCrm.length > 0;

        if (!hasProjectRestriction && !hasCrmRestriction) {
            setRoleAllowedCandidateIds(null);
            return;
        }

        const loadAllowedCandidates = async () => {
            try {
                const candidateIdSet = new Set();

                // Fetch candidates from all allowed AI projects
                if (hasProjectRestriction) {
                    const projPromises = allowedProjects.map(projId =>
                        fetch(`/api/projects?id=${projId}&view=candidates`).then(r => r.json())
                    );
                    const projResults = await Promise.all(projPromises);
                    projResults.forEach(data => {
                        if (data.success && Array.isArray(data.candidates)) {
                            data.candidates.forEach(c => candidateIdSet.add(c.id));
                        }
                    });
                }

                // For CRM manual projects, candidates have manualProjectId field
                // We'll filter by that field in the filteredCandidates logic
                // Just mark that CRM restriction exists

                setRoleAllowedCandidateIds(candidateIdSet);
            } catch (e) {
                console.error('Error loading RBAC allowed candidates:', e);
                setRoleAllowedCandidateIds(null);
            }
        };

        loadAllowedCandidates();
    }, [user, rolePermissions]);

    // 🚀 NEW: Load Project Candidates specific to Riel A
    useEffect(() => {
        if (!aiProjectFilter) {
            setAiProjectCandidates(null);
            return;
        }
        
        const loadProjectCands = async () => {
            try {
                const res = await fetch(`/api/projects?id=${aiProjectFilter}&view=candidates`);
                const data = await res.json();
                if (data.success) {
                    setAiProjectCandidates(data.candidates);
                }
            } catch (e) {
                console.error("Failed to load project candidates for filter:", e);
            }
        };
        loadProjectCands();
    }, [aiProjectFilter]);

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

    const loadProjects = async () => {
        try {
            const res = await fetch('/api/projects');
            const data = await res.json();
            if (data.success && data.projects) {
                setProjects(data.projects);
            }
        } catch (e) {
            console.error('Error fetching marketing projects', e);
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

    // Quick Replies loader
    const loadQuickReplies = async () => {
        try {
            const res = await fetch('/api/quick_replies');
            const data = await res.json();
            if (data.success) setQuickReplies(data.replies || []);
        } catch (e) { console.error('Error loading quick replies', e); }
    };

    const saveQuickReplies = async (newList) => {
        setQuickReplies(newList);
        try {
            await fetch('/api/quick_replies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ replies: newList })
            });
        } catch (e) { console.error('Error saving quick replies', e); }
    };

    // Load quick replies on mount
    useEffect(() => { loadQuickReplies(); }, []);

    // Keyboard shortcut listener for quick replies
    useEffect(() => {
        if (quickReplies.length === 0) return;
        const handler = (e) => {
            // Don't fire when user is typing in an input/textarea
            const tag = document.activeElement?.tagName?.toLowerCase();
            // Only intercept if Ctrl or Meta is pressed
            if (!e.ctrlKey && !e.metaKey) return;

            for (const qr of quickReplies) {
                if (!qr.shortcut) continue;
                // Parse shortcut like "Ctrl+H" → key = 'h'
                const parts = qr.shortcut.toLowerCase().split('+').map(p => p.trim());
                const key = parts[parts.length - 1];
                const needsCtrl = parts.includes('ctrl') || parts.includes('meta');
                const needsShift = parts.includes('shift');
                const needsAlt = parts.includes('alt');

                if (
                    e.key.toLowerCase() === key &&
                    (needsCtrl ? (e.ctrlKey || e.metaKey) : true) &&
                    (needsShift ? e.shiftKey : !e.shiftKey) &&
                    (needsAlt ? e.altKey : !e.altKey)
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    messageInputRef.current?.injectText(qr.message);
                    return;
                }
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [quickReplies]);

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

    const deleteTagGlobal = async (tagName) => {
        const confirmed = await new Promise(resolve => setConfirmModal({
            title: 'Eliminar etiqueta',
            message: `¿Seguro que deseas eliminar la etiqueta "${tagName}"? Esta acción eliminará la etiqueta de TODOS los candidatos que la tengan asignada actualmente.`,
            confirmText: 'Eliminar',
            variant: 'danger',
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false)
        }));
        if (!confirmed) return;
        
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

    const loadCandidates = async () => {
        try {
            const tagParam = activeFilterRef.current === 'label' ? filterValueRef.current : "";
            const result = await getCandidates(5000, 0, "", false, tagParam);
            if (result.success) {
                let fetchedCandidates = result.candidates || [];
                
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

    // Delegate to standalone versions (defined outside component for React.memo compatibility)
    const isProfileComplete = isProfileCompleteStandalone;
    const checkIfUnread = checkIfUnreadStandalone;

    // Fast search filter for the list with robust safety checks
    const filteredCandidates = useMemo(() => {
        const result = (candidates || []).filter(c => {
            const searchVal = (debouncedSearch || "").toLowerCase();
            const matchesSearch = 
                (c?.nombreReal && String(c.nombreReal).toLowerCase().includes(searchVal)) ||
                (c?.nombre && String(c.nombre).toLowerCase().includes(searchVal)) ||
                (c?.whatsapp && String(c.whatsapp).includes(searchVal));
                
            if (!matchesSearch && searchVal !== "") return false;

            // --- RBAC Base Filter: Only show candidates from allowed projects or tags ---
            if (roleAllowedCandidateIds !== null) {
                const allowedCrm = user?.allowed_crm_projects;
                const hasCrmRestriction = Array.isArray(allowedCrm) && allowedCrm.length > 0;
                const allowedLabels = user?.allowed_labels;
                const hasLabelRestriction = Array.isArray(allowedLabels) && allowedLabels.length > 0;

                const inAllowedProject = roleAllowedCandidateIds.has(c.id);
                const inAllowedCrm = hasCrmRestriction && c?.manualProjectId && allowedCrm.includes(c.manualProjectId);
                const inAllowedLabel = hasLabelRestriction && Array.isArray(c?.tags) && c.tags.some(t => {
                    const searchLabel = typeof t === 'string' ? t.trim().toLowerCase() : t?.name?.trim().toLowerCase();
                    return allowedLabels.some(al => typeof al === 'string' && al.trim().toLowerCase() === searchLabel);
                });

                if (!inAllowedProject && !inAllowedCrm && !inAllowedLabel) return false;
            }

            // --- Strict Inbox para Reclutadores (Sin botón 'Todos') ---
            if (!canSeeFilter('filter_todos') && activeFilter === 'all') {
                const hasAnyTag = Array.isArray(c?.tags) && c.tags.length > 0;
                if (!hasAnyTag) return false;
            }

            if (activeFilter === 'unread' && !checkIfUnread(c)) return false;
            if (activeFilter === 'label' && filterValue && !(Array.isArray(c?.tags) && c.tags.includes(filterValue))) return false;
            if (activeFilter === 'profile') {
                const isComplete = isProfileComplete(c);
                if (filterValue === 'complete' && !isComplete) return false;
                if (filterValue === 'incomplete' && isComplete) return false;
            }

            // --- Ruta A: Filtros Marketing ---
            if (aiProjectFilter) {
                if (!aiProjectCandidates) return false; // Todavía cargando los candidatos del proyecto
                const matchingCand = aiProjectCandidates.find(pc => pc.id === c.id);
                if (!matchingCand) return false; // No pertenece a este proyecto
                if (aiStepFilter && matchingCand.projectMetadata?.stepId !== aiStepFilter) return false; // No está en este paso
            }

            // --- Ruta B: Filtros CRM Manual ---
            if (manualPipelineFilter && c?.manualProjectId !== manualPipelineFilter) return false;
            if (manualStepFilter && c?.manualProjectStepId !== manualStepFilter) return false;

            return true;
        });

        // 🏎️ Pre-compute timestamps ONCE (eliminates ~44,000 Date objects per sort)
        const tsCache = new Map();
        for (const c of result) {
            tsCache.set(c.id, c.ultimoMensaje ? new Date(c.ultimoMensaje).getTime() : 0);
        }

        // WhatsApp-Native Sort: Pinned first → then strictly chronological
        return result.sort((a, b) => {
            const aPinned = pinnedChats.includes(a.id);
            const bPinned = pinnedChats.includes(b.id);
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            return (tsCache.get(b.id) || 0) - (tsCache.get(a.id) || 0);
        });
    }, [
        candidates, debouncedSearch, roleAllowedCandidateIds, user, 
        activeFilter, filterValue, aiProjectFilter, aiStepFilter, 
        aiProjectCandidates, manualPipelineFilter, manualStepFilter,
        pinnedChats
    ]);

    // ── Badge counts (MEMOIZED — only recalculated when candidates change) ──
    const baseCandidates = useMemo(() => (candidates || []).filter(c => {
        if (roleAllowedCandidateIds !== null) {
            const allowedCrm = user?.allowed_crm_projects;
            const hasCrmRestriction = Array.isArray(allowedCrm) && allowedCrm.length > 0;
            const allowedLabels = user?.allowed_labels;
            const hasLabelRestriction = Array.isArray(allowedLabels) && allowedLabels.length > 0;

            const inAllowedProject = roleAllowedCandidateIds.has(c.id);
            const inAllowedCrm = hasCrmRestriction && c?.manualProjectId && allowedCrm.includes(c.manualProjectId);
            const inAllowedLabel = hasLabelRestriction && Array.isArray(c?.tags) && c.tags.some(t => {
                const searchLabel = typeof t === 'string' ? t.trim().toLowerCase() : t?.name?.trim().toLowerCase();
                return allowedLabels.some(al => typeof al === 'string' && al.trim().toLowerCase() === searchLabel);
            });

            if (!inAllowedProject && !inAllowedCrm && !inAllowedLabel) return false;
        }
        return true;
    }), [candidates, roleAllowedCandidateIds, user]);

    const badgeCounts = useMemo(() => {
        let all = 0, complete = 0, incomplete = 0;
        for (const c of baseCandidates) {
            all++;
            const profComplete = isProfileComplete(c);
            if (profComplete) {
                complete++;
            } else {
                incomplete++;
            }
        }
        return { all, complete, incomplete };
    }, [baseCandidates]);
    const unreadCounts = useMemo(() => {
        const counts = { tags: {}, aiProjects: {}, crmProjects: {}, complete: 0, incomplete: 0, all: 0 };
        for (const c of baseCandidates) {
            const isUnread = checkIfUnread(c);

            if (isUnread) {
                counts.all++;
                if (isProfileComplete(c)) {
                    counts.complete++;
                } else {
                    counts.incomplete++;
                }

                if (c.tags && Array.isArray(c.tags)) {
                    c.tags.forEach(t => {
                        const tName = typeof t === 'string' ? t : t.name;
                        if (tName) {
                            const normalized = tName.trim().toLowerCase();
                            counts.tags[normalized] = (counts.tags[normalized] || 0) + 1;
                        }
                    });
                }
                if (c.projectId) {
                    counts.aiProjects[c.projectId] = (counts.aiProjects[c.projectId] || 0) + 1;
                }
                if (c.manualProjectId) {
                    counts.crmProjects[c.manualProjectId] = (counts.crmProjects[c.manualProjectId] || 0) + 1;
                }
            }
        }
        return counts;
    }, [baseCandidates]);

    // Scroll to bottom
    const prevMessagesLength = useRef(0);
    useEffect(() => {
        if (messages.length > prevMessagesLength.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        prevMessagesLength.current = messages.length;
    }, [messages]);

    // 🚀 SSE-DRIVEN: Surgical state updates (zero re-fetch architecture)
    // Uses DOM CustomEvent subscription to guarantee EVERY SSE event fires,
    // bypassing React 18's automatic batching which swallows intermediate useState updates.
    useSSECandidateUpdate((sseUpdate) => {
        if (!sseUpdate) return;
        
        const currentChat = selectedChatRef.current;

        // --- Typing indicator ---
        if (sseUpdate.updates?.recruiterTyping !== undefined) {
            if (sseUpdate.candidateId === currentChat?.id) {
                if ((user?.name || 'Reclutador') !== sseUpdate.updates.recruiterTyping) {
                    setRecruiterTypingName(sseUpdate.updates.recruiterTyping);
                    clearTimeout(typingTimersRef.current.recruiter);
                    typingTimersRef.current.recruiter = setTimeout(() => setRecruiterTypingName(''), 8000);
                }
            }
        }

        // --- Candidate Typing indicator ---
        if (sseUpdate.updates?.candidateTyping !== undefined) {
            if (sseUpdate.candidateId === currentChat?.id) {
                setCandidateTyping(sseUpdate.updates.candidateTyping);
                clearTimeout(typingTimersRef.current.candidate);
                if (sseUpdate.updates.candidateTyping) {
                    typingTimersRef.current.candidate = setTimeout(() => setCandidateTyping(false), 8000);
                }
            }
        }

        // --- Messages for the actively viewed chat → inject INSTANTLY ---
        if (String(sseUpdate.candidateId) === String(currentChat?.id) || (currentChat?.whatsapp && String(sseUpdate.phoneMatch) === String(currentChat.whatsapp))) {
            if (sseUpdate.updates?.messageStatusUpdate) {
                const { id, status, additionalData } = sseUpdate.updates.messageStatusUpdate;
                setMessages(prev => {
                    const idx = prev.findIndex(m => m.ultraMsgId === id || m.id === id);
                    if (idx !== -1) {
                        const newArr = [...prev];
                        newArr[idx] = { ...newArr[idx], status, ...additionalData };
                        return newArr;
                    }
                    return prev;
                });
            } else if (sseUpdate.updates?.newMessage) {
                if (sseUpdate.updates?.messagePayload) {
                    console.log('🚀 [SSE] Injecting INSTANT MESSAGE:', sseUpdate.updates.messagePayload);
                    // 🚀 O(1) Instant Message Injection (Meta Standard)
                    // Functional update chains correctly even when React batches
                    setMessages(prev => {
                        const newMsg = sseUpdate.updates.messagePayload;
                        // Prevent duplicates
                        if (prev.some(m => m.id === newMsg.id || (m.ultraMsgId && m.ultraMsgId === newMsg.ultraMsgId))) {
                            return prev;
                        }
                        // Smart deduplication: swap optimistic temp message
                        if (newMsg.from === 'me') {
                            const pendingIndex = prev.findIndex(m => 
                                m.status === 'pending' && 
                                String(m.id).startsWith('temp') && 
                                (
                                    (newMsg.type === 'text' && m.content === newMsg.content) || 
                                    (newMsg.mediaUrl && m.mediaUrl === newMsg.mediaUrl) ||
                                    (newMsg.type === 'template' && m.tipo === 'template')
                                )
                            );
                            if (pendingIndex !== -1) {
                                const newArr = [...prev];
                                newArr[pendingIndex] = newMsg;
                                setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 100);
                                return newArr;
                            }
                        }

                        setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 100);
                        return [...prev, newMsg];
                    });
                } else {
                    // Fallback for legacy hooks that don't send payload
                    const chatId = selectedChatRef.current?.id;
                    if (chatId) {
                        fetch(`/api/chat?candidateId=${chatId}`)
                            .then(r => r.json())
                            .then(data => {
                                if (data.success && selectedChatRef.current?.id === chatId) {
                                    setMessages(data.messages || []);
                                }
                            })
                            .catch(() => {});
                    }
                }
            }
        }

        // --- SURGICAL CANDIDATE PATCH (replaces loadCandidates) ---
        if (sseUpdate.candidateId && sseUpdate.updates && !sseUpdate.updates?.recruiterTyping) {
            const patch = sseUpdate.updates;
            setCandidates(prev => prev.map(c => {
                if (c.id !== sseUpdate.candidateId) return c;
                const updated = { ...c };
                if (patch.ultimoMensaje) updated.ultimoMensaje = patch.ultimoMensaje;
                if (patch.lastUserMessageAt) {
                    updated.lastUserMessageAt = patch.lastUserMessageAt;
                    updated.unreadMsgCount = (c.unreadMsgCount || 0) + 1;
                }
                if (patch.lastBotMessageAt) {
                    updated.lastBotMessageAt = patch.lastBotMessageAt;
                    updated.ultimoMensajeBot = patch.lastBotMessageAt;
                }
                if (patch.unreadMsgCount !== undefined) updated.unreadMsgCount = patch.unreadMsgCount;
                return updated;
            }));
            // Also update selectedChat if it's the one that changed
            if (currentChat?.id === sseUpdate.candidateId) {
                setSelectedChat(prev => {
                    if (!prev || prev.id !== sseUpdate.candidateId) return prev;
                    const updated = { ...prev };
                    if (patch.ultimoMensaje) updated.ultimoMensaje = patch.ultimoMensaje;
                    if (patch.lastBotMessageAt) {
                        updated.lastBotMessageAt = patch.lastBotMessageAt;
                        updated.ultimoMensajeBot = patch.lastBotMessageAt;
                        updated.unreadMsgCount = 0;
                    }
                    if (patch.lastUserMessageAt) {
                        updated.lastUserMessageAt = patch.lastUserMessageAt;
                        updated.unreadMsgCount = (updated.unreadMsgCount || 0) + 1;
                    }
                    if (patch.unreadMsgCount !== undefined) updated.unreadMsgCount = patch.unreadMsgCount;
                    return updated;
                });
            }
        }
    });

    // 🆕 SSE: New candidate arrived → inject directly (zero re-fetch)
    useEffect(() => {
        if (!sseNewCandidate) return;
        setCandidates(prev => {
            if (prev.some(c => c.id === sseNewCandidate.id)) return prev; // already exists
            return [sseNewCandidate, ...prev];
        });
    }, [sseNewCandidate]);

    // Reset typing when switching chats
    useEffect(() => {
        setCandidateTyping(false);
    }, [selectedChat?.id]);

    // Load messages
    useEffect(() => {
        if (!selectedChat) return;

        loadMessages();
        // 🚀 POLLING REMOVED: Trust the SSE `messagePayload` for real-time injection.

        // 🔵 Send blue ticks silently to the candidate's WhatsApp 
        // (Does NOT modify the database unread state or clear the green badge)
        const sendBlueTicks = async () => {
            try {
                await fetch('/api/chat', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'send_read_receipt', candidateId: selectedChat.id })
                });
            } catch(e) {}
        };
        sendBlueTicks();

        // 🔒 Lock this chat for me
        const currentUser = user?.name || 'Reclutador';
        const lockChat = async () => {
            try {
                await fetch('/api/chat', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'lock', candidateId: selectedChat.id, userName: currentUser })
                });
            } catch (e) { /* silent */ }
        };
        lockChat();

        // Heartbeat every 30s
        const heartbeatInterval = setInterval(async () => {
            try {
                await fetch('/api/chat', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'heartbeat', candidateId: selectedChat.id })
                });
            } catch (e) { /* silent */ }
        }, 30000);

        // Optimistic UI updates

        return () => {
            clearInterval(heartbeatInterval);
            // Unlock on deselect
            fetch('/api/chat', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'unlock', candidateId: selectedChat.id })
            }).catch(() => {});
        };
    }, [selectedChat?.id]);

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

    // Debounce state to avoid collision between optimistic messages and SSE/interval redraws
    const isSendingMediaRef = useRef(false);

    const loadMessages = async () => {
        if (!selectedChat?.id) return;
        if (isSendingMediaRef.current) return; // Mute polling/SSE while an optimistic upload is in flight

        try {
            const res = await fetch(`/api/chat?candidateId=${selectedChat.id}`);
            const data = await res.json();
            if (data.success && !isSendingMediaRef.current) {
                setMessages(data.messages || []);
            }
        } catch (e) {
            console.error('Failed to poll chat', e);
        }
    };

    const [blockLoading, setBlockLoading] = useState(false);

    const autoSilenceBot = async (candidate) => {
        if (!candidate || candidate.blocked) return;
        try {
            const result = await blockCandidate(candidate.id, true);
            if (result.success) {
                setCandidates(prev => prev.map(c =>
                    c.id === candidate.id ? { ...c, blocked: true } : c
                ));
                // Only update selectedChat if it's currently selected (though it should be)
                setSelectedChat(prev => prev?.id === candidate.id ? { ...prev, blocked: true } : prev);
                showToast && showToast('IA silenciada automáticamente (intervención humana)', 'success');
            }
        } catch (e) {
            console.error('Failed to auto-silence bot', e);
        }
    };

    const handleBlockToggle = async (chatToBlock, e) => {
        if (e) e.stopPropagation();
        if (!chatToBlock) return;
        const isCurrentlyBlocked = chatToBlock.blocked === true;
        const action = isCurrentlyBlocked ? 'reactivar la IA para' : 'silenciar la IA de';

        const confirmed = await new Promise(resolve => setConfirmModal({
            title: isCurrentlyBlocked ? 'Reactivar IA' : 'Silenciar IA',
            message: `¿Estás seguro de que deseas ${action} este chat?`,
            confirmText: isCurrentlyBlocked ? 'Reactivar' : 'Silenciar',
            variant: isCurrentlyBlocked ? 'success' : 'warning',
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false)
        }));
        if (!confirmed) return;

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
        
        const confirmed = await new Promise(resolve => setConfirmModal({
            title: 'Eliminar candidato',
            message: `¿Estás seguro de que deseas eliminar permanentemente a ${chatToDelete.nombreReal || chatToDelete.nombre || chatToDelete.whatsapp}? Esta acción no se puede deshacer.`,
            confirmText: 'Eliminar',
            variant: 'danger',
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false)
        }));
        if (!confirmed) return;

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

    const handleMarkAsRead = async (chatToMark, e) => {
        if (e) e.stopPropagation();
        if (!chatToMark) return;

        // Optimistic update: we must trick the logic userTime > botTime by setting botTime to now
        const now = new Date().toISOString();
        setCandidates(prev => prev.map(c => 
            c.id === chatToMark.id ? { ...c, unreadMsgCount: 0, lastBotMessageAt: now, ultimoMensajeBot: now } : c
        ));

        try {
            await fetch('/api/chat', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'mark_handled', candidateId: chatToMark.id })
            });
        } catch(err) {
            console.error('Error marking as read', err);
        }
    };

    const handleMarkAsUnread = async (chatToMark, e) => {
        if (e) e.stopPropagation();
        if (!chatToMark) return;

        // Optimistic update: set unread state
        setCandidates(prev => prev.map(c => 
            c.id === chatToMark.id ? { ...c, unreadMsgCount: 1, lastBotMessageAt: null, ultimoMensajeBot: null } : c
        ));

        try {
            await fetch('/api/chat', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'mark_unread', candidateId: chatToMark.id })
            });
        } catch(err) {
            console.error('Error marking as unread', err);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !selectedChat) return;

        // Auto-silence bot on manual intervention
        autoSilenceBot(selectedChat);

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
            timestamp: new Date().toISOString(),
            filename: file.name
        };
        setMessages(prev => [...prev, tempMsg]);
        setSending(true);
        isSendingMediaRef.current = true; // Mute polling during upload

        try {
            // Upload file to local media store first
            const formData = new FormData();
            formData.append('file', file);
            formData.append('candidateId', selectedChat.id);

            console.log(`📤 [FileUpload] Step 1: Uploading ${file.name} (${file.type}, ${Math.round(file.size/1024)}KB) as ${msgType}`);

            const uploadRes = await fetch('/api/media/upload', {
                method: 'POST',
                body: formData
            });
            const uploadData = await uploadRes.json();
            
            console.log(`📤 [FileUpload] Step 2: Upload response:`, { ok: uploadRes.ok, status: uploadRes.status, data: uploadData });

            if (!uploadRes.ok) throw new Error(uploadData.error || 'Error subiendo archivo');

            const mediaUrl = uploadData.url || uploadData.mediaUrl;

            // Update optimistic message with the real Redis URL (so it persists after page reload)
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, mediaUrl } : m));

            // Send via Chat API (single attempt — pre-upload makes retries unnecessary)
            console.log(`📤 [FileUpload] Step 3: Sending via /api/chat with type=${msgType}, mediaUrl=${mediaUrl}`);
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidateId: selectedChat.id,
                    message: '',
                    type: msgType,
                    mediaUrl
                })
            });
            const chatData = await res.json();
            console.log(`📤 [FileUpload] Step 4: Chat API response:`, { ok: res.ok, status: res.status, data: chatData });

            if (!res.ok) throw new Error(chatData?.error || 'Error al enviar media');

            // Update optimistic message in-place (no flicker from loadMessages)
            setMessages(prev => prev.map(m => m.id === tempId 
                ? { ...m, id: chatData.message?.id || tempId, status: 'sent', ultraMsgId: chatData.message?.ultraMsgId }
                : m
            ));
            window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: selectedChat.id } }));

        } catch (err) {
            console.error('❌ [FileUpload] FAILED at:', err.message, err);
            showToast && showToast('Error al mandar archivo: ' + err.message, 'error');
            // Mark as failed instead of removing — so the user sees it didn't go through
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed', error: err.message } : m));
        } finally {
            setSending(false);
            isSendingMediaRef.current = false;
        }
    };

    const injectVacancy = (vac) => {
        if (!vac || !vac.messageDescription) return;
        messageInputRef.current?.injectText(`💼 *Información sobre: ${vac.name}*\n\n${vac.messageDescription}`);
        setShowDropdown(null);
    };

    const sendReactionToApi = async (candidateId, msg, emoji, showToast, setReactionPopupId, loadMessages) => {
        setReactionPopupId(null);
        if (!msg || !emoji) return;

        const replyToId = msg.ultraMsgId || msg.id;

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidateId,
                    message: emoji,
                    type: 'reaction',
                    replyToId: replyToId
                })
            });
            const data = await res.json();
            if (data.success) {
                // Optimistically load immediately
                setTimeout(()=> loadMessages(), 100);
            } else {
                showToast && showToast('Error al enviar reacción', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast && showToast('Error de red al enviar reacción', 'error');
        }
    };

    const handleSend = (msg) => {
        if (!msg || !selectedChat) return;

        // Auto-silence bot on manual intervention
        autoSilenceBot(selectedChat);

        // Optimistic clear + focus so the user can immediately type again
        messageInputRef.current?.clearText();

        const currentCandidateId = selectedChat.id;
        const replyId = replyingToMsg ? (replyingToMsg.ultraMsgId || replyingToMsg.id) : null;
        
        // Optimistic contextualization
        const contextInfoParams = replyId && replyingToMsg ? {
            contextInfo: {
                quotedMessage: {
                    stanzaId: replyId,
                    participant: (replyingToMsg.from !== 'me' && replyingToMsg.from !== 'bot') ? selectedChat.whatsapp : '',
                    text: replyingToMsg.content || 'Mensaje multimedia'
                }
            }
        } : {};

        setReplyingToMsg(null);
        
        const optimisticId = 'temp-' + Date.now();
        setMessages(prev => [...(prev || []), {
            id: optimisticId,
            content: msg,
            tipo: 'text',
            from: 'me',
            enviado_por_agente: 1, // Visual indicator for sent by us
            status: 'pending',
            fecha: new Date().toISOString(),
            ...contextInfoParams
        }]);

        // Fire and forget (No blocking 'await')
        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: currentCandidateId, message: msg, type: 'text', replyToId: replyId })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                // Instantly swap the temp pending message for the real failed/sent one
                setMessages(prev => prev.map(m => m.id === optimisticId ? data.message : m));

                // If it came back failed explicitly from Meta API (e.g., 24h rule)
                if (data.message.status === 'failed') {
                    const fallbackErrorStr = String(data.message.error || '').toLowerCase();
                    if (fallbackErrorStr.includes('131047') || fallbackErrorStr.includes('24 hours')) {
                        showToast('Bloqueado por Meta 🛑: Han pasado >24 hrs. Toca el Rayito Verde ⚡ abajo para mandar una plantilla oficial.', 'error', 8000);
                    } else {
                        showToast(`Error de Meta: ${data.message.error || 'Desconocido'}`, 'error');
                    }
                }

                // 🚀 POLLING REMOVED: Trust the SSE `messagePayload` and optimistic UI for injection.
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: currentCandidateId } }));
            } else {
                setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error || 'API Error' } : m));
                showToast && showToast(`Error al enviar mensaje: ${data.error || 'Desconocido'}`, 'error');
            }
        }).catch(error => {
            setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: 'Red desconectada' } : m));
            console.error(error);
            showToast && showToast('Error de red al enviar', 'error');
        });

        // Backup focus
        setTimeout(() => {
            const input = document.getElementById('chat-msg-input');
            if (input) input.focus();
        }, 50);
    };

    const handleSendTemplate = (templateObj) => {
        if (!selectedChat) return;
        autoSilenceBot(selectedChat);

        const currentCandidateId = selectedChat.id;
        const optimisticId = 'temp-' + Date.now();

        // Optimistic append
        setMessages(prev => [...(prev || []), {
            id: optimisticId,
            content: `[Plantilla: ${templateObj.name}]`,
            tipo: 'template',
            from: 'me',
            enviado_por_agente: 1,
            status: 'pending',
            fecha: new Date().toISOString()
        }]);

        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                candidateId: currentCandidateId, 
                type: 'template', 
                templateData: templateObj 
            })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                setMessages(prev => prev.map(m => m.id === optimisticId ? data.message : m));

                if (data.message.status === 'failed') {
                    showToast(`Error de Meta al mandar plantilla: ${data.message.error || 'Desconocido'}`, 'error');
                } else {
                    showToast('Plantilla enviada correctamente', 'success');
                }
                
                // 🚀 POLLING REMOVED: Trust the SSE `messagePayload` and optimistic UI for injection.
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: currentCandidateId } }));
            } else {
                setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error || 'API Error' } : m));
                showToast(`Error al enviar plantilla: ${data.error || 'Desconocido'}`, 'error');
            }
        }).catch(error => {
            setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: 'Red desconectada' } : m));
            console.error(error);
            showToast('Error de red al enviar plantilla', 'error');
        });
    };

    // 🚀 MEMOIZED: Pre-compute display messages + formatted HTML (eliminates 700 regex ops/render)
    const displayMessages = useMemo(() => {
        if (!Array.isArray(messages)) return [];
        return messages.flatMap((msg) => {
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
                    isSplit: true,
                    _formattedHtml: formatWhatsAppText(part.trim())
                }));
            }
            return [{...msg, content, _formattedHtml: formatWhatsAppText(content)}];
        });
    }, [messages]);

    return (
        <div className="flex h-full w-full bg-[#f0f2f5] dark:bg-[#111b21] font-sans">
            
            {/* LADO IZQUIERDO: LISTA DE CHATS */}
            <div className={`w-full md:w-[30%] lg:w-[35%] xl:w-[500px] flex-col border-r border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] ${selectedChat ? 'hidden md:flex' : 'flex'}`}>
                
                {/* Eliminada la barra Header Izquierdo a petición del usuario */}

                {/* Barra de Búsqueda y Filtros Rápidos */}
                {loadingChats ? (
                    <div className="w-full h-full flex flex-col bg-white dark:bg-[#111b21] p-4 animate-pulse">
                        <div className="h-10 bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg w-full mb-3"></div>
                        <div className="flex gap-2 mb-3">
                            <div className="h-7 w-20 bg-[#f0f2f5] dark:bg-[#202c33] rounded-full"></div>
                            <div className="h-7 w-28 bg-[#f0f2f5] dark:bg-[#202c33] rounded-full"></div>
                            <div className="h-7 w-24 bg-[#f0f2f5] dark:bg-[#202c33] rounded-full"></div>
                        </div>
                        <div className="flex flex-col gap-4 mt-4">
                            {[...Array(8)].map((_, i) => (
                                <div key={i} className="flex gap-3 items-center">
                                    <div className="w-12 h-12 rounded-full bg-[#f0f2f5] dark:bg-[#202c33] shrink-0"></div>
                                    <div className="flex flex-col gap-2 flex-1">
                                        <div className="h-4 bg-[#f0f2f5] dark:bg-[#202c33] rounded w-32"></div>
                                        <div className="h-3 bg-[#f0f2f5] dark:bg-[#202c33] rounded w-full"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="p-2 bg-white dark:bg-[#111b21] flex flex-col gap-2 border-b border-[#f0f2f5] dark:border-[#222e35] relative z-50">
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
                    <div className="flex flex-col gap-2 pb-2 min-h-[105px]">
                        {/* Renglón 1: Estados */}
                        <div 
                            className="w-full flex flex-nowrap items-center justify-between gap-1 pb-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                            style={{ containerType: 'inline-size' }}
                        >
                        {canSeeFilter('filter_todos') && (
                            <button 
                                onClick={() => { setActiveFilter('all'); setFilterValue(null); setAiProjectFilter(null); setAiStepFilter(null); setManualPipelineFilter(null); setManualStepFilter(null); setShowDropdown(null); }}
                                className={`flex-1 flex justify-center px-1.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors border border-transparent items-center gap-1 min-w-[50px] ${
                                    activeFilter === 'all' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                                style={{ fontSize: 'clamp(9px, 2.5cqw, 12px)' }}
                            >
                                Todos
                            </button>
                        )}
                        <button 
                            onClick={() => { setActiveFilter('unread'); setFilterValue(null); setShowDropdown(null); }}
                            className={`flex-[1.2] flex justify-center px-1.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors border border-transparent items-center gap-1 min-w-[70px] ${
                                activeFilter === 'unread' 
                                ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                            }`}
                            style={{ fontSize: 'clamp(9px, 2.5cqw, 12px)' }}
                        >
                            No Leídos
                            {unreadCounts.all > 0 && (
                                <div className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center shrink-0 text-white text-[9px] font-bold shadow-sm -ml-0.5">
                                    {unreadCounts.all}
                                </div>
                            )}
                        </button>
                        {canSeeFilter('filter_complete') && (
                            <button 
                                onClick={() => { setActiveFilter('profile'); setFilterValue('complete'); setShowDropdown(null); }}
                                className={`flex-[1.5] flex justify-center px-1.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors border border-transparent items-center gap-1 min-w-[90px] ${
                                    activeFilter === 'profile' && filterValue === 'complete' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                                style={{ fontSize: 'clamp(9px, 2.5cqw, 12px)' }}
                            >
                                Completos ({badgeCounts.complete})
                                {unreadCounts.complete > 0 && (
                                    <div className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center shrink-0 text-white text-[9px] font-bold shadow-sm -ml-0.5">
                                        {unreadCounts.complete}
                                    </div>
                                )}
                            </button>
                        )}
                        {canSeeFilter('filter_incomplete') && (
                            <button 
                                onClick={() => { setActiveFilter('profile'); setFilterValue('incomplete'); setShowDropdown(null); }}
                                className={`flex-[1.5] flex justify-center px-1.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors border border-transparent items-center gap-1 min-w-[90px] ${
                                    activeFilter === 'profile' && filterValue === 'incomplete' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                                style={{ fontSize: 'clamp(9px, 2.5cqw, 12px)' }}
                            >
                                Incompletos ({badgeCounts.incomplete})
                                {unreadCounts.incomplete > 0 && (
                                    <div className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center shrink-0 text-white text-[9px] font-bold shadow-sm -ml-0.5">
                                        {unreadCounts.incomplete}
                                    </div>
                                )}
                            </button>
                        )}
                        </div>

                        {/* Renglón 2: Etiquetas */}
                        <div className="w-full mt-2 mb-1">
                            {/* Etiquetas Dropdown */}
                            {canSeeFilter('filter_labels') && (
                                <div className="relative w-full">
                                    <div 
                                        onClick={() => setShowDropdown(showDropdown === 'labels' ? null : 'labels')}
                                        className={`w-full bg-[#f0f2f5] dark:bg-[#202c33] border ${activeFilter === 'label' ? 'border-transparent' : 'border-gray-200 dark:border-gray-700'} rounded-lg pl-9 pr-14 py-2 text-xs outline-none font-medium text-left cursor-pointer transition-all flex items-center shadow-sm relative`}
                                        style={activeFilter === 'label' ? {
                                            boxShadow: `0 0 0 2px ${(availableTags.find(t => (typeof t === 'string' ? t : t.name) === filterValue))?.color || '#3b82f6'}`,
                                            borderColor: 'transparent'
                                        } : {}}
                                    >
                                        <Tag className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${activeFilter === 'label' ? 'text-[#111b21] dark:text-[#e9edef]' : 'text-gray-400 dark:text-gray-500'}`} style={activeFilter === 'label' ? { color: (availableTags.find(t => (typeof t === 'string' ? t : t.name) === filterValue))?.color } : {}} />
                                        <span className="flex-1 truncate text-[#111b21] dark:text-[#e9edef]">{activeFilter === 'label' ? filterValue : 'Todas las etiquetas'}</span>
                                        <div className={`absolute right-2 top-1/2 -translate-y-1/2 transition-transform ${showDropdown === 'labels' ? 'rotate-180' : ''}`}>
                                            <ChevronIcon />
                                        </div>
                                    </div>
                                    
                                    {activeFilter === 'label' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setActiveFilter(null); setFilterValue(null); }}
                                            className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shrink-0 z-10"
                                            title="Quitar filtro"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}

                                    {showDropdown === 'labels' && (
                                        <div className="absolute top-full left-0 mt-2 w-full bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-[100] py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                            <div 
                                                onClick={() => { setActiveFilter(null); setFilterValue(null); setShowDropdown(null); }}
                                                className={`px-4 py-2.5 text-xs cursor-pointer flex items-center gap-2 ${!activeFilter ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                            >
                                                <div className="w-3 h-3 rounded border border-gray-300 dark:border-gray-600 flex items-center justify-center">
                                                    {!activeFilter && <div className="w-1.5 h-1.5 rounded-sm bg-indigo-500"></div>}
                                                </div>
                                                Todas las etiquetas
                                            </div>
                                            {(Array.isArray(availableTags) ? availableTags : []).filter(tagObj => {
                                                // User-level label filtering
                                                if (!user || user.role === 'SuperAdmin') return true;
                                                const userLabels = user?.allowed_labels;
                                                if (!Array.isArray(userLabels) || userLabels.length === 0) return true;
                                                const name = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                                return userLabels.some(l => typeof l === 'string' && l.trim().toLowerCase() === name.trim().toLowerCase());
                                            }).map(tagObj => {
                                                const tName = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                                const tColor = typeof tagObj === 'string' ? '#3b82f6' : tagObj.color;
                                                const display = tagObj.count !== undefined ? `${tName} (${tagObj.count})` : tName;
                                                
                                                // Use global memoized count
                                                const unreadCount = unreadCounts.tags[tName.trim().toLowerCase()] || 0;
                                                const isSelected = activeFilter === 'label' && filterValue === tName;

                                                return (
                                                    <div 
                                                        key={tName}
                                                        onClick={() => { setActiveFilter('label'); setFilterValue(tName); setShowDropdown(null); }}
                                                        className={`px-4 py-2.5 text-xs cursor-pointer flex items-center justify-between ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                    >
                                                        <div className="flex items-center gap-2 truncate pr-2">
                                                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tColor }}></span>
                                                            <span className="truncate flex-1">{display}</span>
                                                        </div>
                                                        {unreadCount > 0 && (
                                                            <div className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center shrink-0 text-white text-[10px] font-bold shadow-sm">
                                                                {unreadCount}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Renglón 3: Proyectos y CRM Manual */}
                        <div className="flex flex-col gap-2 w-full">
                            {/* Riel A: Proyectos (Maletín) */}
                            {canSeeFilter('filter_projects') && (
                                <div className="w-full flex flex-col gap-2">
                                    <div className="relative w-full">
                                        <div 
                                            onClick={() => setShowDropdown(showDropdown === 'aiProject' ? null : 'aiProject')}
                                            className={`w-full bg-[#f0f2f5] dark:bg-[#202c33] border ${aiProjectFilter ? 'border-transparent' : 'border-gray-200 dark:border-gray-700'} rounded-lg pl-9 pr-14 py-2 text-xs outline-none font-medium text-left cursor-pointer transition-all flex items-center shadow-sm relative`}
                                            style={aiProjectFilter ? {
                                                boxShadow: `0 0 0 2px #3b82f6`,
                                                borderColor: 'transparent'
                                            } : {}}
                                        >
                                            <Briefcase className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${aiProjectFilter ? 'text-[#111b21] dark:text-[#e9edef]' : 'text-gray-400 dark:text-gray-500'}`} style={aiProjectFilter ? { color: '#3b82f6' } : {}} />
                                            <span className="flex-1 truncate text-[#111b21] dark:text-[#e9edef]">{aiProjectFilter ? (projects.find(p => p.id === aiProjectFilter)?.name || 'Proyecto') : 'Proyectos'}</span>
                                            <div className={`absolute right-2 top-1/2 -translate-y-1/2 transition-transform ${showDropdown === 'aiProject' ? 'rotate-180' : ''}`}>
                                                <ChevronIcon />
                                            </div>
                                        </div>
                                        {aiProjectFilter && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setAiProjectFilter(null); setAiStepFilter(null); setShowDropdown(null); }}
                                                className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shrink-0 z-10"
                                                title="Quitar filtro"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                        {showDropdown === 'aiProject' && (
                                            <div className="absolute top-full left-0 mt-2 w-full bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-[100] py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                                {filteredProjects.length === 0 ? (
                                                    <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay proyectos</div>
                                                ) : (
                                                    filteredProjects.map(project => {
                                                        const unreadCount = unreadCounts.aiProjects[project.id] || 0;
                                                        const isSelected = aiProjectFilter === project.id;
                                                        return (
                                                            <div
                                                                key={project.id}
                                                                onClick={() => { setAiProjectFilter(project.id); setAiStepFilter(null); setShowDropdown(null); }}
                                                                className={`px-4 py-2.5 text-xs cursor-pointer flex items-center justify-between ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                                title={project.name}
                                                            >
                                                                <span className="truncate flex-1 pr-2">{project.name}</span>
                                                                {unreadCount > 0 && (
                                                                    <div className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center shrink-0 text-white text-[10px] font-bold shadow-sm">
                                                                        {unreadCount}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* Pasos Dropdown (Riel A) */}
                                    {aiProjectFilter && (() => {
                                        const activeProject = projects.find(p => p.id === aiProjectFilter);
                                        if (!activeProject) return null;
                                        return (
                                            <div className="relative w-full">
                                                <div 
                                                    onClick={() => setShowDropdown(showDropdown === 'aiStep' ? null : 'aiStep')}
                                                    className={`w-full bg-[#f0f2f5] dark:bg-[#202c33] border ${aiStepFilter ? 'border-transparent' : 'border-gray-200 dark:border-gray-700'} rounded-lg pl-3 pr-14 py-2 text-xs outline-none font-medium text-left cursor-pointer transition-all flex items-center shadow-sm relative`}
                                                    style={aiStepFilter ? {
                                                        boxShadow: `0 0 0 2px #8b5cf6`,
                                                        borderColor: 'transparent'
                                                    } : {}}
                                                >
                                                    <span className={`flex-1 truncate ${aiStepFilter ? 'text-[#111b21] dark:text-[#e9edef]' : 'text-gray-500 dark:text-gray-400'}`}>
                                                        {aiStepFilter ? (activeProject.steps?.find(s => s.id === aiStepFilter)?.name || 'Paso') : 'Todos los pasos'}
                                                    </span>
                                                    <div className={`absolute right-2 top-1/2 -translate-y-1/2 transition-transform ${showDropdown === 'aiStep' ? 'rotate-180' : ''}`}>
                                                        <ChevronIcon />
                                                    </div>
                                                </div>
                                                {aiStepFilter && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setAiStepFilter(null); setShowDropdown(null); }}
                                                        className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shrink-0 z-10"
                                                        title="Quitar filtro"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                {showDropdown === 'aiStep' && (
                                                    <div className="absolute top-full left-0 mt-2 w-full bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-[100] py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                                        <div
                                                            onClick={() => { setAiStepFilter(null); setShowDropdown(null); }}
                                                            className={`px-4 py-2.5 text-xs cursor-pointer flex items-center justify-between ${!aiStepFilter ? 'bg-purple-50 dark:bg-purple-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                        >
                                                            Todos los Pasos
                                                        </div>
                                                        {activeProject.steps?.length === 0 ? (
                                                            <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay pasos</div>
                                                        ) : (
                                                            activeProject.steps?.map(step => {
                                                                const isSelected = aiStepFilter === step.id;
                                                                return (
                                                                    <div
                                                                        key={step.id}
                                                                        onClick={() => { setAiStepFilter(step.id); setShowDropdown(null); }}
                                                                        className={`px-4 py-2.5 text-xs cursor-pointer flex items-center gap-2 ${isSelected ? 'bg-purple-50 dark:bg-purple-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                                        title={step.name}
                                                                    >
                                                                        <span className="truncate flex-1">{step.name}</span>
                                                                    </div>
                                                                );
                                                            })
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* Riel B: CRM Manual */}
                            {canSeeFilter('filter_crm') && (
                                <div className="w-full flex flex-col gap-2">
                                    <div className="relative w-full">
                                        <div 
                                            onClick={() => setShowDropdown(showDropdown === 'manualPipeline' ? null : 'manualPipeline')}
                                            className={`w-full bg-[#f0f2f5] dark:bg-[#202c33] border ${manualPipelineFilter ? 'border-transparent' : 'border-gray-200 dark:border-gray-700'} rounded-lg pl-9 pr-14 py-2 text-xs outline-none font-medium text-left cursor-pointer transition-all flex items-center shadow-sm relative`}
                                            style={manualPipelineFilter ? {
                                                boxShadow: `0 0 0 2px #f59e0b`,
                                                borderColor: 'transparent'
                                            } : {}}
                                        >
                                            <Kanban className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${manualPipelineFilter ? 'text-[#111b21] dark:text-[#e9edef]' : 'text-gray-400 dark:text-gray-500'}`} style={manualPipelineFilter ? { color: '#f59e0b' } : {}} />
                                            <span className="flex-1 truncate text-[#111b21] dark:text-[#e9edef]">{manualPipelineFilter ? (manualProjects.find(p => p.id === manualPipelineFilter)?.name || 'Pipeline') : 'CRM de Proyectos'}</span>
                                            <div className={`absolute right-2 top-1/2 -translate-y-1/2 transition-transform ${showDropdown === 'manualPipeline' ? 'rotate-180' : ''}`}>
                                                <ChevronIcon />
                                            </div>
                                        </div>
                                        {manualPipelineFilter && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setManualPipelineFilter(null); setManualStepFilter(null); setShowDropdown(null); }}
                                                className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shrink-0 z-10"
                                                title="Quitar filtro"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                        {showDropdown === 'manualPipeline' && (
                                            <div className="absolute top-full left-0 mt-2 w-full bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-[100] py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                                {filteredManualProjects.length === 0 ? (
                                                    <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay pipelines</div>
                                                ) : (
                                                    filteredManualProjects.map(project => {
                                                        const unreadCount = unreadCounts.crmProjects[project.id] || 0;
                                                        const isSelected = manualPipelineFilter === project.id;
                                                        return (
                                                            <div
                                                                key={project.id}
                                                                onClick={() => { setManualPipelineFilter(project.id); setManualStepFilter(null); setShowDropdown(null); }}
                                                                className={`px-4 py-2.5 text-xs cursor-pointer flex items-center justify-between ${isSelected ? 'bg-orange-50 dark:bg-orange-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                                title={project.name}
                                                            >
                                                                <span className="truncate flex-1 pr-2">{project.name}</span>
                                                                {unreadCount > 0 && (
                                                                    <div className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center shrink-0 text-white text-[10px] font-bold shadow-sm">
                                                                        {unreadCount}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Pasos Dropdown (Riel B) */}
                                    {manualPipelineFilter && (() => {
                                        const activeProject = manualProjects.find(p => p.id === manualPipelineFilter);
                                        if (!activeProject) return null;
                                        return (
                                            <div className="relative w-full">
                                                <div 
                                                    onClick={() => setShowDropdown(showDropdown === 'manualStep' ? null : 'manualStep')}
                                                    className={`w-full bg-[#f0f2f5] dark:bg-[#202c33] border ${manualStepFilter ? 'border-transparent' : 'border-gray-200 dark:border-gray-700'} rounded-lg pl-3 pr-14 py-2 text-xs outline-none font-medium text-left cursor-pointer transition-all flex items-center shadow-sm relative`}
                                                    style={manualStepFilter ? {
                                                        boxShadow: `0 0 0 2px #d97706`,
                                                        borderColor: 'transparent'
                                                    } : {}}
                                                >
                                                    <span className={`flex-1 truncate ${manualStepFilter ? 'text-[#111b21] dark:text-[#e9edef]' : 'text-gray-500 dark:text-gray-400'}`}>
                                                        {manualStepFilter ? (activeProject.steps?.find(s => s.id === manualStepFilter)?.name || 'Paso') : 'Todos los pasos'}
                                                    </span>
                                                    <div className={`absolute right-2 top-1/2 -translate-y-1/2 transition-transform ${showDropdown === 'manualStep' ? 'rotate-180' : ''}`}>
                                                        <ChevronIcon />
                                                    </div>
                                                </div>
                                                {manualStepFilter && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setManualStepFilter(null); setShowDropdown(null); }}
                                                        className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shrink-0 z-10"
                                                        title="Quitar filtro"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                {showDropdown === 'manualStep' && (
                                                    <div className="absolute top-full left-0 mt-2 w-full bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-[100] py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                                        <div
                                                            onClick={() => { setManualStepFilter(null); setShowDropdown(null); }}
                                                            className={`px-4 py-2.5 text-xs cursor-pointer flex items-center justify-between ${!manualStepFilter ? 'bg-orange-50 dark:bg-orange-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                        >
                                                            Todos los Pasos
                                                        </div>
                                                        {activeProject.steps?.length === 0 ? (
                                                            <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay pasos</div>
                                                        ) : (
                                                            activeProject.steps?.map(step => {
                                                                const isSelected = manualStepFilter === step.id;
                                                                return (
                                                                    <div
                                                                        key={step.id}
                                                                        onClick={() => { setManualStepFilter(step.id); setShowDropdown(null); }}
                                                                        className={`px-4 py-2.5 text-xs cursor-pointer flex items-center gap-2 ${isSelected ? 'bg-orange-50 dark:bg-orange-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                                        title={step.name}
                                                                    >
                                                                        <span className="truncate flex-1">{step.name}</span>
                                                                    </div>
                                                                );
                                                            })
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div> {/* Cierra Row 3 */}
                    </div> {/* Cierra outer flex-col */}
                </div> {/* Cierra header container */}

                {/* Lista de Contactos — VIRTUALIZADA */}
                <div className="flex-1 overflow-hidden bg-white dark:bg-[#111b21]">
                        <Virtuoso
                            data={filteredCandidates}
                            overscan={10}
                            computeItemKey={(index, chat) => chat.id}
                            itemContent={(index, chat) => (
                                <ChatRow
                                    key={chat.id}
                                    chat={chat}
                                    isSelected={selectedChat?.id === chat.id}
                                    isPinned={pinnedChats.includes(chat.id)}
                                    onSelect={setSelectedChat}
                                    onBlock={handleBlockToggle}
                                    onDelete={handleDeleteChat}
                                    onTogglePin={togglePin}
                                    onlineReaders={(onlineUsers || []).filter(u => u.currentChatId === chat.id)}
                                    blockLoading={blockLoading}
                                    userId={user?.id || user?.whatsapp}
                                    onOpenProfileModal={setProfileModalCandidate}
                                    onMarkAsRead={handleMarkAsRead}
                                    onMarkAsUnread={handleMarkAsUnread}
                                />
                            )}
                        />
                </div>
                </>
                )}
            </div>

            {/* LADO DERECHO: CHAT BODY */}
            {selectedChat ? (
                <div className={`flex-1 flex flex-col bg-[#efeae2] dark:bg-[#0b141a] h-full relative ${!selectedChat ? 'hidden md:flex' : 'flex'}`}>
                    
                    {/* Header Chat */}
                    <div className="min-h-[59px] px-4 py-2 flex items-center justify-between bg-[#f0f2f5] dark:bg-[#202c33] z-20 shadow-sm">
                        <div className="flex items-center cursor-pointer flex-1 min-w-0 pr-4">
                            <button 
                                className="md:hidden mr-2 p-1 text-[#54656f] dark:text-[#aebac1]"
                                onClick={() => setSelectedChat(null)}
                            >
                                <ArrowLeft className="w-6 h-6" />
                            </button>
                            <div className="min-w-[40px] w-10 h-10 rounded-full flex items-center justify-center mr-3 overflow-hidden shrink-0">
                                {selectedChat.profilePic ? (
                                    <img src={selectedChat.profilePic} className="w-full h-full object-cover" alt="profile"
                                        onError={(e)=>{e.target.onerror=null; e.target.style.display='none'; e.target.parentElement.innerHTML=`<span class="flex items-center justify-center w-full h-full text-sm font-bold text-white" style="background:${['#f9a8d4','#a5b4fc','#86efac','#fcd34d','#fdba74','#c4b5fd','#67e8f9','#f0abfc','#fca5a5','#bef264'][((selectedChat.nombre||'C').charCodeAt(0)*7)%10]}">${(selectedChat.nombre||'C')[0].toUpperCase()}</span>`;}} />
                                ) : (
                                    <span className="flex items-center justify-center w-full h-full text-sm font-bold text-white rounded-full"
                                        style={{ background: ['#f9a8d4','#a5b4fc','#86efac','#fcd34d','#fdba74','#c4b5fd','#67e8f9','#f0abfc','#fca5a5','#bef264'][((selectedChat.nombre||'C').charCodeAt(0)*7)%10] }}>
                                        {(selectedChat.nombre || 'C')[0].toUpperCase()}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                                <div className="flex items-center min-w-0 w-full">
                                    <h2 className="text-[17px] font-medium text-[#111b21] dark:text-[#e9edef] truncate shrink whitespace-nowrap">
                                        {toTitleCase(selectedChat.nombreReal || selectedChat.nombre) || selectedChat.whatsapp}
                                    </h2>
                                    <div className="flex items-center shrink-0 ml-1.5 overflow-visible pt-1 pb-1 pr-1">
                                    {selectedChat.tags && selectedChat.tags.map(t => {
                                        const tObj = availableTags.find(at => (typeof at === 'string' ? at : at.name) === t);
                                        const tColor = tObj ? (tObj.color || '#3b82f6') : '#3b82f6';
                                        return (
                                            <span key={t} className="group/tag relative inline-flex items-center text-xs px-2.5 py-0.5 rounded-full text-white font-medium whitespace-nowrap opacity-90 shadow-sm cursor-default ml-1.5 align-middle" style={{ backgroundColor: tColor }}>
                                                {t}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleToggleTag(t); }}
                                                    className="absolute -top-1 -right-1.5 w-4 h-4 rounded-full bg-gray-800/80 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover/tag:opacity-100 transition-opacity duration-150 shadow z-10"
                                                    title={`Desvincular "${t}"`}
                                                >
                                                    <X className="w-2.5 h-2.5" />
                                                </button>
                                            </span>
                                        );
                                    })}
                                    </div>
                                </div>
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

                            {/* Draggable Icon Toolbar */}
                            {toolbarOrder.map((iconId) => {
                                const handleDragStart = (e) => {
                                    setDraggedIcon(iconId);
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', iconId);
                                };
                                const handleDragOver = (e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                };
                                const handleDrop = (e) => {
                                    e.preventDefault();
                                    if (!draggedIcon || draggedIcon === iconId) return;
                                    const newOrder = [...toolbarOrder];
                                    const fromIdx = newOrder.indexOf(draggedIcon);
                                    const toIdx = newOrder.indexOf(iconId);
                                    newOrder.splice(fromIdx, 1);
                                    newOrder.splice(toIdx, 0, draggedIcon);
                                    setToolbarOrder(newOrder);
                                    localStorage.setItem('candidatic:toolbar_order', JSON.stringify(newOrder));
                                    setDraggedIcon(null);
                                };
                                const handleDragEnd = () => setDraggedIcon(null);

                                const dragProps = {
                                    draggable: true,
                                    onDragStart: handleDragStart,
                                    onDragOver: handleDragOver,
                                    onDrop: handleDrop,
                                    onDragEnd: handleDragEnd,
                                };

                                const baseClass = `p-2 rounded-full transition-all cursor-grab active:cursor-grabbing ${draggedIcon === iconId ? 'opacity-40 scale-90' : 'opacity-100'}`;

                                if (iconId === 'vacancies') {
                                    return (
                                        <div key={iconId} className="relative z-50" {...dragProps}>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); setShowDropdown(showDropdown === 'vacancies' ? null : 'vacancies'); }}
                                                className={`${baseClass} hover:bg-black/5 dark:hover:bg-white/5 ${showDropdown === 'vacancies' ? 'bg-black/5 dark:bg-white/5' : ''}`} title="Inyectar información de Vacante">
                                                <Briefcase className="w-5 h-5 text-gray-500 hover:text-blue-500 transition-colors" />
                                            </button>
                                            <div className={`absolute right-0 top-full mt-1 w-64 bg-white dark:bg-[#202c33] rounded-lg shadow-xl transition-all z-50 border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col ${showDropdown === 'vacancies' ? 'opacity-100 pointer-events-auto translate-y-0' : 'opacity-0 pointer-events-none -translate-y-2'}`}>
                                                <div className="px-3 py-2 text-xs font-bold text-[#8696a0] border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-[#111b21]">
                                                    Inyectar Info de Vacante
                                                </div>
                                                <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                    {vacancies.length === 0 ? (
                                                        <div className="px-3 py-4 text-center text-xs text-gray-400">
                                                            No hay vacantes configuradas con "Info para el bot"
                                                        </div>
                                                    ) : (
                                                        vacancies.map(vac => {
                                                            return (
                                                                <div key={vac.id}
                                                                    className={`px-3 py-2 text-xs transition-colors flex items-center justify-between group/vacitem ${
                                                                        selectedChat?.currentVacancyId === vac.id
                                                                        ? 'bg-blue-50 dark:bg-blue-900/20'
                                                                        : 'hover:bg-gray-50 dark:hover:bg-[#111b21]'
                                                                    }`}
                                                                >
                                                                    <div onClick={(e) => { e.stopPropagation(); injectVacancy(vac); }} className="flex items-center gap-2 cursor-pointer flex-1 overflow-hidden">
                                                                        <Briefcase className="w-3.5 h-3.5 shrink-0 text-[#111b21] dark:text-[#e9edef]" />
                                                                        <span className={`truncate flex-1 ${selectedChat?.currentVacancyId === vac.id ? 'text-blue-600 font-bold' : 'text-[#111b21] dark:text-[#e9edef]'}`}>{vac.name}</span>
                                                                        {selectedChat?.currentVacancyId === vac.id && <Check className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                                                                    </div>
                                                                    
                                                                    <button 
                                                                        onClick={(e) => { e.stopPropagation(); setEditingVac(vac); }} 
                                                                        className="ml-2 p-1.5 text-gray-400 hover:text-blue-500 opacity-0 group-hover/vacitem:opacity-100 transition-opacity bg-white dark:bg-[#202c33] rounded-full shadow-sm border border-gray-200 dark:border-gray-600"
                                                                        title="Editar información inyectable"
                                                                    >
                                                                        <Edit2 className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                if (iconId === 'tags') {
                                    return (
                                        <div key={iconId} className="relative z-50" {...dragProps}>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); setShowDropdown(showDropdown === 'tags' ? null : 'tags'); }}
                                                className={`${baseClass} hover:bg-black/5 dark:hover:bg-white/5 ${showDropdown === 'tags' ? 'bg-black/5 dark:bg-white/5' : ''}`}>
                                                <Tag className="w-5 h-5" />
                                            </button>
                                            <div className={`absolute right-0 top-full mt-1 w-72 bg-white dark:bg-[#202c33] rounded-lg shadow-xl transition-all z-50 border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col ${showDropdown === 'tags' ? 'opacity-100 pointer-events-auto translate-y-0' : 'opacity-0 pointer-events-none -translate-y-2'}`}>
                                                <div className="px-3 py-2 text-xs font-bold text-[#8696a0] border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-[#111b21]">
                                                    <span>Etiquetar candidato</span>
                                                </div>
                                                <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                    {availableTags.map(tagObj => {
                                                        const tName = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                                        const tColor = typeof tagObj === 'string' ? '#3b82f6' : tagObj.color;
                                                        const display = tagObj.count !== undefined ? `${tName} (${tagObj.count})` : tName;
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
                                                                                        const newGlobal = availableTags.map(t => 
                                                                                            (typeof t === 'string' ? t : t.name) === tName 
                                                                                            ? { name: editTagName.trim(), color: editTagColor } 
                                                                                            : t
                                                                                        );
                                                                                        saveTagsGlobal(newGlobal);
                                                                                        if (isActive && editTagName.trim() !== tName) {
                                                                                            const newCandidateTags = (selectedChat.tags || []).filter(t => t !== tName);
                                                                                            newCandidateTags.push(editTagName.trim());
                                                                                            setSelectedChat({ ...selectedChat, tags: newCandidateTags });
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
                                                                    <span className="truncate">{display}</span>
                                                                    {isActive && <Check className="w-4 h-4 text-blue-500 ml-1" />}
                                                                </div>
                                                                {canManageTags && (
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
                                                                            deleteTagGlobal(tName);
                                                                        }}
                                                                        className="p-1 text-gray-400 hover:text-red-500"
                                                                        title="Eliminar etiqueta"
                                                                    >
                                                                        <X className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {/* Modulo crear nueva etiqueta — solo para usuarios con permiso */}
                                                {canManageTags && (
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
                                                )}
                                            </div>
                                        </div>
                                    );
                                }

                                if (iconId === 'crm_manual') {
                                    return (
                                        <button 
                                            key={iconId}
                                            {...dragProps}
                                            onClick={() => setShowRightPanel(!showRightPanel)}
                                            className={`${baseClass} ml-1 ${showRightPanel ? 'bg-indigo-50 text-indigo-500 dark:bg-indigo-500/20' : 'hover:bg-black/5 dark:hover:bg-white/5 text-[#54656f] dark:text-[#aebac1]'}`}
                                            title="CRM Manual"
                                        >
                                            <Kanban className="w-5 h-5" />
                                        </button>
                                    );
                                }

                                if (iconId === 'quick_replies') {
                                    return (
                                        <button 
                                            key={iconId}
                                            {...dragProps}
                                            onClick={() => setShowQuickRepliesPanel(!showQuickRepliesPanel)}
                                            className={`${baseClass} ${showQuickRepliesPanel ? 'bg-green-50 text-green-600 dark:bg-green-500/20 dark:text-green-400' : 'hover:bg-black/5 dark:hover:bg-white/5 text-[#54656f] dark:text-[#aebac1]'}`}
                                            title="Banco de Respuestas"
                                        >
                                            <BookOpen className="w-5 h-5" />
                                        </button>
                                    );
                                }

                                return null;
                            })}
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
                    <div className="flex-1 overflow-y-auto p-[5%] z-10 space-y-[2px]" onClick={() => setShowDropdown(null)}>
                        <div className="text-center py-2 bg-[#ffeed0] dark:bg-[#cca868]/10 text-[#111b21] dark:text-[#f7cd73]/70 rounded-lg mx-auto w-fit px-4 shadow-sm select-none mb-4 border border-black/5 dark:border-white/5">
                            <p className="text-[12px] leading-tight">Los mensajes están protegidos de extremo a extremo por Candidatic y la IA.</p>
                        </div>

                        {displayMessages.map((msg, i) => {
                            if (!msg) return null;
                            // Prevenir renderizado de burbujas fantasma (eventos de sistema sin texto ni multimedia)
                            if (!msg.content && !msg.mediaUrl) return null;
                            
                            const isMe = msg.from === 'me' || msg.from === 'bot';
                            const prevMsg = i > 0 ? displayMessages[i - 1] : null;
                            const isPrevMe = prevMsg ? (prevMsg.from === 'me' || prevMsg.from === 'bot') : null;
                            const isFirstInSeries = !prevMsg || isMe !== isPrevMe;

                            return (
                                <div key={msg.id + '-' + i} className={`flex ${isMe ? 'justify-end' : 'justify-start'} group max-w-full relative ${!isFirstInSeries ? '-mt-1.5' : 'mt-1'} ${(msg.reactions && msg.reactions.length > 0) ? 'pb-5' : ''}`}>
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

                                        <div className="relative inline-block min-w-[110px] max-w-full group/msgbody">
                                            {/* Quoted Message Rendering */}
                                            {msg.contextInfo?.quotedMessage && (
                                                <div 
                                                    className="mb-1.5 mt-0.5 rounded px-2 py-1.5 border-l-4 text-[12.5px] cursor-default bg-black/5 dark:bg-white/5"
                                                    style={{ 
                                                        borderColor: (msg.contextInfo.quotedMessage.participant && msg.contextInfo.quotedMessage.participant.includes(selectedChat?.whatsapp)) ? '#eb5398' : (isMe ? '#027a61' : '#53bdeb')
                                                    }}
                                                >
                                                    <div 
                                                        className="font-bold mb-0.5 capitalize truncate"
                                                        style={{ color: (msg.contextInfo.quotedMessage.participant && msg.contextInfo.quotedMessage.participant.includes(selectedChat?.whatsapp)) ? '#eb5398' : (isMe ? '#027a61' : '#53bdeb') }}
                                                    >
                                                        {(msg.contextInfo.quotedMessage.participant && msg.contextInfo.quotedMessage.participant.includes(selectedChat?.whatsapp)) ? (selectedChat?.nombre?.split(' ')[0] || 'Candidato') : 'Tú'}
                                                    </div>
                                                    <div className="line-clamp-3 text-[#111b21]/80 dark:text-[#e9edef]/80 break-words leading-tight">
                                                        {msg.contextInfo.quotedMessage.text || '📄 Mensaje multimedia'}
                                                    </div>
                                                </div>
                                            )}

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
                                                            <Paperclip className="w-4 h-4 shrink-0" /> {msg.filename || 'DOCUMENTO ADJUNTO'}
                                                        </a>
                                                    )}
                                                </div>
                                            )}

                                            {/* Text Rendering */}
                                            {msg.content && (
                                                <div className="whitespace-pre-wrap leading-[1.35] inline-block break-words" style={{ paddingBottom: '16px', paddingRight: '80px', paddingTop: msg.mediaUrl ? '2px' : '0' }} dangerouslySetInnerHTML={{ __html: msg._formattedHtml || formatWhatsAppText(msg.content) }}></div>
                                            )}
                                            {!msg.content && <div style={{ paddingBottom: '16px', paddingRight: '80px' }}></div>}
                                            
                                            {/* Reaction Badges */}
                                            {msg.reactions && msg.reactions.length > 0 && (
                                                <div className="absolute -bottom-2.5 right-0 bg-white dark:bg-[#202c33] shadow-md rounded-full px-1.5 py-0.5 text-[11px] z-20 flex gap-0.5 border border-gray-100 dark:border-gray-800">
                                                    {msg.reactions.map((r, rIdx) => <span key={rIdx}>{r.emoji || r}</span>)}
                                                </div>
                                            )}
                                        </div>

                                        {/* Quick Actions (Hover) */}
                                        <div className={`absolute top-1 ${isMe ? '-left-[72px]' : '-right-[72px]'} opacity-0 group-hover:opacity-100 flex gap-1 z-30 transition-opacity`}>
                                            <button onClick={() => setReactionPopupId(msg.id)} title="Reaccionar" className="p-1.5 bg-white dark:bg-[#202c33] hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm border border-black/5 dark:border-white/5 rounded-[10px]"><Smile className="w-[18px] h-[18px] text-[#54656f] dark:text-[#8696a0]" /></button>
                                            <button onClick={() => setReplyingToMsg(msg)} title="Responder" className="p-1.5 bg-white dark:bg-[#202c33] hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm border border-black/5 dark:border-white/5 rounded-[10px]"><Reply className="w-[18px] h-[18px] text-[#54656f] dark:text-[#8696a0]" /></button>
                                        </div>

                                        {/* Reaction Emoji Picker Popup */}
                                        {reactionPopupId === msg.id && (
                                            <div className={`absolute -top-[44px] ${isMe ? 'right-0' : 'left-0'} bg-white dark:bg-[#202c33] shadow-lg rounded-full px-3 py-2 flex items-center gap-3 z-50 border border-gray-200 dark:border-gray-800 slide-in-from-bottom-2`}>
                                                {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                                                    <button key={emoji} onClick={() => sendReactionToApi(selectedChat.id, msg, emoji, showToast, setReactionPopupId, loadMessages)} className="text-xl hover:scale-150 transition-transform origin-bottom">{emoji}</button>
                                                ))}
                                                <button onClick={() => setReactionPopupId(null)} className="ml-1 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"><X className="w-3.5 h-3.5 text-gray-400" /></button>
                                            </div>
                                        )}

                                        <div className={`flex items-center space-x-1 select-none pr-1 absolute bottom-[3px] right-2`}>
                                            <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-medium leading-none">
                                                {safeFormatTime(msg.timestamp)}
                                            </p>
                                            {isMe && (
                                                <MessageStatusTicks status={msg.status} />
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Mostrar Error Nativamente si falló */}
                                    {msg.status === 'failed' && msg.error && (
                                        <div className={`text-[10px] text-red-500 font-medium mt-1 ${isMe ? 'text-right' : 'text-left'}`}>
                                            {String(msg.error).toLowerCase().includes('131047') || String(msg.error).toLowerCase().includes('24 hours') 
                                                ? 'Bloqueado por Meta (Ventana 24 hrs). Usa el Rayito Verde ⚡' 
                                                : `Falló: ${msg.error}`}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        
                        {/* Typing Indicators (Removed as requested) */}

                    <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <MessageInputBox 
                        ref={messageInputRef}
                        onSend={handleSend}
                        onTyping={handleTyping}
                        fileInputRef={fileInputRef}
                        handleFileUpload={handleFileUpload}
                        replyingToMsg={replyingToMsg}
                        onCancelReply={() => setReplyingToMsg(null)}
                        metaTemplates={metaTemplates}
                        onSendTemplate={handleSendTemplate}
                    />
                </div>
            ) : (
                <div className="hidden md:flex flex-1 flex-col items-center justify-center bg-[#f0f2f5] dark:bg-[#222e35] border-l border-[#d1d7db] dark:border-[#222e35]">
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
                    candidates={candidates}
                    onCandidateUpdated={(updatedCandidate) => {
                        setCandidates(prev => prev.map(c => c.id === updatedCandidate.id ? updatedCandidate : c));
                        if(selectedChat?.id === updatedCandidate.id) setSelectedChat(updatedCandidate);
                    }}
                />
            )}

            {/* QUICK REPLIES PANEL */}
            {showQuickRepliesPanel && (
                <div className="w-[340px] border-l border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] flex flex-col h-full">
                    {/* Header */}
                    <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#d1d7db] dark:border-[#222e35] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <BookOpen className="w-5 h-5 text-green-600 dark:text-green-400" />
                            <h3 className="font-bold text-sm text-[#111b21] dark:text-[#e9edef]">Banco de Respuestas</h3>
                        </div>
                        <button onClick={() => setShowQuickRepliesPanel(false)} className="text-[#54656f] hover:text-[#111b21] dark:text-[#aebac1] dark:hover:text-white">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    {/* Panel cont... */}

                    {/* Create / Edit Form */}
                    <div className="p-3 border-b border-[#f0f2f5] dark:border-[#222e35] space-y-2">
                        <input
                            type="text"
                            placeholder="Nombre (ej: Saludo)"
                            value={qrForm.name}
                            onChange={(e) => setQrForm({ ...qrForm, name: e.target.value })}
                            className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors"
                        />
                        <textarea
                            placeholder="Mensaje..."
                            value={qrForm.message}
                            onChange={(e) => setQrForm({ ...qrForm, message: e.target.value })}
                            rows={9}
                            className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors resize-y"
                        />
                        <div className="flex items-center gap-2">
                            <div className="flex-1 relative">
                                <Keyboard className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder={capturingShortcut ? 'Presiona las teclas...' : 'Atajo (clic para capturar)'}
                                    value={qrForm.shortcut}
                                    readOnly
                                    onClick={() => setCapturingShortcut(true)}
                                    onKeyDown={(e) => {
                                        if (!capturingShortcut) return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const parts = [];
                                        if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
                                        if (e.shiftKey) parts.push('Shift');
                                        if (e.altKey) parts.push('Alt');
                                        const key = e.key;
                                        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
                                            parts.push(key.length === 1 ? key.toUpperCase() : key);
                                            setQrForm({ ...qrForm, shortcut: parts.join(' + ') });
                                            setCapturingShortcut(false);
                                        }
                                    }}
                                    onBlur={() => setCapturingShortcut(false)}
                                    className={`w-full text-xs pl-8 pr-3 py-2 rounded-lg border bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none transition-colors cursor-pointer ${
                                        capturingShortcut 
                                        ? 'border-green-500 ring-2 ring-green-500/20' 
                                        : 'border-gray-200 dark:border-gray-700 focus:border-green-500'
                                    }`}
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                            {editingQuickReply !== null && (
                                <button
                                    type="button"
                                    onClick={() => { setEditingQuickReply(null); setQrForm({ name: '', message: '', shortcut: '' }); }}
                                    className="flex-1 text-xs py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#202c33] transition-colors font-medium"
                                >
                                    Cancelar
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={!qrForm.name.trim() || !qrForm.message.trim()}
                                onClick={async () => {
                                    const entry = { id: editingQuickReply?.id || `qr_${Date.now()}`, name: qrForm.name.trim(), message: qrForm.message.trim(), shortcut: qrForm.shortcut.trim() };
                                    let newList;
                                    if (editingQuickReply) {
                                        newList = quickReplies.map(q => q.id === editingQuickReply.id ? entry : q);
                                    } else {
                                        newList = [...quickReplies, entry];
                                    }
                                    await saveQuickReplies(newList);
                                    setQrForm({ name: '', message: '', shortcut: '' });
                                    setEditingQuickReply(null);
                                    showToast && showToast(editingQuickReply ? 'Respuesta actualizada' : 'Respuesta creada', 'success');
                                }}
                                className="flex-1 text-xs py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {editingQuickReply ? 'Actualizar' : 'Guardar'}
                            </button>
                        </div>
                    </div>

                    {/* List */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {quickReplies.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-600 p-6">
                                <BookOpen className="w-10 h-10 mb-3 opacity-30" />
                                <p className="text-xs text-center">Sin respuestas rápidas. Crea una arriba para empezar.</p>
                            </div>
                        ) : (
                            quickReplies.map(qr => (
                                <div
                                    key={qr.id}
                                    className="px-4 py-3 border-b border-[#f0f2f5] dark:border-[#222e35] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] transition-colors group cursor-pointer"
                                    onClick={() => { messageInputRef.current?.injectText(qr.message); setShowQuickRepliesPanel(false); }}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-bold text-[#111b21] dark:text-[#e9edef] truncate">{qr.name}</span>
                                                {qr.shortcut && (
                                                    <span className="shrink-0 text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                                                        {qr.shortcut}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-[#667781] dark:text-[#8696a0] line-clamp-2 leading-relaxed">{qr.message}</p>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setEditingQuickReply(qr); setQrForm({ name: qr.name, message: qr.message, shortcut: qr.shortcut || '' }); }}
                                                className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                                title="Editar"
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setConfirmModal({
                                                        title: 'Eliminar respuesta rápida',
                                                        message: `¿Eliminar "${qr.name}"?`,
                                                        confirmText: 'Eliminar',
                                                        variant: 'danger',
                                                        onConfirm: () => {
                                                            saveQuickReplies(quickReplies.filter(q => q.id !== qr.id));
                                                            showToast && showToast('Respuesta eliminada', 'success');
                                                            setConfirmModal(null);
                                                        },
                                                        onCancel: () => setConfirmModal(null)
                                                    });
                                                }}
                                                className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-full hover:bg-red-50 dark:hover:bg-red-900/20"
                                                title="Eliminar"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* VACANCY EDIT MODAL */}
            {editingVac && (
                <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#202c33] w-full max-w-lg rounded-xl shadow-xl overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-[#111b21] flex justify-between items-center">
                            <h3 className="font-bold text-[#111b21] dark:text-[#e9edef] truncate pr-4">Editar Info de {editingVac.name}</h3>
                            <button onClick={() => setEditingVac(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 flex-1 overflow-y-auto">
                            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                                Texto a inyectar (Info para el bot)
                            </label>
                            <textarea
                                value={editingVac.messageDescription || ''}
                                onChange={(e) => setEditingVac({...editingVac, messageDescription: e.target.value})}
                                rows={10}
                                className="w-full text-sm p-3 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-[#202c33] outline-none transition-all text-[#111b21] dark:text-[#d1d7db] resize-none"
                                placeholder="Escribe aquí la información de la vacante para inyectar/enviar..."
                            />
                        </div>
                        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-[#111b21]">
                            <button 
                                onClick={() => setEditingVac(null)}
                                className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={async () => {
                                    try {
                                        const res = await fetch('/api/vacancies', {
                                            method: 'PUT',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ id: editingVac.id, messageDescription: editingVac.messageDescription })
                                        });
                                        const { success, data } = await res.json();
                                        if (success) {
                                            setVacancies(prev => prev.map(v => v.id === data.id ? data : v));
                                            setEditingVac(null);
                                        }
                                    } catch(e) {
                                        console.error(e);
                                    }
                                }}
                                className="px-5 py-2 font-medium bg-[#00a884] text-white rounded-lg hover:bg-[#008f6f] shadow-sm transition-colors"
                            >
                                Guardar Cambios
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PROFILE EDIT MODAL */}
            {profileModalCandidate && (
                <ProfileModal 
                    candidate={profileModalCandidate}
                    onClose={() => setProfileModalCandidate(null)}
                    onSave={async (updates) => {
                        // Optimistic UI update
                        const updatedChat = { ...profileModalCandidate, ...updates };
                        if (selectedChat?.id === updatedChat.id) setSelectedChat(updatedChat);
                        setCandidates(prev => prev.map(c => c.id === updatedChat.id ? updatedChat : c));
                        setProfileModalCandidate(null);
                        
                        try {
                            const res = await fetch('/api/candidates', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: updatedChat.id, ...updates })
                            });
                            if (!res.ok) throw new Error('Failed to update candidate');
                            showToast && showToast('Perfil actualizado correctamente', 'success');
                        } catch (error) {
                            console.error('Error updating profile:', error);
                            showToast && showToast('Error al actualizar el perfil', 'error');
                        }
                    }}
                />
            )}

            {/* 🎨 Unified Confirm Modal */}
            <ConfirmModal config={confirmModal} onClose={() => setConfirmModal(null)} />
        </div>
    );
}
