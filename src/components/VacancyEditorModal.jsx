import React, { useState, useEffect, useRef } from 'react';
import { FileText, Loader2, Save, Trash2, Pencil, Sparkles, RefreshCw, Paperclip, Image as ImageIcon, X, Plus, Building2, Tag } from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';
import { useToast } from '../hooks/useToast';

// Sanitize FAQ question strings — they may be stored as raw JSON objects
const sanitizeQuestion = (q) => {
    if (typeof q !== 'string') return String(q);
    const t = q.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
        try {
            const parsed = JSON.parse(t);
            if (parsed?.text) return parsed.text;
        } catch (_) { /* not JSON */ }
        if (t.includes(' | ')) {
            const parts = t.split(' | ');
            const texts = parts.map(p => { try { const o = JSON.parse(p.trim()); return o?.text || p.trim(); } catch (_) { return p.trim(); } }).filter(Boolean);
            if (texts.length) return texts[0];
        }
    }
    return t;
};

// Deduplicate originalQuestions: group identical (case-insensitive trim) and return [{text, count}]
const deduplicateQuestions = (questions) => {
    const map = new Map();
    (questions || []).forEach(q => {
        const clean = sanitizeQuestion(q);
        const key = clean.trim().toLowerCase();
        if (map.has(key)) { map.get(key).count++; }
        else { map.set(key, { text: clean, raw: q, count: 1 }); }
    });
    return Array.from(map.values());
};

const VacancyEditorModal = ({ isOpen, onClose, vacancyId, onSaveSuccess }) => {
    const { toast, showToast, hideToast, ToastComponent } = useToast();

    const [saving, setSaving] = useState(false);
    const [loadingData, setLoadingData] = useState(false);
    // Selected question per FAQ card to preview the AI response
    const [selectedQuestion, setSelectedQuestion] = useState({});

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        company: '',
        category: '',
        description: '',
        messageDescription: '',
        documents: []
    });

    const [categories, setCategories] = useState([]);
    const [availableFields, setAvailableFields] = useState([]);

    const [newDocName, setNewDocName] = useState('');
    const [isUploadingDoc, setIsUploadingDoc] = useState(false);
    const docInputRef = useRef(null);

    // FAQ Radar State
    const [faqs, setFaqs] = useState([]);
    const [loadingFaqs, setLoadingFaqs] = useState(false);
    const [uploadingFaqId, setUploadingFaqId] = useState(null);
    const [isUploadingFaq, setIsUploadingFaq] = useState(false);
    const faqFileInputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            loadCategories();
            loadFields();
            if (vacancyId) {
                loadVacancy(vacancyId);
                loadFaqs(vacancyId);
            } else {
                setFormData({ name: '', company: '', category: '', description: '', messageDescription: '', documents: [] });
                setFaqs([]);
                setNewDocName('');
            }
        }
    }, [isOpen, vacancyId]);

    // Auto-refresh (silent poll) para FAQ radar
    useEffect(() => {
        let interval;
        if (isOpen && vacancyId) {
            interval = setInterval(() => {
                fetch(`/api/vacancies/faq?vacancyId=${vacancyId}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            setFaqs(currentFaqs => {
                                if (!data.faqs) return [];
                                return data.faqs.map(newFaq => {
                                    const existing = currentFaqs.find(f => f.id === newFaq.id);
                                    if (existing) {
                                        return {
                                            ...newFaq,
                                            officialAnswer: existing.officialAnswer !== undefined ? existing.officialAnswer : newFaq.officialAnswer,
                                            mediaUrl: existing.mediaUrl !== undefined ? existing.mediaUrl : newFaq.mediaUrl
                                        };
                                    }
                                    return newFaq;
                                });
                            });
                        }
                    })
                    .catch(e => console.error('Silent FAQ poll error:', e));
            }, 10000);
        }
        return () => clearInterval(interval);
    }, [isOpen, vacancyId]);

    const loadVacancy = async (id) => {
        setLoadingData(true);
        try {
            const res = await fetch('/api/vacancies');
            const data = await res.json();
            if (data.success) {
                const vacancy = data.data.find(v => v.id === id);
                if (vacancy) {
                    setFormData({
                        name: vacancy.name,
                        company: vacancy.company,
                        category: vacancy.category,
                        description: vacancy.description || '',
                        messageDescription: vacancy.messageDescription || '',
                        documents: vacancy.documents || []
                    });
                } else {
                    showToast('Vacante no encontrada', 'error');
                }
            }
        } catch (e) {
            console.error(e);
            showToast('Error al cargar vacante', 'error');
        } finally {
            setLoadingData(false);
        }
    };

    const loadCategories = async () => {
        try {
            const res = await fetch('/api/categories');
            const data = await res.json();
            if (data.success) {
                setCategories(data.data || []);
            }
        } catch (e) {
            console.error('Error loading categories:', e);
        }
    };

    const loadFields = async () => {
        try {
            const res = await fetch('/api/fields');
            const data = await res.json();
            if (data.success) {
                setAvailableFields(data.fields || []);
            }
        } catch (e) {
            console.error('Error loading fields:', e);
        }
    };

    const loadFaqs = async (id) => {
        setLoadingFaqs(true);
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${id}`);
            const data = await res.json();
            if (data.success) {
                setFaqs(current => {
                    if (current.length === 0) return data.faqs || [];
                    return (data.faqs || []).map(newFaq => {
                        const existing = current.find(f => f.id === newFaq.id);
                        if (existing) {
                            return {
                                ...newFaq,
                                officialAnswer: existing.officialAnswer !== undefined ? existing.officialAnswer : newFaq.officialAnswer,
                                mediaUrl: existing.mediaUrl !== undefined ? existing.mediaUrl : newFaq.mediaUrl
                            };
                        }
                        return newFaq;
                    });
                });
            }
        } catch (error) {
            console.error('Error loading FAQs:', error);
        } finally {
            setLoadingFaqs(false);
        }
    };

    const handleSave = async () => {
        if (!formData.name || !formData.company || !formData.category) {
            showToast('Por favor completa los campos obligatorios', 'error');
            return;
        }

        setSaving(true);
        try {
            const method = vacancyId ? 'PUT' : 'POST';
            const body = vacancyId ? { ...formData, id: vacancyId } : formData;

            const res = await fetch('/api/vacancies', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (data.success) {
                showToast(vacancyId ? 'Vacante actualizada exitosamente' : 'Vacante creada exitosamente', 'success');
                if (onSaveSuccess) onSaveSuccess();
                if (!vacancyId) {
                    onClose();
                }
            } else {
                showToast(data.error || 'Error al guardar', 'error');
            }
        } catch (error) {
            console.error('Error saving vacancy:', error);
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    // --- Documents Logic ---
    const handleUploadDocument = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !newDocName.trim()) return;

        if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            showToast('El archivo debe ser un PDF, JPG, PNG o WebP', 'error');
            if (e.target) e.target.value = '';
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            showToast('El archivo excede el límite de 5MB', 'error');
            if (e.target) e.target.value = '';
            return;
        }

        setIsUploadingDoc(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                const base64Data = reader.result;
                const uploadType = file.type === 'application/pdf' ? 'pdf' : 'image';

                const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: base64Data, type: uploadType })
                });
                const data = await res.json();

                if (data.success) {
                    let ext = '.pdf';
                    if (file.type !== 'application/pdf') {
                        ext = `.${file.name.split('.').pop()}`;
                    }
                    const docUrl = `${window.location.origin}${data.url}&ext=${ext.replace('.', '')}`;

                    let extractedText = null;
                    if (file.type && file.type.startsWith('image/')) {
                        try {
                            showToast('Analizando texto de la imagen (OCR)...', 'info');
                            const ocrRes = await fetch('/api/ai/ocr', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ image: base64Data })
                            });
                            const ocrData = await ocrRes.json();
                            if (ocrData.success && ocrData.text) {
                                extractedText = ocrData.text;
                                showToast('Texto extraído correctamente.', 'success');
                            }
                        } catch (ocrErr) {
                            console.error('OCR Error:', ocrErr);
                            showToast('Advertencia: No se pudo extraer texto de la imagen.', 'error');
                        }
                    }

                    const newDoc = {
                        id: `doc_${Date.now()}`,
                        name: newDocName.trim(),
                        url: docUrl,
                        type: file.type,
                        extractedText: extractedText
                    };

                    setFormData(prev => ({
                        ...prev,
                        documents: [...(prev.documents || []), newDoc]
                    }));
                    setNewDocName('');
                    showToast('Archivo agregado. Recuerda guardar la vacante.', 'success');
                } else {
                    showToast(data.error || 'Error al subir', 'error');
                }
                setIsUploadingDoc(false);
                if (e.target) e.target.value = '';
            };
        } catch (err) {
            console.error('Doc upload error:', err);
            showToast('Error de conexión', 'error');
            setIsUploadingDoc(false);
            if (e.target) e.target.value = '';
        }
    };

    const handleDeleteDocument = (docId) => {
        setFormData(prev => ({
            ...prev,
            documents: (prev.documents || []).filter(d => d.id !== docId)
        }));
    };

    // --- FAQ Logic ---
    const handleSaveFaq = async (faqId, officialAnswer, mediaUrl) => {
        if (!vacancyId) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${vacancyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faqId, officialAnswer, mediaUrl })
            });
            if (res.ok) {
                showToast('Respuesta oficial guardada e inyectada a la IA', 'success');
                loadFaqs(vacancyId);
            } else {
                showToast('Error al guardar respuesta', 'error');
            }
        } catch (error) {
            console.error('Error saving FAQ:', error);
            showToast('Error de conexión', 'error');
        }
    };

    const handleDeleteFaq = async (faqId) => {
        if (!confirm('¿Seguro que deseas eliminar esta pregunta del radar?')) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${vacancyId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faqId })
            });
            if (res.ok) {
                showToast('Pregunta descartada', 'success');
                loadFaqs(vacancyId);
            }
        } catch (error) {
            console.error('Error deleting FAQ:', error);
            showToast('Error al eliminar duda', 'error');
        }
    };

    const handleSplitFaq = async (faqId, questionText) => {
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${vacancyId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'split', faqId, questionText })
            });
            if (res.ok) {
                showToast('Duda separada en un nuevo tema', 'success');
                loadFaqs(vacancyId);
            }
        } catch (error) {
            console.error('Error splitting FAQ:', error);
            showToast('Error de conexión', 'error');
        }
    };

    const handleRemoveQuestion = async (faqId, questionText) => {
        if (!confirm('¿Deseas eliminar esta pregunta específica?')) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${vacancyId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove_question', faqId, questionText })
            });
            if (res.ok) {
                showToast('Pregunta eliminada', 'success');
                loadFaqs(vacancyId);
            }
        } catch (error) {
            console.error('Error removing question:', error);
            showToast('Error de conexión', 'error');
        }
    };

    const handleUpdateTopic = async (faqId, newTopic) => {
        if (!newTopic?.trim()) return;
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${vacancyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faqId, topic: newTopic })
            });
            if (res.ok) {
                showToast('Tema actualizado', 'success');
                loadFaqs(vacancyId);
            }
        } catch (error) {
            console.error('Error updating topic:', error);
            showToast('Error al actualizar tema', 'error');
        }
    };

    const handleReclusterFaqs = async () => {
        if (!confirm('Brenda volverá a analizar todas las preguntas para agruparlas mejor según los nombres de los temas actuales. ¿Deseas continuar?')) return;

        setLoadingFaqs(true);
        try {
            const res = await fetch(`/api/vacancies/faq?vacancyId=${vacancyId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'recluster' })
            });
            if (res.ok) {
                showToast('Dudas re-agrupadas con éxito ✨', 'success');
                loadFaqs(vacancyId);
            } else {
                showToast('Error al re-agrupar', 'error');
            }
        } catch (error) {
            console.error('Error reclustering FAQs:', error);
            showToast('Error de conexión', 'error');
        } finally {
            setLoadingFaqs(false);
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

    if (loadingData && vacancyId) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title="Editar Vacante" maxWidth="max-w-[1400px] w-[95vw]">
                <div className="flex items-center justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            </Modal>
        );
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={vacancyId ? "Editar Vacante" : "Nueva Vacante"}
            maxWidth={vacancyId ? "max-w-[1400px] w-[95vw]" : "max-w-xl"}
        >
            <div className={`grid gap-8 h-[calc(100vh-16rem)] min-h-[400px] max-h-[700px] ${vacancyId ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                {/* COLUMNA 1: FORMULARIO VACANTE */}
                <div className="space-y-4 h-full min-h-0 overflow-y-auto pr-2 custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Input
                            label="Nombre de la Vacante"
                            placeholder="Ej. Desarrollador Senior"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            autoFocus
                        />

                        <Input
                            label="Empresa"
                            placeholder="Ej. Tech Corp"
                            icon={Building2}
                            value={formData.company}
                            onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                        />

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                Categoría
                            </label>
                            <div className="relative">
                                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <select
                                    className="w-full h-10 pl-10 pr-4 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500/20 outline-none bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm appearance-none"
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                >
                                    <option value="">Selecciona una categoría...</option>
                                    {categories.map(cat => (
                                        <option key={cat.id} value={cat.name}>{cat.name}</option>
                                    ))}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Descripción
                        </label>
                        <textarea
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                            rows={12}
                            placeholder="Detalles sobre el puesto..."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="block text-[10px] font-black tracking-widest text-blue-600 dark:text-blue-400 uppercase">
                            Vacante para Mensaje (Info para el Bot)
                        </label>
                        <textarea
                            className="w-full px-4 py-2 border border-blue-100 dark:border-blue-900/50 rounded-lg focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800/20 focus:border-blue-300 bg-blue-50/30 dark:bg-blue-900/10 text-gray-900 dark:text-white text-sm italic"
                            rows={6}
                            placeholder="Escribe aquí la información simplificada que el bot mandará por WhatsApp..."
                            value={formData.messageDescription}
                            onChange={(e) => setFormData({ ...formData, messageDescription: e.target.value })}
                        />
                    </div>

                    {/* BASE DE CONOCIMIENTO (PDF) */}
                    <div className="space-y-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                        <div>
                            <h4 className="text-[12px] font-black tracking-widest text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-2 mb-1">
                                <FileText className="w-4 h-4" /> Base de Conocimiento (IA)
                            </h4>
                            <p className="text-xs text-gray-500 mb-3">Sube reglamentos o manuales de la vacante para que Brenda (IA) los lea y se vuelva experta.</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Zona de Carga - Izquierda */}
                            <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700 h-fit">
                                <div className="grid grid-cols-1 gap-3">
                                    <Input
                                        label="Nombre del Documento"
                                        placeholder="Ej. Reglamento Interno..."
                                        value={newDocName}
                                        onChange={(e) => setNewDocName(e.target.value)}
                                        className="mb-0"
                                    />
                                    <div>
                                        <input
                                            type="file"
                                            ref={docInputRef}
                                            className="hidden"
                                            accept="application/pdf,image/jpeg,image/png,image/webp"
                                            onChange={handleUploadDocument}
                                        />
                                        <Button
                                            onClick={() => docInputRef.current?.click()}
                                            disabled={!newDocName.trim() || isUploadingDoc}
                                            variant={newDocName.trim() ? "primary" : "outline"}
                                            icon={isUploadingDoc ? Loader2 : Paperclip}
                                            className="w-full"
                                        >
                                            {isUploadingDoc ? 'Subiendo...' : 'Adjuntar Archivo'}
                                        </Button>
                                    </div>
                                </div>

                                {(!newDocName.trim() && !isUploadingDoc) && (
                                    <p className="text-[10px] text-gray-400 mt-2 font-medium">✏️ Escribe un nombre descriptivo para habilitar el botón de adjuntar.</p>
                                )}
                            </div>

                            {/* Archivos Adjuntos - Derecha */}
                            <div className="space-y-2">
                                {(!formData.documents || formData.documents.length === 0) ? (
                                    <div className="flex flex-col items-center justify-center p-6 bg-gray-50/50 dark:bg-gray-900/30 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl h-full min-h-[120px]">
                                        <FileText className="w-6 h-6 text-gray-300 mb-2" strokeWidth={1.5} />
                                        <p className="text-xs text-gray-400">Sin documentos adjuntos</p>
                                    </div>
                                ) : (
                                    formData.documents.map((doc) => (
                                        <div key={doc.id} className="flex items-center justify-between p-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md group hover:border-indigo-300 transition-colors shadow-sm">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${doc.type && doc.type.startsWith('image/') ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500' : 'bg-red-50 dark:bg-red-900/20 text-red-500'}`}>
                                                    {doc.type && doc.type.startsWith('image/') ? <ImageIcon className="w-3 h-3" strokeWidth={1.5} /> : <FileText className="w-3 h-3" strokeWidth={1.5} />}
                                                </div>
                                                <div className="flex items-center gap-2 truncate">
                                                    <p className="text-[11px] font-medium text-gray-700 dark:text-gray-200 truncate" title={doc.name}>{doc.name}</p>
                                                    <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-indigo-500 hover:text-indigo-600 font-medium">Ver</a>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteDocument(doc.id)}
                                                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                                                title="Eliminar documento"
                                            >
                                                <Trash2 className="w-3 h-3" strokeWidth={1.5} />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* COLUMNA 2: RADAR DE DUDAS (SOLO EN EDICION) */}
                {vacancyId && (
                    <div className="space-y-4 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 pt-6 lg:pt-0 lg:pl-8 flex flex-col h-full min-h-0">
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                                    Radar de Dudas (IA)
                                </h3>
                                <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                    Dudas frecuentes de candidatos sobre esta vacante. Dales respuesta y la IA lo aprenderá al instante.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleReclusterFaqs}
                                    disabled={loadingFaqs || faqs.length === 0}
                                    className="flex justify-center items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-indigo-100 dark:border-indigo-800 disabled:opacity-50 whitespace-nowrap"
                                    title="Brenda re-analizará todas las dudas basándose en los nombres de los temas actuales"
                                >
                                    <Sparkles className={`w-3 h-3 ${loadingFaqs ? 'animate-pulse' : ''}`} />
                                    {loadingFaqs ? 'Re-agrupando...' : 'Re-agrupar con IA'}
                                </button>
                                <button
                                    onClick={() => loadFaqs(vacancyId)}
                                    className="p-1.5 text-gray-500 hover:text-indigo-600 bg-gray-50 hover:bg-indigo-50 rounded-lg transition-colors flex-shrink-0"
                                    title="Consultar radar de dudas a Vercel"
                                >
                                    <RefreshCw className={`w-4 h-4 ${loadingFaqs ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-3 custom-scrollbar h-full">
                            {loadingFaqs ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                                </div>
                            ) : faqs.length === 0 ? (
                                <div className="text-center py-10 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                                    <span className="text-2xl mb-2 block">🎧</span>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium tracking-tight">Candidatic analizando llamadas y chats en vivo...</p>
                                </div>
                            ) : (
                                faqs.map(faq => (
                                    <div key={faq.id} className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-800 rounded-2xl p-3 shadow-sm hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all duration-300 relative group overflow-hidden">
                                        <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full -mr-12 -mt-12 blur-2xl group-hover:bg-indigo-500/10 transition-colors"></div>

                                        <div className="flex justify-between items-center mb-2 relative z-10">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600">
                                                    <FileText className="w-4 h-4" />
                                                </div>
                                                <div
                                                    className="cursor-pointer group/title"
                                                    onClick={() => {
                                                        const n = prompt('Nuevo nombre del tema FAQ:', faq.topic);
                                                        if (n && n !== faq.topic) handleUpdateTopic(faq.id, n);
                                                    }}
                                                    title="Haz clic para editar el nombre del tema"
                                                >
                                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-tight leading-none mb-1 group-hover/title:text-indigo-600 dark:group-hover/title:text-indigo-400 transition-colors flex items-center gap-2">
                                                        {faq.topic}
                                                        <Pencil className="w-3 h-3 opacity-0 group-hover/title:opacity-100 transition-all text-gray-400" />
                                                    </h4>
                                                    <div className="flex items-center gap-2">
                                                        <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 text-[9px] font-black rounded-md uppercase tracking-widest">
                                                            {faq.frequency} detecciones
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all border border-transparent hover:border-red-100"
                                                onClick={() => handleDeleteFaq(faq.id)}
                                                title="Eliminar duda del radar"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 mb-3 relative z-10">
                                        <div className="bg-gray-50 dark:bg-gray-900/50 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800/50">
                                                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5 font-sans leading-none">
                                                    🔍 Dudas Recabadas
                                                </p>
                                                <ul className="space-y-0.5 list-none max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                                                    {deduplicateQuestions(faq.originalQuestions).map(({ text, raw, count }, idx) => {
                                                        const isSelected = selectedQuestion[faq.id] === idx;
                                                        return (
                                                            <li
                                                                key={idx}
                                                                className={`flex items-center justify-between group/q text-[11px] italic pl-3 border-l-2 rounded-r-lg py-0.5 leading-snug cursor-pointer transition-all ${
                                                                    isSelected
                                                                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                                                        : 'border-indigo-200 dark:border-indigo-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
                                                                }`}
                                                                onClick={() => setSelectedQuestion(prev => ({ ...prev, [faq.id]: isSelected ? null : idx }))}
                                                            >
                                                                <span className="truncate flex-1 min-w-0" title={text}>
                                                                    "{text}"
                                                                    {count > 1 && <span className="ml-1.5 px-1 py-0.5 bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 text-[9px] font-black rounded not-italic">×{count}</span>}
                                                                </span>
                                                                <div className="flex items-center opacity-0 group-hover/q:opacity-100 transition-all ml-1 flex-shrink-0">
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleSplitFaq(faq.id, raw); }}
                                                                        className="p-1 hover:text-indigo-600 hover:bg-white dark:hover:bg-gray-900 rounded-md transition-all"
                                                                        title="Separar esta duda en un nuevo tema"
                                                                    >
                                                                        <Plus className="w-3 h-3" />
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleRemoveQuestion(faq.id, raw); }}
                                                                        className="p-1 hover:text-red-500 hover:bg-white dark:hover:bg-gray-900 rounded-md transition-all"
                                                                        title="Eliminar esta pregunta"
                                                                    >
                                                                        <Trash2 className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </div>

                                            <div className={`bg-blue-50/50 dark:bg-blue-900/10 p-2.5 rounded-xl border transition-all duration-300 ${
                                                selectedQuestion[faq.id] != null
                                                    ? 'border-blue-400 dark:border-blue-600 ring-2 ring-blue-200 dark:ring-blue-800/50'
                                                    : 'border-blue-100 dark:border-blue-900/20'
                                            }`}>
                                                <p className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5 leading-none">
                                                    🤖 Auditoría: Brenda Respondió
                                                </p>
                                                <p className="text-[11px] text-blue-800 dark:text-blue-300 font-medium leading-snug max-w-full">
                                                    {(() => {
                                                        // If a question is selected, try to find its specific response
                                                        if (selectedQuestion[faq.id] != null) {
                                                            const dedupedList = deduplicateQuestions(faq.originalQuestions);
                                                            const selected = dedupedList[selectedQuestion[faq.id]];
                                                            if (selected) {
                                                                const key = selected.text.trim().toLowerCase();
                                                                const perQ = faq.questionResponses?.[key];
                                                                if (perQ) return perQ.replace(/\[MSG_SPLIT\]/g, ' ');
                                                            }
                                                        }
                                                        return (faq.lastAiResponse || 'Consultando base de datos oficial...').replace(/\[MSG_SPLIT\]/g, ' ');
                                                    })()}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="bg-indigo-50/30 dark:bg-indigo-900/10 p-2 rounded-2xl border border-indigo-100/50 dark:border-indigo-800/30 relative z-10">
                                            {faq.mediaUrl && (
                                                <div className="mb-2 p-1 bg-white dark:bg-gray-900 rounded-xl border border-indigo-100 dark:border-indigo-800 flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-gray-100 flex items-center justify-center bg-gray-50">
                                                            {faq.mediaUrl.toLowerCase().includes('.pdf') || faq.mediaUrl.includes('mime=application%2Fpdf') ? (
                                                                <FileText className="w-5 h-5 text-red-500" />
                                                            ) : (
                                                                <img src={faq.mediaUrl} alt="Preview" className="w-full h-full object-cover" />
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-gray-500 truncate max-w-[150px]">
                                                            {faq.mediaUrl.toLowerCase().includes('.pdf') || faq.mediaUrl.includes('mime=application%2Fpdf') ? 'PDF adjunto listo' : 'Imagen adjunta lista'}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                            const newFaqs = [...faqs];
                                                            const idx = newFaqs.findIndex(f => f.id === faq.id);
                                                            if (idx > -1) {
                                                                newFaqs[idx].mediaUrl = null;
                                                                setFaqs(newFaqs);
                                                            }
                                                        }}
                                                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Eliminar imagen"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            )}

                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 relative group/input">
                                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 group-focus-within/input:text-indigo-600 transition-colors">
                                                        <Plus className="w-3.5 h-3.5" />
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={faq.officialAnswer || ''}
                                                        onChange={(e) => {
                                                            const newFaqs = [...faqs];
                                                            const idx = newFaqs.findIndex(f => f.id === faq.id);
                                                            if (idx > -1) {
                                                                newFaqs[idx].officialAnswer = e.target.value;
                                                                setFaqs(newFaqs);
                                                            }
                                                        }}
                                                        placeholder="Entrena a Brenda para que sepa responder exactamente esto..."
                                                        className="w-full pl-9 pr-10 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all shadow-inner"
                                                    />
                                                    {isUploadingFaq && uploadingFaqId === faq.id ? (
                                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-indigo-600 font-medium">
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                            <span className="text-[10px]">Subiendo...</span>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => {
                                                                setUploadingFaqId(faq.id);
                                                                setTimeout(() => faqFileInputRef.current?.click(), 0);
                                                            }}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-indigo-600 transition-colors"
                                                            title="Adjuntar archivo (Imagen o PDF) a esta respuesta"
                                                        >
                                                            <Paperclip className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => handleSaveFaq(faq.id, faq.officialAnswer, faq.mediaUrl)}
                                                    className="px-5 py-2 bg-indigo-600 hover:bg-black text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-indigo-500/20 hover:shadow-none translate-y-0 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
                                                    disabled={!faq.officialAnswer?.trim() && !faq.mediaUrl}
                                                >
                                                    Enseñar
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
                <Button
                    variant="ghost"
                    onClick={onClose}
                    disabled={saving}
                >
                    Cancelar
                </Button>
                <Button
                    onClick={handleSave}
                    disabled={saving}
                    icon={saving ? Loader2 : Save}
                >
                    {saving ? (vacancyId ? 'Guardando...' : 'Creando...') : (vacancyId ? 'Actualizar Vacante' : 'Guardar Vacante')}
                </Button>
            </div>

            {/* Hidden File Input for FAQs */}
            <input
                type="file"
                ref={faqFileInputRef}
                className="hidden"
                accept="image/*,application/pdf"
                onChange={handleFaqFileSelect}
            />

            {ToastComponent}
        </Modal>
    );
};

export default VacancyEditorModal;
