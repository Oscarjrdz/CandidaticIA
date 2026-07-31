import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useDeferredValue } from 'react';
import ConfirmModal from './ui/ConfirmModal';
import { MapPin, List as ListIcon, ShoppingBag, UserSquare, MousePointerClick, Search, MessageSquare, Plus, Smile, Paperclip, Mic, Square, ArrowLeft, Send, Tag, Pencil, Check, X, Trash2, Briefcase, Kanban, BookOpen, Keyboard, Loader2, Edit2, Reply, Zap, Pin, MessageCirclePlus, Phone, User, Bell, GripVertical, ChevronDown, ChevronUp, Snowflake } from 'lucide-react';
import { getCandidates, getCandidateById, blockCandidate, deleteCandidate } from '../services/candidatesService';
import { substituteVariables } from '../../api/utils/shortcuts.js';
import ManualProjectsSidepanel from './ManualProjectsSidepanel';
import { formatRelativeDate } from '../utils/formatters';
import { useCandidatesSSE, useSSECandidateUpdate } from '../hooks/useCandidatesSSE';
import { Virtuoso } from 'react-virtuoso';
import { isProfileComplete } from '../utils/profileUtils';
import { compressImage } from '../utils/imageCompress';
import { useToastContext } from '../contexts/ToastContext';
import { useAuthContext } from '../contexts/AuthContext';
import { toTitleCase, formatWhatsAppText, TAG_COLORS, checkIfUnread } from './chat/chatUtils';
import { passesChatRBACFilter, canSeeIncompleteChats } from '../utils/chatUnreadCount';
import { renderMetaTemplatePreviewText } from '../utils/metaTemplatePreview';
import CandidateReminderModal from './CandidateReminderModal';
import MessageStatusTicks from './chat/MessageStatusTicks';
import MessageInputBox from './chat/MessageInputBox';
import AudioPlayer from './chat/AudioPlayer';
import DateSeparator from './chat/DateSeparator';
import ChatRow from './chat/ChatRow';
import MessageBubble, { ENTRY_REVEALED_EVENT } from './chat/MessageBubble';


// ─────────────────────────────────────────────────────────────────────────────

const TRANSIENT_CANDIDATE_UPDATE_KEYS = new Set([
    'candidateTyping',
    'markAllSentAsRead',
    'messageFrom',
    'messagePayload',
    'messageStatusUpdate',
    'newMessage',
    'reactionUpdate',
    'recruiterTyping',
    'statusUpdate',
]);

const extractPersistentCandidatePatch = (patch = {}) => {
    return Object.fromEntries(
        Object.entries(patch).filter(([key]) => !TRANSIENT_CANDIDATE_UPDATE_KEYS.has(key))
    );
};

// Estado EFECTIVO del silencio de IA, calculado en el cliente con la misma regla que
// normalizeCandidateSilence del backend: un candidato con silencio manual expirado
// (blockedExpiresAt ya paso) cuenta como NO silenciado, aunque el objeto en memoria
// todavia traiga blocked:true (pasa si el chat lleva rato abierto sin re-leerse). Asi el
// toggle refleja la verdad sin esperar un recargue. Sin blockedExpiresAt (Incontactable
// / silencios legado) se respeta blocked tal cual: esos no se auto-liberan.
const isIaSilenced = (candidate) => {
    if (!candidate || candidate.blocked !== true) return false;
    if (!candidate.blockedExpiresAt) return true;
    const expiresMs = new Date(candidate.blockedExpiresAt).getTime();
    return !Number.isFinite(expiresMs) || expiresMs > Date.now();
};

const scheduleIdleTask = (callback, timeout = 1200) => {
    if (typeof window === 'undefined') return () => {};
    if ('requestIdleCallback' in window) {
        const id = window.requestIdleCallback(callback, { timeout });
        return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(callback, Math.min(timeout, 500));
    return () => window.clearTimeout(timer);
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const ORDERED_MESSAGE_GAP_MS = 450;
const CHAT_LOCK_IDLE_MS = 5 * 60_000; // 5 min — evita falsos positivos al leer/pensar sin tocar el mouse
const CHAT_LOCK_HEARTBEAT_MS = 30_000;

const CHAT_LIST_PAGE_SIZE = 10;
const CHAT_LIST_LOCAL_FILTER_PAGE_SIZE = 500;
const CHAT_EXIT_ANIM_MS = 260; // debe coincidir con la duración de .chat-card-exit en index.css
const UNTAGGED_TAG_FILTER = '__candidatic_untagged__';
const UNTAGGED_TAG_LABEL = 'Sin Etiqueta';
const UNTAGGED_TAG_COLOR = '#ef4444';
const EMPTY_UNREAD_COUNTS = {
    tags: {},
    crmProjects: {},
    completeTags: {},
    incompleteTags: {},
    complete: 0,
    incomplete: 0,
    all: 0,
    untagged: 0,
    completeUntagged: 0,
    incompleteUntagged: 0,
    unreadIds: new Set()
};

const getSelectedTagValues = (value) => (
    Array.isArray(value)
        ? value.filter(Boolean)
        : value
            ? [value]
            : []
);

const formatTagLabel = (value) => {
    if (value === UNTAGGED_TAG_FILTER) return UNTAGGED_TAG_LABEL;
    return toTitleCase(value);
};

const readStoredUnreadCounts = (unreadCountHint = null) => {
    const hintedAll = Number(unreadCountHint);
    try {
        const saved = sessionStorage.getItem('candidatic_unread_counts');
        if (!saved) {
            return Number.isFinite(hintedAll)
                ? { ...EMPTY_UNREAD_COUNTS, all: Math.max(0, hintedAll), unreadIds: new Set() }
                : null;
        }
        const parsed = JSON.parse(saved);
        return {
            ...EMPTY_UNREAD_COUNTS,
            ...parsed,
            all: Number.isFinite(hintedAll)
                ? Math.max(Number(parsed.all) || 0, Math.max(0, hintedAll))
                : (Number(parsed.all) || 0),
            tags: parsed.tags || {},
            crmProjects: parsed.crmProjects || {},
            completeTags: parsed.completeTags || {},
            incompleteTags: parsed.incompleteTags || {},
            unreadIds: new Set(),
        };
    } catch {
        return Number.isFinite(hintedAll)
            ? { ...EMPTY_UNREAD_COUNTS, all: Math.max(0, hintedAll), unreadIds: new Set() }
            : null;
    }
};

const normalizeOutgoingContent = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const getMessageKind = (message = {}) => message.type || message.tipo || (message.mediaUrl ? 'image' : 'text');

// Encabezado de una plantilla oficial: "⚡ Plantilla oficial: *NOMBRE*" (primera línea).
// El cliente y el servidor construyen ese encabezado idéntico (mismo displayName), pero el
// CUERPO lo generan dos implementaciones distintas de renderMetaTemplatePreviewText, así que
// puede diferir. Se usa para deduplicar el optimista contra su eco por SSE sin depender del
// cuerpo exacto ni del `kind` (que puede venir como 'template' o 'text' según la vía).
const TEMPLATE_CONTENT_PREFIX = '⚡ Plantilla oficial:';
const templateHeaderOf = (content = '') => {
    const s = String(content || '').trim();
    if (!s.startsWith(TEMPLATE_CONTENT_PREFIX)) return null;
    return s.split('\n')[0].trim();
};

const isOutgoingAuthor = (message = {}) => message.from === 'me' || message.from === 'bot';

const isIncomingAuthor = (message = {}) => !!message && !isOutgoingAuthor(message);

const withMessageEntryAnimation = (message = {}, direction = null) => ({
    ...message,
    _animateIn: direction || (isOutgoingAuthor(message) ? 'outgoing' : 'incoming')
});

// Espera la señal REAL (ENTRY_REVEALED_EVENT desde MessageBubble.jsx) de que la burbuja
// `key` terminó su fase 1 de entrada — usado para encolar un grupo (texto + fotos del
// banco de respuestas) en secuencia de verdad, no con un temporizador adivinado. El
// fallback de tiempo es solo una red de seguridad (reduced-motion, o cualquier caso raro
// donde el evento no dispare) para que el grupo nunca se quede atorado esperando — debe
// quedar por ENCIMA de la fase 1 más lenta que existe (700ms para burbujas con media, ver
// MessageBubble.jsx/index.css), si no se adelanta siempre a la señal real.
const BUBBLE_REVEAL_FALLBACK_MS = 800;
const waitForBubbleReveal = (key, fallbackMs = BUBBLE_REVEAL_FALLBACK_MS) => new Promise(resolve => {
    if (!key) { resolve(); return; }
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener(ENTRY_REVEALED_EVENT, onEvent);
        window.clearTimeout(fallbackTimer);
        resolve();
    };
    const onEvent = (e) => { if (e.detail?.key === key) finish(); };
    window.addEventListener(ENTRY_REVEALED_EVENT, onEvent);
    const fallbackTimer = window.setTimeout(finish, fallbackMs);
});

const getMessageMediaCandidates = (message = {}) => [
    message.mediaUrl,
    message._serverMediaUrl,
    message._localMediaUrl,
    message._displayMediaUrl
].filter(Boolean);

const getMessageTime = (message = {}) => {
    const value = new Date(message.timestamp || message.fecha || 0).getTime();
    return Number.isFinite(value) ? value : 0;
};

const withClientMessageKey = (message = {}, fallback = null) => ({
    ...message,
    _clientKey: message._clientKey || fallback || message.id || message.ultraMsgId || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
});

const getMessageOrderKey = (message = {}, fallbackIndex = 0) => {
    const ts = getMessageTime(message);
    return ts > 0 ? ts : fallbackIndex;
};

const sortMessagesChronologically = (list = []) => {
    return [...(list || [])]
        .map((message, index) => ({ message, index }))
        .sort((a, b) => {
            const timeDiff = getMessageOrderKey(a.message, a.index) - getMessageOrderKey(b.message, b.index);
            if (timeDiff !== 0) return timeDiff;
            return a.index - b.index;
        })
        .map(item => item.message);
};

const areSameOutgoingMessage = (a = {}, b = {}) => {
    if (!isOutgoingAuthor(a) || !isOutgoingAuthor(b)) return false;
    if (a.id && b.id && String(a.id) === String(b.id)) return true;
    const aIsTemp = String(a.id || '').startsWith('temp');
    const bIsTemp = String(b.id || '').startsWith('temp');
    if (aIsTemp && bIsTemp) return false; // two distinct pending sends
    if (!aIsTemp && !bIsTemp && a.id && b.id) return false; // two different confirmed server IDs
    if (a.ultraMsgId && b.ultraMsgId && String(a.ultraMsgId) === String(b.ultraMsgId)) return true;

    // Plantillas oficiales: deduplica por el encabezado (nombre), no por el cuerpo ni el
    // kind. El preview optimista del cliente y el texto guardado por el servidor pueden
    // diferir en el cuerpo (dos renders distintos) y en el tipo, lo que hacía que el eco
    // por SSE NO se reconociera como el mismo mensaje → burbuja duplicada que parpadeaba.
    const tplA = templateHeaderOf(a.content);
    const tplB = templateHeaderOf(b.content);
    if (tplA || tplB) {
        if (tplA !== tplB) return false; // plantillas distintas, o plantilla vs no-plantilla
        const tA = getMessageTime(a);
        const tB = getMessageTime(b);
        return !tA || !tB || Math.abs(tA - tB) < 180000;
    }

    const kindA = getMessageKind(a);
    const kindB = getMessageKind(b);
    if (kindA !== kindB) return false;

    const mediaSourcesA = getMessageMediaCandidates(a);
    const mediaSourcesB = getMessageMediaCandidates(b);
    if (mediaSourcesA.length || mediaSourcesB.length) {
        if (!mediaSourcesA.some(src => mediaSourcesB.includes(src))) return false;
    } else if (normalizeOutgoingContent(a.content) !== normalizeOutgoingContent(b.content)) {
        return false;
    }

    const timeA = getMessageTime(a);
    const timeB = getMessageTime(b);
    if (timeA > 0 && timeB > 0) {
        // Ventana amplia a propósito: el optimista usa el reloj de la PC del reclutador
        // y el eco del server usa el del servidor — con un reloj desfasado (~1-2 min,
        // común en PCs sin sincronizar), una ventana corta hacía que el eco no matcheara
        // y se inyectara como burbuja duplicada que luego brincaba de lugar.
        return Math.abs(timeA - timeB) < 180000;
    }
    return true;
};

const areVisuallyDuplicateOutgoingMessages = (a = {}, b = {}) => {
    if (!areSameOutgoingMessage(a, b)) return false;
    const aIsTransient = String(a.id || '').startsWith('temp') || ['pending', 'queued'].includes(a.status);
    const bIsTransient = String(b.id || '').startsWith('temp') || ['pending', 'queued'].includes(b.status);
    if (!aIsTransient && !bIsTransient) return false;
    const timeA = getMessageTime(a);
    const timeB = getMessageTime(b);
    return !timeA || !timeB || Math.abs(timeA - timeB) < 180000;
};

const mergeOutgoingPayload = (current = {}, incoming = {}) => {
    const merged = { ...current, ...incoming };
    // Dos señales del servidor confirman el MISMO mensaje por rutas separadas: el eco/
    // respuesta (trae el mensaje completo, pasa por aquí) y el `messageStatusUpdate`
    // (solo cambia `status` in-place, SIN pasar por este merge). Cuando ese segundo
    // aviso llega PRIMERO y deja el status en 'sent', un chequeo basado en status
    // ("¿sigue pendiente/queued?") cree erróneamente que ya no hay nada que proteger,
    // y deja que la hora real del servidor se cuele aquí — moviendo la burbuja de lugar.
    // Por eso la protección usa una bandera propia (`_clientAnchoredTime`) que se
    // propaga en cada merge, en vez de inferirse del status (que otra vía ya mutó).
    const wasTransient = String(current.id || '').startsWith('temp') || ['pending', 'queued'].includes(current.status);
    const protectTime = current._clientAnchoredTime || wasTransient;
    const currentMediaUrl = current.mediaUrl || '';
    const incomingMediaUrl = incoming.mediaUrl || '';

    if (protectTime) {
        if (current.timestamp || current.fecha) {
            merged.timestamp = current.timestamp;
            merged.fecha = current.fecha;
        }
        if (current._clientAnchoredTime) merged._clientAnchoredTime = true;
        if (incoming.timestamp || incoming.fecha) merged._confirmedAt = incoming.timestamp || incoming.fecha;
    }

    if (currentMediaUrl && incomingMediaUrl && currentMediaUrl !== incomingMediaUrl) {
        // ¿La imagen que YA se ve es un preview LOCAL temporal (blob/data al subir del teléfono)?
        // Solo en ese caso vale la pena el crossfade a la URL del servidor (reemplaza el blob por
        // la imagen hospedada — misma foto, swap suave). Para el BANCO la URL optimista ya es una
        // URL hospedada buena; el servidor solo devuelve OTRA dirección de la MISMA imagen, así que
        // un crossfade se veía como "la foto se manda 2 veces, una más tenue". Ahí conservamos la
        // que ya se ve (sin cambiar src → SmoothMediaImage no hace crossfade), y guardamos la del
        // servidor por referencia.
        const currentIsLocalPreview =
            currentMediaUrl.startsWith('blob:') ||
            currentMediaUrl.startsWith('data:') ||
            (current._localMediaUrl && current._localMediaUrl === currentMediaUrl);
        if (currentIsLocalPreview) {
            merged._serverMediaUrl = incomingMediaUrl;
            merged._displayMediaUrl = current._displayMediaUrl || current._localMediaUrl || currentMediaUrl;
        } else {
            merged.mediaUrl = currentMediaUrl;      // conservar la imagen ya visible (sin crossfade)
            merged._serverMediaUrl = incomingMediaUrl;
        }
    }

    // El contextInfo del servidor puede llegar sin el texto citado (backend aparte
    // ya lo guarda, pero por si acaso) — nunca reemplazar un texto citado que sí
    // tenemos por uno vacío, o la vista "respondiendo a..." se queda en blanco.
    const currentQuotedText = current.contextInfo?.quotedMessage?.text;
    const incomingQuotedText = incoming.contextInfo?.quotedMessage?.text;
    if (currentQuotedText && !incomingQuotedText) {
        merged.contextInfo = current.contextInfo;
    }

    return merged;
};

const mergeOutgoingMessage = (messages = [], incoming, replaceId = null) => {
    if (!incoming) return messages;
    let inserted = false;
    const merged = [];

    for (const current of messages || []) {
        const shouldReplace = replaceId && String(current?.id) === String(replaceId);
        const isDuplicate = areSameOutgoingMessage(current, incoming);

        if (shouldReplace || isDuplicate) {
            if (!inserted) {
                merged.push(withClientMessageKey(mergeOutgoingPayload(current, incoming), current._clientKey || current.id || incoming.id));
                inserted = true;
            }
            continue;
        }

        merged.push(current);
    }

    if (!inserted) merged.push(withClientMessageKey(incoming));
    return sortMessagesChronologically(merged);
};

const mergeMessageList = (currentMessages = [], freshMessages = []) => {
    if (!Array.isArray(freshMessages)) return currentMessages || [];
    const byIdentity = new Map();
    const merged = [];

    for (const current of currentMessages || []) {
        if (!current) continue;
        const keyed = withClientMessageKey(current);
        merged.push(keyed);
        if (keyed.id) byIdentity.set(`id:${keyed.id}`, keyed);
        if (keyed.ultraMsgId) byIdentity.set(`wa:${keyed.ultraMsgId}`, keyed);
    }

    for (const fresh of freshMessages) {
        if (!fresh) continue;
        const match = (fresh.id && byIdentity.get(`id:${fresh.id}`)) ||
            (fresh.ultraMsgId && byIdentity.get(`wa:${fresh.ultraMsgId}`)) ||
            (isOutgoingAuthor(fresh) && merged.find(existing => areSameOutgoingMessage(existing, fresh)));

        if (match) {
            const idx = merged.findIndex(m => m === match || m._clientKey === match._clientKey);
            if (idx !== -1) {
                merged[idx] = withClientMessageKey(mergeOutgoingPayload(match, fresh), match._clientKey || match.id || fresh.id);
            }
        } else {
            merged.push(withClientMessageKey(fresh));
        }
    }

    return sortMessagesChronologically(merged);
};

const getStableMessageKey = (msg, index) => {
    if (!msg) return `empty-${index}`;
    if (msg._clientKey) return String(msg._clientKey);
    if (msg.id) return String(msg.id);
    if (msg.ultraMsgId) return String(msg.ultraMsgId);
    if (msg.type === 'date-separator') return String(msg.id || `date-${msg.date}`);
    if (msg.type === 'unread-separator') return String(msg.id || '__unread_sep');
    return `${msg.timestamp || msg.fecha || 'msg'}-${normalizeOutgoingContent(msg.content).slice(0, 32)}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// 🧩 CustomSelect Component
// ─────────────────────────────────────────────────────────────────────────────
const ChevronIcon = () => (
    <div className="flex items-center text-gray-500 dark:text-gray-400 shrink-0 pointer-events-none">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
    </div>
);

const CustomSelect = React.memo(({ name, value, options, onChange, placeholder, disabled = false }) => {
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
});

const MultiSelectDropdown = React.memo(({ label, options, selected, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const normalizedOptions = useMemo(() => (options || []).map(opt => {
        if (opt && typeof opt === 'object') {
            const value = String(opt.value ?? opt.label ?? '').trim();
            const labelText = String(opt.label ?? value).trim();
            const count = Number.isFinite(opt.count) ? opt.count : null;
            return {
                value,
                label: count !== null ? `${labelText} (${count})` : labelText,
                count
            };
        }
        const value = String(opt || '').trim();
        return { value, label: value, count: null };
    }).filter(opt => opt.value), [options]);
    const optionLabelByValue = useMemo(() => {
        const map = new Map();
        normalizedOptions.forEach(opt => map.set(opt.value, opt.label));
        return map;
    }, [normalizedOptions]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleOption = (opt, e) => {
        e.stopPropagation();
        if (selected.includes(opt)) {
            onChange(selected.filter(item => item !== opt));
        } else {
            onChange([...selected, opt]);
        }
    };

    const clearAll = (e) => {
        e.stopPropagation();
        onChange([]);
    };

    return (
        <div className="relative w-full" ref={dropdownRef}>
            <div 
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full bg-[#f0f2f5] dark:bg-[#202c33] border ${selected.length > 0 ? 'border-blue-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg pl-3 pr-14 py-2 text-xs outline-none font-medium text-left cursor-pointer transition-all flex items-center shadow-sm relative min-h-[34px]`}
            >
                <span className={`flex-1 truncate ${selected.length > 0 ? 'text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef]'}`}>
                    {selected.length > 0 ? `${label}: ${selected.map(value => optionLabelByValue.get(value) || value).join(', ')}` : label}
                </span>
                <div className={`absolute right-2 top-1/2 -translate-y-1/2 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    <ChevronIcon />
                </div>
            </div>
            {selected.length > 0 && (
                <button
                    onClick={clearAll}
                    className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shrink-0 z-10"
                    title="Limpiar filtro"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            )}
            {isOpen && (
                <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-[100] py-1 max-h-56 overflow-y-auto custom-scrollbar">
                    {normalizedOptions.length === 0 ? (
                        <div className="px-4 py-2 text-xs text-gray-500 italic">No hay opciones</div>
                    ) : (
                        normalizedOptions.map(opt => {
                            const isSelected = selected.includes(opt.value);
                            return (
                                <div 
                                    key={opt.value}
                                    onClick={(e) => toggleOption(opt.value, e)}
                                    className={`px-3 py-2 text-xs cursor-pointer flex items-center gap-2 hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] ${isSelected ? 'text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef]'}`}
                                >
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300 dark:border-gray-600'}`}>
                                        {isSelected && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <span className="truncate">{opt.label}</span>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 📝 Profile Edit Modal
// ─────────────────────────────────────────────────────────────────────────────
const ProfileModal = React.memo(({ candidate, onClose, onSave }) => {
    const [formData, setFormData] = useState({
        nombreReal: candidate.nombreReal || candidate.nombre || '',
        edad: candidate.edad || candidate.fechaNacimiento || '',
        genero: candidate.genero || '',
        municipio: candidate.municipio || '',
        escolaridad: candidate.escolaridad || '',
        categoria: candidate.categoria || '',
        colonia: candidate.colonia || '',
        experiencia: candidate.experiencia || '',
        meses: candidate.meses || ''
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
            .catch(_err => setBotCategories(["Operativo", "Administrativo", "Otro"]));
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
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">Paso 2</p>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase">Colonia</label>
                                <input type="text" name="colonia" value={formData.colonia} onChange={handleChange} className="w-full text-sm p-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg outline-none text-[#111b21] dark:text-[#d1d7db] border border-transparent focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all" placeholder="Ej. Centro" />
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase">Experiencia</label>
                                    <CustomSelect name="experiencia" value={formData.experiencia} options={["Sí", "No"]} onChange={handleChange} placeholder="Seleccione..." />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase">Meses</label>
                                    <input type="number" name="meses" value={formData.meses} onChange={handleChange} className="w-full text-sm p-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg outline-none text-[#111b21] dark:text-[#d1d7db] border border-transparent focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all" placeholder="Ej. 12" min="0" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-[#111b21] rounded-b-xl">
                    <button onClick={onClose} className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors">Cancelar</button>
                    <button onClick={() => onSave(formData)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors">Guardar</button>
                </div>
            </div>
        </div>
    );
});

// Defined outside ChatSection so Virtuoso doesn't remount it on every render
const MessagesEncryptionHeader = () => (
    <div className="px-[5%] pt-[5%] pb-1">
        <div className="text-center py-2 bg-[#ffeed0] dark:bg-[#cca868]/10 text-[#111b21] dark:text-[#f7cd73]/70 rounded-lg mx-auto w-fit px-4 shadow-sm select-none mb-4 border border-black/5 dark:border-white/5">
            <p className="text-[12px] leading-tight">Los mensajes están protegidos de extremo a extremo por Candidatic y la IA.</p>
        </div>
    </div>
);

// El Footer TAMBIÉN debe vivir fuera del componente: un `Footer: () => <div/>` inline
// es un tipo de componente NUEVO en cada render de ChatSection → React lo desmonta y
// remonta → la altura total de la lista baja/sube 25px → Virtuoso corrige el scroll.
// Con muchos chats en la lista (muchos re-renders por SSE durante un envío con fotos)
// eso se veía como un temblor "arriba y abajo" de las burbujas recién inyectadas.
const MessagesListFooter = () => <div style={{ height: 25 }} />;
const MESSAGES_VIRTUOSO_COMPONENTS = { Header: MessagesEncryptionHeader, Footer: MessagesListFooter };

// Mismo caso para la lista de chats: el estado (loadingMore) llega vía el prop
// `context` de Virtuoso para que el tipo del componente sea estable entre renders.
const ChatListFooter = ({ context }) => context?.loadingMore
    ? <div className="py-4 text-center text-xs text-gray-400 dark:text-gray-600">Cargando más...</div>
    : null;
const CHAT_LIST_VIRTUOSO_COMPONENTS = { Footer: ChatListFooter };

export default function ChatSection({ rolePermissions, onlineUsers = [], unreadCountHint = null, onUnreadCountChange, _agentMode = false }) {
    const { showToast } = useToastContext();
    const { user, setUser } = useAuthContext();

    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 1024);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const canManageTags = user?.role === 'SuperAdmin' || user?.can_manage_tags === true;
    const { newCandidate: sseNewCandidate, updatedCandidate: sseUpdatedCandidate, deletedCandidate: sseDeletedCandidate, connected: sseConnected, globalStats } = useCandidatesSSE();

    const [stableStats, setStableStats] = useState(() => {
        try {
            const saved = sessionStorage.getItem('candidatic_global_stats');
            return saved ? JSON.parse(saved) : { total: null, complete: null, pending: null };
        } catch { return { total: null, complete: null, pending: null }; }
    });

    useEffect(() => {
        if (!globalStats) return;
        const next = {
            total: globalStats.total ?? stableStats.total,
            complete: globalStats.complete ?? stableStats.complete,
            pending: globalStats.pending ?? stableStats.pending,
        };
        setStableStats(next);
        try { sessionStorage.setItem('candidatic_global_stats', JSON.stringify(next)); } catch {}
    }, [globalStats]);

    const [candidates, setCandidates] = useState([]);
    const [globalUnreadCounts, setGlobalUnreadCounts] = useState(() => readStoredUnreadCounts(unreadCountHint));
    const [globalFilterCounts, setGlobalFilterCounts] = useState(() => {
        try {
            const saved = sessionStorage.getItem('candidatic_filter_counts');
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    });
    const [selectedChat, setSelectedChat] = useState(null);
    const [headerImgError, setHeaderImgError] = useState(false);
    const [showVCardModal, setShowVCardModal] = useState(false);
    const [showInteractiveModal, setShowInteractiveModal] = useState(false);
    const [vcardName, setVcardName] = useState('');
    const [vcardPhone, setVcardPhone] = useState('');
    const [interactiveBody, setInteractiveBody] = useState('');
    const [interactiveBtns, setInteractiveBtns] = useState(['', '', '']);
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [locName, setLocName] = useState('');
    const [locAddress, setLocAddress] = useState('');
    const [locLat, setLocLat] = useState('');
    const [locLng, setLocLng] = useState('');

    const [showListModal, setShowListModal] = useState(false);
    const [listBody, setListBody] = useState('');
    const [listBtnText, setListBtnText] = useState('Ver opciones');
    const [listSection, setListSection] = useState('Opciones');
    const [listItems, setListItems] = useState([{title: '', description: ''}]);

    const [showProductModal, setShowProductModal] = useState(false);
    const [prodBody, setProdBody] = useState('');
    const [prodCatalog, setProdCatalog] = useState('');
    const [prodSku, setProdSku] = useState('');

    const [vcardCompany, setVcardCompany] = useState('');
    const [vcardTitle, setVcardTitle] = useState('');
    const [vcardEmail, setVcardEmail] = useState('');
    const [vcardUrl, setVcardUrl] = useState('');



    // Broadcast active chat changes back to global Presence (App.jsx).
    // Depende solo del id (no del objeto completo) — selectedChat se reemplaza
    // por un objeto nuevo en cada actualizacion SSE del candidato (cada mensaje,
    // cada cambio de estado), lo que forzaba un heartbeat de presencia inmediato
    // en cada mensaje, saltandose el throttle de 45s/4min.
    useEffect(() => {
        window.dispatchEvent(new CustomEvent('presence_chat_change', { detail: { chatId: selectedChat?.id || null } }));
    }, [selectedChat?.id]);

    const [searchQuery, setSearchQuery] = useState("");
    const deferredSearch = useDeferredValue(searchQuery);
    const [candidateTyping, setCandidateTyping] = useState(false);
    const [showRightPanel, setShowRightPanel] = useState(true);
    const [messages, setMessages] = useState([]);
    const messageInputRef = useRef(null);
    const [_sending, setSending] = useState(false);
    const [loadingChats, setLoadingChats] = useState(true);
    const [availableTags, setAvailableTags] = useState([]);
    const [manualProjects, setManualProjects] = useState([]);
    const [newTagInput, setNewTagInput] = useState("");
    const [editingTag, setEditingTag] = useState(null);
    const [editTagName, setEditTagName] = useState("");
    const [editTagColor, setEditTagColor] = useState("#3b82f6");
    const [tagSearch, setTagSearch] = useState("");
    const [vacancies, setVacancies] = useState([]);
    const [editingVac, setEditingVac] = useState(null);
    const [chatLocks, setChatLocks] = useState({});
    const [reactionPopupId, setReactionPopupId] = useState(null);
    const [replyingToMsg, setReplyingToMsg] = useState(null);
    const [profileModalCandidate, setProfileModalCandidate] = useState(null);
    const [reminderModalCandidate, setReminderModalCandidate] = useState(null);
    // 🎨 Styled Confirm Modal (replaces ugly window.confirm)
    const [confirmModal, setConfirmModal] = useState(null);

    // Typing Indicators

    const [_recruiterTypingName, setRecruiterTypingName] = useState('');
    const [metaTemplates, setMetaTemplates] = useState([]);
    const typingTimersRef = useRef({});

    // ═══ INSTANCE MAP for I01/I02 badges ═══


    const _messagesEndRef = useRef(null);
    const _messagesContainerRef = useRef(null);
    const virtuosoRef = useRef(null);
    const isSendingRef = useRef(false);
    const isAtBottomRef = useRef(true);
    const virtuosoScrollerRef = useRef(null);
    const scrollFrameRef = useRef(null);
    const messagesByChatRef = useRef(new Map());
    const displayMessageCacheRef = useRef(new Map());
    const bottomAnchorRef = useRef(false);
    const prevDisplayLengthRef = useRef(0);
    // Ventana "acabo de enviar" (~2s): durante ella, la lista de mensajes SOLO hace scroll al
    // fondo cuando CRECE (llega una burbuja nueva), no en re-mediciones (palomita de estado,
    // carga de imagen con marco fijo). Sin esto, enviar texto+2 fotos disparaba ~8 "snaps" de
    // scroll que enmascaraban la animación de entrada y se veían como brinco. isSendingRef no
    // basta: se apaga apenas tocas el fondo, antes de que carguen las imágenes.
    const sendScrollHoldUntilRef = useRef(0);

    // Un solo requestAnimationFrame no basta para una burbuja ALTA (info de vacante /
    // "maletita", texto largo): React ya comprometió el DOM, pero Virtuoso todavía no
    // termina su propia pasada de medición interna (mide vía ResizeObserver, que corre
    // en un frame propio) — leer scrollHeight en ese punto da la altura ESTIMADA, no la
    // real, y el scroll aterriza corto. Un segundo rAF le da a Virtuoso ese frame de
    // margen antes de leer scrollHeight, así que aterriza en el fondo REAL a la primera
    // — igual que un mensaje corto, sin pin continuo ni corrección visible después.
    const scrollToBottom = () => {
        if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = requestAnimationFrame(() => {
            scrollFrameRef.current = requestAnimationFrame(() => {
                const el = virtuosoScrollerRef.current;
                if (el) el.scrollTop = el.scrollHeight;
            });
        });
    };
    const fileInputRef = useRef(null);
    const lastPresenceTimeRef = useRef(0);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [unseenCount, setUnseenCount] = useState(0);
    const [chatSearch, setChatSearch] = useState('');
    const [showChatSearch, setShowChatSearch] = useState(false);
    const [_chatSearchIdx, setChatSearchIdx] = useState(0);
    const chatSearchInputRef = useRef(null);
    // ✅ META AUDIT: Ghost guard — prevents SSE re-insertion after delete (same pattern as CandidatesSection)
    const recentlyDeletedRef = useRef(new Set());
    const draftsRef = useRef(new Map());
    const quickReplyApplyRef = useRef({ key: '', time: 0 });

    useEffect(() => {
        const chatId = selectedChat?.id;
        if (!chatId || !Array.isArray(messages)) return;
        messagesByChatRef.current.set(chatId, messages);
    }, [messages, selectedChat?.id]);

    // Aplica una actualizacion de la lista de mensajes ANCLADA a un chat concreto.
    // Los envios son asincronos: si en lo que un mensaje va en vuelo el reclutador
    // cambia de chat (o entra otro candidato y se reabre otro), el callback diferido
    // NO debe tocar el chat que quedo visible — antes lo hacia y "inyectaba" el mensaje
    // en el chat equivocado. Aqui: si el chat destino sigue abierto, actualizamos el
    // estado visible (el effect de arriba lo espeja al store por-chat); si ya no, solo
    // actualizamos su store para que se vea bien al reabrirlo, sin filtrarse al actual.
    const updateChatMessages = useCallback((chatId, updater) => {
        if (!chatId) return;
        // "Chat activo" tiene que leerse de una senal SINCRONA. selectedChatRef se
        // actualiza en un effect (post-commit), asi que al cambiar de chat queda un
        // instante en que messages ya es del chat nuevo pero selectedChatRef aun apunta
        // al viejo — ahi es donde un .then() diferido inyectaba en el chat equivocado.
        // pendingChatIdRef se setea sincronamente en handleSelectChat (es la misma
        // fuente de verdad que ya usa el SSE), asi que no tiene esa ventana de carrera.
        const activeId = pendingChatIdRef.current ?? selectedChatRef.current?.id;
        if (String(activeId) === String(chatId)) {
            setMessages(prev => updater(Array.isArray(prev) ? prev : []));
        } else {
            const prev = messagesByChatRef.current.get(chatId) || [];
            messagesByChatRef.current.set(chatId, updater(prev));
        }
    }, []);

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
    const quickRepliesLoadedRef = useRef(false);
    // Arranca abierto/cerrado segun la preferencia guardada del reclutador (Redis, perfil de usuario)
    const [showQuickRepliesPanel, setShowQuickRepliesPanel] = useState(() => !!user?.preferences?.quickRepliesOpen);
    const [editingQuickReply, setEditingQuickReply] = useState(null); // null = creating, object = editing

    // El panel de banco de respuestas ya NO se cierra solo al aplicar una respuesta —
    // se queda abierto hasta que el reclutador lo cierre a proposito. Esa preferencia
    // (abierto/cerrado) se guarda en el perfil del reclutador en Redis para recordarla
    // la proxima vez que entre.
    const setQuickRepliesPanelOpen = useCallback((open) => {
        setShowQuickRepliesPanel(open);
        if (!user?.id) return;
        const nextPreferences = { ...(user.preferences || {}), quickRepliesOpen: open };
        setUser(prev => prev ? { ...prev, preferences: nextPreferences } : prev);
        fetch('/api/users', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, preferences: nextPreferences })
        }).catch(() => {});
    }, [user?.id, user?.preferences, setUser]);
    // ── Banco de respuestas: orden por reclutador (drag & drop), form contraible y buscador ──
    // El orden y el colapso del form se guardan en el perfil del usuario en Redis
    // (mismo patron que quickRepliesOpen — merge superficial via PUT /api/users).
    const [qrOrder, setQrOrder] = useState(() => Array.isArray(user?.preferences?.quickRepliesOrder) ? user.preferences.quickRepliesOrder : []);
    const [qrFormCollapsed, setQrFormCollapsed] = useState(() => user?.preferences?.quickRepliesFormCollapsed !== false); // default: contraido (la lista es lo que se usa todo el dia)
    const [qrSearch, setQrSearch] = useState('');
    const [qrDraggedId, setQrDraggedId] = useState(null);
    const [qrDragOverId, setQrDragOverId] = useState(null);

    const saveQrPreference = useCallback((patch) => {
        if (!user?.id) return;
        const nextPreferences = { ...(user.preferences || {}), ...patch };
        setUser(prev => prev ? { ...prev, preferences: nextPreferences } : prev);
        fetch('/api/users', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, preferences: nextPreferences })
        }).catch(() => {});
    }, [user?.id, user?.preferences, setUser]);

    const toggleQrFormCollapsed = useCallback(() => {
        setQrFormCollapsed(prev => {
            saveQrPreference({ quickRepliesFormCollapsed: !prev });
            return !prev;
        });
    }, [saveQrPreference]);

    const persistQrOrder = useCallback((orderIds) => {
        setQrOrder(orderIds);
        saveQrPreference({ quickRepliesOrder: orderIds });
    }, [saveQrPreference]);

    // Lista mostrada: primero el orden del reclutador (respuestas nuevas/sin posicion al
    // final, en su orden original), luego el filtro del buscador (sin acentos/mayusculas).
    const qrNorm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const displayedQuickReplies = useMemo(() => {
        let list = quickReplies;
        if (qrOrder.length) {
            const pos = new Map(qrOrder.map((id, i) => [id, i]));
            // Sin posicion guardada (respuestas nuevas): al final, conservando su orden original
            const fallback = new Map(quickReplies.map((qr, i) => [qr.id, qrOrder.length + i]));
            list = [...quickReplies].sort((a, b) =>
                (pos.has(a.id) ? pos.get(a.id) : fallback.get(a.id)) - (pos.has(b.id) ? pos.get(b.id) : fallback.get(b.id))
            );
        }
        const q = qrNorm(qrSearch.trim());
        if (q) list = list.filter(qr => qrNorm(qr.name).includes(q) || qrNorm(qr.message).includes(q) || qrNorm(qr.shortcut).includes(q));
        return list;
    }, [quickReplies, qrOrder, qrSearch]);

    const handleQrDrop = useCallback((targetId) => {
        setQrDragOverId(null);
        const draggedId = qrDraggedId;
        setQrDraggedId(null);
        if (!draggedId || draggedId === targetId) return;
        const ids = displayedQuickReplies.map(q => q.id);
        const from = ids.indexOf(draggedId);
        const to = ids.indexOf(targetId);
        if (from === -1 || to === -1) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        persistQrOrder(ids);
    }, [qrDraggedId, displayedQuickReplies, persistQrOrder]);

    // ── Orden de etiquetas por reclutador (drag & drop, guardado en SU perfil) ──
    // Mismo patrón que qrOrder: se persiste en user.preferences.tagOrder (merge superficial
    // via PUT /api/users). Es una preferencia de VISTA personal: cada reclutador acomoda las
    // etiquetas del selector a su gusto; el orden NO es global (no toca /api/tags).
    const [tagOrder, setTagOrder] = useState(() => Array.isArray(user?.preferences?.tagOrder) ? user.preferences.tagOrder : []);
    const [tagDraggedName, setTagDraggedName] = useState(null);
    const [tagDragOverName, setTagDragOverName] = useState(null);

    const persistTagOrder = useCallback((names) => {
        setTagOrder(names);
        saveQrPreference({ tagOrder: names });   // saveQrPreference = merge superficial genérico de preferences
    }, [saveQrPreference]);

    // availableTags ordenado según la preferencia del reclutador. Las etiquetas nuevas (sin
    // posición guardada) van al final, conservando su orden original.
    const orderedAvailableTags = useMemo(() => {
        const list = Array.isArray(availableTags) ? availableTags : [];
        if (!tagOrder.length) return list;
        const nameOf = (t) => (typeof t === 'string' ? t : t.name);
        const pos = new Map(tagOrder.map((n, i) => [n, i]));
        const fallback = new Map(list.map((t, i) => [nameOf(t), tagOrder.length + i]));
        return [...list].sort((a, b) => {
            const an = nameOf(a), bn = nameOf(b);
            return (pos.has(an) ? pos.get(an) : fallback.get(an)) - (pos.has(bn) ? pos.get(bn) : fallback.get(bn));
        });
    }, [availableTags, tagOrder]);

    const handleTagDrop = useCallback((targetName) => {
        setTagDragOverName(null);
        const dragged = tagDraggedName;
        setTagDraggedName(null);
        if (!dragged || dragged === targetName) return;
        const names = orderedAvailableTags.map(t => (typeof t === 'string' ? t : t.name));
        const from = names.indexOf(dragged);
        const to = names.indexOf(targetName);
        if (from === -1 || to === -1) return;
        names.splice(to, 0, names.splice(from, 1)[0]);
        persistTagOrder(names);
    }, [tagDraggedName, orderedAvailableTags, persistTagOrder]);

    // ── Orden de vacantes por reclutador (drag & drop, guardado en SU perfil) ──
    // Mismo patrón que tagOrder/qrOrder: se persiste en user.preferences.vacancyOrder
    // (merge superficial via PUT /api/users). Preferencia de VISTA personal del selector
    // "Inyectar Info de Vacante" (maletín); NO es global (no toca /api/vacancies).
    const [vacancyOrder, setVacancyOrder] = useState(() => Array.isArray(user?.preferences?.vacancyOrder) ? user.preferences.vacancyOrder : []);
    const [vacancyDraggedId, setVacancyDraggedId] = useState(null);
    const [vacancyDragOverId, setVacancyDragOverId] = useState(null);

    const persistVacancyOrder = useCallback((ids) => {
        setVacancyOrder(ids);
        saveQrPreference({ vacancyOrder: ids });
    }, [saveQrPreference]);

    // vacancies ordenado según la preferencia del reclutador. Las vacantes nuevas (sin
    // posición guardada) van al final, conservando su orden original.
    const orderedVacancies = useMemo(() => {
        const list = Array.isArray(vacancies) ? vacancies : [];
        if (!vacancyOrder.length) return list;
        const pos = new Map(vacancyOrder.map((id, i) => [id, i]));
        const fallback = new Map(list.map((v, i) => [v.id, vacancyOrder.length + i]));
        return [...list].sort((a, b) =>
            (pos.has(a.id) ? pos.get(a.id) : fallback.get(a.id)) - (pos.has(b.id) ? pos.get(b.id) : fallback.get(b.id))
        );
    }, [vacancies, vacancyOrder]);

    const handleVacancyDrop = useCallback((targetId) => {
        setVacancyDragOverId(null);
        const dragged = vacancyDraggedId;
        setVacancyDraggedId(null);
        if (!dragged || dragged === targetId) return;
        const ids = orderedVacancies.map(v => v.id);
        const from = ids.indexOf(dragged);
        const to = ids.indexOf(targetId);
        if (from === -1 || to === -1) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        persistVacancyOrder(ids);
    }, [vacancyDraggedId, orderedVacancies, persistVacancyOrder]);

    const [qrForm, setQrForm] = useState({ name: '', message: '', shortcut: '', imageUrl: '', imageUrl2: '', imageUrl3: '', imageUrl4: '', type: 'text', locName: '', locAddress: '', locLat: '', locLng: '', audioUrl: '', audioMime: '', audioVoice: false, audioDurationMs: 0 });
    const [qrImageUploading, setQrImageUploading] = useState(false);
    // Grabación de audio para banco de respuestas (nota de voz nativa ogg/opus)
    const [qrRecording, setQrRecording] = useState(false);
    const [qrRecordSecs, setQrRecordSecs] = useState(0);
    const [qrAudioUploading, setQrAudioUploading] = useState(false);
    const qrRecorderRef = useRef(null);
    const qrRecordTimerRef = useRef(null);
    const qrRecordStartRef = useRef(0);
    const [pendingQrImages, setPendingQrImages] = useState([]); // imágenes de QR en espera de enviar
    const [_qrSaving, _setQrSaving] = useState(false);
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
    const [activeFilter, setActiveFilter] = useState('unread'); // 'all', 'unread', 'profile'
    const [filterValue, setFilterValue] = useState(null);
    const [profileUnreadOnly, setProfileUnreadOnly] = useState(false);
    const profileUnreadOnlyRef = useRef(false);
    const [selectedTag, setSelectedTag] = useState(null);
    const selectedTagRef = useRef(null);
    const selectedTagValues = useMemo(() => getSelectedTagValues(selectedTag), [selectedTag]);
    const selectedTagValueSet = useMemo(() => new Set(selectedTagValues), [selectedTagValues]);
    const [candidatesTotal, setCandidatesTotal] = useState(0);
    const [untaggedTotal, setUntaggedTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [visibleChatLimit, setVisibleChatLimit] = useState(CHAT_LIST_PAGE_SIZE);
    const loadingMoreRef = useRef(false);
    const activeFilterRef = useRef('unread');
    const _hasSetInitialFilter = useRef(false);
    const filterValueRef = useRef(null);
    const selectedChatRef = useRef(null);
    const pendingChatIdRef = useRef(null);
    const searchRef = useRef("");
    const candidatesRef = useRef([]);
    const nextCandidatesOffsetRef = useRef(0);
    const prevSearchRef = useRef(null);
    const sseWasConnectedOnceRef = useRef(false);

    // Multi-select Filters State
    const [selectedAges, setSelectedAges] = useState([]);
    const [selectedGenders, setSelectedGenders] = useState([]);
    const [selectedMunicipalities, setSelectedMunicipalities] = useState([]);

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

    // Toolbar drag handlers — defined once with useCallback so they don't recreate on every render.
    // iconId is passed at call site via partial application to avoid hook-inside-loop violation.
    const handleToolbarDragStart = useCallback((iconId, e) => {
        setDraggedIcon(iconId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', iconId);
    }, []);
    const handleToolbarDragOver = useCallback((e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);
    const handleToolbarDrop = useCallback((iconId, e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === iconId) return;
        setToolbarOrder(prev => {
            const newOrder = [...prev];
            const fromIdx = newOrder.indexOf(draggedId);
            const toIdx = newOrder.indexOf(iconId);
            if (fromIdx === -1 || toIdx === -1) return prev;
            newOrder.splice(fromIdx, 1);
            newOrder.splice(toIdx, 0, draggedId);
            localStorage.setItem('candidatic:toolbar_order', JSON.stringify(newOrder));
            return newOrder;
        });
        setDraggedIcon(null);
    }, []);
    const handleToolbarDragEnd = useCallback(() => setDraggedIcon(null), []);
    const toggleTagFilter = useCallback((tagName) => {
        setSelectedTag(current => {
            const values = getSelectedTagValues(current);
            const next = values.includes(tagName)
                ? values.filter(value => value !== tagName)
                : [...values, tagName];
            if (next.length === 0) return null;
            return next.length === 1 ? next[0] : next;
        });
    }, []);

    useEffect(() => {
        selectedChatRef.current = selectedChat;
    }, [selectedChat]);

    // El silencio de IA expira por reloj, no por un evento (a diferencia de la burbuja de
    // no leidos que reacciona a un mensaje via SSE). Para que el toggle se voltee EN VIVO
    // justo al cumplir blockedExpiresAt, programamos un timer que fuerza un re-render en ese
    // instante — ahi isIaSilenced recalcula y el toggle pasa a "IA Dinamica" sin refresh.
    const [, forceSilenceTick] = useState(0);
    useEffect(() => {
        if (selectedChat?.blocked !== true || !selectedChat?.blockedExpiresAt) return;
        const delay = new Date(selectedChat.blockedExpiresAt).getTime() - Date.now();
        if (!Number.isFinite(delay) || delay <= 0) return; // ya expiro: isIaSilenced ya lo refleja
        const timer = setTimeout(() => forceSilenceTick(v => v + 1), delay + 250);
        return () => clearTimeout(timer);
    }, [selectedChat?.id, selectedChat?.blocked, selectedChat?.blockedExpiresAt]);

    useEffect(() => {
        activeFilterRef.current = activeFilter;
        filterValueRef.current = filterValue;
    }, [activeFilter, filterValue]);

    useEffect(() => { searchRef.current = deferredSearch; }, [deferredSearch]);
    useEffect(() => { candidatesRef.current = candidates; }, [candidates]);

    const prevActiveFilterRef = useRef(null);
    const prevSelectedTagRef = useRef(undefined);
    useEffect(() => {
        selectedTagRef.current = selectedTag;
        // Primer render: solo sincronizar ref, no recargar
        if (prevSelectedTagRef.current === undefined) { prevSelectedTagRef.current = selectedTag; return; }
        if (prevSelectedTagRef.current === selectedTag) return;
        prevSelectedTagRef.current = selectedTag;
        // Recargar del servidor con el nuevo tagFilter para traer candidatos correctos
        loadCandidates();
    }, [selectedTag]);

    // Cambiar de filtro siempre recarga: con tag cambia el límite, sin tag cambia el modo servidor.
    useEffect(() => {
        const prev = prevActiveFilterRef.current;
        prevActiveFilterRef.current = activeFilter;
        if (prev === null) return; // primer render
        loadCandidates();
    }, [activeFilter, filterValue]);

    // El toggle "solo no leídos" (burbuja verde del filtro de perfil) también recarga:
    // con tag activo el servidor intersecta por no-leídos, así que al APAGARLO hay que
    // volver a pedir el universo completo (el array cargado solo trae los no-leídos).
    const prevProfileUnreadOnlyRef = useRef(null);
    useEffect(() => {
        profileUnreadOnlyRef.current = profileUnreadOnly;
        if (prevProfileUnreadOnlyRef.current === null) { prevProfileUnreadOnlyRef.current = profileUnreadOnly; return; }
        if (prevProfileUnreadOnlyRef.current === profileUnreadOnly) return;
        prevProfileUnreadOnlyRef.current = profileUnreadOnly;
        loadCandidates();
    }, [profileUnreadOnly]);

    // Server-side search: reload when search query changes (debounced 250ms)
    useEffect(() => {
        if (prevSearchRef.current === null) { prevSearchRef.current = deferredSearch; return; }
        if (prevSearchRef.current === deferredSearch) return;
        prevSearchRef.current = deferredSearch;
        const timer = setTimeout(() => { loadCandidates(); }, 250);
        return () => clearTimeout(timer);
    }, [deferredSearch]);


    // Manual CRM (Kanban) Filters - Route B
    const [manualPipelineFilter, setManualPipelineFilter] = useState(null);
    const [manualStepFilter, setManualStepFilter] = useState(null);

    const prevManualFiltersRef = useRef({ projectId: null, stepId: null, initialized: false });
    useEffect(() => {
        const prev = prevManualFiltersRef.current;
        if (!prev.initialized) {
            prevManualFiltersRef.current = { projectId: manualPipelineFilter, stepId: manualStepFilter, initialized: true };
            return;
        }
        if (prev.projectId === manualPipelineFilter && prev.stepId === manualStepFilter) return;
        prevManualFiltersRef.current = { projectId: manualPipelineFilter, stepId: manualStepFilter, initialized: true };
        loadCandidates();
    }, [manualPipelineFilter, manualStepFilter]);

    const [showDropdown, setShowDropdown] = useState(null);

    // New Chat creation
    const [showNewChat, setShowNewChat] = useState(false);
    const [filtersHidden, setFiltersHidden] = useState(() => localStorage.getItem('chat_filters_hidden') === 'true');
    const [newChatPhone, setNewChatPhone] = useState('');
    const [newChatName, setNewChatName] = useState('');
    const [newChatLoading, setNewChatLoading] = useState(false);

    // RBAC: base-level candidate restriction

    // Helper for RBAC
    const canSeeFilter = (filterKey) => {
        if (!user || user.role === 'SuperAdmin' || user.role === 'Admin') return true;
        // Safety: treat null, undefined, AND empty {} as "no restrictions"
        if (!rolePermissions || Object.keys(rolePermissions).length === 0) return true;
        return rolePermissions[filterKey] === true;
    };

    // No AI projects

    const filteredManualProjects = useMemo(() => {
        if (!user || user.role === 'SuperAdmin' || user.role === 'Admin') return manualProjects;
        const allowed = user?.allowed_crm_projects;
        if (!Array.isArray(allowed) || allowed.length === 0) return manualProjects;
        return manualProjects.filter(p => allowed.includes(p.id));
    }, [manualProjects, user]);

    const getUnreadContribution = useCallback((candidate) => {
        if (!candidate || !passesChatRBACFilter(candidate, user)) return null;
        const complete = isProfileComplete(candidate);
        if (!complete && !canSeeIncompleteChats(user, rolePermissions)) return null;
        if (!checkIfUnread(candidate)) return null;

        const tagKeys = Array.isArray(candidate.tags)
            ? candidate.tags
                .map(t => (typeof t === 'string' ? t : t?.name))
                .filter(Boolean)
                .map(t => t.trim().toLowerCase())
                .filter(Boolean)
            : [];

        return { complete, tagKeys, untagged: tagKeys.length === 0, projectId: candidate.manualProjectId || null };
    }, [user, rolePermissions]);

    const updateCountMap = (map = {}, key, delta) => {
        if (!key) return map;
        const next = { ...map };
        const value = Math.max(0, (Number(next[key]) || 0) + delta);
        if (value > 0) next[key] = value;
        else delete next[key];
        return next;
    };

    const applyUnreadDelta = (counts, contribution, delta) => {
        if (!contribution) return counts;
        let next = { ...counts };
        next.all = Math.max(0, (Number(next.all) || 0) + delta);
        next.complete = Math.max(0, (Number(next.complete) || 0) + (contribution.complete ? delta : 0));
        next.incomplete = Math.max(0, (Number(next.incomplete) || 0) + (!contribution.complete ? delta : 0));
        next.untagged = Math.max(0, (Number(next.untagged) || 0) + (contribution.untagged ? delta : 0));
        next.completeUntagged = Math.max(0, (Number(next.completeUntagged) || 0) + (contribution.untagged && contribution.complete ? delta : 0));
        next.incompleteUntagged = Math.max(0, (Number(next.incompleteUntagged) || 0) + (contribution.untagged && !contribution.complete ? delta : 0));

        let tags = next.tags || {};
        let completeTags = next.completeTags || {};
        let incompleteTags = next.incompleteTags || {};
        contribution.tagKeys.forEach(tagKey => {
            tags = updateCountMap(tags, tagKey, delta);
            if (contribution.complete) completeTags = updateCountMap(completeTags, tagKey, delta);
            else incompleteTags = updateCountMap(incompleteTags, tagKey, delta);
        });

        next.tags = tags;
        next.completeTags = completeTags;
        next.incompleteTags = incompleteTags;
        next.crmProjects = updateCountMap(next.crmProjects || {}, contribution.projectId, delta);
        return next;
    };

    const reconcileUnreadBadges = useCallback((beforeCandidate, afterCandidate) => {
        setGlobalUnreadCounts(prev => {
            if (!prev) return prev;
            let next = { ...prev };
            next = applyUnreadDelta(next, getUnreadContribution(beforeCandidate), -1);
            next = applyUnreadDelta(next, getUnreadContribution(afterCandidate), 1);
            return next;
        });
    }, [getUnreadContribution]);

    const applyCandidateUnreadPatch = useCallback((candidateId, patch) => {
        const before =
            candidatesRef.current.find(c => c.id === candidateId) ||
            (selectedChatRef.current?.id === candidateId ? selectedChatRef.current : null);
        const after = before ? { ...before, ...patch } : null;
        reconcileUnreadBadges(before, after);
        if (after) {
            candidatesRef.current = candidatesRef.current.map(c => c.id === candidateId ? { ...c, ...patch } : c);
            if (selectedChatRef.current?.id === candidateId) {
                selectedChatRef.current = { ...selectedChatRef.current, ...patch };
            }
        }
        setCandidates(prev => prev.map(c => c.id === candidateId ? { ...c, ...patch } : c));
        setSelectedChat(prev => prev?.id === candidateId ? { ...prev, ...patch } : prev);
    }, [reconcileUnreadBadges]);


    const markReplyHandledOptimistically = useCallback((candidateId) => {
        if (!candidateId) return;
        const now = new Date().toISOString();
        applyCandidateUnreadPatch(candidateId, {
            unreadMsgCount: 0,
            lastBotMessageAt: now,
            ultimoMensajeBot: now,
            lastHumanMessageAt: now,
        });
    }, [applyCandidateUnreadPatch]);


    // Optimistic unread clearance
    useEffect(() => {
        const handleReply = (e) => {
            const { candidateId } = e.detail;
            markReplyHandledOptimistically(candidateId);
        };
        window.addEventListener('candidate_replied', handleReply);
        return () => window.removeEventListener('candidate_replied', handleReply);
    }, [markReplyHandledOptimistically]);

    // 🏷️ Ad Label events → actualizar estado de candidatos al instante
    useEffect(() => {
        const onCreate = (e) => {
            const { adId, tagName } = e.detail || {};
            if (!adId || !tagName) return;
            setCandidates(prev => prev.map(c => {
                if (String(c.adId) !== String(adId)) return c;
                const existing = Array.isArray(c.tags) ? c.tags : [];
                if (existing.includes(tagName)) return c;
                return { ...c, tags: [...existing, tagName] };
            }));
        };
        const onRename = (e) => {
            const { oldTagName, newTagName } = e.detail || {};
            if (!oldTagName || !newTagName) return;
            setCandidates(prev => prev.map(c => {
                if (!Array.isArray(c.tags) || !c.tags.includes(oldTagName)) return c;
                return { ...c, tags: c.tags.map(t => t === oldTagName ? newTagName : t) };
            }));
            setAvailableTags(prev => prev.map(t => {
                const name = typeof t === 'string' ? t : t.name;
                if (name !== oldTagName) return t;
                return typeof t === 'string' ? newTagName : { ...t, name: newTagName };
            }));
        };
        const onDelete = (e) => {
            const { tagName } = e.detail || {};
            if (!tagName) return;
            setCandidates(prev => prev.map(c => {
                if (!Array.isArray(c.tags) || !c.tags.includes(tagName)) return c;
                return { ...c, tags: c.tags.filter(t => t !== tagName) };
            }));
            setAvailableTags(prev => prev.filter(t => (typeof t === 'string' ? t : t.name) !== tagName));
        };
        window.addEventListener('ad_label_created', onCreate);
        window.addEventListener('ad_label_renamed', onRename);
        window.addEventListener('ad_label_deleted', onDelete);
        return () => {
            window.removeEventListener('ad_label_created', onCreate);
            window.removeEventListener('ad_label_renamed', onRename);
            window.removeEventListener('ad_label_deleted', onDelete);
        };
    }, []);

    // Load Data
    useEffect(() => {
        loadCandidates();
        loadTags();
        const cancelIdleLoads = scheduleIdleTask(() => {
            loadVacanciesList();
            loadManualProjects();
            loadQuickReplies();

            fetch('/api/whatsapp/templates')
                .then(res => res.json())
                .then(data => { if(data.success && data.data) setMetaTemplates(data.data.filter(t => t.status==='APPROVED')); })
                .catch(() => {});

            // ✅ META AUDIT: chat-stats polling KILLED — locks fetched once after first paint.
            fetch('/api/chat-stats')
                .then(res => res.json())
                .then(data => { if (data.success) setChatLocks(data.locks || {}); })
                .catch(() => {});

            fetch('/api/candidates?action=filter_counts')
                .then(res => res.json())
                .then(data => {
                    if (!data.success) return;
                    setGlobalFilterCounts(data.counts || null);
                    try { sessionStorage.setItem('candidatic_filter_counts', JSON.stringify(data.counts || null)); } catch {}
                })
                .catch(() => {});
        }, 1600);

        return cancelIdleLoads;
    }, []);

    // RBAC effect removed (handled inline)


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

    // Quick Replies loader
    const loadQuickReplies = async () => {
        if (quickRepliesLoadedRef.current) return;
        quickRepliesLoadedRef.current = true;
        try {
            const res = await fetch('/api/quick_replies');
            const data = await res.json();
            if (data.success) setQuickReplies(data.replies || []);
        } catch (e) {
            quickRepliesLoadedRef.current = false;
            console.error('Error loading quick replies', e);
        }
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

    const handleQrImageUpload = async (file) => {
        if (!file) return null;
        setQrImageUploading(true);
        try {
            // Comprimir antes de subir: el banco guarda el base64 90 dias en Redis,
            // asi que cada KB ahorrado aqui se multiplica.
            file = await compressImage(file);
            const formData = new FormData();
            formData.append('file', file);
            formData.append('candidateId', 'quick_reply_asset');
            const res = await fetch('/api/media/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al subir imagen');
            return data.url || data.mediaUrl || null;
        } catch (e) {
            showToast && showToast('Error al subir imagen: ' + e.message, 'error');
            return null;
        } finally {
            setQrImageUploading(false);
        }
    };

    // Sube un blob/archivo de audio al banco (base64 90d + Blob permanente, igual que imágenes).
    // Devuelve { url, mime } o null. voice=true solo si el mime es ogg/opus (requisito de Meta
    // para que WhatsApp lo pinte como nota de voz con onditas).
    const handleQrAudioUpload = async (fileOrBlob, filename) => {
        if (!fileOrBlob) return null;
        setQrAudioUploading(true);
        try {
            const formData = new FormData();
            const fname = filename || (fileOrBlob.name) || `nota-voz-${Date.now()}.ogg`;
            formData.append('file', fileOrBlob, fname);
            formData.append('candidateId', 'quick_reply_asset');
            const res = await fetch('/api/media/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al subir audio');
            return { url: data.url || data.mediaUrl || null, mime: data.mime || fileOrBlob.type || '' };
        } catch (e) {
            showToast && showToast('Error al subir audio: ' + e.message, 'error');
            return null;
        } finally {
            setQrAudioUploading(false);
        }
    };

    const isOggOpus = (mime) => /ogg/i.test(mime || '');

    const stopQrRecording = useCallback(() => {
        try { qrRecorderRef.current?.stop(); } catch { /* noop */ }
        if (qrRecordTimerRef.current) { clearInterval(qrRecordTimerRef.current); qrRecordTimerRef.current = null; }
    }, []);

    const startQrRecording = useCallback(async () => {
        if (qrRecording) return;
        try {
            // Carga diferida: el worker/WASM del encoder (~385KB) solo se baja al grabar.
            const _mod = await import('opus-recorder');
            const Recorder = _mod.default || _mod;
            if (!Recorder.isRecordingSupported || !Recorder.isRecordingSupported()) {
                showToast && showToast('Tu navegador no soporta grabación de audio', 'error');
                return;
            }
            const rec = new Recorder({
                encoderPath: '/opus/encoderWorker.min.js',
                encoderApplication: 2048,   // VOIP — optimizado para voz
                encoderSampleRate: 16000,   // 16kHz mono: nota de voz ligera y clara
                numberOfChannels: 1,
                recordingGain: 1,
                streamPages: false          // un solo blob .ogg completo al parar
            });
            let oggData = null;
            rec.ondataavailable = (typedArray) => { oggData = typedArray; };
            rec.onstop = async () => {
                setQrRecording(false);
                const durationMs = Date.now() - qrRecordStartRef.current;
                try { rec.stream?.getTracks?.().forEach(t => t.stop()); } catch { /* noop */ }
                if (!oggData || !oggData.length) return;
                // MIME sin el sufijo "; codecs=opus": Meta valida el tipo del archivo al subirlo
                // y el parámetro extra puede tumbar la validación. Los bytes ya son ogg/opus.
                const blob = new Blob([oggData], { type: 'audio/ogg' });
                const uploaded = await handleQrAudioUpload(blob, `nota-voz-${Date.now()}.ogg`);
                if (uploaded?.url) {
                    setQrForm(prev => ({ ...prev, audioUrl: uploaded.url, audioMime: uploaded.mime || 'audio/ogg', audioVoice: isOggOpus(uploaded.mime || 'audio/ogg'), audioDurationMs: durationMs }));
                }
            };
            await rec.start();
            qrRecorderRef.current = rec;
            qrRecordStartRef.current = Date.now();
            setQrRecordSecs(0);
            setQrRecording(true);
            qrRecordTimerRef.current = setInterval(() => {
                setQrRecordSecs(Math.floor((Date.now() - qrRecordStartRef.current) / 1000));
            }, 250);
        } catch (e) {
            setQrRecording(false);
            const denied = /denied|permission/i.test(e?.message || '');
            showToast && showToast(denied ? 'Permiso de micrófono denegado' : ('No se pudo iniciar la grabación: ' + (e?.message || '')), 'error');
        }
    }, [qrRecording]);

    // Limpieza: si el componente se desmonta grabando, detener el micrófono.
    useEffect(() => () => {
        try { qrRecorderRef.current?.stop(); } catch { /* noop */ }
        if (qrRecordTimerRef.current) clearInterval(qrRecordTimerRef.current);
    }, []);

    const handleApplyQuickReply = useCallback(async (qr) => {
        const now = Date.now();
        const applyKey = `${selectedChat?.id || 'no-chat'}:${qr.id || qr.name || qr.shortcut || qr.message || qr.type}`;
        if (quickReplyApplyRef.current.key === applyKey && now - quickReplyApplyRef.current.time < 1200) return;
        quickReplyApplyRef.current = { key: applyKey, time: now };

        // Tipo ubicación: enviar directamente sin pasar por el input de texto
        // (el panel ya NO se cierra solo — se queda abierto hasta que el reclutador lo cierre)
        if (qr.type === 'location' && qr.location?.lat && qr.location?.lng) {
            if (!selectedChat) return;
            autoSilenceBot(selectedChat);
            const currentCandidateId = selectedChat.id;
            markReplyHandledOptimistically(currentCandidateId);
            const optimisticId = 'temp-loc-' + Date.now();
            updateChatMessages(currentCandidateId, prev => [...(prev || []), withMessageEntryAnimation({
                id: optimisticId, content: `[Ubicación: ${qr.location.name || 'Mapa'}]`, tipo: 'location',
                from: 'me', enviado_por_agente: 1, status: 'pending', fecha: new Date().toISOString(), _clientAnchoredTime: true
            }, 'outgoing')]);
            fetch('/api/chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidateId: currentCandidateId, message: '', type: 'location',
                    extraParams: { name: qr.location.name, address: qr.location.address, lat: qr.location.lat, lng: qr.location.lng },
                    senderId: user?.id || user?.whatsapp, senderName: user?.name || user?.nombre
                })
            }).then(r => r.json()).then(data => {
                updateChatMessages(currentCandidateId, prev => data.success && data.message
                    ? mergeOutgoingMessage(prev, data.message, optimisticId)
                    : prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m)
                );
            }).catch(() => {
                updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed' } : m));
            });
            return;
        }
        // Tipo audio: enviar directo como nota de voz nativa (no pasa por el input)
        if (qr.type === 'audio' && qr.audioUrl) {
            if (!selectedChat) return;
            autoSilenceBot(selectedChat);
            const currentCandidateId = selectedChat.id;
            markReplyHandledOptimistically(currentCandidateId);
            const optimisticId = 'temp-audio-' + Date.now();
            // ⚠️ El tipo DEBE ser 'audio' (lo que guarda el server), no 'ptt': getMessageKind
            // compara type y, si difieren, el eco por SSE no deduplica contra el optimista y
            // aparece una burbuja doble que luego brinca al reconciliar. El reproductor rinde
            // igual con 'audio'. La distinción de nota de voz la maneja el flag voice al enviar.
            updateChatMessages(currentCandidateId, prev => [...(prev || []), withMessageEntryAnimation({
                id: optimisticId, content: qr.voice ? '🎤 Nota de voz' : '🎵 Audio', type: 'audio', mediaUrl: qr.audioUrl,
                from: 'me', enviado_por_agente: 1, status: 'pending', fecha: new Date().toISOString(), _clientAnchoredTime: true
            }, 'outgoing')]);
            fetch('/api/chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidateId: currentCandidateId, message: '', type: 'audio', mediaUrl: qr.audioUrl, voice: !!qr.voice,
                    senderId: user?.id || user?.whatsapp, senderName: user?.name || user?.nombre
                })
            }).then(r => r.json()).then(data => {
                updateChatMessages(currentCandidateId, prev => data.success && data.message
                    ? mergeOutgoingMessage(prev, data.message, optimisticId)
                    : prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m)
                );
            }).catch(() => {
                updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed' } : m));
            });
            return;
        }
        // Tipo texto/imagen: inyectar en el input
        const imgs = qr.imageUrls?.length ? qr.imageUrls : (qr.imageUrl ? [qr.imageUrl] : []);
        if (imgs.length) setPendingQrImages(imgs);
        if (qr.message) {
            const candidatoFresh = candidates.find(c => c.id === selectedChat?.id) || selectedChat;
            // Misma funcion que usa el backend al enviar (api/utils/shortcuts.js) — antes
            // esto solo reconocia {{nombre}} exacto (sin espacios internos, y ninguna otra
            // variable), asi que cualquier otro placeholder o variante de formato quedaba
            // sin resolver aqui aunque el envio final si lo hubiera resuelto bien.
            const resolved = substituteVariables(qr.message, candidatoFresh || {})
                .replace(/[^\S\n]{2,}/g, ' ')
                .trim();
            messageInputRef.current?.injectText(resolved);
        }
        // El panel se queda abierto a proposito — solo se cierra si el reclutador lo cierra el mismo.
    }, [selectedChat, candidates, user, showToast, markReplyHandledOptimistically, updateChatMessages]);

    useEffect(() => {
        if (showQuickRepliesPanel) loadQuickReplies();
    }, [showQuickRepliesPanel]);

    // HIGH-3: Clean up typing indicator timers on unmount to prevent state updates on unmounted component
    useEffect(() => {
        return () => {
            Object.values(typingTimersRef.current).forEach(t => clearTimeout(t));
            if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
        };
    }, []);

    // Keyboard shortcut listener for quick replies
    useEffect(() => {
        if (quickReplies.length === 0) return;
        const handler = (e) => {
            // Don't fire when user is typing in an input/textarea
            const tag = document.activeElement?.tagName?.toLowerCase();
            if (['input', 'textarea', 'select'].includes(tag) || document.activeElement?.isContentEditable) return;
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
                    handleApplyQuickReply(qr);
                    return;
                }
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [quickReplies, handleApplyQuickReply]);

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
                setUntaggedTotal(Number(data.untaggedCount) || 0);
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
            const selectedTagParams = getSelectedTagValues(selectedTagRef.current);
            const hasMultiTagFilter = selectedTagParams.length > 1;
            const tagParam = selectedTagParams.length === 1 ? selectedTagParams[0] : "";
            const manualProjectParam = manualPipelineFilter || "";
            const manualStepParam = manualStepFilter || "";
            const searchParam = searchRef.current || "";
            const af = activeFilterRef.current;
            const fv = filterValueRef.current;

            // Traducir filtro UI → param servidor
            const getServerFilter = () => {
                if (!tagParam) {
                    if (af === 'unread') return 'unread';
                    if (af === 'profile' && fv === 'complete') return 'complete';
                    if (af === 'profile' && fv === 'incomplete') return 'incomplete';
                }
                return null;
            };
            const serverFilter = getServerFilter();

            const hasLocalFilters =
                selectedAges.length > 0 ||
                selectedGenders.length > 0 ||
                selectedMunicipalities.length > 0 ||
                hasMultiTagFilter ||
                !!manualPipelineFilter ||
                !!manualStepFilter;

            // Si hay filtros que se aplican en cliente, cargamos un universo más amplio
            // para no perder resultados; la pantalla sigue revelando 10 en 10.
            const isFilteredTagMode = !!tagParam && af !== 'all';
            const limit = hasLocalFilters || isFilteredTagMode
                ? CHAT_LIST_LOCAL_FILTER_PAGE_SIZE
                : CHAT_LIST_PAGE_SIZE;

            let result;
            if (serverFilter) {
                result = await getCandidates(limit, 0, searchParam, false, '', false, serverFilter, manualProjectParam, manualStepParam);
            } else if (af === 'all') {
                result = await getCandidates(limit, 0, searchParam, false, tagParam, false, '', manualProjectParam, manualStepParam);
            } else {
                // Tag activo + filtro de estado: se manda el filtro al servidor para que
                // intersecte los sets en Redis e hidrate solo los que aplican (antes traía
                // TODO el tag y el navegador descartaba hasta el 98%). El cliente re-filtra
                // lo recibido igual que siempre, así que un superconjunto nunca rompe la vista.
                const tagStatusFilter = (af === 'unread') ? 'unread'
                    : (af === 'profile' && fv === 'complete') ? 'complete'
                    : (af === 'profile' && fv === 'incomplete') ? 'incomplete'
                    : '';
                const tagUnreadOnly = af === 'profile' && !!tagStatusFilter && !!profileUnreadOnlyRef.current;
                result = await getCandidates(limit, 0, searchParam, false, tagParam, true, tagStatusFilter, manualProjectParam, manualStepParam, tagUnreadOnly);
            }

            if (result.success) {
                const fetchedCandidates = result.candidates || [];
                setCandidates(fetchedCandidates);
                setCandidatesTotal(result.total ?? fetchedCandidates.length);
                nextCandidatesOffsetRef.current = result.pagination?.nextOffset ?? fetchedCandidates.length;
                setVisibleChatLimit(CHAT_LIST_PAGE_SIZE);
                const isPaginated = !hasLocalFilters && !isFilteredTagMode;
                const serverHasMore = result.hasMore ?? result.pagination?.hasMore;
                setHasMore(isPaginated && (serverHasMore ?? fetchedCandidates.length === limit));
                if (fetchedCandidates.length > 0) {
                    setSelectedChat(current => { if (!current) return fetchedCandidates[0]; return current; });
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingChats(false);
        }
    };

    const loadMore = useCallback(async () => {
        if (loadingMoreRef.current || !hasMore) return;
        const selectedTagParams = getSelectedTagValues(selectedTagRef.current);
        const tagParam = selectedTagParams.length === 1 ? selectedTagParams[0] : "";
        const manualProjectParam = manualPipelineFilter || "";
        const manualStepParam = manualStepFilter || "";
        const searchParam = searchRef.current || "";
        const af = activeFilterRef.current;
        const fv = filterValueRef.current;
        const getServerFilter = () => {
            if (!tagParam) {
                if (af === 'unread') return 'unread';
                if (af === 'profile' && fv === 'complete') return 'complete';
                if (af === 'profile' && fv === 'incomplete') return 'incomplete';
            }
            return null;
        };
        const serverFilter = getServerFilter();
        loadingMoreRef.current = true;
        setLoadingMore(true);
        try {
            const nextOffset = nextCandidatesOffsetRef.current;
            let result;
            if (serverFilter) {
                result = await getCandidates(CHAT_LIST_PAGE_SIZE, nextOffset, searchParam, false, '', false, serverFilter, manualProjectParam, manualStepParam);
            } else if (af === 'all') {
                result = await getCandidates(CHAT_LIST_PAGE_SIZE, nextOffset, searchParam, false, tagParam, false, '', manualProjectParam, manualStepParam);
            } else {
                result = await getCandidates(CHAT_LIST_PAGE_SIZE, nextOffset, searchParam, false, tagParam, true, '', manualProjectParam, manualStepParam);
            }
            if (result.success) {
                const newCandidates = result.candidates || [];
                nextCandidatesOffsetRef.current = result.pagination?.nextOffset ?? (nextOffset + newCandidates.length);
                const serverHasMore = result.hasMore ?? result.pagination?.hasMore;
                setHasMore(serverHasMore ?? (newCandidates.length === CHAT_LIST_PAGE_SIZE));
                if (newCandidates.length > 0) {
                    const existingIds = new Set(candidatesRef.current.map(c => c.id));
                    const unique = newCandidates.filter(c => !existingIds.has(c.id));
                    if (unique.length > 0) {
                        setCandidates(prev => [...prev, ...unique]);
                        setVisibleChatLimit(current => current + unique.length);
                    }
                } else {
                    setHasMore(false);
                }
            }
        } catch (e) { console.error(e); }
        finally { loadingMoreRef.current = false; setLoadingMore(false); }
    }, [hasMore, manualPipelineFilter, manualStepFilter]);

    // Filter and sort candidates (search is handled server-side via loadCandidates)
    const filteredCandidates = useMemo(() => {
        const result = (candidates || []).filter(c => {

            // --- RBAC Base Filter: Only show candidates from allowed projects or tags ---
            if (!passesChatRBACFilter(c, user)) return false;

            // --- Permiso: ocultar candidatos incompletos si el rol no lo permite ---
            if (user?.role !== 'SuperAdmin' &&
                rolePermissions && Object.keys(rolePermissions).length > 0 &&
                rolePermissions.view_incomplete_candidates !== true &&
                !isProfileComplete(c)) return false;

            // --- Viewer Role: Only show Messenger chats (for Meta reviewer account) ---
            if (user?.role === 'Viewer' && c?.platform !== 'messenger') return false;

            // --- Strict Inbox para Reclutadores (Sin botón 'Todos') ---
            if (!canSeeFilter('filter_todos') && activeFilter === 'all') {
                const hasAnyTag = Array.isArray(c?.tags) && c.tags.length > 0;
                // 🛡️ Exception: Never hide candidates created in last 24h (protects new Facebook CTWA leads)
                const isRecent = c?.primerContacto && (Date.now() - new Date(c.primerContacto).getTime()) < 86400000;
                if (!hasAnyTag && !isRecent) return false;
            }

            if (activeFilter === 'unread' && !checkIfUnread(c)) return false;
            if (selectedTagValues.length > 0) {
                const tagNames = Array.isArray(c?.tags)
                    ? c.tags.map(t => (typeof t === 'string' ? t : (t?.name || '')).trim()).filter(Boolean)
                    : [];
                const normalizedNames = tagNames.map(n => n.toLowerCase());
                const matchesSelectedTag = selectedTagValues.some(tagValue => {
                    if (tagValue === UNTAGGED_TAG_FILTER) return tagNames.length === 0;
                    return normalizedNames.includes(tagValue.trim().toLowerCase());
                });
                if (!matchesSelectedTag) {
                    return false;
                }
            }
            if (activeFilter === 'profile') {
                const isComplete = isProfileComplete(c);
                if (filterValue === 'complete' && !isComplete) return false;
                if (filterValue === 'incomplete' && isComplete) return false;
                if (profileUnreadOnly && !checkIfUnread(c)) return false;
            }

            // --- Filtros Múltiples (Edad, Género, Municipio) ---
            if (selectedAges.length > 0 && (!c.edad || !selectedAges.includes(String(c.edad).trim()))) return false;
            if (selectedGenders.length > 0 && (!c.genero || !selectedGenders.includes(String(c.genero).trim()))) return false;
            if (selectedMunicipalities.length > 0 && (!c.municipio || !selectedMunicipalities.includes(String(c.municipio).trim()))) return false;


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

        // WhatsApp-Native Sort: Pinned first → then strictly chronological (with deterministic tie-breaker)
        return result.sort((a, b) => {
            const aPinned = pinnedChats.includes(a.id);
            const bPinned = pinnedChats.includes(b.id);
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            const diff = (tsCache.get(b.id) || 0) - (tsCache.get(a.id) || 0);
            if (diff !== 0) return diff;
            return String(b.id || '').localeCompare(String(a.id || ''));
        });
    }, [
        candidates, user,
        activeFilter, filterValue, profileUnreadOnly,
        selectedTag,
        manualPipelineFilter, manualStepFilter,
        pinnedChats,
        selectedAges, selectedGenders, selectedMunicipalities
    ]);

    const visibleCandidates = useMemo(
        () => filteredCandidates.slice(0, visibleChatLimit),
        [filteredCandidates, visibleChatLimit]
    );

    // Firma del filtro activo — se usa para distinguir "un candidato dejó de cumplir el
    // filtro" (animar salida) de "cambiaste de filtro/búsqueda" (mostrar el conjunto nuevo
    // de una vez, sin animar salidas masivas de candidatos que ni siquiera se fueron).
    const chatFilterSignature = useMemo(() => JSON.stringify([
        activeFilter, filterValue, profileUnreadOnly, selectedTag,
        manualPipelineFilter, manualStepFilter, selectedAges, selectedGenders, selectedMunicipalities
    ]), [activeFilter, filterValue, profileUnreadOnly, selectedTag, manualPipelineFilter, manualStepFilter, selectedAges, selectedGenders, selectedMunicipalities]);

    // ── Salida elegante ──
    // Cuando un candidato deja de cumplir el filtro activo (se marca leído, pierde la
    // etiqueta seleccionada, etc.) no desaparece de golpe: se queda renderizado
    // CHAT_EXIT_ANIM_MS más con la animación .chat-card-exit (ChatRow + index.css) y solo
    // entonces se retira de verdad. Si vuelve a matchear el filtro ANTES de que termine
    // (p.ej. te vuelve a escribir) se cancela la salida y sigue de largo, sin duplicarse.
    const [leavingCandidates, setLeavingCandidates] = useState(() => new Map());
    const leavingCandidatesRef = useRef(leavingCandidates);
    leavingCandidatesRef.current = leavingCandidates;
    const prevFilteredIdsRef = useRef(null);

    // Cambio de filtro/búsqueda: no es un candidato "dejando de cumplir", es un conjunto
    // nuevo completo — se limpia cualquier salida en curso y no se animan salidas masivas.
    useEffect(() => {
        prevFilteredIdsRef.current = null;
        setLeavingCandidates(prev => (prev.size === 0 ? prev : new Map()));
    }, [chatFilterSignature]);

    useEffect(() => {
        const currentIds = new Set(filteredCandidates.map(c => c.id));
        const prevIds = prevFilteredIdsRef.current;
        if (prevIds) {
            const departed = [];
            prevIds.forEach(id => { if (!currentIds.has(id)) departed.push(id); });
            if (departed.length > 0) {
                setLeavingCandidates(prev => {
                    const next = new Map(prev);
                    let changed = false;
                    departed.forEach(id => {
                        if (next.has(id)) return;
                        const snap = candidatesRef.current.find(c => c.id === id);
                        if (snap) { next.set(id, snap); changed = true; }
                    });
                    return changed ? next : prev;
                });
                departed.forEach(id => {
                    setTimeout(() => {
                        setLeavingCandidates(prev => {
                            if (!prev.has(id)) return prev;
                            const next = new Map(prev);
                            next.delete(id);
                            return next;
                        });
                    }, CHAT_EXIT_ANIM_MS);
                });
            }
            // Reingresó antes de terminar la animación (p.ej. te volvió a escribir) → cancelar salida
            if (leavingCandidatesRef.current.size > 0) {
                let reentered = false;
                const next = new Map(leavingCandidatesRef.current);
                next.forEach((_candidate, id) => { if (currentIds.has(id)) { next.delete(id); reentered = true; } });
                if (reentered) setLeavingCandidates(next);
            }
        }
        prevFilteredIdsRef.current = currentIds;
    }, [filteredCandidates]);

    // Los candidatos "saliendo" se intercalan con el mismo criterio de orden (pineados +
    // fecha) para que aparezcan donde ya estaban en vez de saltar a un lugar random
    // mientras se desvanecen — no altera el filtro real, solo dónde se ve la animación.
    const renderedCandidates = useMemo(() => {
        if (leavingCandidates.size === 0) return visibleCandidates;
        const extra = [];
        leavingCandidates.forEach((cand, id) => {
            if (visibleCandidates.some(c => c.id === id)) return; // ya volvió a matchear
            extra.push({ ...cand, _leaving: true });
        });
        if (extra.length === 0) return visibleCandidates;
        return [...visibleCandidates, ...extra].sort((a, b) => {
            const aPinned = pinnedChats.includes(a.id);
            const bPinned = pinnedChats.includes(b.id);
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            const at = a.ultimoMensaje ? new Date(a.ultimoMensaje).getTime() : 0;
            const bt = b.ultimoMensaje ? new Date(b.ultimoMensaje).getTime() : 0;
            const diff = bt - at;
            if (diff !== 0) return diff;
            return String(b.id || '').localeCompare(String(a.id || ''));
        });
    }, [visibleCandidates, leavingCandidates, pinnedChats]);

    // ── Ancla de PIVOTE: el chat SELECCIONADO nunca se mueve de su posición en pantalla ──
    // Antes existía un "congelado" del orden completo mientras estabas scrolleado (>80px),
    // acumulando lo nuevo al final para no tocar tu vista. Eso rompía una regla de negocio:
    // un chat que vuelve a ser el más reciente debe ir SIEMPRE al tope (es la cola de
    // prioridad con la que trabajan los reclutadores), no al final del bloque congelado —
    // si no, se mete a media lista, justo donde estás trabajando.
    // Ahora el orden SIEMPRE es el real (fecha/hora), sin excepción por filtro. En vez de
    // congelar todo, se ancla solo el chat que tienes ABIERTO: se mide su posición en
    // pantalla antes/después de cada cambio y se compensa el scroll con la diferencia, así
    // que tu chat activo no se mueve aunque el resto de la lista se reordene alrededor.
    // El ajuste se agrupa por frame (rAF): si llegan varios reordenamientos casi juntos
    // (tráfico alto, varios reclutadores respondiendo a la vez), se aplica UNA sola
    // corrección por frame en vez de una por evento — evita el "temblor" de corregir
    // varias veces por segundo aunque cada corrección individual sea correcta.
    // ChatRow marca la fila seleccionada con data-pivot="true" (ver ChatRow.jsx) — se lee
    // ESE nodo puntual, no un escaneo del DOM interno de Virtuoso.
    const chatListVirtuosoRef = useRef(null);
    const chatListScrollerRef = useRef(null);
    const pivotIdRef = useRef(null);
    const pivotOffsetRef = useRef(null);
    const pivotRafRef = useRef(0);

    const handleChatListScrollerRef = useCallback((el) => {
        chatListScrollerRef.current = el;
    }, []);

    useLayoutEffect(() => {
        const sc = chatListScrollerRef.current;
        if (!sc || !selectedChat?.id) { pivotIdRef.current = null; pivotOffsetRef.current = null; return; }
        const pivotEl = sc.querySelector('[data-pivot="true"]');
        if (!pivotEl) { pivotIdRef.current = null; pivotOffsetRef.current = null; return; }

        const currentOffset = pivotEl.getBoundingClientRect().top - sc.getBoundingClientRect().top;

        if (pivotIdRef.current === selectedChat.id && pivotOffsetRef.current != null) {
            const delta = currentOffset - pivotOffsetRef.current;
            if (Math.abs(delta) > 0.5 && !pivotRafRef.current) {
                pivotRafRef.current = requestAnimationFrame(() => {
                    pivotRafRef.current = 0;
                    const sc2 = chatListScrollerRef.current;
                    const el2 = sc2 && sc2.querySelector('[data-pivot="true"]');
                    if (!sc2 || !el2 || pivotOffsetRef.current == null) return;
                    const liveOffset = el2.getBoundingClientRect().top - sc2.getBoundingClientRect().top;
                    const liveDelta = liveOffset - pivotOffsetRef.current;
                    if (Math.abs(liveDelta) > 0.5) sc2.scrollTop += liveDelta;
                });
            }
        } else {
            // Pivote nuevo (cambiaste de chat, o primer render con selección): su posición
            // actual se vuelve la referencia — nada que compensar todavía.
            pivotIdRef.current = selectedChat.id;
            pivotOffsetRef.current = currentOffset;
        }
    }, [renderedCandidates, selectedChat?.id]);

    useEffect(() => () => { if (pivotRafRef.current) cancelAnimationFrame(pivotRafRef.current); }, []);

    // ── Entrada por CAMBIO DE ESTATUS: detecta tarjetas que RECIÉN pasan a matchear el
    // filtro actual (p.ej. un chat leído recibe mensaje → entra a "no leídos", o vuelve a
    // ser el más reciente) para animar su entrada con el mismo fade que un lead nuevo. Se
    // calcula DURANTE el render (patrón usePrevious: se lee el estado del commit anterior
    // desde refs actualizados en un effect) para que el prop esté listo cuando la fila
    // monta. Guardas anti-cascadeo:
    //   • filtro sin cambiar (si cambió el filtro → set nuevo entero → NO animar)
    //   • sin paginar (visibleChatLimit no creció → no animar la tanda de abajo)
    //   • solo cerca del tope (las entradas por estatus llegan arriba; tope acota un bulk)
    //   • nunca los leads nuevos (esos animan por _newCardAt)
    // Antes esto competía contra el congelado por scroll y se desactivó por inestabilidad
    // bajo tráfico; con el congelado eliminado (orden siempre real + ancla de pivote) esa
    // fuente de conflicto ya no existe.
    const entryPrevIdsRef = useRef(null);
    const entryPrevFilterSigRef = useRef(null);
    const entryPrevLimitRef = useRef(0);
    const enteredFilterIds = useMemo(() => {
        const result = new Set();
        const prevIds = entryPrevIdsRef.current;
        const filterSame = entryPrevFilterSigRef.current !== null && chatFilterSignature === entryPrevFilterSigRef.current;
        const noPagination = visibleChatLimit <= entryPrevLimitRef.current;
        if (prevIds && filterSame && noPagination) {
            const N = Math.min(visibleCandidates.length, 8); // solo cerca del tope
            for (let i = 0; i < N; i++) {
                const c = visibleCandidates[i];
                if (c && !prevIds.has(c.id) && !c._newCardAt) result.add(c.id);
            }
        }
        return result;
    }, [visibleCandidates, chatFilterSignature, visibleChatLimit]);
    useEffect(() => {
        const curIds = new Set();
        for (const c of visibleCandidates) curIds.add(c.id);
        entryPrevIdsRef.current = curIds;
        entryPrevFilterSigRef.current = chatFilterSignature;
        entryPrevLimitRef.current = visibleChatLimit;
    }, [visibleCandidates, chatFilterSignature, visibleChatLimit]);

    // Throttle: al empujar contra el fondo, Virtuoso dispara endReached en ráfaga. Sin freno,
    // crecía visibleChatLimit sin parar (la lista se inflaba de golpe → parpadeo/inestabilidad
    // al final). Limitamos a un avance cada 250ms: sigue cargando al scrollear, pero pausado.
    const endReachedCooldownRef = useRef(0);
    const handleChatListEndReached = useCallback(() => {
        const now = Date.now();
        if (now - endReachedCooldownRef.current < 250) return;
        endReachedCooldownRef.current = now;
        if (visibleChatLimit < filteredCandidates.length) {
            setVisibleChatLimit(current => Math.min(current + CHAT_LIST_PAGE_SIZE, filteredCandidates.length));
            return;
        }
        loadMore();
    }, [filteredCandidates.length, loadMore, visibleChatLimit]);

    // ── Badge counts (MEMOIZED — only recalculated when candidates change) ──
    const baseCandidates = useMemo(() => (candidates || []).filter(c => passesChatRBACFilter(c, user)
    ), [candidates, user]);

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

    const filterOptions = useMemo(() => {
        if (globalFilterCounts) {
            const toCountedOptionsFromObject = (counts = {}, numeric = false) => {
                const values = Object.keys(counts || {}).filter(Boolean).sort((a, b) => {
                    if (numeric) {
                        const numA = parseInt(a, 10);
                        const numB = parseInt(b, 10);
                        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                    }
                    return a.localeCompare(b);
                });
                return values.map(value => ({ value, label: value, count: Number(counts[value]) || 0 }));
            };

            return {
                ages: toCountedOptionsFromObject(globalFilterCounts.ages, true),
                genders: toCountedOptionsFromObject(globalFilterCounts.genders),
                municipalities: toCountedOptionsFromObject(globalFilterCounts.municipalities)
            };
        }

        const ages = new Map();
        const genders = new Map();
        const municipalities = new Map();
        const increment = (map, rawValue) => {
            const value = String(rawValue || '').trim();
            if (!value) return;
            map.set(value, (map.get(value) || 0) + 1);
        };
        const matchesFilters = (c, omit = null) => {
            if (!passesChatRBACFilter(c, user)) return false;

            if (user?.role !== 'SuperAdmin' &&
                rolePermissions && Object.keys(rolePermissions).length > 0 &&
                rolePermissions.view_incomplete_candidates !== true &&
                !isProfileComplete(c)) return false;

            if (user?.role === 'Viewer' && c?.platform !== 'messenger') return false;

            if (!canSeeFilter('filter_todos') && activeFilter === 'all') {
                const hasAnyTag = Array.isArray(c?.tags) && c.tags.length > 0;
                const isRecent = c?.primerContacto && (Date.now() - new Date(c.primerContacto).getTime()) < 86400000;
                if (!hasAnyTag && !isRecent) return false;
            }

            if (activeFilter === 'unread' && !checkIfUnread(c)) return false;

            if (selectedTagValues.length > 0) {
                const tagNames = Array.isArray(c?.tags)
                    ? c.tags.map(t => (typeof t === 'string' ? t : (t?.name || '')).trim()).filter(Boolean)
                    : [];
                const normalizedNames = tagNames.map(n => n.toLowerCase());
                const matchesSelectedTag = selectedTagValues.some(tagValue => {
                    if (tagValue === UNTAGGED_TAG_FILTER) return tagNames.length === 0;
                    return normalizedNames.includes(tagValue.trim().toLowerCase());
                });
                if (!matchesSelectedTag) return false;
            }

            if (activeFilter === 'profile') {
                const isComplete = isProfileComplete(c);
                if (filterValue === 'complete' && !isComplete) return false;
                if (filterValue === 'incomplete' && isComplete) return false;
                if (profileUnreadOnly && !checkIfUnread(c)) return false;
            }

            if (omit !== 'age' && selectedAges.length > 0 && (!c.edad || !selectedAges.includes(String(c.edad).trim()))) return false;
            if (omit !== 'gender' && selectedGenders.length > 0 && (!c.genero || !selectedGenders.includes(String(c.genero).trim()))) return false;
            if (omit !== 'municipality' && selectedMunicipalities.length > 0 && (!c.municipio || !selectedMunicipalities.includes(String(c.municipio).trim()))) return false;

            if (manualPipelineFilter && c?.manualProjectId !== manualPipelineFilter) return false;
            if (manualStepFilter && c?.manualProjectStepId !== manualStepFilter) return false;

            return true;
        };

        (baseCandidates || []).forEach(c => {
            if (matchesFilters(c, 'age')) increment(ages, c.edad);
            if (matchesFilters(c, 'gender')) increment(genders, c.genero);
            if (matchesFilters(c, 'municipality')) increment(municipalities, c.municipio);
        });

        // Numeric sort for ages
        const sortedAges = Array.from(ages.keys()).filter(Boolean).sort((a, b) => {
            const numA = parseInt(a, 10);
            const numB = parseInt(b, 10);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
        });
        const toCountedOptions = (values, counts) => values.map(value => ({ value, label: value, count: counts.get(value) || 0 }));

        return {
            ages: toCountedOptions(sortedAges, ages),
            genders: toCountedOptions(Array.from(genders.keys()).filter(Boolean).sort(), genders),
            municipalities: toCountedOptions(Array.from(municipalities.keys()).filter(Boolean).sort(), municipalities)
        };
    }, [
        globalFilterCounts,
        baseCandidates, user, rolePermissions,
        activeFilter, filterValue, profileUnreadOnly,
        selectedTagValues,
        selectedAges, selectedGenders, selectedMunicipalities,
        manualPipelineFilter, manualStepFilter
    ]);

    const manualFilterCounts = useMemo(() => {
        if (globalFilterCounts?.projects) {
            return {
                projectCounts: globalFilterCounts.projects || {},
                stepCounts: manualPipelineFilter
                    ? (globalFilterCounts.stepsByProject?.[manualPipelineFilter] || {})
                    : {}
            };
        }

        const projectCounts = {};
        const stepCounts = {};
        const matchesNonManualFilters = (c) => {
            if (!passesChatRBACFilter(c, user)) return false;

            if (user?.role !== 'SuperAdmin' &&
                rolePermissions && Object.keys(rolePermissions).length > 0 &&
                rolePermissions.view_incomplete_candidates !== true &&
                !isProfileComplete(c)) return false;

            if (user?.role === 'Viewer' && c?.platform !== 'messenger') return false;

            if (!canSeeFilter('filter_todos') && activeFilter === 'all') {
                const hasAnyTag = Array.isArray(c?.tags) && c.tags.length > 0;
                const isRecent = c?.primerContacto && (Date.now() - new Date(c.primerContacto).getTime()) < 86400000;
                if (!hasAnyTag && !isRecent) return false;
            }

            if (activeFilter === 'unread' && !checkIfUnread(c)) return false;

            if (selectedTagValues.length > 0) {
                const tagNames = Array.isArray(c?.tags)
                    ? c.tags.map(t => (typeof t === 'string' ? t : (t?.name || '')).trim()).filter(Boolean)
                    : [];
                const normalizedNames = tagNames.map(n => n.toLowerCase());
                const matchesSelectedTag = selectedTagValues.some(tagValue => {
                    if (tagValue === UNTAGGED_TAG_FILTER) return tagNames.length === 0;
                    return normalizedNames.includes(tagValue.trim().toLowerCase());
                });
                if (!matchesSelectedTag) return false;
            }

            if (activeFilter === 'profile') {
                const isComplete = isProfileComplete(c);
                if (filterValue === 'complete' && !isComplete) return false;
                if (filterValue === 'incomplete' && isComplete) return false;
                if (profileUnreadOnly && !checkIfUnread(c)) return false;
            }

            if (selectedAges.length > 0 && (!c.edad || !selectedAges.includes(String(c.edad).trim()))) return false;
            if (selectedGenders.length > 0 && (!c.genero || !selectedGenders.includes(String(c.genero).trim()))) return false;
            if (selectedMunicipalities.length > 0 && (!c.municipio || !selectedMunicipalities.includes(String(c.municipio).trim()))) return false;

            return true;
        };

        (baseCandidates || []).forEach(c => {
            if (!matchesNonManualFilters(c)) return;
            if (c?.manualProjectId) {
                projectCounts[c.manualProjectId] = (projectCounts[c.manualProjectId] || 0) + 1;
            }
            if (manualPipelineFilter && c?.manualProjectId === manualPipelineFilter && c?.manualProjectStepId) {
                stepCounts[c.manualProjectStepId] = (stepCounts[c.manualProjectStepId] || 0) + 1;
            }
        });

        return { projectCounts, stepCounts };
    }, [
        globalFilterCounts,
        baseCandidates, user, rolePermissions,
        activeFilter, filterValue, profileUnreadOnly,
        selectedTagValues,
        selectedAges, selectedGenders, selectedMunicipalities,
        manualPipelineFilter
    ]);

    const unreadCounts = useMemo(() => {
        const counts = { tags: {}, crmProjects: {}, complete: 0, incomplete: 0, all: 0, untagged: 0, completeUntagged: 0, incompleteUntagged: 0, unreadIds: new Set() };
        const canSeeIncomplete = canSeeIncompleteChats(user, rolePermissions);

        for (const c of baseCandidates) {
            const profComplete = isProfileComplete(c);
            // No contar no leídos de incompletos si el rol no tiene permiso de verlos
            if (!profComplete && !canSeeIncomplete) continue;

            const isUnread = checkIfUnread(c);

            if (isUnread) {
                counts.all++;
                counts.unreadIds.add(c.id);
                if (profComplete) {
                    counts.complete++;
                } else {
                    counts.incomplete++;
                }

                const candidateTags = Array.isArray(c.tags)
                    ? c.tags
                        .map(t => typeof t === 'string' ? t : t.name)
                        .map(t => t?.trim().toLowerCase())
                        .filter(Boolean)
                    : [];
                if (candidateTags.length === 0) {
                    counts.untagged++;
                    if (profComplete) counts.completeUntagged++;
                    else counts.incompleteUntagged++;
                } else {
                    candidateTags.forEach(normalized => {
                        counts.tags[normalized] = (counts.tags[normalized] || 0) + 1;
                    });
                }

                if (c.manualProjectId) {
                    counts.crmProjects[c.manualProjectId] = (counts.crmProjects[c.manualProjectId] || 0) + 1;
                }
            }
        }
        return counts;
    }, [baseCandidates, user, rolePermissions]);

    const refreshGlobalUnreadCounts = useCallback(async () => {
        const res = await fetch('/api/chat-unread-count');
        const data = await res.json();
        if (!res.ok || !data.success) return null;
        const counts = data.counts || {};
        const nextCounts = {
            all: Number(data.unreadCount ?? counts.all) || 0,
            complete: Number(counts.complete) || 0,
            incomplete: Number(counts.incomplete) || 0,
            untagged: Number(counts.untagged) || 0,
            completeUntagged: Number(counts.completeUntagged) || 0,
            incompleteUntagged: Number(counts.incompleteUntagged) || 0,
            tags: counts.tags || {},
            completeTags: counts.completeTags || {},
            incompleteTags: counts.incompleteTags || {},
            crmProjects: counts.crmProjects || {},
            unreadIds: new Set(),
        };
        setGlobalUnreadCounts(nextCounts);
        try {
            const { unreadIds, ...serializable } = nextCounts;
            sessionStorage.setItem('candidatic_unread_counts', JSON.stringify(serializable));
        } catch {}
        return nextCounts;
    }, []);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                if (cancelled) return;
                await refreshGlobalUnreadCounts();
            } catch {}
        }, 150);

        return () => { cancelled = true; clearTimeout(timer); };
    }, [
        user,
        rolePermissions,
        sseNewCandidate?.id,
        sseUpdatedCandidate?.candidateId,
        sseUpdatedCandidate?.timestamp,
        sseUpdatedCandidate?.updates?.lastUserMessageAt,
        sseUpdatedCandidate?.updates?.lastHumanMessageAt,
        sseUpdatedCandidate?.updates?.unreadMsgCount,
        sseDeletedCandidate?.candidateId,
        sseDeletedCandidate?.id,
        globalStats?.unread,
        refreshGlobalUnreadCounts,
    ]);

    const displayUnreadCounts = globalUnreadCounts || (
        globalStats?.unread != null
            ? { ...EMPTY_UNREAD_COUNTS, all: Number(globalStats.unread) || 0 }
            : unreadCounts
    );

    const getActiveProfileScope = useCallback(() => {
        if (activeFilter !== 'profile') return 'all';
        if (filterValue === 'complete') return 'complete';
        if (filterValue === 'incomplete') return 'incomplete';
        return 'all';
    }, [activeFilter, filterValue]);

    const handleMarkTagAsRead = useCallback(async ({ scope = 'tag', tagName = null, label = 'esta etiqueta', unreadCount = 0, profileScope = 'all' }, e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (!unreadCount) return;

        const confirmed = await new Promise(resolve => setConfirmModal({
            title: 'Marcar como leído',
            message: `Se marcarán como leídos ${unreadCount} chat${unreadCount === 1 ? '' : 's'} de ${label}. Las burbujas verdes de este filtro se quitarán.`,
            confirmText: 'Marcar leído',
            variant: 'success',
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false)
        }));
        if (!confirmed) return;

        try {
            const res = await fetch('/api/chat', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'mark_read_by_tag',
                    tagScope: scope,
                    tagName,
                    profileScope
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'No se pudo marcar como leído');
            }

            const now = new Date().toISOString();
            (data.candidateIds || []).forEach(id => {
                applyCandidateUnreadPatch(id, {
                    unreadMsgCount: 0,
                    lastBotMessageAt: now,
                    ultimoMensajeBot: now,
                    lastHumanMessageAt: now,
                });
            });
            await refreshGlobalUnreadCounts();
            showToast && showToast(`${data.marked || 0} chat${(data.marked || 0) === 1 ? '' : 's'} marcados como leídos`, 'success');
        } catch (err) {
            console.error('Error marking tag as read', err);
            showToast && showToast('No se pudieron marcar como leídos', 'error');
            refreshGlobalUnreadCounts().catch(() => {});
        }
    }, [applyCandidateUnreadPatch, refreshGlobalUnreadCounts, showToast]);

    const renderTagUnreadControls = useCallback(({ scope, tagName = null, label, unreadCount }) => {
        if (!unreadCount || unreadCount <= 0) return null;
        if (scope === 'all') {
            return (
                <div className="flex items-center gap-1.5 shrink-0">
                    <div className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center shrink-0 text-white text-[10px] font-bold shadow-sm">
                        {unreadCount}
                    </div>
                </div>
            );
        }
        const profileScope = getActiveProfileScope();
        return (
            <div className="flex items-center gap-1.5 shrink-0">
                <button
                    type="button"
                    onClick={(e) => handleMarkTagAsRead({ scope, tagName, label, unreadCount, profileScope }, e)}
                    className="h-5 px-1.5 rounded-full border border-emerald-100 dark:border-emerald-900/50 bg-white/70 dark:bg-[#202c33]/70 text-emerald-600/80 dark:text-emerald-400/80 hover:border-emerald-200 dark:hover:border-emerald-800 hover:bg-emerald-50/60 dark:hover:bg-emerald-900/10 text-[9px] font-semibold flex items-center transition-colors"
                    title={`Marcar todo como leído: ${label}`}
                >
                    <span className="hidden sm:inline">Marcar todo leído</span>
                </button>
                <div className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center shrink-0 text-white text-[10px] font-bold shadow-sm">
                    {unreadCount}
                </div>
            </div>
        );
    }, [getActiveProfileScope, handleMarkTagAsRead]);

    // Reportar al padre solo el conteo global exacto. El fallback local depende de la
    // pagina cargada en Chat Web y puede ser parcial (por ejemplo 10 chats visibles).
    useEffect(() => {
        if (loadingChats) return;
        if (!globalUnreadCounts) return;
        onUnreadCountChange?.(globalUnreadCounts.all);
    }, [globalUnreadCounts?.all, loadingChats, onUnreadCountChange]);

    // 🏎️ Online readers por chat — evita recalcular dentro de cada ChatRow
    const EMPTY_READERS = [];
    const tagColorMap = useMemo(() => {
        const map = new Map();
        availableTags.forEach(t => {
            if (typeof t === 'object' && t.name) map.set(t.name, t.color || '#64748b');
        });
        return map;
    }, [availableTags]);

    const onlineReadersByChat = useMemo(() => {
        const map = new Map();
        for (const u of onlineUsers) {
            if (!u.currentChatId) continue;
            if (!map.has(u.currentChatId)) map.set(u.currentChatId, []);
            map.get(u.currentChatId).push(u);
        }
        return map;
    }, [onlineUsers]);

    // Scroll to bottom — covers initial load, chat switches, and new messages.
    const prevMessagesLength = useRef(0);
    const prevChatId = useRef(null);
    useLayoutEffect(() => {
        const chatSwitched = selectedChat?.id !== prevChatId.current;
        if (chatSwitched) {
            prevChatId.current = selectedChat?.id;
            prevMessagesLength.current = messages.length;
            setUnseenCount(0);
            scrollToBottom();
            return;
        }
        if (messages.length > prevMessagesLength.current) {
            if (isAtBottomRef.current || isSendingRef.current) {
                scrollToBottom();
            } else {
                // Count only real incoming messages (not our own optimistic ones)
                const newMsgs = messages.slice(prevMessagesLength.current);
                const incoming = newMsgs.filter(m => m.from !== 'me' && m.from !== 'bot' && !String(m.id).startsWith('temp'));
                if (incoming.length > 0) setUnseenCount(prev => prev + incoming.length);
            }
        }
        prevMessagesLength.current = messages.length;
    }, [messages, selectedChat?.id]);

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
        const activeChatId = pendingChatIdRef.current ?? currentChat?.id;
        if (String(sseUpdate.candidateId) === String(activeChatId) || (currentChat?.whatsapp && String(sseUpdate.phoneMatch) === String(currentChat.whatsapp))) {
            if (sseUpdate.updates?.markAllSentAsRead) {
                setMessages(prev => prev.map(m =>
                    (m.from === 'me' || m.from === 'bot') && m.ultraMsgId && (m.status === 'sent' || m.status === 'delivered')
                        ? { ...m, status: 'read' }
                        : m
                ));
            } else if (sseUpdate.updates?.messageStatusUpdate) {
                const { id, status, additionalData } = sseUpdate.updates.messageStatusUpdate;
                const STATUS_RANK = { failed: -1, queued: 0, pending: 0, sent: 1, delivered: 2, read: 3, seen: 3 };
                setMessages(prev => {
                    const idx = prev.findIndex(m => m.ultraMsgId === id || m.id === id);
                    if (idx !== -1) {
                        const cur = prev[idx].status;
                        if ((STATUS_RANK[status] ?? 0) <= (STATUS_RANK[cur] ?? 0) && status !== 'failed') return prev;
                        const newArr = [...prev];
                        newArr[idx] = { ...newArr[idx], status, ...additionalData };
                        return newArr;
                    }
                    return prev;
                });
            } else if (sseUpdate.updates?.reactionUpdate) {
                const { id, reactions } = sseUpdate.updates.reactionUpdate;
                setMessages(prev => {
                    const idx = prev.findIndex(m => m.ultraMsgId === id || m.id === id);
                    if (idx === -1) return prev;
                    const newArr = [...prev];
                    newArr[idx] = { ...newArr[idx], reactions };
                    return newArr;
                });
            } else if (sseUpdate.updates?.newMessage) {
                if (sseUpdate.updates?.messagePayload) {
                    // Si el candidato mandó este mensaje mientras tenemos su chat abierto → read receipt inmediato
                    const incomingMsg = sseUpdate.updates.messagePayload;
                    if (incomingMsg.from === 'user' && currentChat?.id) {
                        const incomingMessageId = incomingMsg.id || incomingMsg.ultraMsgId;
                        fetch('/api/chat', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'send_read_receipt', candidateId: currentChat.id, messageId: incomingMessageId })
                        }).catch(() => {});
                    }
                    // 🚀 O(1) Instant Message Injection (Meta Standard)
                    // Functional update chains correctly even when React batches
                    setMessages(prev => {
                        const newMsg = sseUpdate.updates.messagePayload;
                        // Prevent duplicates
                        if (prev.some(m => String(m.id) === String(newMsg.id) || (m.ultraMsgId && String(m.ultraMsgId) === String(newMsg.ultraMsgId)))) {
                            return prev;
                        }
                        // Smart deduplication: swap optimistic temp message
                        if (newMsg.from === 'me') {
                            const pendingIndex = prev.findIndex(m => String(m.id).startsWith('temp') && areSameOutgoingMessage(m, newMsg));
                            if (pendingIndex !== -1) {
                                const newArr = mergeOutgoingMessage(prev, newMsg, prev[pendingIndex].id);
                                scrollToBottom();
                                return newArr;
                            }
                            if (prev.some(m => areSameOutgoingMessage(m, newMsg))) return prev;
                        }

                        scrollToBottom();
                        return [...prev, withMessageEntryAnimation(newMsg)];
                    });
                } else {
                    // Fallback: SSE hook didn't send payload — do a surgical merge
                    // instead of full array replace (prevents flickering)
                    const chatId = selectedChatRef.current?.id;
                    if (chatId) {
                        fetch(`/api/chat?candidateId=${chatId}`)
                            .then(r => r.json())
                            .then(data => {
                                if (data.success && selectedChatRef.current?.id === chatId) {
                                    const freshMsgs = data.messages || [];
                                    setMessages(prev => {
                                        // Only update if there are genuinely new messages
                                        if (freshMsgs.length === prev.length) return prev;
                                        // Append only messages not already in the array
                                        const existingIds = new Set(prev.map(m => m.id).filter(Boolean));
                                        const newOnes = freshMsgs.filter(m => m.id && !existingIds.has(m.id));
                                        if (newOnes.length === 0) return prev;
                                        return [...prev, ...newOnes];
                                    });
                                }
                            })
                            .catch(() => {});
                    }
                }
            }
        } else if (sseUpdate.updates?.newMessage && sseUpdate.updates?.messagePayload
            && messagesByChatRef.current.has(sseUpdate.candidateId)) {
            // Chat NO activo pero ya visitado en esta sesión: anexar el mensaje a su
            // caché por-chat. Antes se descartaba y al reabrir ese chat se veía el
            // caché viejo (sin los mensajes nuevos) hasta que respondía loadMessages.
            const cachedMsg = sseUpdate.updates.messagePayload;
            const cachedChatId = sseUpdate.candidateId;
            const prevCached = messagesByChatRef.current.get(cachedChatId) || [];
            const alreadyCached = prevCached.some(m => String(m.id) === String(cachedMsg.id)
                || (m.ultraMsgId && cachedMsg.ultraMsgId && String(m.ultraMsgId) === String(cachedMsg.ultraMsgId)));
            if (!alreadyCached) {
                messagesByChatRef.current.set(cachedChatId, isOutgoingAuthor(cachedMsg)
                    ? mergeOutgoingMessage(prevCached, cachedMsg) // dedup contra optimistas/eco de otros reclutadores
                    : [...prevCached, withClientMessageKey(cachedMsg)]);
            }
        }

        // --- SURGICAL CANDIDATE PATCH (replaces loadCandidates) ---
        if (sseUpdate.candidateId && sseUpdate.updates && !sseUpdate.updates?.recruiterTyping) {
            const patch = sseUpdate.updates;
            const candidatePatch = extractPersistentCandidatePatch(patch);
            const isInList = candidatesRef.current.some(c => c.id === sseUpdate.candidateId);

            if (isInList) {
                setCandidates(prev => {
                    const mapped = prev.map(c => {
                        if (c.id !== sseUpdate.candidateId) return c;
                        const updated = { ...c, ...candidatePatch };
                        if (patch.ultimoMensaje) updated.ultimoMensaje = patch.ultimoMensaje;
                        if (patch.lastUserMessageAt) {
                            updated.lastUserMessageAt = patch.lastUserMessageAt;
                            if (patch.unreadMsgCount === undefined) {
                                updated.unreadMsgCount = (c.unreadMsgCount || 0) + 1;
                            }
                        }
                        if (patch.lastBotMessageAt) {
                            updated.lastBotMessageAt = patch.lastBotMessageAt;
                            updated.ultimoMensajeBot = patch.lastBotMessageAt;
                        }
                        if (patch.unreadMsgCount !== undefined) updated.unreadMsgCount = patch.unreadMsgCount;
                        // lastHumanMessageAt drives checkIfUnread — must stay in sync with Redis
                        if (patch.lastHumanMessageAt !== undefined) updated.lastHumanMessageAt = patch.lastHumanMessageAt;
                        return updated;
                    });
                    // ⚠️ Bubble-up manual ELIMINADO: antes se movía el candidato al
                    // índice 0 del array base aquí mismo. Pero filteredCandidates ya
                    // aplica un .sort() cronológico sobre ese array, así que el
                    // reordenamiento ocurría DOS VECES en rápida sucesión (una aquí y
                    // otra en el sort) → dos renders → brinco visible en la lista.
                    // El sort de filteredCandidates lo maneja solo con el ultimoMensaje
                    // actualizado; no es necesario preordenar el array base.
                    return mapped;
                });
            } else if (patch.lastUserMessageAt || patch.ultimoMensaje) {
                // Candidate not in the loaded 300 — fetch and inject at top (bubble-up)
                getCandidateById(sseUpdate.candidateId)
                    .then(res => {
                        if (res.success && res.candidate) {
                            if (recentlyDeletedRef.current.has(res.candidate.id)) return;
                            setCandidates(prev => {
                                if (prev.some(c => c.id === res.candidate.id)) return prev;
                                return [res.candidate, ...prev];
                            });
                        }
                    })
                    .catch(() => {});
            }

            // Also update selectedChat if it's the one that changed
            if (currentChat?.id === sseUpdate.candidateId) {
                setSelectedChat(prev => {
                    if (!prev || prev.id !== sseUpdate.candidateId) return prev;
                    const updated = { ...prev, ...candidatePatch };
                    if (patch.ultimoMensaje) updated.ultimoMensaje = patch.ultimoMensaje;
                    if (patch.lastBotMessageAt) {
                        updated.lastBotMessageAt = patch.lastBotMessageAt;
                        updated.ultimoMensajeBot = patch.lastBotMessageAt;
                    }
                    if (patch.lastUserMessageAt) {
                        updated.lastUserMessageAt = patch.lastUserMessageAt;
                        if (patch.unreadMsgCount === undefined) {
                            updated.unreadMsgCount = (prev.unreadMsgCount || 0) + 1;
                        }
                    }
                    if (patch.unreadMsgCount !== undefined) updated.unreadMsgCount = patch.unreadMsgCount;
                    if (patch.lastHumanMessageAt !== undefined) updated.lastHumanMessageAt = patch.lastHumanMessageAt;
                    return updated;
                });
            }
        }
    });

    // 🆕 SSE: New candidate arrived → inject directly (zero re-fetch)
    useEffect(() => {
        if (!sseNewCandidate) return;
        // ✅ META AUDIT: Ghost guard — don't re-insert recently deleted candidates
        if (recentlyDeletedRef.current.has(sseNewCandidate.id)) return;
        setCandidates(prev => {
            if (prev.some(c => c.id === sseNewCandidate.id)) return prev; // already exists
            // _newCardAt: sello de tiempo para animar la ENTRADA de la tarjeta (fade+slide).
            // ChatRow solo anima si es reciente (<2.5s) y no se animó antes → no anima al
            // hacer scroll ni en la carga inicial. Ver ChatRow.jsx.
            return [{ ...sseNewCandidate, _newCardAt: Date.now() }, ...prev];
        });
    }, [sseNewCandidate]);

    useEffect(() => {
        const pruneExpiredLocks = () => {
            const now = Date.now();
            setChatLocks(prev => {
                let changed = false;
                const next = {};
                for (const [candidateId, lock] of Object.entries(prev || {})) {
                    if (lock?.expiresAt && Number(lock.expiresAt) < now) {
                        changed = true;
                        continue;
                    }
                    next[candidateId] = lock;
                }
                return changed ? next : prev;
            });
        };

        const handleLockEvent = (event) => {
            const update = event.detail || {};
            if (!update.candidateId) return;

            setChatLocks(prev => {
                const next = { ...(prev || {}) };
                if (update.action === 'unlock') {
                    delete next[update.candidateId];
                } else if (update.lock) {
                    next[update.candidateId] = update.lock;
                }
                return next;
            });
        };

        window.addEventListener('sse:chat:lock', handleLockEvent);
        const pruneInterval = setInterval(pruneExpiredLocks, 10000);
        return () => {
            window.removeEventListener('sse:chat:lock', handleLockEvent);
            clearInterval(pruneInterval);
        };
    }, []);

    useEffect(() => {
        const handleNavigate = (e) => {
            const targetId = e.detail?.candidateId;
            if (!targetId) return;
            const target = candidates.find(c => String(c.id) === String(targetId));
            if (target) {
                bottomAnchorRef.current = true;
                setSelectedChat(target);
                setMessages(messagesByChatRef.current.get(target.id) || []);
            }
        };
        window.addEventListener('navigate_to_recruiter_chat', handleNavigate);
        return () => window.removeEventListener('navigate_to_recruiter_chat', handleNavigate);
    }, [candidates]);

    useEffect(() => {
        const deletedId = sseDeletedCandidate?.candidateId || sseDeletedCandidate?.id;
        if (!deletedId) return;

        setCandidates(prev => prev.filter(c => c.id !== deletedId));
        if (selectedChatRef.current?.id === deletedId) {
            setSelectedChat(null);
            setMessages([]);
        }
    }, [sseDeletedCandidate]);

    // 🔄 SSE reconnect: Vercel corta la conexión cada 60s (maxDuration).
    // NO hacemos loadCandidates() aquí — con filtro de etiqueta activo eso escanea
    // los 6,259 candidatos en Redis (9.4 MB) cada 60s = ~13 GB/día de bandwidth.
    // El pub/sub ya maneja actualizaciones en tiempo real; no se necesita reload completo.
    useEffect(() => {
        if (!sseConnected) return;
        if (!sseWasConnectedOnceRef.current) {
            sseWasConnectedOnceRef.current = true;
            return;
        }
        // El pub/sub SSE maneja actualizaciones quirúrgicas en tiempo real — no necesitamos
        // recargar todo el set en cada reconexión (Vercel corta cada ~60s). Un reload aquí
        // cambia el tamaño/orden del set en memoria y hace que los badges fluctúen.
    }, [sseConnected]);

    // Reset typing when switching chats
    useEffect(() => {
        setCandidateTyping(false);
    }, [selectedChat?.id]);

    // Load messages
    useEffect(() => {
        if (!selectedChat) return;
        const chatId = selectedChat.id;
        const currentUser = user?.name || 'Reclutador';

        loadMessages();
        // 🚀 POLLING REMOVED: Trust the SSE `messagePayload` for real-time injection.

        // 🔵 Send blue ticks silently to the candidate's WhatsApp 
        // (Does NOT modify the database unread state or clear the green badge)
        const sendBlueTicks = async () => {
            try {
                await fetch('/api/chat', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'send_read_receipt', candidateId: chatId })
                });
            } catch {
                // Best-effort read receipt only.
            }
        };
        sendBlueTicks();

        // 🔒 Lock this chat only while a human is actively working it.
        let stopped = false;
        let locked = false;
        let lockInFlight = false;
        let lastHumanActivityAt = Date.now();

        const lockChat = async () => {
            if (stopped || locked || lockInFlight) return;
            lockInFlight = true;
            try {
                const res = await fetch('/api/chat', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'lock', candidateId: chatId, userName: currentUser })
                });
                if (res.ok) {
                    if (stopped) {
                        fetch('/api/chat', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'unlock', candidateId: chatId })
                        }).catch(() => {});
                    } else {
                        locked = true;
                    }
                }
            } catch {
                // Lock heartbeat is best effort.
            }
            finally {
                lockInFlight = false;
            }
        };
        const unlockChat = async () => {
            if (stopped || !locked) return;
            locked = false;
            try {
                await fetch('/api/chat', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'unlock', candidateId: chatId })
                });
            } catch {
                // Unlock is best effort; Redis TTL will also expire the lock.
            }
        };
        const isHumanActive = () => !document.hidden && (Date.now() - lastHumanActivityAt) <= CHAT_LOCK_IDLE_MS;
        const markHumanActivity = () => {
            if (document.hidden) return;
            lastHumanActivityAt = Date.now();
            lockChat();
        };
        const handleVisibilityChange = () => {
            if (document.hidden) {
                unlockChat();
            } else {
                markHumanActivity();
            }
        };
        const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
        activityEvents.forEach(eventName => window.addEventListener(eventName, markHumanActivity, { passive: true }));
        document.addEventListener('visibilitychange', handleVisibilityChange);

        lockChat();

        const heartbeatInterval = setInterval(async () => {
            if (!isHumanActive()) {
                await unlockChat();
                return;
            }
            if (!locked) {
                await lockChat();
                return;
            }
            try {
                await fetch('/api/chat', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'heartbeat', candidateId: chatId, userName: currentUser })
                });
                locked = true;
            } catch {
                locked = false;
                // Heartbeat is best effort; Redis TTL will expire the lock.
            }
        }, CHAT_LOCK_HEARTBEAT_MS);

        // Optimistic UI updates

        return () => {
            stopped = true;
            clearInterval(heartbeatInterval);
            activityEvents.forEach(eventName => window.removeEventListener(eventName, markHumanActivity));
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            // Unlock on deselect
            fetch('/api/chat', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'unlock', candidateId: chatId })
            }).catch(() => {});
        };
    }, [selectedChat?.id, user?.name]);

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

    // Chats con un envío de media en curso: loadMessages se mutea SOLO para esos chats,
    // para no pisar sus mensajes optimistas. Si fuera una bandera global (como antes),
    // cambiar de chat a mitad de un envío dejaría el chat recién abierto en blanco.
    // Map chatId → contador: con el outbox puede haber varios grupos encolados al mismo chat.
    const sendingMediaChatIdsRef = useRef(new Map());
    const addSendingMedia = (chatId) => {
        const map = sendingMediaChatIdsRef.current;
        map.set(chatId, (map.get(chatId) || 0) + 1);
    };
    const removeSendingMedia = (chatId) => {
        const map = sendingMediaChatIdsRef.current;
        const remaining = (map.get(chatId) || 0) - 1;
        if (remaining > 0) map.set(chatId, remaining); else map.delete(chatId);
    };
    const loadMessagesAbortRef = useRef(null);

    const loadMessages = async () => {
        const chatId = selectedChatRef.current?.id;
        if (!chatId) return;
        if (sendingMediaChatIdsRef.current.has(chatId)) return;

        // Cancel any in-flight load from a previous chat switch
        if (loadMessagesAbortRef.current) loadMessagesAbortRef.current.abort();
        loadMessagesAbortRef.current = new AbortController();
        const { signal } = loadMessagesAbortRef.current;

        try {
            const res = await fetch(`/api/chat?candidateId=${chatId}`, { signal });
            const data = await res.json();
            if (data.success && !sendingMediaChatIdsRef.current.has(chatId) && selectedChatRef.current?.id === chatId) {
                bottomAnchorRef.current = true;
                setMessages(prev => {
                    const merged = mergeMessageList(prev, data.messages || []);
                    messagesByChatRef.current.set(chatId, merged);
                    return merged;
                });
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('Failed to load chat', e);
        }
    };

    const [blockLoading, setBlockLoading] = useState(false);

    const autoSilenceBot = async (candidate) => {
        if (!candidate || candidate.blocked) return;
        try {
            const result = await blockCandidate(candidate.id, true);
            if (result.success) {
                const nextCandidate = result.candidate || { ...candidate, blocked: true };
                setCandidates(prev => prev.map(c =>
                    c.id === candidate.id ? { ...c, ...nextCandidate, blocked: true } : c
                ));
                // Only update selectedChat if it's currently selected (though it should be)
                setSelectedChat(prev => prev?.id === candidate.id ? { ...prev, ...nextCandidate, blocked: true } : prev);
                showToast && showToast('IA silenciada automáticamente (intervención humana)', 'success');
            }
        } catch (e) {
            console.error('Failed to auto-silence bot', e);
        }
    };

    const handleBlockToggle = useCallback(async (chatToBlock, e) => {
        if (e) e.stopPropagation();
        if (!chatToBlock) return;
        // Usa el estado efectivo: si el silencio ya expiro, el toggle se ve "IA Dinamica"
        // y este click debe SILENCIAR de nuevo (no "reactivar").
        const isCurrentlyBlocked = isIaSilenced(chatToBlock);
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
                const nextCandidate = result.candidate || { ...chatToBlock, blocked: !isCurrentlyBlocked };

                // Actualizar estado local
                setCandidates(prev => prev.map(c =>
                    c.id === chatToBlock.id ? { ...c, ...nextCandidate, blocked: !isCurrentlyBlocked } : c
                ));
                if (selectedChat?.id === chatToBlock.id) {
                    setSelectedChat(prev => ({ ...prev, ...nextCandidate, blocked: !isCurrentlyBlocked }));
                }
            } else {
                showToast && showToast(`Error al ${isCurrentlyBlocked ? 'reactivar' : 'silenciar'} IA: ${result.error}`, 'error');
            }
        } catch (error) {
            showToast && showToast('Error de red al actualizar estado', 'error');
        } finally {
            setBlockLoading(false);
        }
    }, [showToast, selectedChat]);

    const handleDeleteChat = useCallback(async (chatToDelete, e) => {
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

        // ✅ META AUDIT: Optimistic delete + ghost guard (same pattern as CandidatesSection)
        const { id } = chatToDelete;
        recentlyDeletedRef.current.add(id);
        setTimeout(() => recentlyDeletedRef.current.delete(id), 10000);

        // Instant UI removal
        setCandidates(prev => prev.filter(c => c.id !== id));
        if (selectedChat?.id === id) setSelectedChat(null);

        // Background API call
        try {
            const result = await deleteCandidate(id);
            if (result.success) {
                showToast && showToast('Chat eliminado ✓', 'success');
            } else {
                showToast && showToast(`Error al eliminar: ${result.error}`, 'error');
                loadCandidates(); // Rollback
            }
        } catch (error) {
            showToast && showToast('Error de red al eliminar', 'error');
            loadCandidates(); // Rollback
        }
    }, [showToast, selectedChat]);

    const handleMarkAsRead = useCallback(async (chatToMark, e) => {
        if (e) e.stopPropagation();
        if (!chatToMark) return;

        // Optimistic update: we must trick the logic userTime > botTime by setting botTime to now
        const now = new Date().toISOString();
        applyCandidateUnreadPatch(chatToMark.id, {
            unreadMsgCount: 0,
            lastBotMessageAt: now,
            ultimoMensajeBot: now,
            lastHumanMessageAt: now,
        });

        try {
            await fetch('/api/chat', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'mark_handled', candidateId: chatToMark.id })
            });
        } catch(err) {
            console.error('Error marking as read', err);
        }
    }, [applyCandidateUnreadPatch]);

    const handleMarkAsUnread = useCallback(async (chatToMark, e) => {
        if (e) e.stopPropagation();
        if (!chatToMark) return;

        // Optimistic update: clear lastHumanMessageAt so checkIfUnread returns true
        applyCandidateUnreadPatch(chatToMark.id, { lastHumanMessageAt: null });

        try {
            await fetch('/api/chat', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'mark_unread', candidateId: chatToMark.id })
            });
        } catch(err) {
            console.error('Error marking as unread', err);
        }
    }, [applyCandidateUnreadPatch]);

    const handleSelectChat = useCallback((chat) => {
        pendingChatIdRef.current = chat.id; // guard SSE race before React commits
        // Save draft of current chat before switching
        const currentText = messageInputRef.current?.getText?.();
        const currentId = selectedChatRef.current?.id;
        if (currentId) {
            if (currentText?.trim()) {
                draftsRef.current.set(currentId, currentText);
            } else {
                draftsRef.current.delete(currentId);
            }
        }
        displayMessageCacheRef.current.clear(); // prevent stale cache cross-chat
        setSelectedChat(chat);
        // Sincroniza el ref de inmediato (el effect lo haria hasta post-commit) para que
        // cualquier callback diferido vea el chat correcto sin ventana de carrera.
        selectedChatRef.current = chat;
        setMessages(messagesByChatRef.current.get(chat.id) || []);
        setHeaderImgError(false);
        setPendingQrImages([]); // limpiar imágenes pendientes al cambiar de chat
        // Restore draft for the new chat (or clear). Síncrono: con el setTimeout(80)
        // anterior, un reclutador veloz que tecleaba justo al cambiar de chat veía
        // su texto reemplazado (o borrado) por el draft al dispararse el timer.
        const draft = draftsRef.current.get(chat.id) || '';
        if (messageInputRef.current?.setText) {
            messageInputRef.current.setText(draft);
        } else {
            // El input aún no está montado (no había ningún chat abierto):
            // aplicar al montar, sin pisar lo que ya se haya tecleado.
            setTimeout(() => {
                const typed = messageInputRef.current?.getText?.() || '';
                if (!typed.trim()) messageInputRef.current?.setText?.(draft);
            }, 80);
        }
    }, []);

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !selectedChat) return;

        // Auto-silence bot on manual intervention
        autoSilenceBot(selectedChat);
        const currentCandidateId = selectedChat.id;
        markReplyHandledOptimistically(currentCandidateId);

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
            _localMediaUrl: localUrl,
            type: msgType,
            status: 'queued',
            timestamp: new Date().toISOString(),
            filename: file.name
        };
        isSendingRef.current = true;
        updateChatMessages(currentCandidateId, prev => [...prev, withMessageEntryAnimation(tempMsg, 'outgoing')]);
        setSending(true);
        addSendingMedia(currentCandidateId); // Mute polling during upload (solo este chat)

        try {
            // Comprimir imagenes en el navegador antes de subir (videos/docs/audio van tal cual)
            const uploadFile = isImage ? await compressImage(file) : file;

            // Upload file to local media store first
            const formData = new FormData();
            formData.append('file', uploadFile);
            formData.append('candidateId', currentCandidateId);

            console.log(`📤 [FileUpload] Step 1: Uploading ${uploadFile.name} (${uploadFile.type}, ${Math.round(uploadFile.size/1024)}KB${uploadFile !== file ? `, comprimida de ${Math.round(file.size/1024)}KB` : ''}) as ${msgType}`);

            const uploadRes = await fetch('/api/media/upload', {
                method: 'POST',
                body: formData
            });
            const uploadData = await uploadRes.json();
            
            console.log(`📤 [FileUpload] Step 2: Upload response:`, { ok: uploadRes.ok, status: uploadRes.status, data: uploadData });

            if (!uploadRes.ok) throw new Error(uploadData.error || 'Error subiendo archivo');

            const mediaUrl = uploadData.url || uploadData.mediaUrl;

            // Keep the local preview visible while tracking the final URL for dedupe/send.
            updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === tempId ? { ...m, _serverMediaUrl: mediaUrl } : m));

            // Send via Chat API (single attempt — pre-upload makes retries unnecessary)
            console.log(`📤 [FileUpload] Step 3: Sending via /api/chat with type=${msgType}, mediaUrl=${mediaUrl}`);
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidateId: currentCandidateId,
                    message: '',
                    type: msgType,
                    mediaUrl,
                    senderId: user?.id || user?.whatsapp,
                    senderName: user?.name || user?.nombre,
                })
            });
            const chatData = await res.json();
            console.log(`📤 [FileUpload] Step 4: Chat API response:`, { ok: res.ok, status: res.status, data: chatData });

            if (!res.ok) throw new Error(chatData?.error || 'Error al enviar media');

            // Update optimistic message in-place (no flicker from loadMessages)
            updateChatMessages(currentCandidateId, prev => chatData.message
                ? mergeOutgoingMessage(prev, { ...chatData.message, status: 'sent' }, tempId)
                : prev.map(m => m.id === tempId ? { ...m, status: 'sent' } : m)
            );
            window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: currentCandidateId } }));

        } catch (err) {
            console.error('❌ [FileUpload] FAILED at:', err.message, err);
            showToast && showToast('Error al mandar archivo: ' + err.message, 'error');
            // Mark as failed instead of removing — so the user sees it didn't go through
            updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed', error: err.message } : m));
        } finally {
            setSending(false);
            removeSendingMedia(currentCandidateId);
            setTimeout(() => URL.revokeObjectURL(localUrl), 60000);
        }
    };

    // "Fijar" (copo de nieve) el dropdown de vacantes: cuando está fijado, inyectar/enviar NO
    // lo cierra, para hacerlo repetido sin reabrirlo. Se recuerda en localStorage.
    const [vacancyPinned, setVacancyPinned] = useState(() => {
        try { return localStorage.getItem('vacancyDropdownPinned') === '1'; } catch { return false; }
    });
    const toggleVacancyPinned = () => setVacancyPinned(v => {
        const nv = !v;
        try { localStorage.setItem('vacancyDropdownPinned', nv ? '1' : '0'); } catch { /* ignore */ }
        return nv;
    });

    const injectVacancy = (vac) => {
        if (!vac || !vac.messageDescription) return;
        messageInputRef.current?.injectText(`*${vac.name}*\n\n${vac.messageDescription}`);
        if (!vacancyPinned) setShowDropdown(null); // fijado → se queda abierto
    };

    const sendReactionToApi = async (candidateId, msg, emoji, showToast, setReactionPopupId) => {
        setReactionPopupId(null);
        if (!msg || !emoji) return;

        const replyToId = msg.ultraMsgId || msg.id;
        const targetId = msg.id;

        // Optimistic update — inject emoji immediately without re-fetching
        setMessages(prev => prev.map(m => {
            if (m.id !== targetId && m.ultraMsgId !== targetId) return m;
            const existing = Array.isArray(m.reactions) ? m.reactions : [];
            return { ...m, reactions: [...existing.filter(r => (r.emoji || r) !== emoji), { emoji }] };
        }));

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidateId, message: emoji, type: 'reaction', replyToId })
            });
            const data = await res.json();
            if (!data.success) {
                showToast && showToast('Error al enviar reacción', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast && showToast('Error de red al enviar reacción', 'error');
        }
    };

    const handleSendReaction = useCallback((msg, emoji) => {
        const chatId = selectedChatRef.current?.id;
        if (!chatId) return;
        sendReactionToApi(chatId, msg, emoji, showToast, setReactionPopupId);
    }, [showToast]);

    // Dedup de doble-Enter accidental: bloquea solo el MISMO contenido al MISMO chat
    // en <600ms. Dos mensajes distintos seguidos (reclutador veloz) pasan sin freno —
    // antes había un candado ciego de 1s que se tragaba el segundo envío en silencio.
    const lastSendRef = useRef({ key: '', time: 0 });

    
    const handleSendVCard = (name, phone, company, title, email, url) => {
        if (!name || !phone || !selectedChat) return;
        autoSilenceBot(selectedChat);
        const currentCandidateId = selectedChat.id;
        markReplyHandledOptimistically(currentCandidateId);

        const optimisticId = 'temp-' + Date.now();
        isSendingRef.current = true;
        updateChatMessages(currentCandidateId, prev => [...(prev || []), withMessageEntryAnimation({
            id: optimisticId,
            content: `[Tarjeta de Contacto: ${name}]`,
            tipo: 'contacts',
            from: 'me',
            enviado_por_agente: 1,
            status: 'pending',
            fecha: new Date().toISOString(),
            _clientAnchoredTime: true
        }, 'outgoing')]);

        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                candidateId: currentCandidateId,
                message: name,
                type: 'contacts',
                extraParams: { contactName: name, contactPhone: phone, company, title, email, url },
                senderId: user?.id || user?.whatsapp,
                senderName: user?.name || user?.nombre,
            })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                updateChatMessages(currentCandidateId, prev => mergeOutgoingMessage(prev, data.message, optimisticId));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: currentCandidateId } }));
            } else {
                updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m));
                showToast && showToast(`Error al enviar vCard: ${data.error || 'Desconocido'}`, 'error');
            }
        });
    };

    
    const handleSendLocation = (name, address, lat, lng) => {
        if (!lat || !lng || !selectedChat) return;
        autoSilenceBot(selectedChat);
        const currentCandidateId = selectedChat.id;
        markReplyHandledOptimistically(currentCandidateId);
        const optimisticId = 'temp-' + Date.now();
        isSendingRef.current = true;
        updateChatMessages(currentCandidateId, prev => [...(prev || []), withMessageEntryAnimation({
            id: optimisticId, content: `[Ubicación: ${name || 'Mapa'}]`, tipo: 'location', from: 'me', enviado_por_agente: 1, status: 'pending', fecha: new Date().toISOString(), _clientAnchoredTime: true
        }, 'outgoing')]);
        fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: currentCandidateId, message: '', type: 'location', extraParams: { name, address, lat, lng }, senderId: user?.id || user?.whatsapp, senderName: user?.name || user?.nombre })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                updateChatMessages(currentCandidateId, prev => mergeOutgoingMessage(prev, data.message, optimisticId));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: currentCandidateId } }));
            } else updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m));
        });
    };

    const handleSendList = (bodyTxt, btnText, section, items) => {
        if (!bodyTxt || items.length === 0 || !selectedChat) return;
        autoSilenceBot(selectedChat);
        const currentCandidateId = selectedChat.id;
        markReplyHandledOptimistically(currentCandidateId);
        const optimisticId = 'temp-' + Date.now();
        isSendingRef.current = true;
        updateChatMessages(currentCandidateId, prev => [...(prev || []), withMessageEntryAnimation({
            id: optimisticId, content: `${bodyTxt}\n\n[Lista: ${items.map(i=>i.title).join(', ')}]`, tipo: 'interactive', from: 'me', enviado_por_agente: 1, status: 'pending', fecha: new Date().toISOString(), _clientAnchoredTime: true
        }, 'outgoing')]);
        fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: currentCandidateId, message: bodyTxt, type: 'interactive', extraParams: { interactiveType: 'list', listButtonText: btnText, listSectionTitle: section, listItems: items }, senderId: user?.id || user?.whatsapp, senderName: user?.name || user?.nombre })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                updateChatMessages(currentCandidateId, prev => mergeOutgoingMessage(prev, data.message, optimisticId));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: currentCandidateId } }));
            } else updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m));
        });
    };

    const handleSendProduct = (bodyTxt, catalogId, productSku) => {
        if (!catalogId || !productSku || !selectedChat) return;
        autoSilenceBot(selectedChat);
        const currentCandidateId = selectedChat.id;
        markReplyHandledOptimistically(currentCandidateId);
        const optimisticId = 'temp-' + Date.now();
        isSendingRef.current = true;
        updateChatMessages(currentCandidateId, prev => [...(prev || []), withMessageEntryAnimation({
            id: optimisticId, content: `[Producto del Catálogo: ${productSku}]`, tipo: 'interactive', from: 'me', enviado_por_agente: 1, status: 'pending', fecha: new Date().toISOString(), _clientAnchoredTime: true
        }, 'outgoing')]);
        fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: currentCandidateId, message: bodyTxt, type: 'interactive', extraParams: { interactiveType: 'product', catalogId, productSku }, senderId: user?.id || user?.whatsapp, senderName: user?.name || user?.nombre })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                updateChatMessages(currentCandidateId, prev => mergeOutgoingMessage(prev, data.message, optimisticId));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: currentCandidateId } }));
            } else updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m));
        });
    };

    const handleSendInteractive = (bodyTxt, buttons) => {
        if (!bodyTxt || buttons.length === 0 || !selectedChat) return;
        autoSilenceBot(selectedChat);
        const currentCandidateId = selectedChat.id;
        markReplyHandledOptimistically(currentCandidateId);

        const optimisticId = 'temp-' + Date.now();
        isSendingRef.current = true;
        updateChatMessages(currentCandidateId, prev => [...(prev || []), withMessageEntryAnimation({
            id: optimisticId,
            content: `${bodyTxt}\n\n[Botones: ${buttons.join(' | ')}]`,
            tipo: 'interactive',
            from: 'me',
            enviado_por_agente: 1,
            status: 'pending',
            fecha: new Date().toISOString(),
            _clientAnchoredTime: true
        }, 'outgoing')]);

        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                candidateId: currentCandidateId,
                message: bodyTxt,
                type: 'interactive',
                extraParams: { buttons },
                senderId: user?.id || user?.whatsapp,
                senderName: user?.name || user?.nombre,
            })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                updateChatMessages(currentCandidateId, prev => mergeOutgoingMessage(prev, data.message, optimisticId));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: currentCandidateId } }));
            } else {
                updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m));
                if (data.error?.includes('131047')) {
                    showToast('Bloqueado por Meta 🛑: Han pasado >24 hrs.', 'error', 8000);
                } else {
                    showToast(`Error de Meta: ${data.error || 'Desconocido'}`, 'error');
                }
            }
        });
    };

    // ── Outbox de envíos ─────────────────────────────────────────────────────
    // El Enter nunca se bloquea: cada envío pinta sus burbujas optimistas al
    // instante y encola el trabajo; este worker despacha un POST a la vez para
    // conservar el orden. Si un mensaje de un grupo falla (ej. ventana de 24h),
    // el resto del grupo se marca fallido en sus burbujas en vez de enviarse.
    const outboxRef = useRef({ queue: [], running: false, failedGroups: new Set() });

    const markOutboxFailed = (candidateId, tempId, error = 'Error al enviar') => {
        updateChatMessages(candidateId, prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed', error } : m));
    };

    const showMetaError = (messageData, fallback = 'Error desconocido') => {
        const fallbackErrorStr = String(messageData?.error || fallback || '').toLowerCase();
        const is24h = messageData?.metaCode === 131047 || String(messageData?.metaCode) === '131047'
            || fallbackErrorStr.includes('131047') || fallbackErrorStr.includes('24 hour') || fallbackErrorStr.includes('re-engagement');
        if (is24h) {
            showToast('⛔ Ventana de 24 hrs cerrada. Toca el Rayito Verde ⚡ abajo para mandar una plantilla oficial.', 'error', 8000);
        } else {
            showToast(`⚠️ Meta: ${messageData?.error || fallback}`, 'error');
        }
    };

    const deliverOutboxJob = async (job) => {
        const { candidateId, tempId, payload, normalizeResponse } = job;
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || data.details || 'Error al enviar');

            if (data.success && data.message) {
                const messageData = normalizeResponse ? normalizeResponse(data.message) : data.message;
                updateChatMessages(candidateId, prev => mergeOutgoingMessage(prev, messageData, tempId));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId } }));

                if (messageData.status === 'failed') {
                    showMetaError(messageData);
                    return false;
                }
                return true;
            }

            const error = data.error || 'API Error';
            markOutboxFailed(candidateId, tempId, error);
            showToast && showToast(`Error al enviar mensaje: ${error}`, 'error');
            return false;
        } catch (error) {
            markOutboxFailed(candidateId, tempId, error.message || 'Red desconectada');
            console.error(error);
            showToast && showToast('Error de red al enviar', 'error');
            return false;
        }
    };

    const processOutbox = async () => {
        const outbox = outboxRef.current;
        if (outbox.running) return;
        outbox.running = true;
        try {
            while (outbox.queue.length) {
                const job = outbox.queue.shift();
                try {
                    if (job.groupId && outbox.failedGroups.has(job.groupId)) {
                        markOutboxFailed(job.candidateId, job.tempId, 'No enviado: falló el mensaje anterior del grupo');
                        continue;
                    }
                    // Pausa entre pasos del mismo grupo para que Meta respete el orden texto → fotos
                    if (job.gapBefore) await wait(ORDERED_MESSAGE_GAP_MS);
                    const ok = await deliverOutboxJob(job);
                    if (!ok && job.groupId) outbox.failedGroups.add(job.groupId);
                } finally {
                    if (job.isImage) removeSendingMedia(job.candidateId);
                }
            }
        } finally {
            outbox.running = false;
            outbox.failedGroups.clear();
            isSendingRef.current = false;
            // Defensivo: si algo alcanzó a encolarse en el cierre, reanudar
            if (outbox.queue.length) processOutbox();
        }
    };

    const handleSend = (msg, explicitImages) => {
        const textMessage = (msg || '').trim();
        // El agente pasa las imágenes explícitas (evita carrera con el estado pendingQrImages).
        const queuedImages = explicitImages ? [...explicitImages] : [...pendingQrImages];
        if ((!textMessage && !queuedImages.length) || !selectedChat) return;

        const currentChat = selectedChat;
        const currentCandidateId = currentChat.id;
        const senderId = user?.id || user?.whatsapp;
        const senderName = user?.name || user?.nombre;

        const now = Date.now();
        const sendKey = `${currentCandidateId}|${textMessage}|${queuedImages.join(',')}`;
        if (lastSendRef.current.key === sendKey && now - lastSendRef.current.time < 600) return;
        lastSendRef.current = { key: sendKey, time: now };

        // Auto-silence bot on manual intervention
        autoSilenceBot(currentChat);
        markReplyHandledOptimistically(currentCandidateId);

        // El input queda libre de inmediato: el envío real corre en el outbox
        setPendingQrImages([]);
        messageInputRef.current?.clearText();

        const replyId = replyingToMsg ? (replyingToMsg.ultraMsgId || replyingToMsg.id) : null;

        // Optimistic contextualization
        const contextInfoParams = replyId && replyingToMsg ? {
            contextInfo: {
                quotedMessage: {
                    stanzaId: replyId,
                    participant: (replyingToMsg.from !== 'me' && replyingToMsg.from !== 'bot') ? currentChat.whatsapp : '',
                    text: replyingToMsg.content || 'Mensaje multimedia'
                }
            }
        } : {};

        setReplyingToMsg(null);
        isSendingRef.current = true;
        // El chat abierto es el pivote de la lista izquierda (ver el efecto de ancla más
        // arriba): se mantiene fijo en su posición en pantalla aunque tu propio envío lo
        // mande al tope del orden real. Ya no hace falta congelar nada al enviar.
        // grupo con imágenes: 1 solo scroll al montar, sin snaps por carga/estado
        sendScrollHoldUntilRef.current = Date.now() + 2000;

        const groupId = `grp-${now}-${Math.random().toString(36).slice(2, 7)}`;

        // Tiempo optimista ANCLADO al último mensaje del chat, no solo al reloj de la
        // PC: con un reloj local atrasado vs el servidor, el grupo se ordenaba a media
        // conversación ("se inyectaba") en vez de al fondo, donde debe nacer.
        const lastTs = (messages || []).reduce((mx, m) => Math.max(mx, getMessageTime(m)), 0);
        const baseTime = Math.max(now, lastTs + 1);

        let textOptimisticId = null;
        if (textMessage) {
            textOptimisticId = `temp-${now}-${Math.random().toString(36).slice(2, 6)}`;
            updateChatMessages(currentCandidateId, prev => [...(prev || []), withMessageEntryAnimation({
                id: textOptimisticId,
                content: textMessage,
                tipo: 'text',
                from: 'me',
                enviado_por_agente: 1,
                status: 'pending',
                fecha: new Date(baseTime).toISOString(),
                _clientAnchoredTime: true,
                ...contextInfoParams
            }, 'outgoing')]);
            outboxRef.current.queue.push({
                candidateId: currentCandidateId,
                groupId,
                tempId: textOptimisticId,
                payload: {
                    candidateId: currentCandidateId,
                    message: textMessage,
                    type: 'text',
                    replyToId: replyId,
                    senderId,
                    senderName
                }
            });
        }

        // ── Inyección SECUENCIAL del grupo (texto → foto 1 → foto 2 …) ──
        // Cada burbuja espera la señal REAL de que la anterior terminó de entrar (evento
        // ENTRY_REVEALED_EVENT que dispara MessageBubble.jsx al terminar su fase 1) antes de
        // inyectar la siguiente — no un temporizador adivinado. Si mandas rápido varias veces,
        // cada burbuja sigue teniendo su entrada completa y visible, nunca a medias. El orden
        // cronológico se mantiene por timestamp (baseTime+idx+1); los envíos reales siguen por
        // el outbox (con su pausa de orden), pareado a cada burbuja para que el dedup
        // optimista↔servidor nunca se rompa.
        if (queuedImages.length > 0) {
            (async () => {
                if (textOptimisticId) await waitForBubbleReveal(textOptimisticId);
                for (let idx = 0; idx < queuedImages.length; idx++) {
                    const imgUrl = queuedImages[idx];
                    const tempImgId = `temp_img_${now}_${idx}`;
                    addSendingMedia(currentCandidateId);
                    updateChatMessages(currentCandidateId, prev => [...(prev || []), withMessageEntryAnimation({
                        id: tempImgId,
                        from: 'me',
                        content: '',
                        mediaUrl: imgUrl,
                        _serverMediaUrl: imgUrl,
                        type: 'image',
                        status: 'queued',
                        // +1ms por posición: el grupo entero nace en el mismo instante y el sort
                        // cronológico necesita tiempos estrictamente crecientes (texto → foto 1 → 2 → 3)
                        timestamp: new Date(baseTime + idx + 1).toISOString(),
                        _clientAnchoredTime: true,
                        _sequenceIndex: textMessage ? idx + 1 : idx
                    }, 'outgoing')]);
                    outboxRef.current.queue.push({
                        candidateId: currentCandidateId,
                        groupId,
                        tempId: tempImgId,
                        isImage: true,
                        gapBefore: Boolean(textMessage) || idx > 0,
                        payload: {
                            candidateId: currentCandidateId,
                            message: '',
                            type: 'image',
                            mediaUrl: imgUrl,
                            senderId,
                            senderName
                        },
                        normalizeResponse: (messageData) => ({ ...messageData, status: messageData.status || 'sent' })
                    });
                    // renueva la ventana de scroll suave para que ESTA foto también baje sin brinco
                    sendScrollHoldUntilRef.current = Date.now() + 1200;
                    processOutbox().catch(() => {});
                    if (idx < queuedImages.length - 1) await waitForBubbleReveal(tempImgId);
                }
            })();
        }

        // Arranca el envío del texto de inmediato (las fotos se autoencolan al inyectarse)
        processOutbox().catch(() => {});
        setTimeout(() => {
            const input = document.getElementById('chat-msg-input');
            if (input) input.focus();
        }, 50);
    };

    // ── Envío DIRECTO (botón verde del banco / vacantes): inyecta y manda al chat abierto,
    // sin pasar por el campo de texto. Reusa handleSend (optimista + outbox + dedup). ──
    const sendBankReplyDirect = (qr) => {
        if (!selectedChat) { showToast && showToast('Abre un chat primero', 'info'); return; }
        // Ubicación y audio ya se envían por su propia vía (POST directo) en handleApplyQuickReply.
        if (qr.type === 'location' || qr.type === 'audio') { handleApplyQuickReply(qr); return; }
        const candidatoFresh = candidates.find(c => c.id === selectedChat?.id) || selectedChat;
        const resolved = substituteVariables(qr.message || '', candidatoFresh || {}).replace(/[^\S\n]{2,}/g, ' ').trim();
        const imgs = qr.imageUrls?.length ? qr.imageUrls : (qr.imageUrl ? [qr.imageUrl] : []);
        if (!resolved && !imgs.length) return;
        handleSend(resolved, imgs);
    };
    const sendVacancyDirect = (vac) => {
        if (!vac?.messageDescription) return;
        if (!selectedChat) { showToast && showToast('Abre un chat primero', 'info'); return; }
        handleSend(`*${vac.name}*\n\n${vac.messageDescription}`, []);
        if (!vacancyPinned) setShowDropdown(null); // fijado → se queda abierto
    };

    // ═══ AGENTE KATCON — ahora es SERVER-SIDE (event-driven) ════════════════════
    // El auto-envío del Paso 1 (PUNTO KATCON) ya NO vive en el navegador: se disparaba
    // al ABRIR el chat (requería el dashboard abierto). Ahora se dispara en el backend,
    // en el INSTANTE en que Brenda termina la extracción (paso2Estado → 'completo'):
    //   api/ai/agent.js → maybeSendKatconOnComplete()  (helper: api/utils/agent-katcon.js)
    // Así funciona con el dashboard CERRADO ("prendo el toggle, me voy a comer, y a los
    // que van entrando y completan les manda la cita"). El toggle (agentMode) sigue
    // gateando todo desde el super header; su estado persiste en Redis. El cron
    // api/cron/agent-katcon.js queda solo como red de seguridad.

    const handleSendTemplate = (templateObj) => {
        if (!selectedChat) return;
        autoSilenceBot(selectedChat);
        markReplyHandledOptimistically(selectedChat.id);

        const currentCandidateId = selectedChat.id;
        const optimisticId = 'temp-' + Date.now();

        // Optimistic append — build content matching server format so it renders immediately
        const _candidateName = selectedChat.nombreReal?.trim().split(/\s+/).slice(0, 2).join(' ')
            || selectedChat.nombre || 'Candidato';
        const _bodyText = renderMetaTemplatePreviewText(templateObj, {}, _candidateName);
        const _displayName = templateObj.name.replace(/_/g, ' ');
        const _optimisticContent = `⚡ Plantilla oficial: *${_displayName}*\n\n${_bodyText}`.trim();

        isSendingRef.current = true;
        // El chat abierto es el pivote de la lista izquierda — se mantiene fijo en pantalla.
        sendScrollHoldUntilRef.current = Date.now() + 2000;
        updateChatMessages(currentCandidateId, prev => [...(prev || []), withMessageEntryAnimation({
            id: optimisticId,
            content: _optimisticContent,
            tipo: 'template',
            from: 'me',
            enviado_por_agente: 1,
            status: 'pending',
            fecha: new Date().toISOString(),
            _clientAnchoredTime: true
        }, 'outgoing')]);

        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                candidateId: currentCandidateId,
                type: 'template',
                templateData: templateObj,
                senderId: user?.id || user?.whatsapp,
                senderName: user?.name || user?.nombre,
            })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                updateChatMessages(currentCandidateId, prev => mergeOutgoingMessage(prev, data.message, optimisticId));

                if (data.message.status === 'failed') {
                    showToast(`Error de Meta al mandar plantilla: ${data.message.error || 'Desconocido'}`, 'error');
                } else {
                    showToast('Plantilla enviada correctamente', 'success');
                }

                // 🚀 POLLING REMOVED: Trust the SSE `messagePayload` and optimistic UI for injection.
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: currentCandidateId } }));
            } else {
                updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error || 'API Error' } : m));
                showToast(`Error al enviar plantilla: ${data.error || 'Desconocido'}`, 'error');
            }
        }).catch(error => {
            updateChatMessages(currentCandidateId, prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: 'Red desconectada' } : m));
            console.error(error);
            showToast('Error de red al enviar plantilla', 'error');
        });
    };

    // 🚀 MEMOIZED: Pre-compute display messages + formatted HTML (eliminates 700 regex ops/render)
    const displayMessages = useMemo(() => {
        if (!Array.isArray(messages)) return [];
        const result = [];
        const seenOutgoing = [];
        let lastDateKey = null;
        const orderedMessages = sortMessagesChronologically(messages);
        // Índice id/ultraMsgId → mensaje, para resolver el mensaje CITADO ("respondiendo a…")
        // UNA sola vez aquí, en vez de pasarle `allMessages={messages}` a cada burbuja (eso
        // re-renderizaba TODAS las burbujas visibles en cada mensaje SSE → parpadeo bajo tráfico).
        const msgById = new Map();
        for (const m of orderedMessages) {
            if (m?.id) msgById.set(String(m.id), m);
            if (m?.ultraMsgId) msgById.set(String(m.ultraMsgId), m);
        }
        const resolveQuoted = (msg) => {
            const q = msg?.contextInfo?.quotedMessage;
            if (!q || q.text || q.stanzaId == null) return undefined; // con texto ya no hace falta
            const qm = msgById.get(String(q.stanzaId));
            if (!qm) return undefined;
            return { content: qm.content || '', mediaUrl: qm.mediaUrl || '', type: qm.type || '' };
        };
        const rawUnreadCount = Number(selectedChat?.unreadMsgCount || 0);
        const incomingCount = orderedMessages.filter(isIncomingAuthor).length;
        const unreadCount = Math.min(rawUnreadCount, incomingCount);
        let unreadSepIdx = -1;

        if (unreadCount > 0) {
            let remainingIncoming = unreadCount;
            for (let i = orderedMessages.length - 1; i >= 0; i--) {
                if (!isIncomingAuthor(orderedMessages[i])) continue;
                remainingIncoming -= 1;
                if (remainingIncoming === 0) {
                    unreadSepIdx = i;
                    break;
                }
            }
        }

        let msgIdx = 0;

        for (const msg of orderedMessages) {
            if (!msg) { msgIdx++; continue; }
            let content = typeof msg.content === 'string' ? msg.content : '';
            if (content.includes('[REACCI')) {
                content = content.replace(/\[REACCI[OÓ]N:\s*.*?\]/gi, '').trim();
                if (!content && !msg.mediaUrl) { msgIdx++; continue; }
            }

            const normalizedMsg = { ...msg, content };
            if (isOutgoingAuthor(normalizedMsg)) {
                const duplicate = seenOutgoing.find(previous => areVisuallyDuplicateOutgoingMessages(previous, normalizedMsg));
                if (duplicate) {
                    msgIdx++;
                    continue;
                }
                seenOutgoing.push(normalizedMsg);
                if (seenOutgoing.length > 30) seenOutgoing.shift();
            }

            // Separador de no leídos
            if (unreadSepIdx >= 0 && msgIdx === unreadSepIdx) {
                result.push({ id: '__unread_sep', type: 'unread-separator', count: unreadCount });
            }

            // Separador de fecha
            const ts = msg.timestamp || msg.fecha;
            if (ts) {
                const d = new Date(ts);
                if (!isNaN(d)) {
                    const key = d.toDateString();
                    if (key !== lastDateKey) {
                        lastDateKey = key;
                        result.push({ id: `date-sep-${key}`, _clientKey: `date-sep-${key}`, type: 'date-separator', date: ts });
                    }
                }
            }

            const _quotedResolved = resolveQuoted(msg);
            if (content && content.includes('[MSG_SPLIT]')) {
                const parts = content.split('[MSG_SPLIT]').filter(p => p.trim());
                parts.forEach((part, index) => result.push({
                    ...msg,
                    id: `${msg.id || msg._clientKey || msgIdx}-split-${index}`,
                    _clientKey: `${msg._clientKey || msg.id || msgIdx}-split-${index}`,
                    content: part.trim(),
                    mediaUrl: index === 0 ? msg.mediaUrl : null,
                    isSplit: true,
                    _formattedHtml: formatWhatsAppText(part.trim()),
                    ...(_quotedResolved ? { _quotedResolved } : {})
                }));
            } else {
                result.push({ ...msg, content, _formattedHtml: formatWhatsAppText(content), ...(_quotedResolved ? { _quotedResolved } : {}) });
            }
            msgIdx++;
        }

        // Pre-computar isFirstInSeries para evitar cálculo en render
        let lastMsgFrom = null;
        for (const item of result) {
            if (item.type === 'date-separator' || item.type === 'unread-separator') {
                lastMsgFrom = null; // reset para que el siguiente sea "primero en serie"
                continue;
            }
            const isMe = item.from === 'me' || item.from === 'bot';
            item._isFirstInSeries = lastMsgFrom === null || isMe !== lastMsgFrom;
            lastMsgFrom = isMe;
        }

        // Propagar status 'read'/'seen' hacia atrás: si un mensaje mío posterior
        // fue leído, todos los anteriores también lo fueron (comportamiento WhatsApp)
        let highestStatus = null;
        for (let i = result.length - 1; i >= 0; i--) {
            const item = result[i];
            if (item.type === 'date-separator' || item.type === 'unread-separator') continue;
            const isMe = item.from === 'me' || item.from === 'bot';
            if (!isMe) continue;
            if (item.status === 'seen' || item.status === 'read') {
                highestStatus = item.status;
            } else if (highestStatus && item.ultraMsgId && (item.status === 'sent' || item.status === 'delivered')) {
                item.status = highestStatus;
            }
        }

        const cache = displayMessageCacheRef.current;
        return result.map((item, index) => {
            if (!item || item.type === 'date-separator' || item.type === 'unread-separator') return item;
            const key = getStableMessageKey(item, index);
            const signature = [
                item.content,
                item.mediaUrl || '',
                item._displayMediaUrl || '',
                item.status || '',
                item.timestamp || item.fecha || '',
                item._isFirstInSeries ? '1' : '0',
                item.reactions ? JSON.stringify(item.reactions) : '',
                item.contextInfo ? JSON.stringify(item.contextInfo) : '',
                item._quotedResolved ? JSON.stringify(item._quotedResolved) : ''
            ].join('|');
            const cached = cache.get(key);
            if (cached?.signature === signature) return cached.value;
            cache.set(key, { signature, value: item });
            return item;
        });
    }, [messages, selectedChat?.unreadMsgCount]);

    // Detecta si la lista CRECIÓ desde el último render — se usa para no forzar
    // scroll-to-bottom en re-renders que solo cambian una palomita de estado
    // (queued→sent→delivered). Antes CUALQUIER cambio de altura medida por Virtuoso
    // (incluida una remedición de 1px al cambiar el ícono de estado) disparaba
    // scrollToBottom otra vez — con 3 fotos eso son ~8 "snaps" de scroll en pocos
    // segundos, y se veía como que las burbujas de imagen "suben y bajan".
    const messagesGrew = displayMessages.length > prevDisplayLengthRef.current;
    prevDisplayLengthRef.current = displayMessages.length;

    return (
        <div className="flex h-full w-full bg-[#f0f2f5] dark:bg-[#111b21] font-sans overflow-hidden">
            
            {/* LADO IZQUIERDO: LISTA DE CHATS */}
            <div className={`w-full md:w-[30%] lg:w-[35%] xl:w-[500px] flex-col border-r border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] min-w-0 overflow-hidden ${selectedChat ? 'hidden md:flex' : 'flex'}`}>
                
                {isMobile && (
                    <div className="h-[60px] bg-[#008069] dark:bg-[#202c33] flex items-center px-5 text-white shrink-0 shadow-md">
                        <span className="text-xl font-semibold tracking-wide">Candidatic</span>
                    </div>
                )}

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
                    {isMobile && (
                        <div className="flex gap-2 overflow-x-auto py-2.5 px-4 scrollbar-none select-none border-b border-[#f0f2f5] dark:border-[#222e35] mb-1">
                            <button 
                                onClick={() => { setActiveFilter('all'); setFilterValue(null); setSelectedTag(null); setManualPipelineFilter(null); setManualStepFilter(null); setShowDropdown(null); }}
                                className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 shrink-0 ${
                                    activeFilter === 'all' 
                                    ? 'bg-[#d9fdd3] text-[#128c7e] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                            >
                                Todos {stableStats.total != null ? `(${stableStats.total})` : ''}
                            </button>
                            <button
                                onClick={() => { setActiveFilter('unread'); setFilterValue(null); setSelectedTag(null); setShowDropdown(null); }}
                                className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 shrink-0 ${
                                    activeFilter === 'unread'
                                    ? 'bg-[#d9fdd3] text-[#128c7e] dark:bg-[#0a332c] dark:text-[#25d366]'
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                            >
                                No leídos
                                {displayUnreadCounts.all > 0 && (
                                    <div className="min-w-[16px] h-[16px] px-1 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center shrink-0 text-white text-[9px] font-bold shadow-sm">
                                        {displayUnreadCounts.all}
                                    </div>
                                )}
                            </button>
                            <button 
                                onClick={() => { setActiveFilter('profile'); setFilterValue('complete'); setProfileUnreadOnly(true); setSelectedTag(null); setShowDropdown(null); }}
                                className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 shrink-0 ${
                                    activeFilter === 'profile' && filterValue === 'complete' 
                                    ? 'bg-[#d9fdd3] text-[#128c7e] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                            >
                                Completos
                            </button>
                            {(user?.role === 'SuperAdmin' || !rolePermissions || Object.keys(rolePermissions).length === 0 || rolePermissions.view_incomplete_candidates === true) && (
                                <button
                                    onClick={() => { setActiveFilter('profile'); setFilterValue('incomplete'); setProfileUnreadOnly(true); setSelectedTag(null); setShowDropdown(null); }}
                                    className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 shrink-0 ${
                                        activeFilter === 'profile' && filterValue === 'incomplete'
                                        ? 'bg-[#d9fdd3] text-[#128c7e] dark:bg-[#0a332c] dark:text-[#25d366]'
                                        : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                    }`}
                                >
                                    Incompletos
                                </button>
                            )}
                        </div>
                    )}

                    {!isMobile && (
                        <>
                            <button
                                onClick={() => setFiltersHidden(h => { const next = !h; localStorage.setItem('chat_filters_hidden', next); return next; })}
                                className="w-full text-center text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 py-1 transition-colors select-none cursor-pointer"
                            >
                                {filtersHidden ? 'Mostrar filtros' : 'Ocultar filtros'}
                            </button>
                            {!filtersHidden && <div className="flex flex-col gap-1.5 pb-1">
                                {/* Renglón 1: Estados */}
                        <div 
                            className="w-full flex flex-nowrap items-center justify-between gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                            style={{ containerType: 'inline-size' }}
                        >
                        {canSeeFilter('filter_todos') && (
                            <button 
                                onClick={() => { setActiveFilter('all'); setFilterValue(null); setSelectedTag(null); setManualPipelineFilter(null); setManualStepFilter(null); setShowDropdown(null); }}
                                className={`flex-1 flex justify-center px-1.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors border border-transparent items-center gap-1 min-w-[50px] ${
                                    activeFilter === 'all' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                                style={{ fontSize: 'clamp(8px, 2.2cqw, 11px)' }}
                            >
                                Todos {stableStats.total != null ? `(${stableStats.total})` : ''}
                            </button>
                        )}
                        <button
                            onClick={() => { setActiveFilter('unread'); setFilterValue(null); setSelectedTag(null); setShowDropdown(null); }}
                            className={`flex-[1.2] flex justify-center px-1.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors border border-transparent items-center gap-1 min-w-[70px] ${
                                activeFilter === 'unread'
                                ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]'
                                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                            }`}
                            style={{ fontSize: 'clamp(8px, 2.2cqw, 11px)' }}
                        >
                            No Leídos
                            {displayUnreadCounts.all > 0 && (
                                <div className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center shrink-0 text-white text-[9px] font-bold shadow-sm -ml-0.5">
                                    {displayUnreadCounts.all}
                                </div>
                            )}
                        </button>
                        {canSeeFilter('filter_complete') && (
                            <button 
                                onClick={() => { setActiveFilter('profile'); setFilterValue('complete'); setProfileUnreadOnly(true); setSelectedTag(null); setShowDropdown(null); }}
                                className={`flex-[1.5] flex justify-center px-1.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors border border-transparent items-center gap-1 min-w-[90px] ${
                                    activeFilter === 'profile' && filterValue === 'complete' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                                style={{ fontSize: 'clamp(8px, 2.2cqw, 11px)' }}
                            >
                                Completos ({stableStats.complete ?? badgeCounts.complete})
                                {displayUnreadCounts.complete > 0 && (
                                    <div
                                        onClick={(e) => { e.stopPropagation(); setActiveFilter('profile'); setFilterValue('complete'); setProfileUnreadOnly(true); setShowDropdown(null); }}
                                        className={`min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shrink-0 text-white text-[9px] font-bold shadow-sm -ml-0.5 cursor-pointer transition-all ${activeFilter === 'profile' && filterValue === 'complete' && profileUnreadOnly ? 'bg-[#128c7e] ring-2 ring-white/50 scale-110' : 'bg-[#25d366] dark:bg-[#00a884] hover:scale-110'}`}
                                        title="Ver solo no leídos completos"
                                    >
                                        {displayUnreadCounts.complete}
                                    </div>
                                )}
                            </button>
                        )}
                        {canSeeFilter('filter_incomplete') && (user?.role === 'SuperAdmin' || !rolePermissions || Object.keys(rolePermissions).length === 0 || rolePermissions.view_incomplete_candidates === true) && (
                            <button 
                                onClick={() => { setActiveFilter('profile'); setFilterValue('incomplete'); setProfileUnreadOnly(true); setSelectedTag(null); setShowDropdown(null); }}
                                className={`flex-[1.5] flex justify-center px-1.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors border border-transparent items-center gap-1 min-w-[90px] ${
                                    activeFilter === 'profile' && filterValue === 'incomplete' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                                style={{ fontSize: 'clamp(8px, 2.2cqw, 11px)' }}
                            >
                                Incompletos ({stableStats.pending ?? badgeCounts.incomplete})
                                {displayUnreadCounts.incomplete > 0 && (
                                    <div
                                        onClick={(e) => { e.stopPropagation(); setActiveFilter('profile'); setFilterValue('incomplete'); setProfileUnreadOnly(true); setShowDropdown(null); }}
                                        className={`min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shrink-0 text-white text-[9px] font-bold shadow-sm -ml-0.5 cursor-pointer transition-all ${activeFilter === 'profile' && filterValue === 'incomplete' && profileUnreadOnly ? 'bg-[#128c7e] ring-2 ring-white/50 scale-110' : 'bg-[#25d366] dark:bg-[#00a884] hover:scale-110'}`}
                                        title="Ver solo no leídos incompletos"
                                    >
                                        {displayUnreadCounts.incomplete}
                                    </div>
                                )}
                            </button>
                        )}
                        </div>

                        {/* Renglón 2: Etiquetas */}
                        <div className="w-full">
                            {/* Etiquetas Dropdown */}
                            {canSeeFilter('filter_labels') && (
                                <div className="relative w-full">
                                    <div 
                                        onClick={() => setShowDropdown(showDropdown === 'labels' ? null : 'labels')}
                                        className={`w-full bg-[#f0f2f5] dark:bg-[#202c33] border ${selectedTagValues.length > 0 ? 'border-transparent' : 'border-gray-200 dark:border-gray-700'} rounded-lg pl-9 pr-14 py-2 text-xs outline-none font-medium text-left cursor-pointer transition-all flex items-center shadow-sm relative`}
                                        style={selectedTagValues.length > 0 ? {
                                            boxShadow: `0 0 0 2px ${selectedTagValues[0] === UNTAGGED_TAG_FILTER ? UNTAGGED_TAG_COLOR : ((availableTags.find(t => (typeof t === 'string' ? t : t.name) === selectedTagValues[0]))?.color || '#3b82f6')}`,
                                            borderColor: 'transparent'
                                        } : {}}
                                    >
                                        <Tag className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${selectedTagValues.length > 0 ? 'text-[#111b21] dark:text-[#e9edef]' : 'text-gray-400 dark:text-gray-500'}`} style={selectedTagValues.length > 0 ? { color: selectedTagValues[0] === UNTAGGED_TAG_FILTER ? UNTAGGED_TAG_COLOR : (availableTags.find(t => (typeof t === 'string' ? t : t.name) === selectedTagValues[0]))?.color } : {}} />
                                        <span className="flex-1 truncate text-[#111b21] dark:text-[#e9edef]">
                                            {selectedTagValues.length > 0 ? (() => {
                                                const hasSubFilters = selectedAges.length > 0 || selectedGenders.length > 0 || selectedMunicipalities.length > 0;
                                                // "Todos" usa el total real del tag (todos los candidatos).
                                                // Los otros filtros cargan todo de golpe, filteredCandidates.length es exacto.
                                                if (selectedTagValues.length > 1) {
                                                    return `${selectedTagValues.length} Etiquetas (${filteredCandidates.length})`;
                                                }
                                                const activeTag = selectedTagValues[0];
                                                if (activeTag === UNTAGGED_TAG_FILTER) {
                                                    const count = (!hasSubFilters && activeFilter === 'all')
                                                        ? untaggedTotal
                                                        : filteredCandidates.length;
                                                    return `${UNTAGGED_TAG_LABEL} (${count})`;
                                                }
                                                const tagObj = availableTags.find(t => (typeof t === 'string' ? t : t.name) === activeTag);
                                                const count = (!hasSubFilters && activeFilter === 'all')
                                                    ? (tagObj?.count ?? candidatesTotal)
                                                    : filteredCandidates.length;
                                                return `${formatTagLabel(activeTag)} (${count})`;
                                            })() : 'Todas Las Etiquetas'}
                                        </span>
                                        <div className={`absolute right-2 top-1/2 -translate-y-1/2 transition-transform ${showDropdown === 'labels' ? 'rotate-180' : ''}`}>
                                            <ChevronIcon />
                                        </div>
                                    </div>
                                    
                                    {selectedTagValues.length > 0 && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setSelectedTag(null); }}
                                            className="absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-md bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shrink-0 z-10"
                                            title="Quitar filtro"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}

                                    {showDropdown === 'labels' && (
                                        <div className="absolute top-full left-0 mt-2 w-full bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-[100] py-1 max-h-72 flex flex-col">
                                            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 shrink-0">
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={tagSearch}
                                                    onChange={e => setTagSearch(e.target.value)}
                                                    onClick={e => e.stopPropagation()}
                                                    placeholder="Buscar etiqueta..."
                                                    className="w-full text-xs px-2.5 py-1.5 rounded-md bg-[#f0f2f5] dark:bg-[#111b21] text-[#111b21] dark:text-[#e9edef] outline-none placeholder-gray-400 dark:placeholder-gray-500"
                                                />
                                            </div>
                                            <div className="overflow-y-auto custom-scrollbar flex-1">
                                            {!tagSearch && (() => {
                                                const hasSubFilters = selectedAges.length > 0 || selectedGenders.length > 0 || selectedMunicipalities.length > 0;
                                                const count = hasSubFilters
                                                    ? filteredCandidates.length
                                                    : (candidatesTotal || stableStats.total || filteredCandidates.length);
                                                const unreadCount = activeFilter === 'profile' && filterValue === 'complete'
                                                    ? displayUnreadCounts.complete
                                                    : activeFilter === 'profile' && filterValue === 'incomplete'
                                                        ? displayUnreadCounts.incomplete
                                                        : displayUnreadCounts.all;
                                                const isSelected = selectedTagValues.length === 0;

                                                return (
                                                    <div
                                                        onClick={() => { setSelectedTag(null); setTagSearch(''); }}
                                                        className={`px-4 py-2.5 text-xs cursor-pointer flex items-center justify-between ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                    >
                                                        <div className="flex items-center gap-2 truncate pr-2">
                                                            <span className="w-3 h-3 rounded-full shrink-0 bg-black dark:bg-white"></span>
                                                            <span className="truncate flex-1">Todas Las Etiquetas ({count})</span>
                                                        </div>
                                                        {renderTagUnreadControls({
                                                            scope: 'all',
                                                            label: 'Todas Las Etiquetas',
                                                            unreadCount
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                            {(!tagSearch || UNTAGGED_TAG_LABEL.toLowerCase().includes(tagSearch.toLowerCase())) && (() => {
                                                // Synthetic option backed by the server's special untagged filter value.
                                                const _gc = globalUnreadCounts;
                                                const unreadCount = _gc
                                                    ? (activeFilter === 'profile' && filterValue === 'complete'
                                                        ? _gc.completeUntagged
                                                        : activeFilter === 'profile' && filterValue === 'incomplete'
                                                            ? _gc.incompleteUntagged
                                                            : _gc.untagged)
                                                    : (activeFilter === 'profile' && filterValue === 'complete'
                                                        ? unreadCounts.completeUntagged
                                                        : activeFilter === 'profile' && filterValue === 'incomplete'
                                                            ? unreadCounts.incompleteUntagged
                                                            : unreadCounts.untagged);
                                                const isSelected = selectedTagValueSet.has(UNTAGGED_TAG_FILTER);

                                                return (
                                                    <div
                                                        key={UNTAGGED_TAG_FILTER}
                                                        onClick={() => { toggleTagFilter(UNTAGGED_TAG_FILTER); }}
                                                        className={`px-4 py-2.5 text-xs cursor-pointer flex items-center justify-between ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                    >
                                                        <div className="flex items-center gap-2 truncate pr-2">
                                                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: UNTAGGED_TAG_COLOR }}></span>
                                                            <span className="truncate flex-1">{UNTAGGED_TAG_LABEL} ({untaggedTotal})</span>
                                                        </div>
                                                        {renderTagUnreadControls({
                                                            scope: 'untagged',
                                                            tagName: UNTAGGED_TAG_FILTER,
                                                            label: UNTAGGED_TAG_LABEL,
                                                            unreadCount
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                            {(Array.isArray(availableTags) ? availableTags : []).filter(tagObj => {
                                                const tSearchName = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                                if (tagSearch && !`${tSearchName} ${formatTagLabel(tSearchName)}`.toLowerCase().includes(tagSearch.toLowerCase())) return false;
                                                // User-level label filtering
                                                if (!user || user.role === 'SuperAdmin' || user.role === 'Admin') return true;
                                                const userLabels = user?.allowed_labels;
                                                if (!Array.isArray(userLabels) || userLabels.length === 0) return true;
                                                return userLabels.some(l => typeof l === 'string' && l.trim().toLowerCase() === tSearchName.trim().toLowerCase());
                                            }).map(tagObj => {
                                                const tName = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                                const tColor = typeof tagObj === 'string' ? '#3b82f6' : tagObj.color;
                                                const display = tagObj.count !== undefined ? `${formatTagLabel(tName)} (${tagObj.count})` : formatTagLabel(tName);
                                                
                                                // Badge de etiqueta según filtro activo
                                                const _tagKey = tName.trim().toLowerCase();
                                                const _gc = globalUnreadCounts;
                                                const _tagCounts = _gc
                                                    ? (activeFilter === 'profile' && filterValue === 'complete'
                                                        ? _gc.completeTags
                                                        : activeFilter === 'profile' && filterValue === 'incomplete'
                                                            ? _gc.incompleteTags
                                                            : _gc.tags)
                                                    : unreadCounts.tags;
                                                const unreadCount = (_tagCounts?.[_tagKey]) || 0;
                                                const isSelected = selectedTagValueSet.has(tName);

                                                return (
                                                    <div
                                                        key={tName}
                                                        onClick={() => { toggleTagFilter(tName); }}
                                                        className={`px-4 py-2.5 text-xs cursor-pointer flex items-center justify-between ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                    >
                                                        <div className="flex items-center gap-2 truncate pr-2">
                                                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tColor }}></span>
                                                            <span className="truncate flex-1">{display}</span>
                                                        </div>
                                                        {renderTagUnreadControls({
                                                            scope: 'tag',
                                                            tagName: tName,
                                                            label: formatTagLabel(tName),
                                                            unreadCount
                                                        })}
                                                    </div>
                                                );
                                            })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Renglón 3: Proyectos y CRM Manual */}
                        <div className="flex flex-col gap-1.5 w-full">
                                <MultiSelectDropdown 
                                    label="Edad" 
                                    options={filterOptions.ages} 
                                    selected={selectedAges} 
                                    onChange={setSelectedAges} 
                                />
                                <MultiSelectDropdown 
                                    label="Género" 
                                    options={filterOptions.genders} 
                                    selected={selectedGenders} 
                                    onChange={setSelectedGenders} 
                                />
                                <MultiSelectDropdown 
                                    label="Municipio" 
                                    options={filterOptions.municipalities} 
                                    selected={selectedMunicipalities} 
                                    onChange={setSelectedMunicipalities} 
                                />


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
                                            <span className="flex-1 truncate text-[#111b21] dark:text-[#e9edef]">{manualPipelineFilter ? (() => {
                                                const activeProject = manualProjects.find(p => p.id === manualPipelineFilter);
                                                return activeProject ? `${activeProject.name} (${manualFilterCounts.projectCounts[activeProject.id] || 0})` : 'Pipeline';
                                            })() : 'CRM de Proyectos'}</span>
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
                                                        const unreadCount = displayUnreadCounts.crmProjects[project.id] || 0;
                                                        const candidateCount = manualFilterCounts.projectCounts[project.id] || 0;
                                                        const isSelected = manualPipelineFilter === project.id;
                                                        return (
                                                            <div
                                                                key={project.id}
                                                                onClick={() => { setManualPipelineFilter(project.id); setManualStepFilter(null); setShowDropdown(null); }}
                                                                className={`px-4 py-2.5 text-xs cursor-pointer flex items-center justify-between ${isSelected ? 'bg-orange-50 dark:bg-orange-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                                title={project.name}
                                                            >
                                                                <span className="truncate flex-1 pr-2">{project.name} ({candidateCount})</span>
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
                                        const stepTotal = manualFilterCounts.projectCounts[manualPipelineFilter] || 0;
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
                                                        {manualStepFilter ? (() => {
                                                            const activeStep = activeProject.steps?.find(s => s.id === manualStepFilter);
                                                            return activeStep ? `${activeStep.name} (${manualFilterCounts.stepCounts[activeStep.id] || 0})` : 'Paso';
                                                        })() : `Todos los pasos (${stepTotal})`}
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
                                                            Todos los Pasos ({stepTotal})
                                                        </div>
                                                        {activeProject.steps?.length === 0 ? (
                                                            <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay pasos</div>
                                                        ) : (
                                                            activeProject.steps?.map(step => {
                                                                const isSelected = manualStepFilter === step.id;
                                                                const candidateCount = manualFilterCounts.stepCounts[step.id] || 0;
                                                                return (
                                                                    <div
                                                                        key={step.id}
                                                                        onClick={() => { setManualStepFilter(step.id); setShowDropdown(null); }}
                                                                        className={`px-4 py-2.5 text-xs cursor-pointer flex items-center gap-2 ${isSelected ? 'bg-orange-50 dark:bg-orange-900/30 text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21]'}`}
                                                                        title={step.name}
                                                                    >
                                                                        <span className="truncate flex-1">{step.name} ({candidateCount})</span>
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

                        {/* ── Agregar Chat (Nuevo Candidato) ── */}
                        <div className="w-full">
                            <button
                                onClick={() => setShowNewChat(!showNewChat)}
                                className={`w-full bg-[#f0f2f5] dark:bg-[#202c33] border ${
                                    showNewChat ? 'border-[#25d366] dark:border-[#00a884]' : 'border-gray-200 dark:border-gray-700'
                                } rounded-lg px-3 py-2 text-xs font-medium text-left cursor-pointer transition-all flex items-center shadow-sm gap-2`}
                            >
                                <MessageCirclePlus className={`w-3.5 h-3.5 ${showNewChat ? 'text-[#25d366] dark:text-[#00a884]' : 'text-gray-400 dark:text-gray-500'}`} />
                                <span className="flex-1 text-[#111b21] dark:text-[#e9edef]">Agregar Chat</span>
                                <div className={`transition-transform ${showNewChat ? 'rotate-45' : ''}`}>
                                    <Plus className={`w-3.5 h-3.5 ${showNewChat ? 'text-[#25d366] dark:text-[#00a884]' : 'text-gray-400 dark:text-gray-500'}`} />
                                </div>
                            </button>
                            {showNewChat && (
                                <div className="mt-2 bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg p-3 border border-gray-200 dark:border-gray-700 flex flex-col gap-2 animate-in slide-in-from-top-2 duration-200">
                                    <div className="flex items-center gap-2">
                                        <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                        <input
                                            type="tel"
                                            placeholder="Número WhatsApp (ej: 8112345678)"
                                            value={newChatPhone}
                                            onChange={e => setNewChatPhone(e.target.value.replace(/[^\d+]/g, ''))}
                                            className="flex-1 bg-white dark:bg-[#111b21] border border-gray-200 dark:border-gray-600 rounded-md px-2.5 py-1.5 text-xs text-[#111b21] dark:text-[#e9edef] outline-none focus:border-[#25d366] dark:focus:border-[#00a884] transition-colors placeholder-gray-400"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                        <input
                                            type="text"
                                            placeholder="Nombre del contacto"
                                            value={newChatName}
                                            onChange={e => setNewChatName(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && newChatPhone && newChatName.trim()) document.getElementById('btn-create-chat')?.click(); }}
                                            className="flex-1 bg-white dark:bg-[#111b21] border border-gray-200 dark:border-gray-600 rounded-md px-2.5 py-1.5 text-xs text-[#111b21] dark:text-[#e9edef] outline-none focus:border-[#25d366] dark:focus:border-[#00a884] transition-colors placeholder-gray-400"
                                        />
                                    </div>
                                    <button
                                        id="btn-create-chat"
                                        onClick={async () => {
                                            if (!newChatPhone || !newChatName.trim() || newChatLoading) return;
                                            setNewChatLoading(true);
                                            try {
                                                const res = await fetch('/api/candidates', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ whatsapp: newChatPhone, nombre: newChatName.trim() })
                                                });
                                                const data = await res.json();
                                                if (data.success && data.candidate) {
                                                    setSelectedChat(data.candidate);
                                                    setNewChatPhone('');
                                                    setNewChatName('');
                                                    setShowNewChat(false);
                                                    if (data.existed) {
                                                        showToast && showToast('Candidato ya existía, abriendo chat', 'info');
                                                    } else {
                                                        showToast && showToast('Chat creado exitosamente', 'success');
                                                    }
                                                } else {
                                                    showToast && showToast(data.error || 'Error al crear chat', 'error');
                                                }
                                            } catch (err) {
                                                showToast && showToast('Error de red', 'error');
                                            } finally {
                                                setNewChatLoading(false);
                                            }
                                        }}
                                        disabled={!newChatPhone || !newChatName.trim() || newChatLoading}
                                        className="w-full bg-[#25d366] hover:bg-[#1da851] disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-medium text-xs py-2 rounded-md transition-colors flex items-center justify-center gap-2"
                                    >
                                        {newChatLoading ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <>
                                                <MessageCirclePlus className="w-3.5 h-3.5" />
                                                Crear Chat
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>

                    </div>}
                        </>
                    )}
                </div>

                {/* Lista de Contactos — VIRTUALIZADA */}
                <div className="flex-1 overflow-hidden bg-white dark:bg-[#111b21]">
                        <Virtuoso
                            ref={chatListVirtuosoRef}
                            scrollerRef={handleChatListScrollerRef}
                            data={renderedCandidates}
                            style={{ height: '100%' }}
                            // Buffer de render alto (px): antes era overscan={10} (¡10px!) y en scroll
                            // rápido Virtuoso no alcanzaba a pintar filas por delante → huecos en blanco
                            // → corrección de golpe = "se traba y brinca". 800px arriba/abajo lo suaviza.
                            increaseViewportBy={{ top: 800, bottom: 800 }}
                            // Las filas tienen altura VARIABLE (con/sin etiquetas, badges, lock). Darle una
                            // altura estimada real (~76px) hace que estime bien el alto total y NO corrija
                            // la posición del scroll cada vez que mide una fila nueva.
                            defaultItemHeight={76}
                            computeItemKey={(index, chat) => chat.id}
                            endReached={handleChatListEndReached}
                            context={{ loadingMore }}
                            components={CHAT_LIST_VIRTUOSO_COMPONENTS}
                            itemContent={(index, chat) => (
                                <ChatRow
                                    key={chat.id}
                                    chat={chat}
                                    isSelected={selectedChat?.id === chat.id}
                                    isPinned={pinnedChats.includes(chat.id)}
                                    onSelect={handleSelectChat}
                                    onBlock={handleBlockToggle}
                                    onDelete={handleDeleteChat}
                                    onTogglePin={togglePin}
                                    onlineReaders={onlineReadersByChat.get(chat.id) || EMPTY_READERS}
                                    blockLoading={blockLoading}
                                    userId={user?.id || user?.whatsapp}
                                    onOpenProfileModal={setProfileModalCandidate}
                                    onMarkAsRead={handleMarkAsRead}
                                    onMarkAsUnread={handleMarkAsUnread}
                                    onScheduleReminder={setReminderModalCandidate}
                                    tagColorMap={tagColorMap}
                                    lock={chatLocks[chat.id] || null}
                                    isEnteringFilter={enteredFilterIds.has(chat.id)}
                                />
                            )}
                        />
                </div>
                </>
                )}
            </div>

            {/* LADO DERECHO: CHAT BODY */}
            {selectedChat ? (
                <div className={`flex-1 flex flex-col bg-[#efeae2] dark:bg-[#0b141a] h-full relative min-w-0 overflow-hidden ${!selectedChat ? 'hidden md:flex' : 'flex'}`}>
                    
                    {/* Header Chat — container query: cuando los paneles laterales (CRM, Banco)
                        angostan el chat, el texto del toggle IA se oculta para no cortar las etiquetas */}
                    <div className="min-h-[59px] px-4 py-2 flex items-center justify-between bg-[#f0f2f5] dark:bg-[#202c33] z-20 shadow-sm" style={{ containerType: 'inline-size' }}>
                        <div className="flex items-center cursor-pointer flex-1 min-w-0 pr-4">
                            <button 
                                className="md:hidden mr-2 p-1 text-[#54656f] dark:text-[#aebac1]"
                                onClick={() => setSelectedChat(null)}
                            >
                                <ArrowLeft className="w-6 h-6" />
                            </button>
                            <div className="min-w-[40px] w-10 h-10 rounded-full flex items-center justify-center mr-3 overflow-hidden shrink-0">
                                {selectedChat.profilePic && !headerImgError ? (
                                    <img src={selectedChat.profilePic} className="w-full h-full object-cover" alt="profile"
                                        onError={() => setHeaderImgError(true)} />
                                ) : (
                                    <span className="flex items-center justify-center w-full h-full text-sm font-bold text-white rounded-full"
                                        style={{ background: ['#f9a8d4','#a5b4fc','#86efac','#fcd34d','#fdba74','#c4b5fd','#67e8f9','#f0abfc','#fca5a5','#bef264'][((selectedChat.nombre||'C').charCodeAt(0)*7)%10] }}>
                                        {(selectedChat.nombre || 'C')[0].toUpperCase()}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                                {/* Nombre completo + etiquetas: las etiquetas usan flex-wrap para bajar de
                                    linea en vez de recortarse con scroll horizontal + degradado. Asi un tag
                                    largo (ej. "Metalsa Anuncio") se ve completo aprovechando el espacio que
                                    el header ya deja libre arriba del toolbar de iconos, en vez de quedar
                                    truncado. El header crece verticalmente si hace falta (min-h lo permite). */}
                                <div className="flex items-start min-w-0 w-full flex-wrap gap-y-1">
                                    <h2 className="text-[17px] font-medium text-[#111b21] dark:text-[#e9edef] shrink-0 whitespace-nowrap">
                                        {toTitleCase(selectedChat.nombreReal || selectedChat.nombre) || selectedChat.whatsapp}
                                    </h2>
                                    {!isMobile && (
                                        <div className="flex items-center flex-wrap min-w-0 ml-1.5 gap-1.5 pt-1.5 pb-1 pr-4">
                                        {selectedChat.tags && (Array.isArray(selectedChat.tags) ? selectedChat.tags : []).map(t => {
                                            const tObj = availableTags.find(at => (typeof at === 'string' ? at : at.name) === t);
                                            const tColor = tObj ? (tObj.color || '#3b82f6') : '#3b82f6';
                                            return (
                                                <span key={t} className="group/tag relative inline-flex items-center text-xs px-2.5 py-0.5 rounded-full text-white font-medium whitespace-nowrap opacity-90 shadow-sm cursor-default align-middle" style={{ backgroundColor: tColor }}>
                                                    {formatTagLabel(t)}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleToggleTag(t); }}
                                                        className="absolute -top-1 -right-1.5 w-4 h-4 rounded-full bg-gray-800/80 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover/tag:opacity-100 transition-opacity duration-150 shadow z-10"
                                                        title={`Desvincular "${formatTagLabel(t)}"`}
                                                    >
                                                        <X className="w-2.5 h-2.5" />
                                                    </button>
                                                </span>
                                            );
                                        })}
                                        </div>
                                    )}
                                </div>
                                {/* Linea 2: WhatsApp + numero + ultimo mensaje — sin badges, espacio completo para el texto */}
                                <div className="flex items-center gap-x-2 mt-0.5 min-w-0 flex-wrap">
                                    <p className="text-xs text-[#667781] dark:text-[#8696a0] flex items-center gap-1 whitespace-nowrap">
                                        <span className="font-semibold" style={{ color: '#25D366' }}>WhatsApp</span>
                                        {(() => {
                                            let p = String(selectedChat.whatsapp || '');
                                            if (p.startsWith('521') && p.length === 13) p = p.slice(3);
                                            else if (p.startsWith('52') && p.length === 12) p = p.slice(2);
                                            return p;
                                        })()}
                                        <span className="mx-0.5 opacity-50">·</span>
                                        Último Mensaje {formatRelativeDate(selectedChat.ultimoMensaje)}
                                    </p>
                                </div>
                                {/* Linea 3: estado + numero de entrada + anuncio — badges uniformes (mismo alto/padding/tipografia) */}
                                <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${isProfileComplete(selectedChat) ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400'}`}>
                                        {isProfileComplete(selectedChat) ? 'Completo' : 'Incompleto'}
                                    </span>
                                    {selectedChat.incomingPhoneNumberId && (
                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                                            {selectedChat.incomingPhoneNumberId === '1249373631587237' ? 'Hr One México' : selectedChat.incomingPhoneNumberId === '1061455557054529' ? 'Candidatic IA' : selectedChat.incomingPhoneNumberId}
                                        </span>
                                    )}
                                    {(selectedChat.adHeadline || selectedChat.adId) && (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-violet-50 dark:bg-violet-500/10 text-violet-500 dark:text-violet-400 border border-violet-200/60 dark:border-violet-500/20 truncate max-w-[180px]" title={selectedChat.adHeadline || selectedChat.adId}>
                                            📢 {selectedChat.adHeadline || `Ad ${selectedChat.adId}`}
                                        </span>
                                    )}
                                    {/* Datos del candidato — mismo formato que la tarjeta de la lista de chats */}
                                    {(selectedChat.edad || selectedChat.escolaridad || selectedChat.municipio || selectedChat.colonia || selectedChat.categoria) && (
                                        <span className="flex items-center gap-2 text-[10px] text-[#8696a0] dark:text-[#697882] whitespace-nowrap ml-0.5">
                                            {selectedChat.edad && <span>{selectedChat.edad} años</span>}
                                            {selectedChat.edad && selectedChat.escolaridad && <span>•</span>}
                                            {selectedChat.escolaridad && <span>{selectedChat.escolaridad}</span>}
                                            {(selectedChat.edad || selectedChat.escolaridad) && selectedChat.municipio && <span>•</span>}
                                            {selectedChat.municipio && <span>{selectedChat.municipio}</span>}
                                            {(selectedChat.edad || selectedChat.escolaridad || selectedChat.municipio) && selectedChat.colonia && <span>•</span>}
                                            {selectedChat.colonia && <span>{toTitleCase(selectedChat.colonia)}</span>}
                                            {(selectedChat.edad || selectedChat.escolaridad || selectedChat.municipio || selectedChat.colonia) && selectedChat.categoria && <span>•</span>}
                                            {selectedChat.categoria && <span>{toTitleCase(selectedChat.categoria)}</span>}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex space-x-3 text-[#54656f] dark:text-[#aebac1] items-center">
                            {/* Silenciar IA Toggle */}
                            {!isMobile && (() => {
                                const iaSilenced = isIaSilenced(selectedChat);
                                return (
                                <div className="flex items-center gap-2 mr-2">
                                    <span className={`text-xs font-medium ${iaSilenced ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'} select-none whitespace-nowrap [@container(max-width:1060px)]:hidden`}>
                                        {iaSilenced ? 'IA Silenciada' : 'IA Dinámica'}
                                    </span>
                                    <button
                                        onClick={(e) => handleBlockToggle(selectedChat, e)}
                                        disabled={blockLoading}
                                        className={`w-8 h-4 rounded-full relative transition-colors duration-200 focus:outline-none flex items-center ${iaSilenced ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                                        title={iaSilenced ? 'Reactivar Chat IA' : 'Silenciar Chat IA'}
                                    >
                                        <div className={`absolute w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${iaSilenced ? 'translate-x-4' : 'translate-x-0.5'}`}>
                                        </div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setReminderModalCandidate(selectedChat); }}
                                        className="p-2 -mr-1 rounded-full text-[#54656f] dark:text-[#aebac1] hover:text-amber-500 dark:hover:text-amber-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                                        title="Programar recordatorio"
                                        aria-label="Programar recordatorio"
                                    >
                                        <Bell className="w-5 h-5" />
                                    </button>
                                </div>
                                );
                            })()}

                            {/* Draggable Icon Toolbar */}
                            {!isMobile && toolbarOrder.map((iconId) => {
                                const dragProps = {
                                    draggable: true,
                                    // Los dropdowns de vacantes/etiquetas viven DENTRO de este contenedor
                                    // arrastrable. Con el dropdown ABIERTO, agarrar su panel (buscador,
                                    // colores, área vacía) arrastraba el icono completo y sacaba la ventana
                                    // de su lugar. Si el dropdown de este icono está abierto, no arrastres
                                    // el icono. Las filas de etiqueta/vacante hacen stopPropagation en su
                                    // propio onDragStart, así que su reordenamiento nunca llega hasta aquí.
                                    onDragStart: (e) => {
                                        if (showDropdown === iconId) { e.preventDefault(); return; }
                                        handleToolbarDragStart(iconId, e);
                                    },
                                    onDragOver: handleToolbarDragOver,
                                    onDrop: (e) => handleToolbarDrop(iconId, e),
                                    onDragEnd: handleToolbarDragEnd,
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
                                                <div className="px-3 py-2 text-xs font-bold text-[#8696a0] border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-[#111b21] flex items-center justify-between">
                                                    <span>Inyectar Info de Vacante</span>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); toggleVacancyPinned(); }}
                                                        title={vacancyPinned ? 'Ventana fijada (clic para soltar)' : 'Mantener esta ventana abierta'}
                                                        className={`p-1 rounded-full transition-colors shrink-0 ${vacancyPinned ? 'text-sky-500 bg-sky-500/10' : 'text-gray-400 hover:text-sky-400 hover:bg-sky-400/10'}`}
                                                    >
                                                        <Snowflake className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                                <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                    {vacancies.length === 0 ? (
                                                        <div className="px-3 py-4 text-center text-xs text-gray-400">
                                                            No hay vacantes configuradas con "Info para el bot"
                                                        </div>
                                                    ) : (
                                                        orderedVacancies.map(vac => {
                                                            return (
                                                                <div key={vac.id}
                                                                    draggable
                                                                    onDragStart={(e) => { e.stopPropagation(); setVacancyDraggedId(vac.id); e.dataTransfer.effectAllowed = 'move'; }}
                                                                    onDragOver={(e) => { if (!vacancyDraggedId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (vacancyDragOverId !== vac.id) setVacancyDragOverId(vac.id); }}
                                                                    onDrop={(e) => { e.preventDefault(); handleVacancyDrop(vac.id); }}
                                                                    onDragEnd={() => { setVacancyDraggedId(null); setVacancyDragOverId(null); }}
                                                                    className={`px-3 py-2 text-xs transition-colors flex items-center justify-between group/vacitem ${
                                                                        selectedChat?.currentVacancyId === vac.id
                                                                        ? 'bg-blue-50 dark:bg-blue-900/20'
                                                                        : 'hover:bg-gray-50 dark:hover:bg-[#111b21]'
                                                                    } ${vacancyDraggedId === vac.id ? 'opacity-40' : ''} ${vacancyDragOverId === vac.id && vacancyDraggedId && vacancyDraggedId !== vac.id ? 'shadow-[inset_0_2px_0_0_#22c55e]' : ''}`}
                                                                >
                                                                    <div onClick={(e) => { e.stopPropagation(); injectVacancy(vac); }} className="flex items-center gap-2 cursor-pointer flex-1 overflow-hidden">
                                                                        <GripVertical className="w-3 h-3 shrink-0 text-gray-300 dark:text-gray-600 opacity-0 group-hover/vacitem:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />
                                                                        <Briefcase className="w-3.5 h-3.5 shrink-0 text-[#111b21] dark:text-[#e9edef]" />
                                                                        <span className={`truncate min-w-0 ${selectedChat?.currentVacancyId === vac.id ? 'text-blue-600 font-bold' : 'text-[#111b21] dark:text-[#e9edef]'}`}>{vac.name}</span>
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); sendVacancyDirect(vac); }}
                                                                            title="Enviar directo al chat"
                                                                            className="p-0.5 shrink-0 rounded-full text-gray-400 hover:text-white hover:bg-[#25d366] transition-colors"
                                                                        >
                                                                            <Send className="w-3 h-3" />
                                                                        </button>
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
                                                onClick={(e) => { e.stopPropagation(); if (showDropdown === 'tags') { setShowDropdown(null); setTagSearch(''); } else { setShowDropdown('tags'); } }}
                                                className={`${baseClass} hover:bg-black/5 dark:hover:bg-white/5 ${showDropdown === 'tags' ? 'bg-black/5 dark:bg-white/5' : ''}`}>
                                                <Tag className="w-5 h-5" />
                                            </button>
                                            <div className={`absolute right-0 top-full mt-1 w-72 bg-white dark:bg-[#202c33] rounded-lg shadow-xl transition-all z-50 border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col ${showDropdown === 'tags' ? 'opacity-100 pointer-events-auto translate-y-0' : 'opacity-0 pointer-events-none -translate-y-2'}`}>
                                                <div className="px-3 py-2 text-xs font-bold text-[#8696a0] border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-[#111b21]">
                                                    <span>Etiquetar candidato</span>
                                                </div>
                                                <div className="px-2 py-1.5 border-b border-gray-100 dark:border-gray-700">
                                                    <div className="relative">
                                                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                                                        <input
                                                            type="text"
                                                            placeholder="Buscar etiqueta..."
                                                            value={tagSearch}
                                                            onChange={e => setTagSearch(e.target.value)}
                                                            onClick={e => e.stopPropagation()}
                                                            className="w-full text-xs pl-6 pr-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#111b21] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="max-h-52 overflow-y-auto custom-scrollbar">
                                                    {orderedAvailableTags.filter(tagObj => {
                                                        if (!tagSearch.trim()) return true;
                                                        const n = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                                        return `${n} ${formatTagLabel(n)}`.toLowerCase().includes(tagSearch.trim().toLowerCase());
                                                    }).map(tagObj => {
                                                        const tName = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                                        const tColor = typeof tagObj === 'string' ? '#3b82f6' : tagObj.color;
                                                        const display = tagObj.count !== undefined ? `${formatTagLabel(tName)} (${tagObj.count})` : formatTagLabel(tName);
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
                                                                draggable={!tagSearch}
                                                                onDragStart={(e) => { e.stopPropagation(); setTagDraggedName(tName); e.dataTransfer.effectAllowed = 'move'; }}
                                                                onDragOver={(e) => { if (!tagDraggedName) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (tagDragOverName !== tName) setTagDragOverName(tName); }}
                                                                onDrop={(e) => { e.preventDefault(); handleTagDrop(tName); }}
                                                                onDragEnd={() => { setTagDraggedName(null); setTagDragOverName(null); }}
                                                                className={`px-3 py-2 text-sm text-[#111b21] dark:text-[#e9edef] hover:bg-gray-50 dark:hover:bg-[#202c33] flex items-center justify-between group/item cursor-pointer ${tagDraggedName === tName ? 'opacity-40' : ''} ${tagDragOverName === tName && tagDraggedName && tagDraggedName !== tName ? 'shadow-[inset_0_2px_0_0_#22c55e]' : ''}`}
                                                                onClick={() => handleToggleTag(tName)}
                                                            >
                                                                <div className="flex-1 flex items-center gap-2 min-w-0">
                                                                    {!tagSearch && (
                                                                        <GripVertical className="w-3 h-3 shrink-0 text-gray-300 dark:text-gray-600 opacity-0 group-hover/item:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />
                                                                    )}
                                                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tColor }}></span>
                                                                    <span className="truncate">{display}</span>
                                                                    {isActive && <Check className="w-4 h-4 text-blue-500 ml-1 shrink-0" />}
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
                                            onClick={() => setQuickRepliesPanelOpen(!showQuickRepliesPanel)}
                                            className={`${baseClass} ${showQuickRepliesPanel ? 'bg-green-50 text-green-600 dark:bg-green-500/20 dark:text-green-400' : 'hover:bg-black/5 dark:hover:bg-white/5 text-[#54656f] dark:text-[#aebac1]'}`}
                                            title="Banco de Respuestas"
                                        >
                                            <BookOpen className="w-5 h-5" />
                                        </button>
                                    );
                                }

                                return null;
                            })}

                            {/* Search icon */}
                            <button
                                onClick={() => { setShowChatSearch(v => !v); if (!showChatSearch) setTimeout(() => chatSearchInputRef.current?.focus(), 50); }}
                                className={`p-2 rounded-full transition-all ${showChatSearch ? 'bg-black/10 dark:bg-white/10 text-[#111b21] dark:text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 text-[#54656f] dark:text-[#aebac1]'}`}
                                title="Buscar en conversación"
                            >
                                <Search className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* In-chat search bar */}
                    {showChatSearch && (
                        <div className="bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#d1d7db] dark:border-[#222e35] px-4 py-2 flex items-center gap-2 z-20 shrink-0">
                            <Search className="w-4 h-4 text-[#54656f] dark:text-[#aebac1] shrink-0" />
                            <input
                                ref={chatSearchInputRef}
                                autoFocus
                                type="text"
                                placeholder="Buscar en conversación..."
                                value={chatSearch}
                                onChange={e => { setChatSearch(e.target.value); setChatSearchIdx(0); }}
                                className="flex-1 bg-transparent outline-none text-[14px] text-[#111b21] dark:text-[#e9edef] placeholder-[#8696a0]"
                            />
                            {chatSearch && (
                                <span className="text-[11px] text-[#8696a0] shrink-0">
                                    {displayMessages.filter(m => m.type !== 'date-separator' && m.type !== 'unread-separator' && typeof m.content === 'string' && m.content.toLowerCase().includes(chatSearch.toLowerCase())).length} resultados
                                </span>
                            )}
                            <button onClick={() => { setShowChatSearch(false); setChatSearch(''); }} className="p-1 rounded-full text-[#54656f] hover:text-[#111b21] dark:text-[#aebac1] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {/* WhatsApp Background Pattern */}
                    <div 
                        className="absolute inset-0 z-0 opacity-[0.4] dark:opacity-[0.05] pointer-events-none"
                        style={{
                            backgroundImage: 'url("/whatsapp-bg.png")',
                            backgroundRepeat: 'repeat',
                            backgroundSize: '350px'
                        }}
                    ></div>

                    {/* Mensajes — Virtualized (react-virtuoso: solo renderiza items visibles) */}
                    <div className="flex-1 overflow-hidden z-10 min-h-0" onClick={() => setShowDropdown(null)}>
                        <Virtuoso
                            ref={virtuosoRef}
                            scrollerRef={(el) => { virtuosoScrollerRef.current = el; }}
                            style={{ height: '100%' }}
                            data={displayMessages}
                            // Con pocos mensajes (lista mas corta que el viewport) Virtuoso alinea
                            // arriba por defecto: las burbujas quedan pegadas al tope y el hueco vacio
                            // abajo, junto al input. Al inyectar del banco algo con imagenes (~520px),
                            // la lista cruzaba de "cabe" a "se desborda" de golpe y scrollToBottom
                            // saltaba el scroll de 0 al fondo = brinco. alignToBottom ancla los mensajes
                            // ABAJO (estilo WhatsApp) para que la inyeccion se extienda suave desde el
                            // fondo tanto con pocos como con muchos mensajes.
                            alignToBottom
                            initialTopMostItemIndex={displayMessages.length > 0 ? displayMessages.length - 1 : 0}
                            followOutput={(isAtBottom) => {
                                // Mismo criterio que totalListHeightChanged: Virtuoso llama esto en
                                // CUALQUIER cambio de `data` (incluida una palomita de estado), no solo
                                // cuando llega una burbuja nueva — sin messagesGrew se auto-scrolleaba
                                // de mas durante todo el envio, aunque nada nuevo hubiera aparecido.
                                if (isSendingRef.current && messagesGrew) return 'auto';
                                return isAtBottom ? 'auto' : false;
                            }}
                            computeItemKey={(index, msg) => getStableMessageKey(msg, index)}
                            overscan={400}
                            atBottomThreshold={150}
                            components={MESSAGES_VIRTUOSO_COMPONENTS}
                            totalListHeightChanged={() => {
                                // Durante la ventana "acabo de enviar" (~2s), SOLO scrollear si la lista
                                // CRECIÓ (burbuja nueva) — así enviar texto+2 fotos hace UN solo scroll al
                                // montar el grupo, no ~8 snaps por cada re-medición (palomita de estado,
                                // marco de imagen). Eso enmascaraba la animación y se veía como brinco.
                                // Fuera de esa ventana, el comportamiento normal (anclar al fondo si estás
                                // abajo) se conserva para el flujo de mensajes entrantes.
                                const inSendHold = Date.now() < sendScrollHoldUntilRef.current;
                                const atBottomTrigger = inSendHold ? messagesGrew : isAtBottomRef.current;
                                if (bottomAnchorRef.current || atBottomTrigger) {
                                    // Mismo scrollToBottom() para cualquier tamaño de mensaje — ya espera
                                    // el frame que Virtuoso necesita para medir burbujas altas (ver arriba),
                                    // así que un texto largo (vacante/maletita) no necesita mecanismo aparte.
                                    scrollToBottom();
                                    // bottomAnchorRef es una bandera de "una sola vez" (se activa al abrir un
                                    // chat o cargar sus mensajes) — sin este reset se quedaba encendida para
                                    // siempre, forzando scroll al fondo en CADA cambio de altura de la lista
                                    // (cualquier mensaje nuevo, imagen cargando, reaccion) sin importar si el
                                    // usuario habia subido a leer historial. Eso causaba el parpadeo.
                                    bottomAnchorRef.current = false;
                                }
                            }}
                            atBottomStateChange={(isAtBottom) => {
                                setShowScrollBtn(!isAtBottom);
                                isAtBottomRef.current = isAtBottom;
                                if (isAtBottom) {
                                    isSendingRef.current = false;
                                    setUnseenCount(0);
                                }
                            }}
                            itemContent={(index, msg) => {
                            if (!msg) return <div style={{ height: 0 }} />;

                            // Date separator chip
                            if (msg.type === 'date-separator') {
                                return <div className="px-[5%]"><DateSeparator date={msg.date} /></div>;
                            }

                            // Unread separator
                            if (msg.type === 'unread-separator') {
                                return (
                                    <div className="px-[5%] flex items-center justify-center my-2 select-none">
                                        <div className="bg-[#d0f0e8] dark:bg-[#025144]/60 text-[#075e54] dark:text-[#00a884] text-[11px] font-medium px-3 py-1 rounded-full shadow-sm border border-black/5 dark:border-white/5">
                                            {msg.count} mensaje{msg.count !== 1 ? 's' : ''} no leído{msg.count !== 1 ? 's' : ''}
                                        </div>
                                    </div>
                                );
                            }

                            // Prevenir renderizado de burbujas fantasma (eventos de sistema sin texto ni multimedia)
                            if (!msg.content && !msg.mediaUrl) return <div style={{ height: 0 }} />;
                            const _isLast = index === displayMessages.length - 1;

                            return (
                                <div>
                                <MessageBubble
                                    msg={msg}
                                    chatWhatsapp={selectedChat?.whatsapp}
                                    chatNombre={selectedChat?.nombre}
                                    chatId={selectedChat?.id}
                                    reactionPopupId={reactionPopupId}
                                    onReaction={setReactionPopupId}
                                    onReply={setReplyingToMsg}
                                    onSendReaction={handleSendReaction}
                                />
                                </div>
                            );
                        }}
                        />
                    </div>

                    {/* Typing Indicator — fuera de Virtuoso, siempre visible sobre el input */}
                    {candidateTyping && (
                        <div className="flex justify-start px-[5%] py-1 z-10 shrink-0">
                            <div className="bg-white dark:bg-[#202c33] rounded-[7.5px] rounded-tl-none px-3 py-2.5 shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                                <div className="flex items-center gap-1 h-4">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#8696a0] animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#8696a0] animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#8696a0] animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Scroll-to-bottom button */}
                    {showScrollBtn && (
                        <button
                            onClick={() => { scrollToBottom(); setUnseenCount(0); }}
                            className="absolute bottom-[72px] right-5 z-30 w-10 h-10 rounded-full bg-white dark:bg-[#202c33] shadow-lg flex items-center justify-center border border-black/10 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-[#2a3942] transition-colors"
                            title="Ir al final"
                        >
                            {unseenCount > 0 && (
                                <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#25d366] text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 shadow-sm pointer-events-none">
                                    {unseenCount > 99 ? '99+' : unseenCount}
                                </span>
                            )}
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#54656f] dark:text-[#aebac1]"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </button>
                    )}

                    {/* Input Area + preview de imágenes pendientes de QR.
                        La tira de preview va como OVERLAY absoluto (bottom-full) sobre el input,
                        NO en el flujo flex: si estuviera en flujo, al enviar (setPendingQrImages([]))
                        se desmontaba en el mismo commit que inyecta las burbujas → la lista flex-1
                        crecía ~72px → Virtuoso re-anclaba su scroll → micro-parpadeo de las burbujas
                        recién inyectadas (solo visible en envíos CON imágenes del banco). Al sacarla
                        del flujo, montarla/desmontarla ya no cambia la altura de la lista. */}
                    <div className="relative shrink-0">
                        {pendingQrImages.length > 0 && (
                            <div className="absolute bottom-full inset-x-0 z-20 px-3 pt-2 pb-1 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#d1d7db] dark:border-[#222e35] shadow-[0_-1px_2px_rgba(11,20,26,.08)] flex items-center gap-2">
                                {pendingQrImages.map((imgUrl, idx) => (
                                    <div key={idx} className="relative shrink-0">
                                        <img src={imgUrl} alt="preview" className="w-14 h-14 object-cover rounded-lg border border-gray-300 dark:border-gray-600" />
                                        <button
                                            type="button"
                                            onClick={() => setPendingQrImages(prev => prev.filter((_, i) => i !== idx))}
                                            className="absolute -top-1.5 -right-1.5 bg-gray-600 hover:bg-red-500 text-white rounded-full p-0.5 transition-colors"
                                            title="Quitar imagen"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                                <span className="text-[11px] text-[#667781] dark:text-[#8696a0]">
                                    {pendingQrImages.length === 1 ? 'Imagen adjunta' : `${pendingQrImages.length} imágenes adjuntas`} · se enviarán en orden
                                </span>
                            </div>
                        )}

                        <MessageInputBox
                            ref={messageInputRef}
                            isMobile={isMobile}
                            onSend={handleSend}
                            hasPendingMedia={pendingQrImages.length > 0}
                            onTyping={handleTyping}
                            // Al crecer el input (tecleo multilínea o inyección de banco/vacante) el
                            // viewport de mensajes se encoge; si el reclutador ya estaba al fondo,
                            // re-anclamos para que el último mensaje no quede tapado por el input.
                            // Protegido por isAtBottomRef → NO jala a quien está leyendo historial.
                            onHeightChange={() => { if (isAtBottomRef.current) scrollToBottom(); }}
                            fileInputRef={fileInputRef}
                            handleFileUpload={handleFileUpload}
                            replyingToMsg={replyingToMsg}
                            onCancelReply={() => setReplyingToMsg(null)}
                            metaTemplates={metaTemplates}
                            onSendTemplate={handleSendTemplate}
                            onSendVCard={() => setShowVCardModal(true)}
                            onSendInteractive={() => setShowInteractiveModal(true)}
                            onSendLocation={() => setShowLocationModal(true)}
                            onSendList={() => setShowListModal(true)}
                            onSendProduct={() => setShowProductModal(true)}
                            templatePreviewName={selectedChat?.nombreReal?.trim().split(/\s+/).slice(0, 2).join(' ') || selectedChat?.nombre || 'Candidato'}
                        />
                    </div>
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
                <div className="absolute md:relative inset-y-0 right-0 z-30 w-full md:w-[340px] border-l border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] flex flex-col h-full shadow-2xl md:shadow-none">
                    {/* Header */}
                    <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#d1d7db] dark:border-[#222e35] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <BookOpen className="w-5 h-5 text-green-600 dark:text-green-400" />
                            <h3 className="font-bold text-sm text-[#111b21] dark:text-[#e9edef]">Banco de Respuestas</h3>
                        </div>
                        <button onClick={() => setQuickRepliesPanelOpen(false)} className="text-[#54656f] hover:text-[#111b21] dark:text-[#aebac1] dark:hover:text-white">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    {/* Panel cont... */}

                    {/* Create / Edit Form — contraible; editar una respuesta lo abre solo */}
                    <div className="p-3 border-b border-[#f0f2f5] dark:border-[#222e35] space-y-2">
                        <button
                            type="button"
                            onClick={toggleQrFormCollapsed}
                            className="w-full flex items-center justify-between text-left group/qrform"
                        >
                            <span className="text-xs font-bold text-[#111b21] dark:text-[#e9edef] flex items-center gap-1.5">
                                {editingQuickReply ? <><Pencil className="w-3.5 h-3.5 text-blue-500" /> Editar respuesta</> : <><Plus className="w-3.5 h-3.5 text-green-600" /> Crear respuesta</>}
                            </span>
                            {(qrFormCollapsed && !editingQuickReply)
                                ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover/qrform:text-gray-600 dark:group-hover/qrform:text-gray-200" />
                                : <ChevronUp className="w-4 h-4 text-gray-400 group-hover/qrform:text-gray-600 dark:group-hover/qrform:text-gray-200" />}
                        </button>
                        {(!qrFormCollapsed || editingQuickReply) && (<>
                        {qrForm.type !== 'location' && (
                            <input
                                type="text"
                                placeholder="Nombre (ej: Saludo inicial)"
                                value={qrForm.name}
                                onChange={(e) => setQrForm({ ...qrForm, name: e.target.value })}
                                className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors"
                            />
                        )}
                        {/* Tipo toggle */}
                        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
                            <button type="button"
                                onClick={() => setQrForm(prev => ({ ...prev, type: 'text' }))}
                                className={`flex-1 py-1.5 font-medium transition-colors ${(qrForm.type !== 'location' && qrForm.type !== 'audio') ? 'bg-green-600 text-white' : 'bg-white dark:bg-[#202c33] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a3942]'}`}>
                                📝 Texto / Imagen
                            </button>
                            <button type="button"
                                onClick={() => setQrForm(prev => ({ ...prev, type: 'audio' }))}
                                className={`flex-1 py-1.5 font-medium transition-colors border-x border-gray-200 dark:border-gray-700 ${qrForm.type === 'audio' ? 'bg-green-600 text-white' : 'bg-white dark:bg-[#202c33] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a3942]'}`}>
                                🎤 Audio
                            </button>
                            <button type="button"
                                onClick={() => setQrForm(prev => ({ ...prev, type: 'location' }))}
                                className={`flex-1 py-1.5 font-medium transition-colors ${qrForm.type === 'location' ? 'bg-green-600 text-white' : 'bg-white dark:bg-[#202c33] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a3942]'}`}>
                                📍 Ubicación
                            </button>
                        </div>

                        {qrForm.type === 'audio' ? (
                            <div className="space-y-2">
                                {qrForm.audioUrl ? (
                                    <div className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#202c33]">
                                        <audio src={qrForm.audioUrl} controls className="flex-1 h-9 min-w-0" />
                                        <button
                                            type="button"
                                            onClick={() => setQrForm(prev => ({ ...prev, audioUrl: '', audioMime: '', audioVoice: false, audioDurationMs: 0 }))}
                                            className="shrink-0 p-1.5 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                            title="Quitar audio"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        {qrRecording ? (
                                            <button
                                                type="button"
                                                onClick={stopQrRecording}
                                                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors"
                                            >
                                                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                                                <Square className="w-3.5 h-3.5" /> Detener ({String(Math.floor(qrRecordSecs / 60)).padStart(2, '0')}:{String(qrRecordSecs % 60).padStart(2, '0')})
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={startQrRecording}
                                                disabled={qrAudioUploading}
                                                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
                                            >
                                                {qrAudioUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                                                {qrAudioUploading ? 'Subiendo...' : 'Grabar nota de voz'}
                                            </button>
                                        )}
                                        <label className={`shrink-0 flex items-center justify-center gap-1 px-3 py-2.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:border-green-500 transition-colors text-[11px] text-gray-500 dark:text-gray-400 ${(qrRecording || qrAudioUploading) ? 'opacity-50 pointer-events-none' : ''}`} title="Subir archivo de audio">
                                            <Paperclip className="w-3.5 h-3.5" /> Subir
                                            <input type="file" accept="audio/*" className="hidden" onChange={async (e) => {
                                                const f = e.target.files?.[0];
                                                e.target.value = '';
                                                if (!f) return;
                                                const uploaded = await handleQrAudioUpload(f, f.name);
                                                if (uploaded?.url) setQrForm(prev => ({ ...prev, audioUrl: uploaded.url, audioMime: uploaded.mime || f.type, audioVoice: isOggOpus(uploaded.mime || f.type), audioDurationMs: 0 }));
                                            }} />
                                        </label>
                                    </div>
                                )}
                                {qrForm.audioUrl && (
                                    <p className={`text-[10px] leading-relaxed ${qrForm.audioVoice ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                        {qrForm.audioVoice
                                            ? '✅ Se enviará como nota de voz nativa (con onditas).'
                                            : '⚠️ Este formato se enviará como archivo de audio descargable (sin onditas). Para nota de voz nativa, graba con el botón 🎤.'}
                                    </p>
                                )}
                                {!qrForm.audioUrl && !qrRecording && (
                                    <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">
                                        🎤 Graba directamente (sale como nota de voz con onditas) o sube un archivo. Al hacer clic en la respuesta, se envía al instante.
                                    </p>
                                )}
                            </div>
                        ) : qrForm.type === 'location' ? (
                            <div className="space-y-2">
                                <input
                                    type="text"
                                    placeholder="Nombre del lugar (ej: HR One México)"
                                    value={qrForm.locName}
                                    onChange={e => setQrForm(prev => ({ ...prev, locName: e.target.value }))}
                                    className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors"
                                />
                                <input
                                    type="text"
                                    placeholder="Dirección (opcional)"
                                    value={qrForm.locAddress}
                                    onChange={e => setQrForm(prev => ({ ...prev, locAddress: e.target.value }))}
                                    className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors"
                                />
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Latitud (ej: 25.6866)"
                                        value={qrForm.locLat}
                                        onChange={e => setQrForm(prev => ({ ...prev, locLat: e.target.value }))}
                                        className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Longitud (ej: -100.316)"
                                        value={qrForm.locLng}
                                        onChange={e => setQrForm(prev => ({ ...prev, locLng: e.target.value }))}
                                        className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors"
                                    />
                                </div>
                                <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">
                                    💡 En Google Maps: clic derecho sobre el lugar → selecciona las coordenadas que aparecen (las copia automáticamente)
                                </p>
                            </div>
                        ) : (
                            <>
                                <textarea
                                    placeholder="Mensaje... (opcional si adjuntas imagen)"
                                    value={qrForm.message}
                                    onChange={(e) => setQrForm({ ...qrForm, message: e.target.value })}
                                    rows={5}
                                    className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors resize-y"
                                />
                                {/* Image slots */}
                                <div className="grid grid-cols-2 gap-2">
                                    {[{ key: 'imageUrl', label: 'Imagen 1' }, { key: 'imageUrl2', label: 'Imagen 2 (opcional)' }, { key: 'imageUrl3', label: 'Imagen 3 (opcional)' }, { key: 'imageUrl4', label: 'Imagen 4 (opcional)' }].map(({ key, label }) => (
                                        <div key={key} className="flex-1 relative">
                                            {qrForm[key] ? (
                                                <div className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                                                    <img src={qrForm[key]} alt="preview" className="w-full h-24 object-cover" />
                                                    <button
                                                        type="button"
                                                        onClick={() => setQrForm(prev => ({ ...prev, [key]: '' }))}
                                                        className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-0.5 transition-colors"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <label className={`flex flex-col items-center justify-center gap-1 w-full h-24 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:border-green-500 transition-colors text-[10px] text-gray-400 dark:text-gray-500 ${qrImageUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                                                    {qrImageUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                                                    <span>{label}</span>
                                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleQrImageUpload(f).then(url => url && setQrForm(prev => ({ ...prev, [key]: url }))); e.target.value = ''; }} />
                                                </label>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
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
                                    onClick={() => { setEditingQuickReply(null); setQrForm({ name: '', message: '', shortcut: '', imageUrl: '', imageUrl2: '', imageUrl3: '', imageUrl4: '', type: 'text', locName: '', locAddress: '', locLat: '', locLng: '', audioUrl: '', audioMime: '', audioVoice: false, audioDurationMs: 0 }); }}
                                    className="flex-1 text-xs py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#202c33] transition-colors font-medium"
                                >
                                    Cancelar
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={qrForm.type === 'location'
                                    ? (!qrForm.locLat || !qrForm.locLng || !qrForm.locName.trim())
                                    : qrForm.type === 'audio'
                                    ? (!qrForm.name.trim() || !qrForm.audioUrl || qrRecording || qrAudioUploading)
                                    : (!qrForm.name.trim() || (!qrForm.message.trim() && !qrForm.imageUrl && !qrForm.imageUrl2 && !qrForm.imageUrl3 && !qrForm.imageUrl4))
                                }
                                onClick={async () => {
                                    const isLoc = qrForm.type === 'location';
                                    const isAudio = qrForm.type === 'audio';
                                    const entry = {
                                        id: editingQuickReply?.id || `qr_${Date.now()}`,
                                        name: qrForm.name.trim() || qrForm.locName.trim(),
                                        shortcut: qrForm.shortcut.trim(),
                                        type: qrForm.type || 'text',
                                        ...(isLoc ? {
                                            location: { lat: parseFloat(qrForm.locLat), lng: parseFloat(qrForm.locLng), name: qrForm.locName.trim(), address: qrForm.locAddress.trim() }
                                        } : isAudio ? {
                                            audioUrl: qrForm.audioUrl,
                                            audioMime: qrForm.audioMime,
                                            voice: !!qrForm.audioVoice,
                                            audioDurationMs: qrForm.audioDurationMs || 0
                                        } : {
                                            message: qrForm.message.trim(),
                                            imageUrls: [qrForm.imageUrl, qrForm.imageUrl2, qrForm.imageUrl3, qrForm.imageUrl4].filter(Boolean)
                                        })
                                    };
                                    let newList;
                                    if (editingQuickReply) {
                                        newList = quickReplies.map(q => q.id === editingQuickReply.id ? entry : q);
                                    } else {
                                        newList = [...quickReplies, entry];
                                    }
                                    await saveQuickReplies(newList);
                                    setQrForm({ name: '', message: '', shortcut: '', imageUrl: '', imageUrl2: '', imageUrl3: '', imageUrl4: '', type: 'text', locName: '', locAddress: '', locLat: '', locLng: '', audioUrl: '', audioMime: '', audioVoice: false, audioDurationMs: 0 });
                                    setEditingQuickReply(null);
                                    showToast && showToast(editingQuickReply ? 'Respuesta actualizada' : 'Respuesta creada', 'success');
                                }}
                                className="flex-1 text-xs py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {editingQuickReply ? 'Actualizar' : 'Guardar'}
                            </button>
                        </div>
                        </>)}
                    </div>

                    {/* Buscador */}
                    <div className="px-3 py-2 border-b border-[#f0f2f5] dark:border-[#222e35]">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Buscar respuesta..."
                                value={qrSearch}
                                onChange={(e) => setQrSearch(e.target.value)}
                                className="w-full text-xs pl-8 pr-8 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors"
                            />
                            {qrSearch && (
                                <button
                                    onClick={() => setQrSearch('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                        {qrSearch && (
                            <p className="mt-1 text-[10px] text-gray-400">
                                {displayedQuickReplies.length} resultado{displayedQuickReplies.length === 1 ? '' : 's'} — el orden se arrastra sin búsqueda activa
                            </p>
                        )}
                    </div>

                    {/* List */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {quickReplies.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-600 p-6">
                                <BookOpen className="w-10 h-10 mb-3 opacity-30" />
                                <p className="text-xs text-center">Sin respuestas rápidas. Crea una arriba para empezar.</p>
                            </div>
                        ) : displayedQuickReplies.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-600 p-6">
                                <Search className="w-10 h-10 mb-3 opacity-30" />
                                <p className="text-xs text-center">Sin resultados para "{qrSearch}"</p>
                            </div>
                        ) : (
                            displayedQuickReplies.map(qr => (
                                <div
                                    key={qr.id}
                                    draggable={!qrSearch}
                                    onDragStart={(e) => { setQrDraggedId(qr.id); e.dataTransfer.effectAllowed = 'move'; }}
                                    onDragOver={(e) => { if (!qrDraggedId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (qrDragOverId !== qr.id) setQrDragOverId(qr.id); }}
                                    onDrop={(e) => { e.preventDefault(); handleQrDrop(qr.id); }}
                                    onDragEnd={() => { setQrDraggedId(null); setQrDragOverId(null); }}
                                    className={`px-4 py-3 border-b border-[#f0f2f5] dark:border-[#222e35] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] transition-colors group cursor-pointer ${
                                        qrDraggedId === qr.id ? 'opacity-40' : ''
                                    } ${qrDragOverId === qr.id && qrDraggedId && qrDraggedId !== qr.id ? 'shadow-[inset_0_2px_0_0_#22c55e]' : ''}`}
                                    onClick={() => handleApplyQuickReply(qr)}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        {!qrSearch && (
                                            <GripVertical className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 mb-1 min-w-0">
                                                <span className="text-xs font-bold text-[#111b21] dark:text-[#e9edef] truncate min-w-0">{qr.name}</span>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); sendBankReplyDirect(qr); }}
                                                    title="Enviar directo al chat"
                                                    className="p-1 shrink-0 rounded-full text-gray-400 hover:text-white hover:bg-[#25d366] transition-colors"
                                                >
                                                    <Send className="w-3 h-3" />
                                                </button>
                                                {qr.shortcut && (
                                                    <span className="ml-auto shrink-0 text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                                                        {qr.shortcut}
                                                    </span>
                                                )}
                                            </div>
                                            {qr.type === 'location' && qr.location ? (
                                                <div className="flex items-center gap-1 text-[11px] text-blue-500 dark:text-blue-400">
                                                    <MapPin className="w-3 h-3 shrink-0" />
                                                    <span className="line-clamp-1">{qr.location.name || qr.location.address || 'Ubicación'}</span>
                                                </div>
                                            ) : qr.type === 'audio' && qr.audioUrl ? (
                                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                    <Mic className={`w-3 h-3 shrink-0 ${qr.voice ? 'text-green-600 dark:text-green-400' : 'text-amber-500'}`} />
                                                    <audio src={qr.audioUrl} controls className="h-8 max-w-[220px] flex-1 min-w-0" />
                                                </div>
                                            ) : (
                                                <>
                                                    {qr.imageUrl && <img src={qr.imageUrl} alt="img" className="mb-1 rounded-md max-h-20 object-cover border border-gray-200 dark:border-gray-700" />}
                                                    {qr.message && <p className="text-[11px] text-[#667781] dark:text-[#8696a0] line-clamp-2 leading-relaxed">{qr.message}</p>}
                                                </>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setEditingQuickReply(qr); const imgs = qr.imageUrls || (qr.imageUrl ? [qr.imageUrl] : []); setQrForm({ name: qr.name, message: qr.message || '', shortcut: qr.shortcut || '', imageUrl: imgs[0] || '', imageUrl2: imgs[1] || '', imageUrl3: imgs[2] || '', imageUrl4: imgs[3] || '', type: qr.type || 'text', locName: qr.location?.name || '', locAddress: qr.location?.address || '', locLat: qr.location?.lat ? String(qr.location.lat) : '', locLng: qr.location?.lng ? String(qr.location.lng) : '', audioUrl: qr.audioUrl || '', audioMime: qr.audioMime || '', audioVoice: !!qr.voice, audioDurationMs: qr.audioDurationMs || 0 }); }}
                                                className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/20"
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
            
            {/* --- VCard Modal --- */}
            {showVCardModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
                        <button onClick={() => setShowVCardModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2">
                            <UserSquare className="w-6 h-6 text-blue-500" />
                            Enviar Contacto (vCard)
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Nombre del Contacto</label>
                                <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={vcardName} onChange={(e)=>setVcardName(e.target.value)} placeholder="Ej. Recursos Humanos" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Número de Teléfono</label>
                                <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={vcardPhone} onChange={(e)=>setVcardPhone(e.target.value)} placeholder="Ej. 8112345678" />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Empresa</label>
                                    <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white outline-none" value={vcardCompany} onChange={(e)=>setVcardCompany(e.target.value)} placeholder="Ej. Candidatic" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Puesto</label>
                                    <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white outline-none" value={vcardTitle} onChange={(e)=>setVcardTitle(e.target.value)} placeholder="Ej. Reclutador" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Email</label>
                                    <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white outline-none" value={vcardEmail} onChange={(e)=>setVcardEmail(e.target.value)} placeholder="ejemplo@correo.com" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Sitio Web</label>
                                    <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white outline-none" value={vcardUrl} onChange={(e)=>setVcardUrl(e.target.value)} placeholder="https://..." />
                                </div>
                            </div>
                            <button onClick={() => { handleSendVCard(vcardName, vcardPhone, vcardCompany, vcardTitle, vcardEmail, vcardUrl); setShowVCardModal(false); }} disabled={!vcardName || !vcardPhone} className="w-full mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all shadow-md hover:shadow-lg">
                                Enviar Tarjeta
                            </button>
                        </div>
                    </div>
                </div>
            )}

            
            {/* --- Location Modal --- */}
            {showLocationModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
                        <button onClick={() => setShowLocationModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2"><MapPin className="w-6 h-6 text-red-500" /> Enviar Ubicación</h2>
                        <div className="space-y-3">
                            <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white" value={locName} onChange={e=>setLocName(e.target.value)} placeholder="Nombre del lugar (Ej. Oficinas)" />
                            <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white" value={locAddress} onChange={e=>setLocAddress(e.target.value)} placeholder="Dirección completa" />
                            <div className="grid grid-cols-2 gap-2">
                                <input type="number" step="any" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white" value={locLat} onChange={e=>setLocLat(e.target.value)} placeholder="Latitud (25.6866)" />
                                <input type="number" step="any" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white" value={locLng} onChange={e=>setLocLng(e.target.value)} placeholder="Longitud (-100.316)" />
                            </div>
                            <button onClick={() => { handleSendLocation(locName, locAddress, locLat, locLng); setShowLocationModal(false); }} disabled={!locLat || !locLng} className="w-full mt-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl">Enviar Mapa</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- List Message Modal --- */}
            {showListModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in">
                        <button onClick={() => setShowListModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2"><ListIcon className="w-6 h-6 text-indigo-500" /> Menú de Opciones (Lista)</h2>
                        <div className="space-y-3">
                            <textarea className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" rows="2" value={listBody} onChange={e=>setListBody(e.target.value)} placeholder="Mensaje principal..." />
                            <div className="grid grid-cols-2 gap-2">
                                <input type="text" maxLength="20" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" value={listBtnText} onChange={e=>setListBtnText(e.target.value)} placeholder="Texto botón (Ver Opciones)" />
                                <input type="text" maxLength="24" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" value={listSection} onChange={e=>setListSection(e.target.value)} placeholder="Título sección (Vacantes)" />
                            </div>
                            <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-3">
                                <label className="block text-xs font-semibold text-slate-500 mb-2">Ítems de la Lista (Máx 10)</label>
                                {listItems.map((item, i) => (
                                    <div key={i} className="flex flex-col gap-1 mb-2 bg-slate-50 dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 relative">
                                        <input type="text" maxLength="24" className="w-full bg-transparent border-none text-sm outline-none font-medium" value={item.title} onChange={e=>{const n=[...listItems]; n[i].title=e.target.value; setListItems(n)}} placeholder="Título (Ej. Almacenista)" />
                                        <input type="text" maxLength="72" className="w-full bg-transparent border-none text-xs text-slate-500 outline-none" value={item.description} onChange={e=>{const n=[...listItems]; n[i].description=e.target.value; setListItems(n)}} placeholder="Descripción breve" />
                                        {listItems.length > 1 && <button onClick={()=>{setListItems(listItems.filter((_,idx)=>idx!==i))}} className="absolute top-2 right-2 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>}
                                    </div>
                                ))}
                                {listItems.length < 10 && <button onClick={()=>setListItems([...listItems, {title:'', description:''}])} className="text-xs text-indigo-500 hover:text-indigo-600 font-bold flex items-center gap-1"><Plus className="w-3 h-3"/> Agregar Ítem</button>}
                            </div>
                            <button onClick={() => { const valids = listItems.filter(i=>i.title); handleSendList(listBody, listBtnText, listSection, valids); setShowListModal(false); }} disabled={!listBody || !listItems[0].title} className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl">Enviar Lista</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Product Catalog Modal --- */}
            {showProductModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in">
                        <button onClick={() => setShowProductModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2"><ShoppingBag className="w-6 h-6 text-emerald-500" /> Producto (Catálogo)</h2>
                        <div className="space-y-3">
                            <textarea className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" rows="2" value={prodBody} onChange={e=>setProdBody(e.target.value)} placeholder="Mensaje principal..." />
                            <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" value={prodCatalog} onChange={e=>setProdCatalog(e.target.value)} placeholder="Catalog ID (Ej. 1234567890)" />
                            <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" value={prodSku} onChange={e=>setProdSku(e.target.value)} placeholder="Product Retailer ID (SKU)" />
                            <button onClick={() => { handleSendProduct(prodBody, prodCatalog, prodSku); setShowProductModal(false); }} disabled={!prodCatalog || !prodSku} className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl">Enviar Producto</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Interactive Buttons Modal --- */}
            {showInteractiveModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
                        <button onClick={() => setShowInteractiveModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2">
                            <MousePointerClick className="w-6 h-6 text-purple-500" />
                            Botones Interactivos
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Mensaje Principal</label>
                                <textarea className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none resize-none transition-all" rows="2" value={interactiveBody} onChange={(e)=>setInteractiveBody(e.target.value)} placeholder="¿Te interesa continuar con el proceso?" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Opciones (Máx 3, 20 caract. c/u)</label>
                                {[0,1,2].map(i => (
                                    <input key={i} type="text" maxLength="20" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none mb-2 transition-all" value={interactiveBtns[i]} onChange={(e) => {
                                        const newBtns = [...interactiveBtns];
                                        newBtns[i] = e.target.value;
                                        setInteractiveBtns(newBtns);
                                    }} placeholder={`Opción ${i+1}`} />
                                ))}
                            </div>
                            <button onClick={() => { 
                                const validBtns = interactiveBtns.filter(b => b.trim());
                                handleSendInteractive(interactiveBody, validBtns); 
                                setShowInteractiveModal(false); 
                            }} disabled={!interactiveBody || interactiveBtns.filter(b => b.trim()).length === 0} className="w-full mt-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all shadow-md hover:shadow-lg">
                                Enviar Botones
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal config={confirmModal} onClose={() => setConfirmModal(null)} />

            {reminderModalCandidate && (
                <CandidateReminderModal
                    candidate={reminderModalCandidate}
                    onClose={() => setReminderModalCandidate(null)}
                />
            )}
        </div>
    );
}
