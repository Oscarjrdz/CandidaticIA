import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Loader2, MessageCircle } from 'lucide-react';
import Button from './ui/Button';

/**
 * Panel lateral de chat tipo WhatsApp
 */
const ChatDrawer = ({ isOpen, onClose, candidate, credentials }) => {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef(null);

    // Auto-scroll al fondo
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (isOpen && candidate) {
            loadMessages();
            // Polling simple para refrescar chat abierto
            const interval = setInterval(loadMessages, 3000);
            return () => clearInterval(interval);
        }
    }, [isOpen, candidate]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const loadMessages = async () => {
        try {
            const res = await fetch(`/api/chat?candidateId=${candidate.id}`);
            const data = await res.json();
            if (data.success) {
                // Verificar si hay nuevos mensajes para evitar re-render innecesario o perder posición
                setMessages(data.messages);
            }
        } catch (error) {
            console.error('Error cargando chat:', error);
        }
    };

    const handleSend = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || sending) return;

        setSending(true);
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidateId: candidate.id,
                    message: newMessage,
                    botId: credentials?.botId,
                    apiKey: credentials?.apiKey
                })
            });

            const data = await res.json();

            if (data.success) {
                setNewMessage('');
                loadMessages(); // Recargar inmediato
            } else {
                alert('Error enviando mensaje: ' + (data.details || data.error));
            }
        } catch (error) {
            console.error('Error enviando:', error);
            alert('Error de conexión');
        } finally {
            setSending(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-hidden">
            <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm" onClick={onClose} />

            <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-800 shadow-xl flex flex-col transform transition-transform duration-300 ease-in-out">

                {/* Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-white dark:bg-gray-800 z-10">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold">
                            {candidate?.nombre?.charAt(0) || '?'}
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900 dark:text-white">
                                {candidate?.nombre}
                            </h3>
                            <p className="text-xs text-gray-500 font-mono">
                                {candidate?.whatsapp}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Messages Area - Fondo tipo WhatsApp */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#efe7dd] dark:bg-gray-900">
                    {messages.length === 0 ? (
                        <div className="text-center py-10 opacity-50">
                            <MessageCircle className="w-12 h-12 mx-auto mb-2" />
                            <p>No hay mensajes aún.</p>
                            <p className="text-xs">Envía un mensaje para iniciar la conversación.</p>
                        </div>
                    ) : (
                        messages.map((msg, idx) => {
                            const isMe = msg.from === 'me' || msg.from === 'bot'; // 'bot' si lo envió la automatización
                            return (
                                <div key={idx} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`
                                        max-w-[80%] rounded-lg px-4 py-2 shadow-sm
                                        ${isMe
                                            ? 'bg-[#d9fdd3] dark:bg-green-900 text-gray-900 dark:text-white rounded-tr-none'
                                            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-tl-none'}
                                    `}>
                                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 text-right">
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            {isMe && <span className="ml-1">✓✓</span>}
                                        </p>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                    <form onSubmit={handleSend} className="flex space-x-2">
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Escribe un mensaje..."
                            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            autoFocus
                        />
                        <Button
                            type="submit"
                            disabled={!newMessage.trim() || sending}
                            className={`rounded-full w-12 h-12 flex items-center justify-center p-0 ${sending ? 'opacity-70' : ''}`}
                        >
                            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ChatDrawer;
