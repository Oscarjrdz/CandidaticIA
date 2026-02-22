import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Loader2, MessageCircle, Move, Copy, Tag, Mic, Trash, Check, Paperclip } from 'lucide-react';
import Button from './ui/Button';
import VacancyHistoryCard from './VacancyHistoryCard';
import CandidateADNCard from './CandidateADNCard';

/**
 * Ventana de chat flotante y arrastrable
 */
const ChatWindow = ({ isOpen, onClose, candidate }) => {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [availableFields, setAvailableFields] = useState([]);

    // Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState(null);
    const [recordingTime, setRecordingTime] = useState(0);
    const mediaRecorderRef = useRef(null);
    const timerRef = useRef(null);

    // Draggable Logic
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // File Input Ref
    const fileInputRef = useRef(null);

    // Refs
    const windowRef = useRef(null);
    const messagesEndRef = useRef(null);

    // Reset position when opening
    useEffect(() => {
        if (isOpen) {
            setPosition({ x: 0, y: 0 }); // Center initial
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
            loadFields();
            const interval = setInterval(loadMessages, 3000);
            return () => clearInterval(interval);
        }
    }, [isOpen, candidate]);

    const loadFields = async () => {
        try {
            const res = await fetch('/api/fields');
            const data = await res.json();
            if (data.success) {
                setAvailableFields(data.fields || []);
            }
        } catch (e) {
            // Error logged to monitoring service in future
        }
    };

    // Auto-scroll ONLY on new messages
    const prevMessagesLength = useRef(0);
    useEffect(() => {
        if (messages.length > prevMessagesLength.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        prevMessagesLength.current = messages.length;
    }, [messages]);

    const loadMessages = async () => {
        if (!candidate?.id) return;
        try {
            const res = await fetch(`/api/chat?candidateId=${candidate.id}`);
            const contentType = res.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                return;
            }
            const data = await res.json();
            if (data && data.success) {
                setMessages(Array.isArray(data.messages) ? data.messages : []);
            }
        } catch (error) {
            // Fail silently or handle with UI feedback
        }
    };

    const handleSend = async (e, forceType = 'text', forceMedia = null) => {
        if (e) e.preventDefault();

        const messageToProcess = newMessage.trim();
        if ((!messageToProcess && !audioBlob && !forceMedia) || sending) return;

        setSending(true);
        try {
            // Apply variable substitution locally for instant feedback if possible
            // But real substitution happens in backend.

            let payload = {
                candidateId: candidate.id,
                message: messageToProcess,
                type: forceType,
                mediaUrl: forceMedia
            };

            // Handle Audio Recording Attachment
            if (audioBlob && !forceMedia) {
                const reader = new FileReader();
                const base64Promise = new Promise((resolve) => {
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(audioBlob);
                });
                const base64 = await base64Promise;

                // Upload to Redis for history persistence & scale
                const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: base64 }) // Endpoint accepts 'image' field for any base64
                });
                const uploadData = await uploadRes.json();

                if (uploadData.success) {
                    payload.mediaUrl = uploadData.url; // Relative URL, backend will convert to absolute
                    payload.type = 'voice';
                    payload.base64Data = base64; // Stripped in backend orchestration
                } else {
                    throw new Error('Falló el procesamiento del audio');
                }
            }

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (data.success) {
                setNewMessage('');
                setAudioBlob(null);
                loadMessages();
            } else {
                const errorMsg = data.details || data.error || 'Error desconocido';
                alert('Error al enviar: ' + errorMsg);
            }
        } catch (error) {
            console.error('Error enviando:', error);
            alert('Error de conexión: ' + error.message);
        } finally {
            setSending(false);
        }
    };

    const handleImageSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 4 * 1024 * 1024) {
            alert('Archivo demasiado grande (Máx 4MB)');
            return;
        }

        setSending(true);
        try {
            const reader = new FileReader();
            const base64Promise = new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(file);
            });
            const base64 = await base64Promise;

            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64 })
            });
            const uploadData = await uploadRes.json();

            if (uploadData.success) {
                const mediaUrl = `${window.location.origin}${uploadData.url}`;
                handleSend(null, 'image', mediaUrl);
            } else {
                alert('Error al subir imagen');
            }
        } catch (err) {
            console.error(err);
            alert('Error subiendo imagen');
        } finally {
            setSending(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Voice Recording Logic
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            const chunks = [];

            mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
            mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' });
                setAudioBlob(blob);
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            setIsRecording(true);
            setRecordingTime(0);
            timerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);
        } catch (err) {
            alert('No se pudo acceder al micrófono: ' + err.message);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            clearInterval(timerRef.current);
        }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop(); // Stop but we ignore the blob
            setIsRecording(false);
            clearInterval(timerRef.current);
            setAudioBlob(null);
        }
    };

    const safeFormatTime = (ts) => {
        if (!ts) return '-';
        try {
            const date = new Date(ts);
            if (isNaN(date.getTime())) return '-';
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '-';
        }
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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
        // Simple drag: just track mouse position
        setPosition({
            x: e.clientX,
            y: e.clientY,
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
                            margin: 0,
                            transform: 'translate(-50%, -10px)' // Little offset for handle grip center
                        }
                        : {}
                }
            >
                {/* Header draggable */}
                <div
                    className="drag-handle p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-100 dark:bg-gray-900 cursor-move select-none"
                    onMouseDown={handleMouseDown}
                >
                    <div className="flex items-center space-x-2 pointer-events-none">
                        {candidate?.profilePic || candidate?.profilePicUrl ? (
                            <img
                                src={candidate.profilePic || candidate.profilePicUrl}
                                alt="Profile"
                                className="w-8 h-8 rounded-full object-cover border border-white/20 shadow-sm"
                            />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-xs">
                                {candidate?.nombre?.charAt(0) || '?'}
                            </div>
                        )}
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
                            onClick={(e) => {
                                e.stopPropagation();
                                onClose();
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full text-gray-500 hover:text-red-500 transition-colors pointer-events-auto"
                            title="Cerrar (Esc)"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* 🏷️ CV CARD / ADN SUMMARY */}
                <CandidateADNCard candidate={candidate} />

                {/* Scalable Vacancy History Timeline */}
                <VacancyHistoryCard candidateId={candidate?.id} />

                {/* Messages Area */}
                <div className="h-96 overflow-y-auto p-4 space-y-3 bg-[#efe7dd] dark:bg-gray-900 text-sm">
                    {!Array.isArray(messages) || messages.length === 0 ? (
                        <div className="text-center py-10 opacity-50 select-none">
                            <MessageCircle className="w-10 h-10 mx-auto mb-2" />
                            <p>Sin mensajes</p>
                        </div>
                    ) : (
                        messages.map((msg, idx) => {
                            if (!msg) return null; // Safe guard
                            const isMe = msg.from === 'me' || msg.from === 'bot';
                            const senderName = isMe ? 'Bot' : (candidate?.nombre || 'Usuario');
                            return (
                                <div key={idx} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`
                                        max-w-[85%] rounded-lg px-3 py-1.5 shadow-sm
                                        ${isMe
                                            ? 'bg-[#d9fdd3] dark:bg-green-900 text-gray-900 dark:text-white rounded-tr-none'
                                            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-tl-none'}
                                    `}>
                                        <p className="text-[10px] font-semibold mb-0.5 opacity-70">{senderName}</p>

                                        {/* Media Rendering */}
                                        {msg.mediaUrl && (
                                            <div className="mb-2 rounded-lg overflow-hidden border border-black/5">
                                                {(msg.type === 'image' || msg.type === 'image_received') && (
                                                    <img src={msg.mediaUrl} alt="Media" className="max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity" onClick={() => window.open(msg.mediaUrl, '_blank')} />
                                                )}
                                                {(msg.type === 'video' || msg.type === 'video_received') && (
                                                    <video src={msg.mediaUrl} controls className="max-w-full h-auto" />
                                                )}
                                                {(msg.type === 'audio' || msg.type === 'voice' || msg.type === 'ptt' || msg.type === 'audio_received') && (
                                                    <div className="flex flex-col space-y-1">
                                                        <audio src={msg.mediaUrl} controls className="max-w-full h-10 mt-1" />
                                                        <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 dark:text-blue-400 underline pl-1">
                                                            Abrir audio en pestaña nueva
                                                        </a>
                                                    </div>
                                                )}
                                                {(msg.type === 'document' || msg.type === 'doc_received') && (
                                                    <div className="p-3 bg-black/5 flex items-center space-x-2 cursor-pointer" onClick={() => window.open(msg.mediaUrl, '_blank')}>
                                                        <Paperclip className="w-4 h-4" />
                                                        <span className="text-xs font-medium underline">Ver documento</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {!msg.content && msg.mediaUrl && (msg.type === 'voice' || msg.type === 'ptt') && (
                                            <p className="text-[11px] italic opacity-50 mb-1">Nota de voz</p>
                                        )}

                                        {msg.content && <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>}

                                        <div className="flex items-center justify-between mt-1 space-x-2">
                                            <p className="text-[9px] text-gray-500 dark:text-gray-400 opacity-70">
                                                {safeFormatTime(msg.timestamp)}
                                            </p>
                                            <div className="flex items-center space-x-1">
                                                {msg.status && (
                                                    <span className={`text-[9px] font-bold uppercase ${msg.status === 'seen' || msg.status === 'read' ? 'text-blue-500' : 'text-gray-400'
                                                        }`}>
                                                        {msg.status === 'seen' || msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
                                                    </span>
                                                )}
                                                {isMe && !msg.status && <span className="text-[9px] text-gray-400">✓✓</span>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Variable Tray */}
                {(Array.isArray(availableFields) && availableFields.length > 0) && (
                    <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 overflow-x-auto whitespace-nowrap scrollbar-hide">
                        <div className="flex space-x-1.5">
                            {[
                                { label: 'Nombre', value: '{{nombre}}' },
                                { label: 'WhatsApp', value: '{{whatsapp}}' },
                                ...availableFields.map(f => ({ label: f.label, value: `{{${f.value}}}` }))
                            ].map(tag => (
                                <button
                                    key={tag.value}
                                    type="button"
                                    onClick={() => setNewMessage(prev => prev + tag.value)}
                                    className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 rounded border border-blue-100 dark:border-blue-800 text-[10px] font-medium hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
                                    title={`Insertar ${tag.label}`}
                                >
                                    {tag.value}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Input Area */}
                <div className="p-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                    {isRecording ? (
                        <div className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 px-4 py-2 rounded-lg animate-pulse">
                            <div className="flex items-center space-x-3 text-red-600 dark:text-red-400">
                                <div className="w-2 h-2 bg-red-600 rounded-full animate-ping" />
                                <span className="text-sm font-bold font-mono">{formatTime(recordingTime)}</span>
                            </div>
                            <div className="flex items-center space-x-2">
                                <button
                                    onClick={cancelRecording}
                                    className="p-2 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-full text-red-600 transition-colors"
                                    title="Cancelar grabación"
                                >
                                    <Trash className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={stopRecording}
                                    className="p-2 bg-red-600 hover:bg-red-700 rounded-full text-white shadow-lg transition-transform active:scale-95"
                                    title="Detener y adjuntar"
                                >
                                    <Check className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSend} className="flex items-center space-x-2">
                            {audioBlob ? (
                                <div className="flex-1 flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800">
                                    <div className="flex items-center space-x-2 text-blue-700 dark:text-blue-300">
                                        <Mic className="w-4 h-4" />
                                        <span className="text-xs font-medium">Nota de voz lista</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setAudioBlob(null)}
                                        className="text-gray-400 hover:text-red-500 transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        accept="image/*"
                                        onChange={handleImageSelect}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                                        title="Adjuntar imagen"
                                    >
                                        <Paperclip className="w-5 h-5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={startRecording}
                                        className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                                        title="Grabar audio"
                                    >
                                        <Mic className="w-5 h-5" />
                                    </button>
                                    <input
                                        type="text"
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        placeholder="Escribe un mensaje..."
                                        className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:outline-none text-sm"
                                        autoFocus
                                    />
                                </>
                            )}
                            <Button
                                type="submit"
                                disabled={(!newMessage.trim() && !audioBlob) || sending}
                                className={`rounded-lg w-10 h-10 flex items-center justify-center p-0 ${sending ? 'opacity-70' : ''}`}
                            >
                                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            </Button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChatWindow;
