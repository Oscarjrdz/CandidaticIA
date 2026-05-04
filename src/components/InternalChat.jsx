import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, X, Send, ChevronDown, Users, Lock } from 'lucide-react';
import { useAuthContext } from '../contexts/AuthContext';

function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

const COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500', 'bg-cyan-500'];
function avatarColor(name) { return COLORS[(name?.charCodeAt(0) || 0) % COLORS.length]; }

function Avatar({ name, size = 6 }) {
    return (
        <div className={`w-${size} h-${size} rounded-full ${avatarColor(name)} flex items-center justify-center text-white font-bold shrink-0 text-[10px]`}>
            {name?.charAt(0)?.toUpperCase() || '?'}
        </div>
    );
}

export default function InternalChat({ onlineUsers = [] }) {
    const { user } = useAuthContext();
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [unread, setUnread] = useState(0);
    const [sending, setSending] = useState(false);
    const [recipientId, setRecipientId] = useState(null); // null = first online user or 'all'
    const [showRecipients, setShowRecipients] = useState(false);
    const bottomRef = useRef(null);
    const inputRef = useRef(null);
    const myId = user?.id || user?.whatsapp;

    // Others online (excluding self)
    const others = onlineUsers.filter(u => u.userId !== myId);

    // Auto-select first online user as default recipient (private by default)
    useEffect(() => {
        if (recipientId === null && others.length > 0) {
            setRecipientId(others[0].userId);
        }
    }, [others, recipientId]);

    const recipient = recipientId === 'all'
        ? { userId: 'all', userName: 'Todos' }
        : others.find(u => u.userId === recipientId) || (recipientId ? { userId: recipientId, userName: recipientId } : null);

    // Load history on first open
    useEffect(() => {
        if (!open || !myId) return;
        setUnread(0);
        fetch(`/api/internal-chat?userId=${encodeURIComponent(myId)}`)
            .then(r => r.json())
            .then(d => { if (d.success) setMessages(d.messages); })
            .catch(() => {});
    }, [open, myId]);

    // Scroll to bottom on new messages
    useEffect(() => {
        if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, open]);

    // Focus input when opened
    useEffect(() => {
        if (open) setTimeout(() => inputRef.current?.focus(), 50);
    }, [open]);

    // Real-time SSE — only show messages relevant to me
    useEffect(() => {
        const handle = (e) => {
            const msg = e.detail;
            if (!myId) return;
            const relevant = msg.to === 'all' || msg.from === myId || msg.to === myId;
            if (!relevant) return;
            setMessages(prev => {
                if (prev.some(m => m.id === msg.id)) return prev;
                return [...prev, msg];
            });
            if (msg.from !== myId && (!open || document.hidden)) {
                setUnread(u => u + 1);
            }
        };
        window.addEventListener('sse:internal:message', handle);
        return () => window.removeEventListener('sse:internal:message', handle);
    }, [open, myId]);

    const send = useCallback(async () => {
        const text = input.trim();
        if (!text || !myId || sending || !recipient) return;
        setInput('');
        setSending(true);

        const optimistic = {
            id: `tmp_${Date.now()}`,
            from: myId,
            fromName: user?.name || user?.nombre || 'Yo',
            to: recipient.userId,
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
                    to: recipient.userId,
                    toName: recipient.userName,
                    content: text,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setMessages(prev => prev.map(m => m._opt && m.content === text ? data.message : m));
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

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
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
                        <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white transition-colors">
                            <ChevronDown className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Online users strip */}
                    {others.length > 0 && (
                        <div className="flex gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700 overflow-x-auto shrink-0">
                            <button
                                onClick={() => { setRecipientId('all'); setShowRecipients(false); }}
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
                                    onClick={() => { setRecipientId(u.userId); setShowRecipients(false); }}
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
                    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                        {messages.length === 0 && (
                            <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-8">
                                {others.length === 0 ? 'No hay nadie más en línea' : 'Nadie ha escrito aún. ¡Di hola! 👋'}
                            </p>
                        )}
                        {messages.map((msg, i) => {
                            const isMe = msg.from === myId;
                            const prevMsg = messages[i - 1];
                            const showSender = !isMe && prevMsg?.from !== msg.from;
                            const isBroadcast = msg.to === 'all';

                            return (
                                <div key={msg.id} className={`flex gap-1.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                                    {!isMe && showSender && <Avatar name={msg.fromName} />}
                                    {!isMe && !showSender && <div className="w-6 shrink-0" />}
                                    <div className={`max-w-[78%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
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
                                        <div className={`flex items-center gap-1 mt-0.5 mx-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                                            <span className="text-[9px] text-gray-400">{formatTime(msg.timestamp)}</span>
                                            {isBroadcast
                                                ? <span className="text-[9px] text-indigo-400 flex items-center gap-0.5"><Users className="w-2.5 h-2.5" />Todos</span>
                                                : isMe
                                                    ? <span className="text-[9px] text-gray-400 flex items-center gap-0.5"><Lock className="w-2.5 h-2.5" />{msg.toName}</span>
                                                    : null
                                            }
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={bottomRef} />
                    </div>

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
            <button
                onClick={() => { setOpen(o => !o); if (!open) setUnread(0); }}
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
    );
}
