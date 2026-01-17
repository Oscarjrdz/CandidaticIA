import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Loader2, MessageCircle, GripHorizontal } from 'lucide-react';
import Button from './ui/Button';

/**
 * Ventana de chat flotante y arrastrable
 */
const ChatWindow = ({ isOpen, onClose, candidate, credentials }) => {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);

    // Draggable Logic
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // Refs
    const windowRef = useRef(null);
    const messagesEndRef = useRef(null);

    // Reset position when opening
    useEffect(() => {
        if (isOpen) {
            setPosition({ x: 0, y: 0 }); // Center initial (handled by CSS flex centering + translate 0)
        }
    }, [isOpen]);

    // Close on ESC
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            window.addEventListener('keydown', handleEsc);
        }
        return () => window.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

    // Chat Polling & Validation
    useEffect(() => {
        if (isOpen && candidate) {
            loadMessages();
            const interval = setInterval(loadMessages, 3000);
            return () => clearInterval(interval);
        }
    }, [isOpen, candidate]);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const loadMessages = async () => {
        try {
            const res = await fetch(`/api/chat?candidateId=${candidate.id}`);
            const data = await res.json();
            if (data.success) {
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
                loadMessages();
            } else {
                const errorMsg = typeof data.details === 'object'
                    ? JSON.stringify(data.details, null, 2)
                    : (data.details || data.error);
                alert('Error enviando mensaje: ' + errorMsg);
            }
        } catch (error) {
            console.error('Error enviando:', error);
            alert('Error de conexión');
        } finally {
            setSending(false);
        }
    };

    // Drag handlers
    const handleMouseDown = (e) => {
        if (windowRef.current && e.target.closest('.drag-handle')) {
            setIsDragging(true);
            const rect = windowRef.current.getBoundingClientRect();
            // Offset del ratón relativo a la esquina superior izquierda de la ventana
            setDragOffset({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            });
        }
    };

    const handleMouseMove = (e) => {
        if (isDragging) {
            const x = e.clientX - dragOffset.x;
            const y = e.clientY - dragOffset.y;

            // Convertir a posición relativa al centro inicial o usar posición absoluta
            // Aquí usaremos fixed positioning básico.
            // Para que funcione el 'centrado inicial' + 'drag', necesitamos cambiar la estrategia de CSS.
            // Usaremos un wrapper fixed que centra, y transform translate.

            // Pero React y los eventos globales son truculentos.
            // Simplemente actualizaremos el transform: translate(x,y)
            // Necesitamos saber delta desde el centro.

            // Simplificación: Vamos a posicionar absolute directo.
            // Pero tenemos que calcular las coordenadas relativas al viewport.

            // Mejor approach: 'position' guarda los deltas X/Y desde el centro.
            // no, mejor coordenadas absolutas (left/top).
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Global drag listeners
    useEffect(() => {
        if (isDragging) {
            const onMove = (e) => {
                // Calcular nueva posición (left/top)
                // Usamos estado 'position' para controlar style={{ left, top }}
                // Pero inicialmente está centrado.
                // Truco: Al iniciar drag, si no tenemos posición "fija", calculamos la actual del DOM y la seteamos como estado inicial
                // para evitar saltos.

                // Vamos a hacerlo más simple:
                // El div siempre tendrá style={{ transform: `translate(${x}px, ${y}px)` }}
                // x, y son deltas desde la posición original (centro).

                // No, mejor absolute positioning puro.
            };

            window.addEventListener('mousemove', onGlobalMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', onGlobalMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging]);

    const onGlobalMove = (e) => {
        // Obtenemos la nueva posición absoluta deseada
        let newX = e.clientX - dragOffset.x;
        let newY = e.clientY - dragOffset.y;

        // Guardamos en estado. Pero espera, ¿cómo mezclamos esto con el centrado CSS?
        // Solución: Dejamos de usar flex-center en el padre cuando se empieza a arrastrar.
        // O más fácil: El componente tiene `top: 0, left: 0` y usamos `transform: translate(x,y)` para todo.
        // Inicialmente centrado: `left: 50%, top: 50%, transform: translate(-50%, -50%)`.
        // Al arrastrar, cambiamos a `left: 0, top: 0, transform: translate(mouseX, mouseY)`.

        setPosition({
            x: newX,
            y: newY,
            isMoved: true
        });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            {/* Backdrop opcional - lo haremos invisible para dar sensación 'flotante' real, 
                pero si el usuario quiere modal behavior (no clicar atrás), ponemos div.
                Usuario dijo "popup... flotante". Normalmente 'flotante' implica poder interactuar atrás, 
                pero 'popup' suele ser modal.
                Lo haremos 'Modeless-like' (pointer-events-none en container), 
                pero el chat (pointer-events-auto) bloquea clicks en él mismo.
            */}

            <div
                ref={windowRef}
                className="w-full max-w-md bg-white dark:bg-gray-800 shadow-2xl rounded-xl flex flex-col pointer-events-auto border border-gray-200 dark:border-gray-700 overflow-hidden"
                style={
                    position.isMoved
                        ? {
                            position: 'fixed',
                            left: position.x,
                            top: position.y,
                            transform: 'none',
                            margin: 0
                        }
                        : {
                            // Estado inicial centrado
                            // Ya el flex container padre lo centra, solo necesitamos dimensiones
                        }
                }
            >
                {/* Header draggable */}
                <div
                    className="drag-handle p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-100 dark:bg-gray-900 cursor-move select-none"
                    onMouseDown={handleMouseDown}
                >
                    <div className="flex items-center space-x-2 pointer-events-none">
                        <GripHorizontal className="w-4 h-4 text-gray-400" />
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-xs">
                            {candidate?.nombre?.charAt(0) || '?'}
                        </div>
                        <div>
                            <h3 className="font-bold text-sm text-gray-900 dark:text-white leading-tight">
                                {candidate?.nombre}
                            </h3>
                            <p className="text-[10px] text-gray-500 font-mono">
                                {candidate?.whatsapp}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-1">
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full text-gray-500 hover:text-red-500 transition-colors pointer-events-auto"
                            title="Cerrar (Esc)"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Messages Area */}
                <div className="h-96 overflow-y-auto p-4 space-y-3 bg-[#efe7dd] dark:bg-gray-900 text-sm">
                    {messages.length === 0 ? (
                        <div className="text-center py-10 opacity-50 select-none">
                            <MessageCircle className="w-10 h-10 mx-auto mb-2" />
                            <p>Sin mensajes</p>
                        </div>
                    ) : (
                        messages.map((msg, idx) => {
                            const isMe = msg.from === 'me' || msg.from === 'bot';
                            return (
                                <div key={idx} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`
                                        max-w-[85%] rounded-lg px-3 py-1.5 shadow-sm
                                        ${isMe
                                            ? 'bg-[#d9fdd3] dark:bg-green-900 text-gray-900 dark:text-white rounded-tr-none'
                                            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-tl-none'}
                                    `}>
                                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                        <p className="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5 text-right opacity-70">
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
                <div className="p-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                    <form onSubmit={handleSend} className="flex space-x-2">
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Escribe un mensaje..."
                            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                            autoFocus
                        />
                        <Button
                            type="submit"
                            disabled={!newMessage.trim() || sending}
                            className={`rounded-lg w-10 h-10 flex items-center justify-center p-0 ${sending ? 'opacity-70' : ''}`}
                        >
                            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ChatWindow;
