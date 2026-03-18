import React, { useState, useEffect, useRef } from 'react';
import { Send, RefreshCw, Smartphone, Smile, GripVertical, Plus, Trash2, Pencil, Bot, Paperclip, Loader2, X, Image as ImageIcon, FileText, Terminal as TerminalIcon } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Button from './ui/Button';

const SortableCategoryItem = ({ faq, isSelected, onSelect, onDelete, onEdit }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: faq.id });
    
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.5 : 1
    };

    return (
        <div 
            ref={setNodeRef} 
            style={style} 
            className={`group bg-white dark:bg-gray-800 border ${isSelected ? 'border-indigo-500 shadow-md ring-1 ring-indigo-500' : 'border-gray-100 dark:border-gray-700 hover:border-indigo-200'} rounded-xl p-3 flex items-center gap-3 transition-all cursor-pointer relative`}
            onClick={onSelect}
        >
            <div 
                {...attributes} 
                {...listeners} 
                className="cursor-grab hover:bg-gray-50 dark:hover:bg-gray-700 p-1.5 rounded-lg text-gray-400"
                onClick={(e) => e.stopPropagation()}
            >
                <GripVertical className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{faq.topic}</h4>
                    <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 text-[10px] font-black rounded-md uppercase">
                        {(faq.originalQuestions || []).length} Qs
                    </span>
                </div>
            </div>
            
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                    onClick={(e) => { e.stopPropagation(); onEdit(); }}
                    className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-gray-50 rounded-lg"
                    title="Editar nombre"
                >
                    <Pencil className="w-4 h-4" />
                </button>
                <button 
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                    title="Eliminar categoría"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

const SortableQuestionItem = ({ text, index, onDelete, onEdit, onMove }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: text });
    
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.5 : 1
    };

    return (
        <div 
            ref={setNodeRef} 
            style={style} 
            className="group bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 rounded-lg p-2.5 flex items-start gap-3 relative"
        >
            <div 
                {...attributes} 
                {...listeners} 
                className="cursor-grab hover:bg-gray-200 dark:hover:bg-gray-700 p-1 rounded mt-0.5 text-gray-400"
            >
                <GripVertical className="w-3.5 h-3.5" />
            </div>
            
            <div className="flex-1 min-w-0">
                <p className="text-[13px] text-gray-700 dark:text-gray-300 leading-snug italic">"{text}"</p>
            </div>
            
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button 
                    onClick={onMove}
                    className="p-1 text-gray-400 hover:text-blue-500 hover:bg-white dark:hover:bg-gray-800 rounded"
                    title="Mover a otra categoría"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button 
                    onClick={onEdit}
                    className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-white dark:hover:bg-gray-800 rounded"
                    title="Editar duda"
                >
                    <Pencil className="w-3.5 h-3.5" />
                </button>
                <button 
                    onClick={onDelete}
                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-white dark:hover:bg-gray-800 rounded"
                    title="Eliminar duda"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
};

// iPhone 17 Pro Max Dimensions/Proportions (Scaled down ~15%)
const IPHONE_WIDTH = 300;
const IPHONE_HEIGHT = 630;

const SimulatorSection = ({ showToast }) => {
    const [messages, setMessages] = useState([
        { id: 1, sender: 'bot', text: '¡Hola! Soy Brenda, la asistente virtual de Candidatic. ¿En qué te puedo ayudar hoy?', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showEmojis, setShowEmojis] = useState(false);
    
    // Logs Terminal State
    const [logs, setLogs] = useState([
        { id: Date.now(), time: new Date().toLocaleTimeString(), type: 'system', message: 'Terminal inicializada. Esperando eventos...', data: null }
    ]);
    const terminalEndRef = useRef(null);

    const addLog = (type, message, data = null) => {
        setLogs(prev => [...prev, { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), type, message, data }]);
    };

    useEffect(() => {
        if (terminalEndRef.current) {
            terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);
    
    // --- Simulator Settings State ---
    const [vacancies, setVacancies] = useState([]);
    const [selectedVacancyId, setSelectedVacancyId] = useState('');
    const [faqs, setFaqs] = useState([]);
    const [selectedFaqId, setSelectedFaqId] = useState(null);
    const [loadingFaqs, setLoadingFaqs] = useState(false);
    
    // --- Upload State ---
    const [uploadingFaqId, setUploadingFaqId] = useState(null);
    const [isUploadingFaq, setIsUploadingFaq] = useState(false);
    const faqFileInputRef = useRef(null);
    
    // DND Sensors
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const messagesEndRef = useRef(null);

    const commonEmojis = ['😀', '😂', '👍', '❤️', '🙏', '😊', '🤔', '👋', '✅', '❌', '🤷‍♂️', '🔥', '🎉', '💼', '💵'];

    // Load initial history & vacancies
    useEffect(() => {
        const fetchInitialData = async () => {
            setIsLoading(true);
            try {
                // Fetch simulator chat history
                const simRes = await fetch('/api/ai/simulate', { method: 'GET' });
                const simData = await simRes.json();
                if (simData.messages && simData.messages.length > 0) {
                    setMessages(simData.messages);
                }
                addLog('info', 'Historial inicial del simulador cargado.');

                // Fetch Vacancies for Col 2
                const vacRes = await fetch('/api/vacancies');
                const vacData = await vacRes.json();
                if (vacData.success && vacData.data) {
                    setVacancies(vacData.data);
                }
            } catch (e) {
                console.error('Error fetching initial data:', e);
                addLog('error', 'Error obteniendo historial inicial', { error: e.message });
            } finally {
                setIsLoading(false);
            }
        };
        fetchInitialData();
    }, []);

    // Load FAQs when Vacancy changes
    useEffect(() => {
        if (!selectedVacancyId) {
            setFaqs([]);
            setSelectedFaqId(null);
            return;
        }
        const fetchFaqs = async () => {
            setLoadingFaqs(true);
            try {
                const res = await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`);
                const data = await res.json();
                if (data.success) {
                    setFaqs(data.faqs || []);
                }
            } catch (e) {
                console.error('Error fetching FAQs:', e);
            } finally {
                setLoadingFaqs(false);
            }
        };
        fetchFaqs();
    }, [selectedVacancyId]);

    // --- FAQ Actions ---
    const handleAddCategory = async () => {
        if (!selectedVacancyId) return;
        const topic = prompt('Nombre de la nueva categoría FAQ:');
        if (!topic) return;

        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'create_category', topic })
            });
            const data = await res.json();
            if (data.success) setFaqs(data.faqs);
        } catch (e) {
            showToast('Error al crear categoría', 'error');
        }
    };

    const handleDeleteCategory = async (faqId) => {
        if (!confirm('¿Eliminar esta categoría y todas sus preguntas?')) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faqId })
            });
            if (res.ok) {
                setFaqs(prev => prev.filter(f => f.id !== faqId));
                if (selectedFaqId === faqId) setSelectedFaqId(null);
            }
        } catch (e) {
            showToast('Error al eliminar', 'error');
        }
    };

    const handleEditCategoryTopic = async (faqId, oldTopic) => {
        const newTopic = prompt('Editar nombre de categoría:', oldTopic);
        if (!newTopic || newTopic === oldTopic) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faqId, topic: newTopic })
            });
            if (res.ok) {
                setFaqs(prev => prev.map(f => f.id === faqId ? { ...f, topic: newTopic } : f));
            }
        } catch (e) {
            showToast('Error al editar', 'error');
        }
    };

    const handleCategoryDragEnd = async (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        setFaqs((items) => {
            const oldIndex = items.findIndex(i => i.id === active.id);
            const newIndex = items.findIndex(i => i.id === over.id);
            const newArray = arrayMove(items, oldIndex, newIndex);
            
            // Persist Order
            fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reorder_categories', order: newArray.map(f => f.id) })
            }).catch(e => console.error('Error reordering', e));

            return newArray;
        });
    };

    // --- Question Actions (Column 3) ---
    const handleAddQuestion = async () => {
        if (!selectedVacancyId || !selectedFaqId) return;
        const question = prompt('Ingresa la nueva variante de la duda:');
        if (!question?.trim()) return;

        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add_question', faqId: selectedFaqId, questionText: question.trim() })
            });
            if (res.ok) {
                setFaqs(prev => prev.map(f => 
                    f.id === selectedFaqId 
                        ? { ...f, originalQuestions: [...(f.originalQuestions || []), question.trim()] }
                        : f
                ));
            }
        } catch (e) {
            showToast('Error al agregar', 'error');
        }
    };

    const handleEditQuestion = async (oldText) => {
        const newText = prompt('Modificar duda:', oldText);
        if (!newText?.trim() || newText === oldText) return;

        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'edit_question', faqId: selectedFaqId, questionText: oldText, newQuestionText: newText.trim() })
            });
            if (res.ok) {
                setFaqs(prev => prev.map(f => {
                    if (f.id !== selectedFaqId) return f;
                    const qIdx = f.originalQuestions.indexOf(oldText);
                    if (qIdx === -1) return f;
                    const newQs = [...f.originalQuestions];
                    newQs[qIdx] = newText.trim();
                    return { ...f, originalQuestions: newQs };
                }));
            }
        } catch (e) {
            showToast('Error al editar', 'error');
        }
    };

    const handleDeleteQuestion = async (questionText) => {
        if (!confirm('¿Eliminar esta variante?')) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove_question', faqId: selectedFaqId, questionText })
            });
            if (res.ok) {
                setFaqs(prev => prev.map(f => 
                    f.id === selectedFaqId 
                        ? { ...f, originalQuestions: f.originalQuestions.filter(q => q !== questionText) }
                        : f
                ));
            }
        } catch (e) {
            showToast('Error al eliminar', 'error');
        }
    };

    const handleMoveQuestion = async (questionText) => {
        const availableCategories = faqs.filter(f => f.id !== selectedFaqId);
        if (availableCategories.length === 0) {
            showToast('No hay otras categorías a donde mover', 'info');
            return;
        }

        let promptText = 'Selecciona el número de la categoría destino:\n';
        availableCategories.forEach((cat, idx) => {
            promptText += `${idx + 1}. ${cat.topic}\n`;
        });

        const choice = prompt(promptText);
        if (!choice) return;

        const targetIdx = parseInt(choice) - 1;
        if (isNaN(targetIdx) || targetIdx < 0 || targetIdx >= availableCategories.length) {
            showToast('Selección inválida', 'error');
            return;
        }

        const targetFaqId = availableCategories[targetIdx].id;

        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: 'move_question', 
                    faqId: selectedFaqId, 
                    targetFaqId, 
                    questionText 
                })
            });
            if (res.ok) {
                showToast('Pregunta movida con éxito', 'success');
                setFaqs(prev => prev.map(f => {
                    if (f.id === selectedFaqId) {
                        return { ...f, originalQuestions: f.originalQuestions.filter(q => q !== questionText) };
                    }
                    if (f.id === targetFaqId) {
                        return { ...f, originalQuestions: [...(f.originalQuestions || []), questionText] };
                    }
                    return f;
                }));
            } else {
                showToast('Error al mover', 'error');
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        }
    };

    const handleQuestionDragEnd = async (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id || !selectedFaqId) return;

        const currentFaq = faqs.find(f => f.id === selectedFaqId);
        if (!currentFaq) return;

        const oldIndex = currentFaq.originalQuestions.indexOf(active.id);
        const newIndex = currentFaq.originalQuestions.indexOf(over.id);
        const newArray = arrayMove(currentFaq.originalQuestions, oldIndex, newIndex);

        setFaqs(prev => prev.map(f => f.id === selectedFaqId ? { ...f, originalQuestions: newArray } : f));

        fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reorder_questions', faqId: selectedFaqId, questionsOrder: newArray })
        }).catch(e => console.error('Error reordering qs', e));
    };

    const handleSaveOfficialAnswer = async (newAnswer) => {
        if (!selectedVacancyId || !selectedFaqId) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faqId: selectedFaqId, officialAnswer: newAnswer })
            });
            if (res.ok) {
                showToast('Respuesta oficial guardada', 'success');
                // The onBlur event syncs state, but we ensure central state is matching just in case
                setFaqs(prev => prev.map(f => f.id === selectedFaqId ? { ...f, officialAnswer: newAnswer } : f));
            }
        } catch (e) {
            showToast('Error al guardar respuesta', 'error');
        }
    };

    const handleFaqFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file || !uploadingFaqId) return;

        if (file.size > 5 * 1024 * 1024) {
            showToast('Archivo demasiado grande (Máx 5MB)', 'error');
            setUploadingFaqId(null);
            return;
        }

        setIsUploadingFaq(true);
        try {
            const customName = window.prompt(
                "Ingresa el nombre público con el que Brenda enviará este archivo:",
                file.name
            );

            // If user clicked Cancel on the prompt
            if (customName === null) {
                setIsUploadingFaq(false);
                setUploadingFaqId(null);
                return;
            }

            const reader = new FileReader();
            const base64Promise = new Promise(resolve => {
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(file);
            });
            const base64 = await base64Promise;

            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64, filename: customName })
            });
            const data = await res.json();

            if (data.success) {
                const extension = data.mime === 'application/pdf' ? '&ext=.pdf' : '&ext=.jpg';
                const mediaUrl = `${window.location.origin}${data.url}${extension}`;
                
                // Save to Backend immediately
                await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ faqId: uploadingFaqId, mediaUrl })
                });

                setFaqs(current => current.map(f =>
                    f.id === uploadingFaqId ? { ...f, mediaUrl } : f
                ));
                showToast('Archivo subido correctamente. Recuerda guardar el FAQ.', 'success');
            } else {
                showToast('Error al subir archivo', 'error');
            }
        } catch (err) {
            console.error('Upload error:', err);
            showToast('Error de conexión al subir', 'error');
        } finally {
            setIsUploadingFaq(false);
            setUploadingFaqId(null);
            if (e.target) e.target.value = '';
        }
    };

    const handleRemoveFaqMedia = async (faqId) => {
        if(!confirm('¿Eliminar archivo adjunto?')) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${selectedVacancyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faqId, mediaUrl: null })
            });
            if (res.ok) {
                setFaqs(prev => prev.map(f => f.id === faqId ? { ...f, mediaUrl: null } : f));
                showToast('Archivo eliminado', 'success');
            }
        } catch (e) {
            showToast('Error al eliminar archivo', 'error');
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = async (e) => {
        e?.preventDefault();
        if (!inputValue.trim() || isLoading) return;

        const userMsg = {
            id: Date.now(),
            sender: 'user',
            text: inputValue,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages(prev => [...prev, userMsg]);
        addLog('user', `[Usuario]: ${inputValue}`);
        setInputValue('');
        setShowEmojis(false);
        setIsLoading(true);

        try {
            const response = await fetch('/api/ai/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg.text, sessionId: 'simulator_123' })
            });
            const data = await response.json();

            if (!response.ok || !data.success) {
                addLog('error', `Error HTTP/API Code: ${response.status}`, data);
                throw new Error(data.error || `HTTP error ${response.status}`);
            }

            addLog('ai', `Respuesta del Simulador (Status 200)`, data);

            const rawReply = data.reply || 'Sin respuesta del bot.';
            const parts = rawReply.split(/\[MSG_SPLIT\]/).map(p => p.trim()).filter(Boolean);
            
            const newBubbles = parts.map((part, idx) => ({
                id: Date.now() + idx + 1,
                sender: 'bot',
                text: part,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }));

            // Insert media bubble if the AI sent an attachment
            if (data.mediaUrl) {
                const mediaBubble = {
                    id: Date.now() + 100,
                    sender: 'bot',
                    isMedia: true,
                    mediaUrl: data.mediaUrl,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                };
                if (newBubbles.length > 1) {
                    newBubbles.splice(1, 0, mediaBubble);
                } else {
                    newBubbles.push(mediaBubble);
                }
            }

            setMessages(prev => [...prev, ...newBubbles]);
        } catch (error) {
            console.error('Sim error:', error);
            addLog('error', 'Excepción Capturada', { error: error.message || String(error) });
            showToast('Error al procesar el mensaje', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleRestart = async () => {
        setIsLoading(true);
        addLog('system', 'Solicitando reinicio de sesión...');
        try {
            const response = await fetch('/api/ai/simulate', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reset: true, sessionId: 'simulator_123' })
            });
            const data = await response.json();
            setMessages([
                { id: Date.now(), sender: 'bot', text: data.reply || 'Conversación reiniciada. ¡Hola! Soy Brenda.', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
            ]);
            addLog('success', 'Sesión reiniciada exitosamente.');
            showToast('Chat reiniciado', 'info');
        } catch (error) {
            console.error('Reset error:', error);
            addLog('error', 'Fallo al reiniciar chat', { error: error.message || String(error) });
            showToast('Error al reiniciar', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="h-full flex flex-col space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-3 text-gray-900 dark:text-white">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg text-blue-600 dark:text-blue-400">
                            <Smartphone className="w-6 h-6" />
                        </div>
                        📱 Simulador de Brenda 🚀
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Prueba los flujos conversacionales, respuestas y el Radar de FAQs en tiempo real 💬.</p>
                </div>
                <div className="flex items-center space-x-4">
                    <Button onClick={handleRestart} variant="outline" className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" />
                        Reiniciar Chat
                    </Button>
                </div>
            </div>

            {/* Main Area: 4 Columns Layout */}
            <div className="flex-1 grid grid-cols-1 xl:grid-cols-4 lg:grid-cols-2 gap-6 overflow-hidden">
                
                {/* COLUMN 1: iPhone 17 Pro Max Mockup */}
                <div className="flex flex-col items-center justify-center p-4">
                    <div 
                        className="relative bg-black rounded-[55px] shadow-2xl overflow-hidden border-[8px] border-slate-900 ring-1 ring-white/10"
                        style={{ width: IPHONE_WIDTH, height: IPHONE_HEIGHT, maxWidth: '100%' }}
                    >
                        {/* Dynamic Island */}
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-8 bg-black rounded-full z-20" />

                        {/* Screen Content: WhatsApp Clone UI */}
                        <div className="absolute inset-0 bg-[#EFEAE2] flex flex-col pt-12">
                            {/* WA Header */}
                            <div className="bg-[#00A884] text-white px-4 py-3 flex items-center space-x-3 shadow-sm z-10 shrink-0">
                                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center shrink-0">
                                    <span className="font-bold text-lg">B</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-[15px] truncate">Brenda (Simulador)</h3>
                                    <p className="text-xs text-white/80">en línea</p>
                                </div>
                            </div>

                            {/* WA Chat Area */}
                            <div 
                                className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar" 
                                style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")', backgroundSize: 'contain' }}
                            >
                                {messages.map((msg) => (
                                    <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div 
                                            className={`max-w-[85%] rounded-lg px-3 py-2 text-[15px] shadow-sm relative ${
                                                msg.sender === 'user' 
                                                ? 'bg-[#D9FDD3] rounded-tr-none' 
                                                : 'bg-white rounded-tl-none'
                                            }`}
                                        >
                                            {msg.isMedia ? (
                                                <div className="flex flex-col items-center">
                                                    {msg.mediaUrl.includes('.pdf') ? (
                                                        <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg border border-red-100 hover:bg-red-100 transition-colors w-full">
                                                            <FileText className="w-8 h-8 shrink-0" />
                                                            <span className="text-[13px] font-bold block overflow-hidden text-ellipsis whitespace-nowrap">Documento PDF</span>
                                                        </a>
                                                    ) : (
                                                        <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
                                                            <img src={msg.mediaUrl} alt="Media" className="rounded-lg w-full h-auto max-w-[200px] object-cover border border-gray-100" />
                                                        </a>
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="text-gray-900 whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                                            )}
                                            <div className="text-[10px] text-gray-500 text-right mt-1 font-medium">
                                                {msg.time}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {isLoading && (
                                    <div className="flex justify-start">
                                        <div className="bg-white rounded-lg rounded-tl-none px-4 py-3 shadow-sm flex items-center space-x-2">
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* WA Input Area */}
                            <div className="bg-[#F0F2F5] p-3 flex flex-col shrink-0 pb-6 relative">
                                {showEmojis && (
                                    <div className="absolute bottom-full left-3 mb-2 bg-white rounded-lg shadow-lg p-2 flex gap-2 flex-wrap w-64 border border-gray-200">
                                        {commonEmojis.map(emoji => (
                                            <button 
                                                key={emoji} 
                                                type="button"
                                                onClick={() => setInputValue(prev => prev + emoji)}
                                                className="w-8 h-8 flex items-center justify-center text-xl hover:bg-gray-100 rounded"
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className="flex items-end space-x-2">
                                    <button 
                                        type="button"
                                        onClick={() => setShowEmojis(!showEmojis)}
                                        className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700 shrink-0"
                                    >
                                        <Smile className="w-6 h-6" />
                                    </button>
                                    <form onSubmit={handleSendMessage} className="flex-1 flex items-center bg-white rounded-2xl px-4 py-2 min-h-[44px] shadow-sm">
                                        <input
                                            type="text"
                                            value={inputValue}
                                            onChange={(e) => setInputValue(e.target.value)}
                                            placeholder="Escribe un mensaje"
                                            className="flex-1 bg-transparent outline-none text-[15px]"
                                            disabled={isLoading}
                                        />
                                    </form>
                                    {inputValue.trim() && (
                                        <button 
                                            onClick={handleSendMessage}
                                            className="w-11 h-11 bg-[#00A884] rounded-full flex items-center justify-center text-white shrink-0 hover:bg-[#008f6f] transition-colors"
                                        >
                                            <Send className="w-5 h-5 ml-1" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* COLUMN 2: Terminal Logs Pane */}
                <div className="bg-[#0D1117] rounded-2xl shadow-xl border border-gray-800 flex flex-col h-full overflow-hidden text-gray-300 font-mono text-xs">
                    <div className="flex items-center justify-between px-4 py-3 bg-[#161B22] border-b border-gray-800 shrink-0">
                        <div className="flex items-center gap-2 text-gray-300 font-semibold text-[13px]">
                            <TerminalIcon className="w-4 h-4 text-emerald-400" />
                            Console / Logs
                        </div>
                        <button 
                            onClick={() => setLogs([])}
                            className="px-2 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
                        >
                            Clear
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar break-words">
                        {logs.length === 0 ? (
                            <p className="text-gray-600 italic">No hay logs recientes.</p>
                        ) : (
                            <div className="space-y-3">
                                {logs.map(log => (
                                    <div key={log.id} className="flex flex-col gap-1 pb-2 border-b border-gray-800/50 last:border-0 last:pb-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-500 shrink-0">[{log.time}]</span>
                                            {log.type === 'error' && <span className="text-red-400 font-bold shrink-0">[ERROR]</span>}
                                            {log.type === 'ai' && <span className="text-purple-400 font-bold shrink-0">[BRAIN]</span>}
                                            {log.type === 'user' && <span className="text-blue-400 font-bold shrink-0">[IN]</span>}
                                            {log.type === 'system' && <span className="text-yellow-400 font-bold shrink-0">[SYS]</span>}
                                            {log.type === 'success' && <span className="text-emerald-400 font-bold shrink-0">[OK]</span>}
                                            <span className={`flex-1 ${log.type === 'error' ? 'text-red-300' : 'text-gray-300'}`}>
                                                {log.message}
                                            </span>
                                        </div>
                                        {log.data && (
                                            <pre className="mt-1 bg-[#161B22] p-2 rounded border border-gray-800 text-[10px] text-gray-400 overflow-x-auto whitespace-pre-wrap">
                                                {JSON.stringify(log.data, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                ))}
                                <div ref={terminalEndRef} />
                            </div>
                        )}
                    </div>
                </div>

                {/* COLUMN 3: Controles & Categorías (Radar) */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col h-full overflow-hidden">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            ⚙️ Categorías (Radar)
                        </h3>
                        <button 
                            onClick={handleAddCategory}
                            disabled={!selectedVacancyId}
                            className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                            title="Nueva Categoría"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="mb-4">
                        <select
                            className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                            value={selectedVacancyId}
                            onChange={(e) => setSelectedVacancyId(e.target.value)}
                        >
                            <option value="">-- Selecciona Vacante para Radar --</option>
                            {vacancies.map(v => (
                                <option key={v.id} value={v.id}>{v.name} ({v.company})</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                        {!selectedVacancyId ? (
                            <p className="text-xs text-gray-400 text-center mt-10">Selecciona una vacante arriba para ver su Radar de Dudas.</p>
                        ) : loadingFaqs ? (
                            <p className="text-xs text-gray-400 text-center mt-10 animate-pulse">Cargando...</p>
                        ) : faqs.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center mt-10">No hay categorías. Crea una.</p>
                        ) : (
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
                                <SortableContext items={faqs.map(f => f.id)} strategy={verticalListSortingStrategy}>
                                    {faqs.map(faq => (
                                        <SortableCategoryItem 
                                            key={faq.id} 
                                            faq={faq} 
                                            isSelected={selectedFaqId === faq.id}
                                            onSelect={() => setSelectedFaqId(faq.id)}
                                            onEdit={() => handleEditCategoryTopic(faq.id, faq.topic)}
                                            onDelete={() => handleDeleteCategory(faq.id)}
                                        />
                                    ))}
                                </SortableContext>
                            </DndContext>
                        )}
                    </div>
                </div>

                {/* COLUMN 4: Preguntas Locales del Radar */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col h-full overflow-hidden">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            🧠 Rayos X (Preguntas)
                        </h3>
                        <div className="flex gap-2">
                            <button 
                                onClick={handleAddQuestion}
                                disabled={!selectedFaqId}
                                className="p-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
                                title="Agregar nueva pregunta manual"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    
                    {!selectedFaqId ? (
                        <p className="text-xs text-gray-400 text-center mt-10">Selecciona una categoría en la Columna 2 para ver y editar sus preguntas y la respuesta oficial.</p>
                    ) : (
                        <div className="flex-1 flex flex-col overflow-hidden">
                            <div className="mb-4 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 rounded-lg border border-indigo-100 dark:border-indigo-800/50">
                                <p className="text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-tight">Tema enfocado:</p>
                                <p className="text-sm text-gray-800 dark:text-gray-200 truncate" title={faqs.find(f => f.id === selectedFaqId)?.topic}>
                                    {faqs.find(f => f.id === selectedFaqId)?.topic}
                                </p>
                            </div>

                            <p className="text-[10px] font-black tracking-widest text-gray-400 uppercase mb-2">Variantes de Dudas Detectadas</p>
                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2 min-h-[150px]">
                                {(() => {
                                    const activeFaq = faqs.find(f => f.id === selectedFaqId);
                                    if (!activeFaq?.originalQuestions || activeFaq.originalQuestions.length === 0) {
                                        return <p className="text-xs text-gray-400 text-center mt-4">No hay preguntas asociadas a este tema.</p>;
                                    }
                                    return (
                                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleQuestionDragEnd}>
                                            <SortableContext items={activeFaq.originalQuestions} strategy={verticalListSortingStrategy}>
                                                {activeFaq.originalQuestions.map((qText, idx) => (
                                                    <SortableQuestionItem 
                                                        key={`q-${qText}-${idx}`} // Use combined key for absolute safety just in case of dupes
                                                        text={qText} 
                                                        index={idx}
                                                        onDelete={() => handleDeleteQuestion(qText)}
                                                        onEdit={() => handleEditQuestion(qText)}
                                                        onMove={() => handleMoveQuestion(qText)}
                                                    />
                                                ))}
                                            </SortableContext>
                                        </DndContext>
                                    );
                                })()}
                            </div>

                            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 shrink-0">
                                <label className="block text-[10px] font-black tracking-widest text-blue-600 dark:text-blue-400 uppercase mb-2 flex items-center gap-1.5">
                                    <Bot className="w-3.5 h-3.5" />
                                    Respuesta Oficial del Bot
                                </label>
                                <textarea
                                    key={`answer-${selectedFaqId}`}
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-[13px] resize-none"
                                    rows={4}
                                    placeholder="Instruye a Brenda sobre qué responder cuando le pregunten por este tema. Guarda automáticamente al salir del campo."
                                    defaultValue={faqs.find(f => f.id === selectedFaqId)?.officialAnswer || ''}
                                    onBlur={(e) => {
                                        const newVal = e.target.value.trim();
                                        const currentVal = faqs.find(f => f.id === selectedFaqId)?.officialAnswer || '';
                                        if (newVal !== currentVal) {
                                            handleSaveOfficialAnswer(newVal);
                                        }
                                    }}
                                />
                                <div className="mt-2 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50 p-2 rounded-lg border border-gray-100 dark:border-gray-700">
                                    {faqs.find(f => f.id === selectedFaqId)?.mediaUrl ? (
                                        <div className="flex items-center justify-between w-full group/media">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500">
                                                    {faqs.find(f => f.id === selectedFaqId).mediaUrl.includes('.pdf') ? <FileText className="w-3.5 h-3.5" /> : <ImageIcon className="w-3.5 h-3.5" />}
                                                </div>
                                                <a href={faqs.find(f => f.id === selectedFaqId).mediaUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-700 dark:text-gray-300 truncate hover:text-indigo-600 transition-colors">
                                                    Archivo Adjunto
                                                </a>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveFaqMedia(selectedFaqId)}
                                                className="p-1 text-gray-400 hover:text-red-500 hover:bg-white dark:hover:bg-gray-900 rounded transition-colors opacity-0 group-hover/media:opacity-100 flex-shrink-0"
                                                title="Eliminar archivo"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between w-full">
                                            <p className="text-[10px] text-gray-400">Sin archivo interactivo</p>
                                            <input 
                                                type="file" 
                                                className="hidden" 
                                                ref={faqFileInputRef} 
                                                accept="application/pdf,image/jpeg,image/png,image/webp"
                                                onChange={handleFaqFileSelect}
                                            />
                                            <button
                                                className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 rounded shadow-sm transition-colors disabled:opacity-50"
                                                onClick={() => {
                                                    setUploadingFaqId(selectedFaqId);
                                                    setTimeout(() => faqFileInputRef.current?.click(), 0);
                                                }}
                                                disabled={isUploadingFaq && uploadingFaqId === selectedFaqId}
                                            >
                                                {isUploadingFaq && uploadingFaqId === selectedFaqId ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                    <Paperclip className="w-3 h-3" />
                                                )}
                                                Adjuntar PDF/IMG
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <p className="text-[9px] text-gray-400 mt-2 text-right">Se guarda automáticamente 💾</p>
                            </div>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default SimulatorSection;
