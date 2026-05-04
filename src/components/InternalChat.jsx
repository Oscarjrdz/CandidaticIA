import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, X, Send, ChevronDown } from 'lucide-react';
import { useAuthContext } from '../contexts/AuthContext';

function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function Avatar({ name, size = 6 }) {
    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500', 'bg-cyan-500'];
    const color = colors[(name?.charCodeAt(0) || 0) % colors.length];
    return (
        <div className={`w-${size} h-${size} rounded-full ${color} flex items-center justify-center text-white font-bold shrink-0`}
            style={{ fontSize: size * 2 }}>
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
    const bottomRef = useRef(null);
    const inputRef = useRef(null);
    const myId = user?.id || user?.whatsapp;

    // Load history on first open
    useEffect(() => {
        if (!open) return;
        setUnread(0);
        fetch('/api/internal-chat')
            .then(r => r.json())
            .then(d => { if (d.success) setMessages(d.messages); })
            .catch(() => {});
    }, [open]);

    // Scroll to bottom when messages change while open
    useEffect(() => {
        if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, open]);

    // Focus input when opened
    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    // Real-time SSE listener
    useEffect(() => {
        const handle = (e) => {
            const msg = e.detail;
            setMessages(prev => {
                if (prev.some(m => m.id === msg.id)) return prev;
                return [...prev, msg];
            });
            if (!open || document.hidden) setUnread(u => u + 1);
        };
        window.addEventListener('sse:internal:message', handle);
        return () => window.removeEventListener('sse:internal:message', handle);
    }, [open]);

    const send = useCallback(async () => {
        const text = input.trim();
        if (!text || !myId || sending) return;
        setInput('');
        setSending(true);

        // Optimistic
        const optimistic = {
            id: `tmp_${Date.now()}`,
            userId: myId,
            userName: user?.name || user?.nombre || 'Tú',
            role: user?.role || '',
            content: text,
            timestamp: new Date().toISOString(),
            _optimistic: true,
        };
        setMessages(prev => [...prev, optimistic]);

        try {
            const res = await fetch('/api/internal-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: myId,
                    userName: user?.name || user?.nombre || 'Reclutador',
                    role: user?.role || 'User',
                    content: text,
                }),
            });
            const data = await res.json();
            if (data.success) {
                // Replace optimistic with real message
                setMessages(prev => prev.map(m => m._optimistic ? data.message : m));
            }
        } catch {
            setMessages(prev => prev.filter(m => !m._optimistic));
        } finally {
            setSending(false);
        }
    }, [input, myId, sending, user]);

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };

    const onlineCount = onlineUsers.filter(u => u.userId !== myId).length;

    if (!user) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
            {/* Panel */}
            {open && (
                <div className="w-80 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
                    style={{ height: 420 }}>

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 bg-blue-600 dark:bg-blue-700">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-white" />
                            <span className="text-white font-bold text-sm">Chat del equipo</span>
                            {onlineCount > 0 && (
                                <span className="text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded-full">
                                    {onlineCount} en línea
                                </span>
                            )}
                        </div>
                        <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white transition-colors">
                            <ChevronDown className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                        {messages.length === 0 && (
                            <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-8">
                                Nadie ha escrito aún. ¡Di hola! 👋
                            </p>
                        )}
                        {messages.map((msg, i) => {
                            const isMe = msg.userId === myId;
                            const showName = !isMe && (i === 0 || messages[i - 1]?.userId !== msg.userId);
                            return (
                                <div key={msg.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                                    {!isMe && showName && <Avatar name={msg.userName} size={6} />}
                                    {!isMe && !showName && <div className="w-6 shrink-0" />}
                                    <div className={`max-w-[75%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                        {showName && (
                                            <span className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5 ml-1">
                                                {msg.userName}
                                            </span>
                                        )}
                                        <div className={`px-3 py-2 rounded-2xl text-sm leading-snug break-words ${
                                            isMe
                                                ? 'bg-blue-600 text-white rounded-tr-sm'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-tl-sm'
                                        } ${msg._optimistic ? 'opacity-70' : ''}`}>
                                            {msg.content}
                                        </div>
                                        <span className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5 mx-1">
                                            {formatTime(msg.timestamp)}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={bottomRef} />
                    </div>

                    {/* Input */}
                    <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2">
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKey}
                            placeholder="Escribe un mensaje..."
                            className="flex-1 text-sm bg-gray-100 dark:bg-gray-800 rounded-full px-4 py-2 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400"
                        />
                        <button
                            onClick={send}
                            disabled={!input.trim() || sending}
                            className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center disabled:opacity-40 hover:bg-blue-700 transition-colors shrink-0"
                        >
                            <Send className="w-3.5 h-3.5 text-white" />
                        </button>
                    </div>
                </div>
            )}

            {/* Floating button */}
            <button
                onClick={() => { setOpen(o => !o); setUnread(0); }}
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
