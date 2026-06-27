import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Send, ChevronDown, Users, Lock, Trash2, Monitor, MonitorOff, X } from 'lucide-react';

const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];
import { useAuthContext } from '../contexts/AuthContext';

function MsgStatus({ status, opt }) {
    if (opt) return (
        <svg className="w-3 h-3 text-white/40 shrink-0" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
    );
    const color = status === 'read' ? 'text-blue-300' : 'text-white/50';
    if (status === 'delivered' || status === 'read') return (
        <svg className={`w-4 h-3 ${color} shrink-0`} viewBox="0 0 20 14" fill="none">
            <path d="M1 7l4 4L11 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M7 7l4 4 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    );
    return (
        <svg className="w-3 h-3 text-white/50 shrink-0" viewBox="0 0 14 14" fill="none">
            <path d="M1 7l4 4 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    );
}

function playNotificationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
    } catch {}
}

function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

const COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500', 'bg-cyan-500'];
function avatarColor(name) { return COLORS[(name?.charCodeAt(0) || 0) % COLORS.length]; }

function Avatar({ name }) {
    return (
        <div className={`w-6 h-6 rounded-full ${avatarColor(name)} flex items-center justify-center text-white font-bold shrink-0 text-[10px]`}>
            {name?.charAt(0)?.toUpperCase() || '?'}
        </div>
    );
}

// Merge new messages into existing list, deduplicating by id.
// Replaces any optimistic (_opt) entry that matches the incoming real message.
function mergeMessages(prev, incoming) {
    const results = [...prev];
    for (const msg of (Array.isArray(incoming) ? incoming : [incoming])) {
        const existingIdx = results.findIndex(m => m.id === msg.id);
        if (existingIdx >= 0) {
            // Already present (possibly optimistic replaced by real) — update in place
            results[existingIdx] = msg;
            continue;
        }
        // Remove any matching optimistic (same sender + same content)
        const optIdx = results.findIndex(m => m._opt && m.from === msg.from && m.content === msg.content);
        if (optIdx >= 0) {
            results[optIdx] = msg;
        } else {
            results.push(msg);
        }
    }
    return results;
}

export default function InternalChat({ onlineUsers = [] }) {
    const { user } = useAuthContext();
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [unread, setUnread] = useState(0);
    const [sending, setSending] = useState(false);
    const [recipientId, setRecipientId] = useState(null);
    const [pulsing, setPulsing] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [hoveredMsg, setHoveredMsg] = useState(null);
    const [pickerFor, setPickerFor] = useState(null);
    const [sharing, setSharing] = useState(false);
    const [incomingOffer, setIncomingOffer] = useState(null);
    const [viewing, setViewing] = useState(false);

    const bottomRef = useRef(null);
    const inputRef = useRef(null);
    // Stable refs so SSE handler never has stale closures
    const myIdRef = useRef(null);
    const myIdAltRef = useRef(null);
    const openRef = useRef(false);
    const messagesRef = useRef([]);
    const recipientIdRef = useRef(null);
    const clearedAtRef = useRef(localStorage.getItem('internalChatClearedAt') || null);
    const pcRef = useRef(null);
    const localStreamRef = useRef(null);
    const videoRef = useRef(null);
    const pendingIceRef = useRef([]);

    const clearChat = useCallback(() => {
        const ts = new Date().toISOString();
        clearedAtRef.current = ts;
        localStorage.setItem('internalChatClearedAt', ts);
        setMessages([]);
    }, []);

    const sendSignal = useCallback((msgType, payload, toId) => {
        if (!toId || !myIdRef.current) return;
        fetch('/api/internal-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: myIdRef.current,
                fromName: user?.name || user?.nombre || 'Reclutador',
                to: toId,
                content: JSON.stringify(payload),
                msgType,
            }),
        }).catch(() => {});
    }, [user]);

    const stopShare = useCallback(() => {
        localStreamRef.current?.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
        pcRef.current?.close();
        pcRef.current = null;
        setSharing(false);
        const toId = recipientIdRef.current;
        if (toId && toId !== 'all') sendSignal('webrtc:end', {}, toId);
    }, [sendSignal]);

    const stopViewing = useCallback(() => {
        pcRef.current?.close();
        pcRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setViewing(false);
        pendingIceRef.current = [];
    }, []);

    const myId = user?.whatsapp || user?.id;
    myIdRef.current = myId;
    myIdAltRef.current = user?.id || user?.whatsapp;
    openRef.current = open;
    messagesRef.current = messages;
    recipientIdRef.current = recipientId;

    // Others online (excluding self)
    const others = onlineUsers.filter(u => {
        const id = u.whatsapp || u.userId;
        return id && id !== myId;
    });

    // Auto-select first online user as default DM recipient
    useEffect(() => {
        if (recipientId === null && others.length > 0) {
            setRecipientId(others[0].userId);
        }
    }, [others, recipientId]);

    const recipient = recipientId === 'all'
        ? { userId: 'all', userName: 'Todos' }
        : others.find(u => u.userId === recipientId) ?? (recipientId ? { userId: recipientId, userName: recipientId } : null);

    // ── Fetch message history ──────────────────────────────────────────────
    const fetchHistory = useCallback(() => {
        if (!myId) return;
        const params = new URLSearchParams({ whatsapp: myId });
        if (clearedAtRef.current) params.set('clearedAt', clearedAtRef.current);
        fetch(`/api/internal-chat?${params}`)
            .then(r => r.json())
            .then(d => {
                if (d.success && Array.isArray(d.messages)) {
                    setMessages(d.messages);
                    setLoaded(true);
                }
            })
            .catch(() => {});
    }, [myId]);

    // Load once when chat first opens
    useEffect(() => {
        if (open && !loaded) {
            fetchHistory();
            setUnread(0);
        }
        if (open) setUnread(0);
    }, [open, loaded, fetchHistory]);

    // SSE maneja tiempo real — no polling. Carga una vez al abrir el drawer.

    const containerRef = useRef(null);
    const isNearBottomRef = useRef(true);
    const justOpenedRef = useRef(false);

    // Track if user is near the bottom so we only auto-scroll when appropriate
    const handleScroll = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    }, []);

    // Scroll to bottom only when user is already near bottom or chat just opened
    useEffect(() => {
        if (!open) return;
        if (justOpenedRef.current || isNearBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: justOpenedRef.current ? 'auto' : 'smooth' });
            justOpenedRef.current = false;
        }
    }, [messages, open]);

    // Mark "just opened" so the first render scrolls to bottom
    useEffect(() => {
        if (open) {
            justOpenedRef.current = true;
            isNearBottomRef.current = true;
        }
    }, [open]);

    // Focus input when opened
    useEffect(() => {
        if (open) setTimeout(() => inputRef.current?.focus(), 50);
    }, [open]);

    // ── Status receipt helper ──────────────────────────────────────────────
    const sendReceipt = useCallback((msgId, status) => {
        fetch('/api/internal-chat', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msgId, status }),
        }).catch(() => {});
    }, []);

    // ── Reactions ─────────────────────────────────────────────────────────
    const react = useCallback((msgId, emoji) => {
        setPickerFor(null);
        const current = messagesRef.current.find(m => m.id === msgId);
        const myCurrentEmoji = current?.reactions?.[myId];
        const newEmoji = myCurrentEmoji === emoji ? '' : emoji; // toggle off si es el mismo

        // Optimistic
        setMessages(prev => prev.map(m => {
            if (m.id !== msgId) return m;
            const reactions = { ...(m.reactions || {}) };
            if (newEmoji) reactions[myId] = newEmoji;
            else delete reactions[myId];
            return { ...m, reactions };
        }));

        fetch('/api/internal-chat', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'react', msgId, userId: myId, emoji: newEmoji }),
        }).catch(() => {});
    }, [myId]);

    // ── SSE real-time handler ──────────────────────────────────────────────
    useEffect(() => {
        const handleWebRTC = async (e) => {
            const sig = e.detail;
            const me = myIdRef.current;
            if (!sig || sig.to !== me) return;
            let payload;
            try { payload = JSON.parse(sig.content); } catch { return; }

            if (sig.msgType === 'webrtc:offer') {
                pendingIceRef.current = [];
                setIncomingOffer({ from: sig.from, fromName: sig.fromName, sdp: payload.sdp });
                playNotificationSound();
            } else if (sig.msgType === 'webrtc:answer' && pcRef.current) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp)).catch(() => {});
            } else if (sig.msgType === 'webrtc:ice') {
                if (pcRef.current?.remoteDescription) {
                    try { await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch {}
                } else {
                    pendingIceRef.current.push(payload.candidate);
                }
            } else if (sig.msgType === 'webrtc:end') {
                stopViewing();
                setIncomingOffer(null);
            }
        };

        const handle = (e) => {
            const msg = e.detail;
            const me = myIdRef.current;
            const meAlt = myIdAltRef.current;
            if (!me || !msg?.id) return;

            const isMe = (v) => v && (v === me || v === meAlt);
            const relevant = msg.to === 'all' || isMe(msg.from) || isMe(msg.to);
            if (!relevant) return;
            if (clearedAtRef.current && (msg.timestamp || '') < clearedAtRef.current) return;

            setMessages(prev => mergeMessages(prev, msg));

            if (!isMe(msg.from) && !openRef.current) {
                setUnread(u => u + 1);
                playNotificationSound();
                setPulsing(true);
                setTimeout(() => setPulsing(false), 1200);
            }

            // Auto-receipt for DMs addressed to me
            if (msg.to !== 'all' && isMe(msg.to) && !isMe(msg.from)) {
                sendReceipt(msg.id, openRef.current ? 'read' : 'delivered');
            }
        };
        window.addEventListener('sse:internal:webrtc', handleWebRTC);
        window.addEventListener('sse:internal:message', handle);
        return () => {
            window.removeEventListener('sse:internal:webrtc', handleWebRTC);
            window.removeEventListener('sse:internal:message', handle);
        };
    }, [sendReceipt]); // sendReceipt is stable (useCallback with no deps)

    // ── SSE status updates ─────────────────────────────────────────────────
    useEffect(() => {
        const handle = (e) => {
            const { msgId, status } = e.detail;
            setMessages(prev => prev.map(m => m.id === msgId ? { ...m, status } : m));
        };
        window.addEventListener('sse:internal:status', handle);
        return () => window.removeEventListener('sse:internal:status', handle);
    }, []);

    // ── SSE reactions ──────────────────────────────────────────────────────
    useEffect(() => {
        const handle = (e) => {
            const { msgId, reactions } = e.detail;
            setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions } : m));
        };
        window.addEventListener('sse:internal:reaction', handle);
        return () => window.removeEventListener('sse:internal:reaction', handle);
    }, []);

    // ── Mark as read when chat opens or conversation changes ───────────────
    useEffect(() => {
        if (!open || !myId) return;
        const rId = recipientIdRef.current;
        if (!rId || rId === 'all') return;
        const toMark = messagesRef.current.filter(m =>
            m.to !== 'all' && m.from !== myId && m.status !== 'read' &&
            (m.from === rId || m.to === myId)
        );
        toMark.forEach(m => sendReceipt(m.id, 'read'));
    }, [open, recipientId, myId, sendReceipt]);

    // ── Send ───────────────────────────────────────────────────────────────
    const send = useCallback(async () => {
        const text = input.trim();
        if (!text || !myId || sending || !recipient) return;
        setInput('');
        setSending(true);

        const toId = recipient.whatsapp || recipient.userId;
        const optimistic = {
            id: `tmp_${Date.now()}`,
            from: myId,
            fromName: user?.name || user?.nombre || 'Yo',
            to: toId,
            toName: recipient.userName,
            content: text,
            timestamp: new Date().toISOString(),
            _opt: true,
        };
        setMessages(prev => [...prev, optimistic]);

        try {
            const res = await fetch('/api/internal-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: myId,
                    fromName: user?.name || user?.nombre || 'Reclutador',
                    fromRole: user?.role || 'User',
                    to: toId,
                    toName: recipient.userName,
                    content: text,
                }),
            });
            const data = await res.json();
            if (data.success) {
                // SSE may have already delivered this — mergeMessages handles both cases
                setMessages(prev => mergeMessages(prev, data.message));
            } else {
                setMessages(prev => prev.filter(m => !m._opt));
            }
        } catch {
            setMessages(prev => prev.filter(m => !m._opt));
        } finally {
            setSending(false);
            inputRef.current?.focus();
        }
    }, [input, myId, sending, recipient, user]);

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };

    if (!user) return null;

    const isPrivate = recipientId !== 'all';
    const recipientOnline = isPrivate && others.find(u => u.userId === recipientId);

    const startShare = async () => {
        const toId = recipientIdRef.current;
        if (!toId || toId === 'all') return;
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            localStreamRef.current = stream;
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            pcRef.current = pc;
            stream.getTracks().forEach(track => pc.addTrack(track, stream));
            stream.getVideoTracks()[0].onended = stopShare;
            pc.onicecandidate = ({ candidate }) => {
                if (candidate) sendSignal('webrtc:ice', { candidate }, toId);
            };
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendSignal('webrtc:offer', { sdp: offer }, toId);
            setSharing(true);
        } catch (err) {
            if (err.name !== 'NotAllowedError') console.error('Screen share:', err);
        }
    };

    const acceptShare = async () => {
        if (!incomingOffer) return;
        const { sdp, from } = incomingOffer;
        setIncomingOffer(null);
        setViewing(true);
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;
        pc.ontrack = ({ streams }) => {
            if (videoRef.current && streams[0]) videoRef.current.srcObject = streams[0];
        };
        pc.onicecandidate = ({ candidate }) => {
            if (candidate) sendSignal('webrtc:ice', { candidate }, from);
        };
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        for (const c of pendingIceRef.current) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
        }
        pendingIceRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal('webrtc:answer', { sdp: answer }, from);
    };

    const visibleMessages = messages.filter(m => {
        if (recipientId === 'all') return m.to === 'all';
        if (!recipientId) return false;
        return (
            (m.from === myId && m.to === recipientId) ||
            (m.from === recipientId && m.to === myId) ||
            (m._opt && m.from === myId && m.to === recipientId)
        );
    });

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {viewing && createPortal(
            <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 bg-black/60 shrink-0">
                    <span className="text-white text-sm font-medium flex items-center gap-2">
                        <Monitor className="w-4 h-4 text-blue-400" /> Pantalla compartida
                    </span>
                    <button onClick={stopViewing} className="flex items-center gap-1.5 text-white/80 hover:text-white text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-colors">
                        <X className="w-3.5 h-3.5" /> Cerrar
                    </button>
                </div>
                <video ref={videoRef} autoPlay playsInline className="flex-1 w-full object-contain" />
            </div>,
            document.body
        )}
            {open && (
                <div className="w-80 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
                    style={{ height: 460 }}>

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 bg-blue-600 dark:bg-blue-700 shrink-0">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-white" />
                            <span className="text-white font-bold text-sm">Chat del equipo</span>
                            {others.length > 0 && (
                                <span className="text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded-full">
                                    {others.length} en línea
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {messages.length >= 20 && (
                                <button
                                    onClick={clearChat}
                                    title="Limpiar chat"
                                    className="text-white/60 hover:text-white transition-colors flex items-center gap-1"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span className="text-[10px]">Limpiar</span>
                                </button>
                            )}
                            <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white transition-colors">
                                <ChevronDown className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Online users strip */}
                    {others.length > 0 && (
                        <div className="flex gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700 overflow-x-auto shrink-0">
                            <button
                                onClick={() => setRecipientId('all')}
                                className={`flex flex-col items-center gap-0.5 shrink-0 px-1.5 py-1 rounded-xl transition-colors ${recipientId === 'all' ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                            >
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${recipientId === 'all' ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`}>
                                    <Users className={`w-4 h-4 ${recipientId === 'all' ? 'text-white' : 'text-gray-500 dark:text-gray-400'}`} />
                                </div>
                                <span className={`text-[9px] font-medium ${recipientId === 'all' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>Todos</span>
                            </button>
                            {others.map(u => (
                                <button
                                    key={u.userId}
                                    onClick={() => setRecipientId(u.userId)}
                                    className={`flex flex-col items-center gap-0.5 shrink-0 px-1.5 py-1 rounded-xl transition-colors ${recipientId === u.userId ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                                >
                                    <div className="relative">
                                        <div className={`w-8 h-8 rounded-full ${avatarColor(u.userName)} flex items-center justify-center text-white text-xs font-bold ${recipientId === u.userId ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}>
                                            {u.userName?.charAt(0)?.toUpperCase() || '?'}
                                        </div>
                                        <span className="absolute bottom-0 right-0 w-2 h-2 bg-green-400 rounded-full border border-white dark:border-gray-900" />
                                    </div>
                                    <span className={`text-[9px] font-medium max-w-[48px] truncate ${recipientId === u.userId ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                        {u.userName?.split(' ')[0]}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Messages */}
                    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                        {visibleMessages.length === 0 && (
                            <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-8">
                                {others.length === 0 ? 'No hay nadie más en línea' : 'Nadie ha escrito aún. ¡Di hola!'}
                            </p>
                        )}
                        {visibleMessages.map((msg, i) => {
                            const isMe = msg.from === myId;
                            const prevMsg = messages[i - 1];
                            const showSender = !isMe && prevMsg?.from !== msg.from;
                            const isBroadcast = msg.to === 'all';
                            const rxEntries = Object.entries(msg.reactions || {});
                            // Group: emoji → [userIds]
                            const rxGroups = rxEntries.reduce((acc, [uid, em]) => {
                                acc[em] = acc[em] || [];
                                acc[em].push(uid);
                                return acc;
                            }, {});
                            const myReaction = msg.reactions?.[myId];
                            const isHovered = hoveredMsg === msg.id;
                            const pickerOpen = pickerFor === msg.id;

                            return (
                                <div
                                    key={msg.id}
                                    className={`flex gap-1.5 items-end ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
                                    onMouseEnter={() => setHoveredMsg(msg.id)}
                                    onMouseLeave={() => { setHoveredMsg(null); setPickerFor(null); }}
                                >
                                    {!isMe && showSender && <Avatar name={msg.fromName} />}
                                    {!isMe && !showSender && <div className="w-6 shrink-0" />}

                                    {/* Reaction button — siempre ocupa el espacio (w-6) para no mover la burbuja */}
                                    <div className="relative self-center w-6 shrink-0">
                                        <button
                                            onClick={() => setPickerFor(p => p === msg.id ? null : msg.id)}
                                            className={`w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-sm transition-opacity ${(isHovered || pickerOpen) && !msg._opt ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                                        >
                                            🙂
                                        </button>
                                        {pickerOpen && (
                                            <div className={`absolute bottom-8 ${isMe ? 'right-0' : 'left-0'} bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-600 flex gap-1 p-1.5 z-50`}>
                                                {['👍','❤️','😂','😮','😢','🙏'].map(em => (
                                                    <button
                                                        key={em}
                                                        onClick={() => react(msg.id, em)}
                                                        className={`w-8 h-8 rounded-full flex items-center justify-center text-base hover:bg-gray-100 dark:hover:bg-gray-700 transition-transform hover:scale-125 ${myReaction === em ? 'bg-blue-100 dark:bg-blue-900/40' : ''}`}
                                                    >
                                                        {em}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className={`max-w-[72%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                        {showSender && (
                                            <span className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5 ml-1">{msg.fromName}</span>
                                        )}
                                        <div className={`px-3 py-1.5 rounded-2xl text-sm leading-snug break-words ${
                                            isMe
                                                ? isBroadcast
                                                    ? 'bg-indigo-600 text-white rounded-tr-sm'
                                                    : 'bg-blue-600 text-white rounded-tr-sm'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-tl-sm'
                                        } ${msg._opt ? 'opacity-60' : ''}`}>
                                            {msg.content}
                                        </div>

                                        {/* Reaction pills */}
                                        {Object.keys(rxGroups).length > 0 && (
                                            <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                                                {Object.entries(rxGroups).map(([em, uids]) => (
                                                    <button
                                                        key={em}
                                                        onClick={() => react(msg.id, em)}
                                                        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                                            uids.includes(myId)
                                                                ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-600'
                                                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                                                        }`}
                                                    >
                                                        <span>{em}</span>
                                                        {uids.length > 1 && <span className="text-gray-500 dark:text-gray-400 font-medium">{uids.length}</span>}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        <div className={`flex items-center gap-1 mt-0.5 mx-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                                            <span className="text-[9px] text-gray-400">{formatTime(msg.timestamp)}</span>
                                            {isBroadcast
                                                ? <span className="text-[9px] text-indigo-400 flex items-center gap-0.5"><Users className="w-2.5 h-2.5" />Todos</span>
                                                : isMe
                                                    ? <MsgStatus status={msg.status} opt={msg._opt} />
                                                    : null
                                            }
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={bottomRef} />
                    </div>

                    {/* Incoming screen share banner */}
                    {incomingOffer && (
                        <div className="mx-3 mb-2 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-xl shrink-0">
                            <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">
                                🖥️ {incomingOffer.fromName} quiere compartir pantalla
                            </p>
                            <div className="flex gap-2">
                                <button onClick={acceptShare} className="flex-1 text-xs bg-blue-600 text-white rounded-lg py-1.5 font-medium hover:bg-blue-700 transition-colors">Aceptar</button>
                                <button onClick={() => setIncomingOffer(null)} className="flex-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg py-1.5 font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">Rechazar</button>
                            </div>
                        </div>
                    )}

                    {/* Recipient + Input */}
                    <div className="px-3 pb-3 pt-2 border-t border-gray-100 dark:border-gray-700 shrink-0">
                        {recipient && (
                            <div className={`flex items-center gap-1 mb-1.5 text-[10px] font-medium px-1 ${isPrivate ? 'text-blue-500' : 'text-indigo-500'}`}>
                                {isPrivate ? <Lock className="w-2.5 h-2.5" /> : <Users className="w-2.5 h-2.5" />}
                                <span>Para: <strong>{recipient.userName}</strong></span>
                            </div>
                        )}
                        {!recipient && others.length === 0 && (
                            <p className="text-[10px] text-gray-400 mb-1.5 px-1">Solo tú estás en línea</p>
                        )}
                        <div className="flex items-center gap-2">
                            <input
                                ref={inputRef}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={handleKey}
                                placeholder={recipient ? `Mensaje para ${recipient.userName}…` : 'Escribe un mensaje…'}
                                disabled={!recipient && others.length === 0}
                                className="flex-1 text-sm bg-gray-100 dark:bg-gray-800 rounded-full px-4 py-2 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50"
                            />
                            {recipientOnline && (
                                <button
                                    onClick={sharing ? stopShare : startShare}
                                    title={sharing ? 'Dejar de compartir' : 'Compartir pantalla'}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0 ${sharing ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                                >
                                    {sharing ? <MonitorOff className="w-3.5 h-3.5 text-white" /> : <Monitor className="w-3.5 h-3.5 text-gray-600 dark:text-gray-300" />}
                                </button>
                            )}
                            <button
                                onClick={send}
                                disabled={!input.trim() || sending || !recipient}
                                className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center disabled:opacity-40 hover:bg-blue-700 transition-colors shrink-0"
                            >
                                <Send className="w-3.5 h-3.5 text-white" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating button */}
            <div className="relative">
                {pulsing && (
                    <span className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-75 pointer-events-none" />
                )}
                <button
                    onClick={() => { setOpen(o => !o); if (!open) { setUnread(0); setPulsing(false); } }}
                    className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 shadow-lg flex items-center justify-center transition-all active:scale-95 relative"
                >
                    <MessageSquare className="w-5 h-5 text-white" />
                    {unread > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                            {unread > 9 ? '9+' : unread}
                        </span>
                    )}
                </button>
            </div>
        </div>
    );
}
