import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Loader2, Send, User } from 'lucide-react';
import TrainingBubble from './TrainingBubble';
import { getSessionToken } from './session';

const MAX_INPUT_CHARS = 900;
const MAX_CLIENT_HISTORY = 8;

const ChatCandidatoPanel = () => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [lastUsage, setLastUsage] = useState(null);
    const inputRef = useRef(null);
    const endRef = useRef(null);

    const compactHistory = useMemo(() => {
        return messages
            .slice(-MAX_CLIENT_HISTORY)
            .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 700) }));
    }, [messages]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages, loading]);

    const sendMessage = async () => {
        const clean = input.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT_CHARS);
        if (!clean || loading) return;

        setInput('');
        setLoading(true);
        setMessages((prev) => [...prev, { role: 'user', content: clean }]);

        try {
            const res = await fetch('/api/brenda-training/chat-candidato', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSessionToken()}` },
                body: JSON.stringify({ message: clean, history: compactHistory })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo contactar a Brenda');

            setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
            setLastUsage(data.usage || null);
        } catch (error) {
            setMessages((prev) => [...prev, { role: 'assistant', content: `No pude responder: ${error.message}` }]);
        } finally {
            setLoading(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col h-[560px]">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                        <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Chat candidato</h3>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Escribe como si fueras el candidato. Brenda responde usando la personalidad guardada.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50 dark:bg-gray-950">
                {messages.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 text-center pt-6">
                        Manda el primer mensaje como si fueras un candidato con perfil completo.
                    </p>
                )}
                {messages.map((message, index) => (
                    <TrainingBubble key={index} role={message.role}>{message.content}</TrainingBubble>
                ))}
                {loading && (
                    <TrainingBubble role="assistant">
                        <span className="flex items-center gap-2 text-gray-500 dark:text-gray-300">
                            <Loader2 className="w-4 h-4 animate-spin" /> Pensando
                        </span>
                    </TrainingBubble>
                )}
                <div ref={endRef} />
            </div>

            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-end gap-2">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_CHARS))}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                            }
                        }}
                        placeholder="Escribe como candidato..."
                        rows={2}
                        className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-blue-500"
                    />
                    <button
                        onClick={sendMessage}
                        disabled={loading || !input.trim()}
                        className="w-10 h-10 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white flex items-center justify-center transition-colors"
                        title="Enviar"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500">
                    <span>{input.length}/{MAX_INPUT_CHARS} caracteres</span>
                    {lastUsage?.total_tokens ? <span>{lastUsage.total_tokens} tokens</span> : null}
                </div>
            </div>
        </div>
    );
};

export default ChatCandidatoPanel;
