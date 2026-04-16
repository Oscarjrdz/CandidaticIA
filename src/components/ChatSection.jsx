import React, { useState, useEffect, useRef } from 'react';
import { Search, MoreVertical, MessageSquare, Plus, Smile, Paperclip, Mic, ArrowLeft, Send, Tag, Pencil, Check, X, Trash2, Briefcase, Kanban, BookOpen, Keyboard, Loader2, Edit2 } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import { getCandidates, blockCandidate, deleteCandidate } from '../services/candidatesService';
import ManualProjectsSidepanel from './ManualProjectsSidepanel';
import { formatRelativeDate } from '../utils/formatters';
import { useCandidatesSSE } from '../hooks/useCandidatesSSE';

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
        .replace(/```(.*?)```/g, '<code class="bg-black/5 dark:bg-black/30 px-1 py-0.5 rounded font-mono text-[11px]">$1</code>')
        .replace(/\[Imagen Adjunta:\s*(https?:\/\/[^\s\]]+)\](?:\nCaption:\s*(.*))?/gi, (match, url, caption) => {
            return `<div class="mt-1 mb-1"><img src="${url}" alt="Adjunto" class="max-w-[200px] object-cover rounded shadow-sm bg-transparent" />${caption ? `<div class="text-[11px] text-gray-600 dark:text-gray-300 mt-1">${caption}</div>` : ''}</div>`;
        })
        .replace(/\[Ubicación:\s*(.*?)\s*\(([-.\d]+),\s*([-.\d]+)\)\]/gi, (match, address, lat, lng) => {
            return `<div class="mt-1 mb-1 border border-black/10 dark:border-white/10 rounded overflow-hidden max-w-[220px]">
                <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" class="bg-gray-100 dark:bg-gray-800 p-2 text-blue-500 hover:text-blue-600 text-[11px] flex items-center gap-1 font-medium select-none whitespace-normal"><span class="text-xs shrink-0">📍</span> <span>Google Maps</span></a>
            </div>`;
        })
        .replace(/\[Sticker:\s*(https?:\/\/[^\s\]]+)\]/gi, (match, url) => {
            return `<div class="mt-1 mb-1"><img src="${url}" alt="Sticker" class="max-w-[120px] max-h-[120px] object-contain rounded bg-transparent" /></div>`;
        });
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

const ChatSection = ({ showToast, user, rolePermissions }) => {
    const { updatedCandidate: sseUpdate, newCandidate: sseNewCandidate } = useCandidatesSSE();
    const [candidates, setCandidates] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
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
    const [editingVac, setEditingVac] = useState(null);
    const [chatLocks, setChatLocks] = useState({});
    const [unreadCount, setUnreadCount] = useState(0);

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

    const [showEmojis, setShowEmojis] = useState(false);
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
    const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'unread', 'label', 'profile'
    const [filterValue, setFilterValue] = useState(null);
    const activeFilterRef = useRef('all');
    const filterValueRef = useRef(null);
    const selectedChatRef = useRef(null);

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

    // Load Data
    useEffect(() => {
        loadCandidates();
        loadTags();
        loadVacanciesList();
        loadManualProjects();
        loadProjects();

        // 🟢 FALLBACK polling (SSE handles real-time, this is safety net)
        const interval = setInterval(loadCandidates, 15000);

        // 🔔 Poll chat stats (unread counts + locks) — now O(1) on backend
        const statsInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/chat-stats');
                const data = await res.json();
                if (data.success) {
                    setUnreadCount(data.unreadCount || 0);
                    setChatLocks(data.locks || {});
                }
            } catch (e) { /* silent */ }
        }, 15000);
        // Initial fetch
        (async () => {
            try {
                const res = await fetch('/api/chat-stats');
                const data = await res.json();
                if (data.success) {
                    setUnreadCount(data.unreadCount || 0);
                    setChatLocks(data.locks || {});
                }
            } catch (e) { /* silent */ }
        })();

        return () => { clearInterval(interval); clearInterval(statsInterval); };
    }, []);

    // RBAC: Load candidate IDs from all allowed projects to create base filter
    useEffect(() => {
        if (!user || user.role === 'SuperAdmin') {
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
        // Refresh every 15s in case projects change
        const interval = setInterval(loadAllowedCandidates, 15000);
        return () => clearInterval(interval);
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
                    setNewMessage(qr.message);
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

        if (activeFilter === 'unread' && c?.unread !== true) {
            // Pin the selected chat in the UI even if it's no longer unread while they are actively viewing it
            if (selectedChatRef.current?.id !== c.id) return false;
        }
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
    }).sort((a, b) => {
        if (a?.unread && !b?.unread) return -1;
        if (!a?.unread && b?.unread) return 1;
        return 0; // Maintain recent timestamp sorting from backend
    });

    // ── Badge counts (from same candidates array, applying only RBAC filter, not category filter) ──
    const baseCandidates = (candidates || []).filter(c => {
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
    });
    const badgeCounts = {
        all: baseCandidates.length,
        allUnread: baseCandidates.filter(c => c?.unread === true).length,
        complete: baseCandidates.filter(c => isProfileComplete(c)).length,
        completeUnread: baseCandidates.filter(c => isProfileComplete(c) && c?.unread === true).length,
        incomplete: baseCandidates.filter(c => !isProfileComplete(c)).length,
        incompleteUnread: baseCandidates.filter(c => !isProfileComplete(c) && c?.unread === true).length
    };

    // Scroll to bottom
    const prevMessagesLength = useRef(0);
    useEffect(() => {
        if (messages.length > prevMessagesLength.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        prevMessagesLength.current = messages.length;
    }, [messages]);

    // 🚀 SSE-DRIVEN: Reload candidates + messages when SSE fires
    useEffect(() => {
        if (!sseUpdate) return;
        // A candidate was updated (new message arrived, status changed, etc)
        loadCandidates();
        // If the update is for the currently open chat, reload messages instantly
        if (sseUpdate.candidateId === selectedChat?.id) {
            loadMessages();
        }
    }, [sseUpdate]);

    // 🆕 SSE: New candidate arrived
    useEffect(() => {
        if (!sseNewCandidate) return;
        loadCandidates();
    }, [sseNewCandidate]);

    // Load messages
    useEffect(() => {
        if (!selectedChat) return;

        loadMessages();
        // 🟢 FALLBACK polling (SSE handles real-time, this is safety net)
        const interval = setInterval(loadMessages, 10000);

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
        // DO NOT clear unread on load anymore - clear it ONLY ON SEND.
        // setCandidates(prev => prev.map(c => c.id === selectedChat.id ? { ...c, unread: false } : c));

        return () => {
            clearInterval(interval);
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

    const injectVacancy = (vac) => {
        if (!vac || !vac.messageDescription) return;
        setNewMessage((prev) => {
            const baseStr = prev ? prev.trim() + '\n\n' : '';
            return baseStr + `💼 *Información sobre: ${vac.name}*\n\n${vac.messageDescription}`;
        });
        setShowDropdown(null);
        setTimeout(() => {
            const input = document.getElementById('chat-msg-input');
            if (input) input.focus();
        }, 50);
    };

    const handleSend = async (e) => {
        if (e) e.preventDefault();
        const msg = newMessage.trim();
        if (!msg || sending || !selectedChat) return;

        // Optimistic clear + focus so the user can immediately type again
        setNewMessage('');
        setTimeout(() => {
            const input = document.getElementById('chat-msg-input');
            if (input) input.focus();
        }, 10);

        setSending(true);

        const currentCandidateId = selectedChat.id;
        
        // Optimistic clear of unread!
        setCandidates(prev => prev.map(c => c.id === currentCandidateId ? { ...c, unread: false } : c));
        
        // Optimistic append
        setMessages(prev => [...(prev || []), {
            id: 'temp-' + Date.now(),
            content: msg,
            tipo: 'text',
            from: 'me',
            enviado_por_agente: 1, // Visual indicator for sent by us
            fecha: new Date().toISOString()
        }]);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidateId: selectedChat.id, message: msg, type: 'text' })
            });
            const data = await res.json();
            if (data.success) {
                loadMessages();
            } else {
                showToast && showToast('Error al enviar mensaje', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast && showToast('Error de red', 'error');
        } finally {
            setSending(false);
            // Backup focus
            setTimeout(() => {
                const input = document.getElementById('chat-msg-input');
                if (input) input.focus();
            }, 50);
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
            <div className={`w-full md:w-[30%] lg:w-[35%] xl:w-[500px] flex-col border-r border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] ${selectedChat ? 'hidden md:flex' : 'flex'}`}>
                
                {/* Eliminada la barra Header Izquierdo a petición del usuario */}

                {/* Barra de Búsqueda y Filtros Rápidos */}
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
                    <div className="flex flex-wrap content-start items-start gap-2 pb-1 pt-0 min-h-[105px]">
                        {canSeeFilter('filter_todos') && (
                            <button 
                                onClick={() => { setActiveFilter('all'); setFilterValue(null); setAiProjectFilter(null); setAiStepFilter(null); setManualPipelineFilter(null); setManualStepFilter(null); setShowDropdown(null); }}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent flex items-center gap-1.5 ${
                                    activeFilter === 'all' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                            >
                                Todos ({badgeCounts.all})
                                {badgeCounts.allUnread > 0 && (
                                    <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#25d366] text-white text-[10px] font-bold rounded-full">
                                        {badgeCounts.allUnread}
                                    </span>
                                )}
                            </button>
                        )}
                        {canSeeFilter('filter_unread') && (
                            <button 
                                onClick={() => { setActiveFilter('unread'); setFilterValue(null); setShowDropdown(null); }}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent flex items-center gap-1.5 ${
                                    activeFilter === 'unread' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                            >
                                No leídos ({badgeCounts.allUnread})
                                {badgeCounts.allUnread > 0 && (
                                    <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#25d366] text-white text-[10px] font-bold rounded-full">
                                        {badgeCounts.allUnread}
                                    </span>
                                )}
                            </button>
                        )}
                        {canSeeFilter('filter_complete') && (
                            <button 
                                onClick={() => { setActiveFilter('profile'); setFilterValue('complete'); setShowDropdown(null); }}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent flex items-center gap-1.5 ${
                                    activeFilter === 'profile' && filterValue === 'complete' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                            >
                                Completos ({badgeCounts.complete})
                                {badgeCounts.completeUnread > 0 && (
                                    <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#25d366] text-white text-[10px] font-bold rounded-full">
                                        {badgeCounts.completeUnread}
                                    </span>
                                )}
                            </button>
                        )}
                        {canSeeFilter('filter_incomplete') && (
                            <button 
                                onClick={() => { setActiveFilter('profile'); setFilterValue('incomplete'); setShowDropdown(null); }}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent flex items-center gap-1.5 ${
                                    activeFilter === 'profile' && filterValue === 'incomplete' 
                                    ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                    : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                }`}
                            >
                                Incompletos ({badgeCounts.incomplete})
                                {badgeCounts.incompleteUnread > 0 && (
                                    <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#25d366] text-white text-[10px] font-bold rounded-full">
                                        {badgeCounts.incompleteUnread}
                                    </span>
                                )}
                            </button>
                        )}

                        {/* Etiquetas Dropdown */}
                        {canSeeFilter('filter_labels') && (
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
                                <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-50 py-1 max-h-64 overflow-y-auto custom-scrollbar">
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
                                        const tagUnread = baseCandidates.filter(c => c?.unread === true && Array.isArray(c.tags) && c.tags.includes(tName)).length;
                                        return (
                                            <div 
                                                key={tName}
                                                onClick={() => { setActiveFilter('label'); setFilterValue(tName); setShowDropdown(null); }}
                                                className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer flex items-center gap-2"
                                            >
                                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tColor }}></span>
                                                <span className="truncate flex-1">{display}</span>
                                                {tagUnread > 0 && (
                                                    <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#25d366] text-white text-[10px] font-bold rounded-full shrink-0">
                                                        {tagUnread}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        )}

                        {/* Riel A: Proyectos (Maletín) */}
                        {canSeeFilter('filter_projects') && (
                        <div className="flex items-center gap-1 shrink-0">
                            <div className="relative">
                                <button 
                                    onClick={() => setShowDropdown(showDropdown === 'aiProject' ? null : 'aiProject')}
                                    className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent flex-shrink-0 ${
                                        aiProjectFilter 
                                        ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                        : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                    }`}
                                >
                                    <Briefcase className="w-3 h-3 mr-1.5" />
                                    {aiProjectFilter ? (projects.find(p => p.id === aiProjectFilter)?.name?.slice(0, 15) || 'Proyecto') : 'Proyectos'} 
                                    {aiProjectFilter && (
                                        <span 
                                            className="ml-2 w-4 h-4 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center hover:bg-black/20 dark:hover:bg-white/20"
                                            onClick={(e) => { e.stopPropagation(); setAiProjectFilter(null); setAiStepFilter(null); setShowDropdown(null); }}
                                        >
                                            <X size={10} />
                                        </span>
                                    )}
                                    {!aiProjectFilter && <span className="ml-1 text-[9px]">▼</span>}
                                </button>
                                {showDropdown === 'aiProject' && (
                                    <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-50 py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                        {filteredProjects.length === 0 ? (
                                            <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay proyectos</div>
                                        ) : (
                                            filteredProjects.map(project => {
                                                const projUnread = baseCandidates.filter(c => c?.unread === true && c.currentVacancyId === project.id).length;
                                                return (
                                                    <div
                                                        key={project.id}
                                                        onClick={() => {
                                                            setAiProjectFilter(project.id);
                                                            setAiStepFilter(null);
                                                            setShowDropdown(null);
                                                        }}
                                                        className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer flex items-center gap-2"
                                                        title={project.name}
                                                    >
                                                        <span className="truncate flex-1">{project.name}</span>
                                                        {projUnread > 0 && (
                                                            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#25d366] text-white text-[10px] font-bold rounded-full shrink-0">
                                                                {projUnread}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Pasos Dropdown (Riel A) */}
                            {aiProjectFilter && (
                                <div className="relative flex items-center">
                                    <div className="text-gray-300 dark:text-gray-700 mx-1">/</div>
                                    {(() => {
                                        const activeProject = projects.find(p => p.id === aiProjectFilter);
                                        if (!activeProject) return null;

                                        return (
                                            <>
                                                <button 
                                                    onClick={() => setShowDropdown(showDropdown === 'aiStep' ? null : 'aiStep')}
                                                    className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                                        aiStepFilter 
                                                        ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                                        : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                                    }`}
                                                >
                                                    {aiStepFilter ? (activeProject.steps?.find(s => s.id === aiStepFilter)?.name?.slice(0, 15) || 'Paso') : 'Pasos'} 
                                                    {aiStepFilter && (
                                                        <span 
                                                            className="ml-2 w-4 h-4 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center hover:bg-black/20 dark:hover:bg-white/20"
                                                            onClick={(e) => { e.stopPropagation(); setAiStepFilter(null); }}
                                                        >
                                                            <X size={10} />
                                                        </span>
                                                    )}
                                                    {!aiStepFilter && <span className="ml-1 text-[9px]">▼</span>}
                                                </button>
                                                {showDropdown === 'aiStep' && (
                                                    <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-50 py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                                        <div
                                                            onClick={() => { setAiStepFilter(null); setShowDropdown(null); }}
                                                            className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-[#111b21] font-medium"
                                                        >
                                                            Todos los Pasos
                                                        </div>
                                                        {activeProject.steps?.length === 0 ? (
                                                            <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay pasos</div>
                                                        ) : (
                                                            activeProject.steps?.map(step => {
                                                                const stepUnread = baseCandidates.filter(c => c?.unread === true && c.currentVacancyId === aiProjectFilter && c.pasoActual === step.id).length;
                                                                return (
                                                                    <div
                                                                        key={step.id}
                                                                        onClick={() => { setAiStepFilter(step.id); setShowDropdown(null); }}
                                                                        className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer flex items-center gap-2"
                                                                        title={step.name}
                                                                    >
                                                                        <span className="truncate flex-1">{step.name}</span>
                                                                        {stepUnread > 0 && (
                                                                            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#25d366] text-white text-[10px] font-bold rounded-full shrink-0">
                                                                                {stepUnread}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                        )}

                        {/* Riel B: CRM Manual */}
                        {canSeeFilter('filter_crm') && (
                        <div className="flex items-center gap-1 shrink-0">
                            <div className="relative">
                                <button 
                                    onClick={() => setShowDropdown(showDropdown === 'manualPipeline' ? null : 'manualPipeline')}
                                    className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent flex-shrink-0 ${
                                        manualPipelineFilter 
                                        ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                        : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                    }`}
                                >
                                    <Kanban className="w-3 h-3 mr-1.5" />
                                    {manualPipelineFilter ? (manualProjects.find(p => p.id === manualPipelineFilter)?.name?.slice(0, 15) || 'Pipeline') : 'CRM Manual'} 
                                    {manualPipelineFilter && (
                                        <span 
                                            className="ml-2 w-4 h-4 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center hover:bg-black/20 dark:hover:bg-white/20"
                                            onClick={(e) => { e.stopPropagation(); setManualPipelineFilter(null); setManualStepFilter(null); setShowDropdown(null); }}
                                        >
                                            <X size={10} />
                                        </span>
                                    )}
                                    {!manualPipelineFilter && <span className="ml-1 text-[9px]">▼</span>}
                                </button>
                                {showDropdown === 'manualPipeline' && (
                                    <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-50 py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                        {filteredManualProjects.length === 0 ? (
                                            <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay pipelines</div>
                                        ) : (
                                            filteredManualProjects.map(project => {
                                                const crmUnread = baseCandidates.filter(c => c?.unread === true && c.manualProjectId === project.id).length;
                                                return (
                                                    <div
                                                        key={project.id}
                                                        onClick={() => {
                                                            setManualPipelineFilter(project.id);
                                                            setManualStepFilter(null);
                                                            setShowDropdown(null);
                                                        }}
                                                        className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer flex items-center gap-2"
                                                        title={project.name}
                                                    >
                                                        <span className="truncate flex-1">{project.name}</span>
                                                        {crmUnread > 0 && (
                                                            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#25d366] text-white text-[10px] font-bold rounded-full shrink-0">
                                                                {crmUnread}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Pasos Dropdown (Riel B) */}
                            {manualPipelineFilter && (
                                <div className="relative flex items-center">
                                    <div className="text-gray-300 dark:text-gray-700 mx-1">/</div>
                                    {(() => {
                                        const activeProject = manualProjects.find(p => p.id === manualPipelineFilter);
                                        if (!activeProject) return null;

                                        return (
                                            <>
                                                <button 
                                                    onClick={() => setShowDropdown(showDropdown === 'manualStep' ? null : 'manualStep')}
                                                    className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border border-transparent ${
                                                        manualStepFilter 
                                                        ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#0a332c] dark:text-[#25d366]' 
                                                        : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
                                                    }`}
                                                >
                                                    {manualStepFilter ? (activeProject.steps?.find(s => s.id === manualStepFilter)?.name?.slice(0, 15) || 'Paso') : 'Pasos'} 
                                                    {manualStepFilter && (
                                                        <span 
                                                            className="ml-2 w-4 h-4 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center hover:bg-black/20 dark:hover:bg-white/20"
                                                            onClick={(e) => { e.stopPropagation(); setManualStepFilter(null); }}
                                                        >
                                                            <X size={10} />
                                                        </span>
                                                    )}
                                                    {!manualStepFilter && <span className="ml-1 text-[9px]">▼</span>}
                                                </button>
                                                {showDropdown === 'manualStep' && (
                                                    <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-[#202c33] border border-gray-100 dark:border-gray-700 shadow-xl rounded-lg z-50 py-1 max-h-64 overflow-y-auto custom-scrollbar">
                                                        <div
                                                            onClick={() => { setManualStepFilter(null); setShowDropdown(null); }}
                                                            className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-[#111b21] font-medium"
                                                        >
                                                            Todos los Pasos
                                                        </div>
                                                        {activeProject.steps?.length === 0 ? (
                                                            <div className="px-4 py-2.5 text-xs text-gray-500 italic">No hay pasos</div>
                                                        ) : (
                                                            activeProject.steps?.map(step => {
                                                                const stepUnread = baseCandidates.filter(c => c?.unread === true && c.manualProjectId === manualPipelineFilter && c.manualProjectStepId === step.id).length;
                                                                return (
                                                                    <div
                                                                        key={step.id}
                                                                        onClick={() => { setManualStepFilter(step.id); setShowDropdown(null); }}
                                                                        className="px-4 py-2.5 text-xs text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] cursor-pointer flex items-center gap-2"
                                                                        title={step.name}
                                                                    >
                                                                        <span className="truncate flex-1">{step.name}</span>
                                                                        {stepUnread > 0 && (
                                                                            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#25d366] text-white text-[10px] font-bold rounded-full shrink-0">
                                                                                {stepUnread}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
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
                                            <span className={`text-xs whitespace-nowrap ${chat.unread ? 'text-[#25d366] font-bold' : 'text-[#667781] dark:text-[#8696a0]'}`}>{formatRelativeDate(chat.ultimoMensaje)}</span>
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
                                        <div className="flex items-center shrink-0 ml-1 gap-1">
                                            {/* Unread green dot */}
                                            {chat.unread && (
                                                <span className="w-5 h-5 flex items-center justify-center bg-[#25d366] text-white text-[9px] font-bold rounded-full shadow-sm">
                                                    !
                                                </span>
                                            )}
                                            {/* Lock indicator - someone else is attending */}
                                            {chatLocks[chat.id] && chatLocks[chat.id].user !== (user?.name || '') && (
                                                <span className="text-[9px] text-amber-500 font-semibold truncate max-w-[60px]" title={`${chatLocks[chat.id].user} está atendiendo`}>
                                                    👤{chatLocks[chat.id].user?.split(' ')[0]}
                                                </span>
                                            )}
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
                                    {/* Info row: edad, escolaridad, municipio */}
                                    <div className="flex items-center gap-2 mt-1 text-[10px] text-[#8696a0] dark:text-[#697882] truncate">
                                        {chat.edad && <span>{chat.edad} años</span>}
                                        {chat.edad && chat.escolaridad && <span>•</span>}
                                        {chat.escolaridad && <span className="truncate">{chat.escolaridad}</span>}
                                        {(chat.edad || chat.escolaridad) && chat.municipio && <span>•</span>}
                                        {chat.municipio && <span className="truncate">{chat.municipio}</span>}
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
                                                            const vacUnread = baseCandidates.filter(c => c?.unread === true && c.currentVacancyId === vac.id).length;
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
                                                                        {vacUnread > 0 && (
                                                                            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#25d366] text-white text-[10px] font-bold rounded-full shrink-0">
                                                                                {vacUnread}
                                                                            </span>
                                                                        )}
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

                                        <div className="relative inline-block min-w-[110px] max-w-full group/msgbody">
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
                                                <div className="whitespace-pre-wrap leading-[1.35] inline-block break-words" style={{ paddingBottom: '16px', paddingRight: '80px', paddingTop: msg.mediaUrl ? '2px' : '0' }} dangerouslySetInnerHTML={{ __html: formatWhatsAppText(msg.content) }}></div>
                                            )}
                                            {!msg.content && <div style={{ paddingBottom: '16px', paddingRight: '80px' }}></div>}
                                            
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
                            <div className="absolute bottom-[70px] left-2 shadow-2xl z-[100] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                                <EmojiPicker 
                                    onEmojiClick={(eData) => {
                                        setNewMessage(prev => prev + eData.emoji);
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

                        <div className="flex space-x-3 text-[#54656f] dark:text-[#8696a0] items-center mb-1 mr-2 px-1">
                            <button type="button" onClick={() => setShowEmojis(!showEmojis)} className={`hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors ${showEmojis ? 'text-blue-500' : ''}`}><Smile className="w-[26px] h-[26px] stroke-[1.5]" /></button>
                            <button type="button" onClick={() => fileInputRef.current?.click()} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors"><Plus className="w-[26px] h-[26px] stroke-[1.5]" /></button>
                            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                        </div>
                        
                        <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-lg border-none shadow-[0_1px_0_rgba(11,20,26,.05)] focus-within:shadow-[0_1px_2px_rgba(11,20,26,.1)] transition-shadow flex items-center pr-1">
                            <input 
                                id="chat-msg-input"
                                autoComplete="off"
                                className="w-full bg-transparent border-none outline-none py-2.5 px-4 text-[#111b21] dark:text-[#d1d7db] placeholder-[#8696a0] resize-none overflow-hidden text-[15px]" 
                                placeholder="Escribe un mensaje"
                                value={newMessage}
                                onChange={(e) => {
                                    setNewMessage(e.target.value);
                                    handleTyping();
                                }}
                            />
                            {newMessage && (
                                <button 
                                    type="button" 
                                    title="Limpiar texto"
                                    onClick={() => setNewMessage('')}
                                    className="p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded-full mr-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
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
                            rows={3}
                            className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] outline-none focus:border-green-500 transition-colors resize-none"
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
                                    onClick={() => { setNewMessage(qr.message); setShowQuickRepliesPanel(false); }}
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
                                                    if (window.confirm(`¿Eliminar "${qr.name}"?`)) {
                                                        saveQuickReplies(quickReplies.filter(q => q.id !== qr.id));
                                                        showToast && showToast('Respuesta eliminada', 'success');
                                                    }
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
        </div>
    );
};

export default ChatSection;
