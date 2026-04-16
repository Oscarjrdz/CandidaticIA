import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Loader2, MessageCircle, Move, Copy, Tag, Mic, Trash, Check, Paperclip } from 'lucide-react';
import Button from './ui/Button';
import VacancyHistoryCard from './VacancyHistoryCard';
import CandidateADNCard from './CandidateADNCard';
import { useCandidatesSSE } from '../hooks/useCandidatesSSE';
import { Virtuoso } from 'react-virtuoso';
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

/**
 * Ventana de chat flotante y arrastrable
 */
const ChatWindow = ({ isOpen, onClose, candidate }) => {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [availableFields, setAvailableFields] = useState([]);
    const [replyToMsg, setReplyToMsg] = useState(null);
    const { updatedCandidate } = useCandidatesSSE();

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
    const virtuosoRef = useRef(null);
    const lastPresenceTimeRef = useRef(0);

    const handleTyping = () => {
        if (!candidate || !candidate.id) return;
        const now = Date.now();
        if (now - lastPresenceTimeRef.current > 8000) {
            lastPresenceTimeRef.current = now;
            fetch('/api/chat', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'presence', candidateId: candidate.id, status: 'composing' })
            }).catch(() => {});
        }
    };

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

    // Chat Initialization (One-time load) & Fields
    useEffect(() => {
        if (isOpen && candidate) {
            loadMessages();
            loadFields();
        }
    }, [isOpen, candidate]);

    // SSE Real-Time Updates Listener (Replaces Short-Polling)
    useEffect(() => {
        if (isOpen && candidate && updatedCandidate?.id === candidate.id) {
            // Signal received that this candidate has a new message!
            if (updatedCandidate?.updates?.newMessage) {
                loadMessages();
            }
        }
    }, [updatedCandidate]);

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
    // Auto-scroll ONLY on new messages
    // (Virtuoso maneja esto con followOutput, por lo que deshabilitamos el scroll manual viejo)
    const prevMessagesLength = useRef(0);
    useEffect(() => {
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

        // 1. Extraer datos directos del DOM para evitar retrasos de React (Stale State)
        let messageToProcess = newMessage;
        if (e && e.target && e.target.tagName === 'INPUT') {
            messageToProcess = e.target.value;
        }
        messageToProcess = messageToProcess.trim();

        const tempAudioBlob = audioBlob;
        
        if (!messageToProcess && !tempAudioBlob && !forceMedia) return;

        // --- OPTIMISTIC UI: Sensación instantánea WhatsApp Web ---
        const tempId = `temp_${Date.now()}`;
        const isAudioUpload = !!(tempAudioBlob && !forceMedia);
        const previewMediaUrl = isAudioUpload ? URL.createObjectURL(tempAudioBlob) : forceMedia;

        const optimisticMsg = {
            id: tempId,
            from: 'me',
            content: messageToProcess,
            type: isAudioUpload ? 'voice' : forceType,
            mediaUrl: previewMediaUrl,
            status: 'queued', // Status para relojito
            timestamp: new Date().toISOString()
        };

        if (replyToMsg) {
            optimisticMsg.contextInfo = {
                quotedMessage: {
                    stanzaId: replyToMsg.id,
                    participant: replyToMsg.from === 'me' ? 'me' : candidate.whatsapp,
                    conversation: replyToMsg.content || 'Media'
                }
            };
        }

        // Empujar inmediato a la pantalla
        setMessages(prev => [...prev, optimisticMsg]);
        
        // Limpiar inputs al instante para dejar libre el cajón de texto
        setNewMessage('');
        setAudioBlob(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        
        // Extraer captura actual de la cita antes de limpiar
        const currentReplyToMsg = replyToMsg;
        setReplyToMsg(null);

        try {
            let payload = {
                candidateId: candidate.id,
                message: messageToProcess,
                type: forceType,
                mediaUrl: forceMedia
            };
            
            if (currentReplyToMsg) {
                payload.replyToId = currentReplyToMsg.id;
            }

            // Handle Audio Recording Attachment
            if (isAudioUpload) {
                const reader = new FileReader();
                const base64Promise = new Promise((resolve) => {
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(tempAudioBlob);
                });
                const base64 = await base64Promise;

                const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: base64 })
                });
                const uploadData = await uploadRes.json();

                if (uploadData.success) {
                    payload.mediaUrl = uploadData.url;
                    payload.type = 'voice';
                    payload.base64Data = base64;
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
                // Actualizar estado del DOM con el mensaje real que trajo de regreso sin esperar al polling
                setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...data.message, status: data.message?.status || 'sent' } : m));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: candidate.id } }));
            } else {
                const errorMsg = data.details || data.error || 'Error desconocido';
                // Retirar mensaje engañoso que falló
                setMessages(prev => prev.filter(m => m.id !== tempId));
                alert('Error al enviar: ' + errorMsg);
            }
        } catch (error) {
            console.error('Error enviando:', error);
            // Retirar mensaje engañoso si se fue el internet
            setMessages(prev => prev.filter(m => m.id !== tempId));
            alert('Error de conexión: ' + error.message);
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
            return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
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

    // --- RENDER MESSAGE ---
    const renderMessage = (idx, msg) => {
        if (!msg) return null;
        const isMe = msg.from === 'me' || msg.from === 'bot';
        
        // Find previous message for tail logic
        const prevMsg = idx > 0 ? displayMessages[idx - 1] : null;
        const isPrevMe = prevMsg ? (prevMsg.from === 'me' || prevMsg.from === 'bot') : null;
        const isFirstInSeries = !prevMsg || isMe !== isPrevMe;

        return (
            <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} group relative ${!isFirstInSeries ? '-mt-1.5' : ''} px-2`}>
                {/* 🔄 Botón de Cotizar (Reply) Oculto hasta Hover */}
                <button
                    onClick={() => setReplyToMsg(msg)}
                    className={`absolute top-1/2 -translate-y-1/2 ${isMe ? 'right-full mr-2' : 'left-full ml-2'} opacity-0 group-hover:opacity-100 p-1.5 rounded-full bg-white/50 dark:bg-black/50 shadow-sm text-gray-500 hover:text-blue-500 transition-all cursor-pointer z-20`}
                    title="Responder mensaje"
                >
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>
                </button>

                <div className={`
                    max-w-[85%] rounded-[7.5px] px-2 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,.13)] relative z-10
                    ${isMe
                        ? `bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] ${isFirstInSeries ? 'rounded-tr-none' : ''}`
                        : `bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] ${isFirstInSeries ? 'rounded-tl-none' : ''}`}
                `}>
                    {/* Tail */}
                    {isFirstInSeries && (
                        <div 
                            className={`absolute top-0 w-3 h-3 ${isMe ? '-right-2 bg-[#d9fdd3] dark:bg-[#005c4b]' : '-left-2 bg-white dark:bg-[#202c33]'}`} 
                            style={{ clipPath: isMe ? 'polygon(0 0, 0 100%, 100% 0)' : 'polygon(100% 0, 100% 100%, 0 0)' }}
                        />
                    )}

                    {/* Quote Context (Cita visual) si el mensaje es respuesta */}
                    {msg.contextInfo?.quotedMessage && (
                        <div className="bg-black/5 dark:bg-black/20 rounded-[4px] p-2 mb-1.5 border-l-4 border-blue-400 text-[11.5px] overflow-hidden whitespace-nowrap text-ellipsis cursor-pointer opacity-80" onClick={() => {}}>
                            <span className="font-bold text-blue-500 dark:text-blue-400 block mb-0.5">
                                {msg.contextInfo.quotedMessage.participant === 'me' ? 'Tú' : candidate?.nombre || 'Usuario'}
                            </span>
                            <span className="text-gray-600 dark:text-gray-300">
                                {msg.contextInfo.quotedMessage.conversation || 'Audio / Imagen'}
                            </span>
                        </div>
                    )}

                    {/* Media Rendering */}
                    {msg.mediaUrl && (
                        <div className="mb-2 rounded-lg overflow-hidden border border-black/5 relative min-w-[200px]">
                            {(msg.type === 'image' || msg.type === 'image_received') && (
                                <img src={msg.mediaUrl} loading="lazy" alt="Media" className="max-w-full h-auto max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity" onClick={() => window.open(msg.mediaUrl, '_blank')} />
                            )}
                            {(msg.type === 'video' || msg.type === 'video_received') && (
                                <video src={msg.mediaUrl} controls className="max-w-full h-auto" />
                            )}
                            {(msg.type === 'audio' || msg.type === 'voice' || msg.type === 'ptt' || msg.type === 'audio_received') && (
                                <div className="flex flex-col space-y-1 p-1 bg-black/5 dark:bg-white/5 rounded-lg">
                                    <audio src={msg.mediaUrl} controls className="max-w-full h-8 mt-1 block" style={{ filter: isMe ? 'sepia(100%) hue-rotate(90deg) saturate(300%)' : '' }} />
                                    <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-600 dark:text-blue-400 opacity-60 hover:underline pl-1 text-right block mt-1">
                                        Descargar audio
                                    </a>
                                </div>
                            )}
                            {(msg.type === 'document' || msg.type === 'doc_received') && (
                                <div className="p-3 bg-black/5 flex items-center space-x-2 cursor-pointer" onClick={() => window.open(msg.mediaUrl, '_blank')}>
                                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" className="text-gray-600 dark:text-gray-300"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                    <span className="text-xs font-medium underline">Ver documento</span>
                                </div>
                            )}
                        </div>
                    )}

                    {!msg.content && msg.mediaUrl && (msg.type === 'voice' || msg.type === 'ptt') && (
                        <p className="text-[11px] italic opacity-50 mb-1">Nota de voz</p>
                    )}

                    {msg.content && (
                        <div className="relative inline-block min-w-[40px] max-w-full">
                            <div 
                                className="whitespace-pre-wrap leading-[1.35] inline-block break-words" 
                                style={{ paddingBottom: '10px', paddingRight: '48px' }}
                                dangerouslySetInnerHTML={{ __html: formatWhatsAppText(msg.content) }}
                            />
                        </div>
                    )}

                    <div className={`flex items-center space-x-1 select-none pr-1 ${msg.content ? 'absolute bottom-[3px] right-2' : 'justify-end mt-1'}`}>
                        <p className="text-[10.5px] text-gray-500/90 dark:text-gray-400/90 font-medium">
                            {safeFormatTime(msg.timestamp)}
                        </p>
                        {isMe && (
                            <span className={`text-[12.5px] font-bold uppercase leading-none ${msg.status === 'seen' || msg.status === 'read' ? 'text-[#53bdeb]' : 'text-gray-400/80'}`}>
                                {msg.status === 'seen' || msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : msg.status === 'queued' ? '...' : '✓'}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );
    };

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

                {/* Messages Area - WhatsApp Original Styling */}
                <div className="h-[450px] flex flex-col relative text-[14.2px] bg-[#efeae2] dark:bg-[#0b141a]">
                    <div 
                        className="absolute inset-0 z-0 opacity-[0.4] dark:opacity-[0.05] pointer-events-none"
                        style={{
                            backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")',
                            backgroundRepeat: 'repeat',
                            backgroundSize: '350px'
                        }}
                    ></div>
                    
                    {displayMessages.length === 0 ? (
                        <div className="relative z-10 text-center py-2 bg-[#ffeed0] dark:bg-[#cca868]/10 text-[#111b21] dark:text-[#f7cd73]/70 rounded-lg mx-auto w-4/5 shadow-sm select-none mt-4 border border-black/5 dark:border-white/5">
                            <p className="text-[10.5px] leading-tight">Los mensajes están protegidos por Candidatic IA Nivel Meta.</p>
                        </div>
                    ) : (
                        <div className="flex-1 relative z-10">
                            <Virtuoso
                                ref={virtuosoRef}
                                data={displayMessages}
                                initialTopMostItemIndex={displayMessages.length - 1}
                                followOutput="smooth"
                                alignToBottom
                                itemContent={renderMessage}
                                className="w-full h-full [&>div]:py-2 [&>div]:space-y-1.5 custom-scrollbar"
                            />
                        </div>
                    )}
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

                {/* Input Area (With Reply Context Banner) */}
                <div className="flex flex-col bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                    
                    {/* Reply Banner preview */}
                    {replyToMsg && (
                        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between animate-in slide-in-from-bottom-2">
                            <div className="flex-1 border-l-4 border-blue-500 pl-3">
                                <p className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                    Respondiendo a {replyToMsg.from === 'user' ? candidate.nombre : 'Tú'}
                                </p>
                                <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-1">
                                    {replyToMsg.content || 'Media/Audio adjunto'}
                                </p>
                            </div>
                            <button onClick={() => setReplyToMsg(null)} className="p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    )}

                    <div className="p-3">
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
                        <div className="flex items-center space-x-2 w-full">
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
                                        onChange={(e) => {
                                            setNewMessage(e.target.value);
                                            handleTyping();
                                        }}
                                        onKeyDown={(e) => {
                                            // Prevenir envíos de mensajes al presionar Enter durante composición de acentos (isComposing)
                                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                                e.preventDefault();
                                                handleSend(e);
                                            }
                                        }}
                                        placeholder="Escribe un mensaje..."
                                        className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:outline-none text-sm"
                                        autoFocus
                                    />
                                </>
                            )}
                            <Button
                                type="button"
                                onClick={handleSend}
                                disabled={!newMessage.trim() && !audioBlob}
                                className={`rounded-lg w-10 h-10 flex items-center justify-center p-0`}
                            >
                                <Send className="w-4 h-4" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
        </div>
    );
};

export default ChatWindow;
