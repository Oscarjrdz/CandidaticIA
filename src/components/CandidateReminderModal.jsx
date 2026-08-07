import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Bell, Trash2, Clock, Send, ChevronDown, Check, Save, LayoutTemplate } from 'lucide-react';
import { renderMetaTemplatePreviewText } from '../utils/metaTemplatePreview';
import { substituteVariables } from '../../api/utils/shortcuts.js';

const API = '/api/candidate-reminders';
const TEMPLATES_API = '/api/reminder-templates';

function formatLocalDatetime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    // Format as "Lun 5 Mayo, 07:00"
    return d.toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Returns the minimum datetime-local value (now + 2 min) as "YYYY-MM-DDTHH:MM"
function minDatetimeLocal() {
    const d = new Date(Date.now() + 2 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Default datetime = tomorrow at 7:00 AM CST
function defaultDatetime() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(7, 0, 0, 0);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T07:00`;
}

// Convierte un "YYYY-MM-DDTHH:MM" (datetime-local, hora local) en { dayOffset, timeOfDay }
// relativos al momento actual, para que una plantilla sea reutilizable en cualquier día
// (no guarda una fecha absoluta, que quedaría vencida en el segundo uso).
function toRelativeOffset(scheduledAtLocal) {
    const target = new Date(scheduledAtLocal);
    const now = new Date();
    const targetDateOnly = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOffset = Math.max(0, Math.round((targetDateOnly - nowDateOnly) / 86400000));
    const pad = n => String(n).padStart(2, '0');
    return { dayOffset, timeOfDay: `${pad(target.getHours())}:${pad(target.getMinutes())}` };
}

// Inverso de toRelativeOffset: reconstruye un "YYYY-MM-DDTHH:MM" a partir de un offset
// relativo, anclado al momento en que se aplica la plantilla.
function fromRelativeOffset(dayOffset, timeOfDay) {
    const d = new Date();
    d.setDate(d.getDate() + (Number(dayOffset) || 0));
    const [hours, minutes] = String(timeOfDay || '07:00').split(':').map(Number);
    d.setHours(hours || 0, minutes || 0, 0, 0);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeTemplateId() {
    return `rt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const CandidateReminderModal = ({ candidate, onClose }) => {
    const [reminders, setReminders] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(null);

    // New reminder form state
    const [scheduledAt, setScheduledAt] = useState(defaultDatetime());
    const [message, setMessage] = useState('');
    const [fallbackTemplateId, setFallbackTemplateId] = useState('');
    const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
    const [templateMenuPosition, setTemplateMenuPosition] = useState(null);
    const templateButtonRef = useRef(null);

    // Plantillas de recordatorio (reutilizables, guardadas por el reclutador)
    const [savedTemplates, setSavedTemplates] = useState([]);
    const [creatingTemplate, setCreatingTemplate] = useState(false);
    const [newTemplateName, setNewTemplateName] = useState('');
    const [savingTemplate, setSavingTemplate] = useState(false);
    const [deletingTemplateId, setDeletingTemplateId] = useState(null);

    const nombre = candidate.nombreReal || candidate.nombre || candidate.whatsapp;
    const firstName = String(nombre || '').trim().split(/\s+/)[0] || 'Candidato';
    const selectedTemplate = templates.find(t => t.id === fallbackTemplateId) || null;
    const templateButtonLabel = templatesLoading
        ? 'Cargando plantillas...'
        : selectedTemplate
            ? `${selectedTemplate.name.replace(/_/g, ' ')} (${selectedTemplate.language})`
            : 'Sin template para ventana expirada';

    useEffect(() => {
        const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const updateTemplateMenuPosition = useCallback(() => {
        const button = templateButtonRef.current;
        if (!button) return;
        const rect = button.getBoundingClientRect();
        const estimatedHeight = Math.min(260, ((templates.length || 0) + 1) * 52 + 8);
        const spaceBelow = window.innerHeight - rect.bottom - 12;
        const spaceAbove = rect.top - 12;
        const openUp = spaceBelow < 190 && spaceAbove > spaceBelow;
        const maxHeight = Math.max(120, Math.min(260, openUp ? spaceAbove - 8 : spaceBelow - 8));
        setTemplateMenuPosition({
            left: rect.left,
            top: openUp ? Math.max(12, rect.top - Math.min(estimatedHeight, maxHeight) - 8) : rect.bottom + 8,
            width: rect.width,
            maxHeight
        });
    }, [templates.length]);

    useEffect(() => {
        if (!templateMenuOpen) return;
        updateTemplateMenuPosition();
        window.addEventListener('resize', updateTemplateMenuPosition);
        window.addEventListener('scroll', updateTemplateMenuPosition, true);
        return () => {
            window.removeEventListener('resize', updateTemplateMenuPosition);
            window.removeEventListener('scroll', updateTemplateMenuPosition, true);
        };
    }, [templateMenuOpen, updateTemplateMenuPosition]);

    const fetchReminders = useCallback(async () => {
        try {
            const res = await fetch(`${API}?candidateId=${candidate.id}`);
            const data = await res.json();
            setReminders(data.reminders || []);
        } catch {
            setReminders([]);
        } finally {
            setLoading(false);
        }
    }, [candidate.id]);

    useEffect(() => {
        fetchReminders();
    }, [fetchReminders]);

    useEffect(() => {
        setTemplatesLoading(true);
        fetch('/api/whatsapp/templates')
            .then(res => res.json())
            .then(data => {
                const approved = data.success && Array.isArray(data.data)
                    ? data.data.filter(t => t.status === 'APPROVED')
                    : [];
                setTemplates(approved);
            })
            .catch(() => setTemplates([]))
            .finally(() => setTemplatesLoading(false));
    }, []);

    useEffect(() => {
        fetch(TEMPLATES_API)
            .then(res => res.json())
            .then(data => setSavedTemplates(data.success ? (data.templates || []) : []))
            .catch(() => setSavedTemplates([]));
    }, []);

    const handleCreate = async () => {
        if (!message.trim() || !scheduledAt) return;
        setSaving(true);
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidateId: candidate.id,
                    whatsapp: candidate.whatsapp,
                    nombre,
                    message: message.trim(),
                    scheduledAt: new Date(scheduledAt).toISOString(),
                    fallbackTemplateData: selectedTemplate || null,
                    fallbackTemplateParams: selectedTemplate ? { candidato: firstName, nombre: firstName, name: firstName, 1: firstName } : null,
                }),
            });
            if (!res.ok) {
                const d = await res.json();
                alert(d.error || 'Error al programar');
                return;
            }
            setMessage('');
            setScheduledAt(defaultDatetime());
            setFallbackTemplateId('');
            await fetchReminders();
        } catch {
            alert('Error de red');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        setDeleting(id);
        try {
            await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            setReminders(prev => prev.filter(r => r.id !== id));
        } catch {
            alert('Error al cancelar');
        } finally {
            setDeleting(null);
        }
    };

    const handleSaveTemplate = async () => {
        const name = newTemplateName.trim();
        if (!name || !message.trim() || !scheduledAt) return;
        setSavingTemplate(true);
        try {
            const { dayOffset, timeOfDay } = toRelativeOffset(scheduledAt);
            const newTemplate = {
                id: makeTemplateId(),
                name,
                message: message.trim(),
                dayOffset,
                timeOfDay,
                fallbackTemplateName: selectedTemplate?.name || null,
                fallbackTemplateLanguage: selectedTemplate?.language || null,
                createdAt: new Date().toISOString(),
            };
            const updated = [...savedTemplates, newTemplate];
            const res = await fetch(TEMPLATES_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templates: updated }),
            });
            if (!res.ok) {
                const d = await res.json();
                alert(d.error || 'Error al guardar la plantilla');
                return;
            }
            setSavedTemplates(updated);
            setNewTemplateName('');
            setCreatingTemplate(false);
        } catch {
            alert('Error de red al guardar la plantilla');
        } finally {
            setSavingTemplate(false);
        }
    };

    const handleUseTemplate = (tpl) => {
        setMessage(substituteVariables(tpl.message, candidate));
        setScheduledAt(fromRelativeOffset(tpl.dayOffset, tpl.timeOfDay));
        if (tpl.fallbackTemplateName) {
            const match = templates.find(t => t.name === tpl.fallbackTemplateName && t.language === tpl.fallbackTemplateLanguage);
            setFallbackTemplateId(match ? match.id : '');
        } else {
            setFallbackTemplateId('');
        }
    };

    const handleDeleteTemplate = async (id) => {
        setDeletingTemplateId(id);
        try {
            const updated = savedTemplates.filter(t => t.id !== id);
            const res = await fetch(TEMPLATES_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templates: updated }),
            });
            if (!res.ok) {
                alert('Error al eliminar la plantilla');
                return;
            }
            setSavedTemplates(updated);
        } catch {
            alert('Error de red al eliminar la plantilla');
        } finally {
            setDeletingTemplateId(null);
        }
    };

    const pendingReminders = reminders.filter(r => r.status === 'pending');
    const sentReminders    = reminders.filter(r => r.status === 'sent');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                            <Bell className="w-4 h-4 text-amber-500" />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-slate-800 dark:text-white">Mensaje Programado</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{nombre}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">

                    {/* Form */}
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fecha y hora de envío</label>
                            <input
                                type="datetime-local"
                                value={scheduledAt}
                                min={minDatetimeLocal()}
                                onChange={e => setScheduledAt(e.target.value)}
                                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-amber-400 outline-none text-slate-800 dark:text-slate-200"
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                            <div className="space-y-1 min-w-0">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mensaje para {firstName}</label>
                                <textarea
                                    rows={4}
                                    value={message}
                                    onChange={e => setMessage(e.target.value)}
                                    placeholder={`Ej: Hola ${firstName}, recuerda que tu entrevista es hoy a las 9:00am 🌟`}
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none resize-none text-slate-800 dark:text-slate-200 placeholder-slate-400"
                                />
                            </div>
                            <div className="space-y-2 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/70 dark:bg-emerald-900/10 p-3 min-w-0">
                                <div>
                                    <label className="text-[10px] font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">Template para ventana de 24h expirada</label>
                                </div>
                                <div className="relative">
                                    <button
                                        ref={templateButtonRef}
                                        type="button"
                                        onClick={() => {
                                            const next = !templateMenuOpen;
                                            if (next) updateTemplateMenuPosition();
                                            setTemplateMenuOpen(next);
                                        }}
                                        disabled={templatesLoading}
                                        className="w-full min-h-[46px] bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2.5 text-sm font-bold text-left text-slate-800 dark:text-slate-200 flex items-center justify-between gap-3 shadow-sm hover:border-emerald-300 dark:hover:border-emerald-700 focus:ring-2 focus:ring-emerald-400 outline-none transition-all disabled:opacity-70"
                                    >
                                        <span className="truncate">{templateButtonLabel}</span>
                                        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${templateMenuOpen ? 'rotate-180' : ''}`} />
                                    </button>

                                    {templateMenuOpen && templateMenuPosition && (
                                        <div
                                            className="fixed z-[80] overflow-hidden rounded-xl border border-emerald-100 dark:border-emerald-900/50 bg-white dark:bg-slate-900 shadow-2xl shadow-emerald-900/10"
                                            style={{
                                                left: templateMenuPosition.left,
                                                top: templateMenuPosition.top,
                                                width: templateMenuPosition.width
                                            }}
                                        >
                                            <div className="overflow-y-auto py-1" style={{ maxHeight: templateMenuPosition.maxHeight }}>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setFallbackTemplateId('');
                                                        setTemplateMenuOpen(false);
                                                    }}
                                                    className="w-full px-3 py-2.5 text-left text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 flex items-center gap-2 transition-colors"
                                                >
                                                    <Check className={`w-4 h-4 shrink-0 ${!fallbackTemplateId ? 'text-emerald-500' : 'text-transparent'}`} />
                                                    <span className="truncate">Sin template para ventana expirada</span>
                                                </button>
                                                {templates.map(t => (
                                                    <button
                                                        key={t.id}
                                                        type="button"
                                                        onClick={() => {
                                                            setFallbackTemplateId(t.id);
                                                            setTemplateMenuOpen(false);
                                                        }}
                                                        className="w-full px-3 py-2.5 text-left hover:bg-emerald-50 dark:hover:bg-emerald-900/20 flex items-center gap-2 transition-colors"
                                                    >
                                                        <Check className={`w-4 h-4 shrink-0 ${fallbackTemplateId === t.id ? 'text-emerald-500' : 'text-transparent'}`} />
                                                        <span className="min-w-0">
                                                            <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{t.name.replace(/_/g, ' ')}</span>
                                                            <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">{t.language}</span>
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className={`grid transition-all duration-300 ease-out ${selectedTemplate ? 'grid-rows-[1fr] opacity-100 pt-1' : 'grid-rows-[0fr] opacity-0 pt-0'}`}>
                                    <div className="overflow-hidden">
                                        {selectedTemplate && (
                                            <div className="rounded-xl bg-white dark:bg-slate-800 border border-emerald-100 dark:border-emerald-900/40 p-3 space-y-2">
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Vista previa</p>
                                                <div className="space-y-2">
                                                    <p className="text-xs font-black text-emerald-700 dark:text-emerald-300">
                                                        {selectedTemplate.name.replace(/_/g, ' ')}
                                                    </p>
                                                    <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                                                        {renderMetaTemplatePreviewText(selectedTemplate, { candidato: firstName, nombre: firstName, name: firstName, 1: firstName }, firstName)}
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                            <button
                                onClick={handleCreate}
                                disabled={!message.trim() || !scheduledAt || saving}
                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors shadow-md shadow-amber-500/20"
                            >
                                <Send className="w-3.5 h-3.5" />
                                {saving ? 'Programando...' : 'Programar mensaje'}
                            </button>

                            {!creatingTemplate ? (
                                <button
                                    type="button"
                                    onClick={() => { setCreatingTemplate(true); setNewTemplateName(''); }}
                                    disabled={!message.trim() || !scheduledAt}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors shadow-md shadow-violet-500/20"
                                >
                                    <Save className="w-3.5 h-3.5" />
                                    Crear plantilla
                                </button>
                            ) : (
                                <div className="flex items-center gap-1.5 p-1.5 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-900/10 min-w-0">
                                    <input
                                        autoFocus
                                        type="text"
                                        value={newTemplateName}
                                        onChange={e => setNewTemplateName(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') handleSaveTemplate();
                                            if (e.key === 'Escape') setCreatingTemplate(false);
                                        }}
                                        placeholder="Nombre"
                                        className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-violet-200 dark:border-violet-700 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-violet-400 text-slate-800 dark:text-slate-200 placeholder-slate-400"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleSaveTemplate}
                                        disabled={!newTemplateName.trim() || savingTemplate}
                                        className="px-2.5 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors shrink-0"
                                    >
                                        {savingTemplate ? '...' : 'Guardar'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCreatingTemplate(false)}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0"
                                        title="Cancelar"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Plantillas guardadas */}
                    {savedTemplates.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                <LayoutTemplate className="w-3 h-3" />
                                Plantillas guardadas
                            </p>
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {savedTemplates.map(t => (
                                    <div key={t.id} className="flex items-start gap-3 p-3 rounded-2xl bg-violet-50 dark:bg-violet-900/10 border border-violet-100 dark:border-violet-800/30">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-violet-700 dark:text-violet-400 truncate">{t.name}</p>
                                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed line-clamp-2">{t.message}</p>
                                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                                                {t.dayOffset === 0 ? 'Mismo día' : `+${t.dayOffset} día${t.dayOffset === 1 ? '' : 's'}`} · {t.timeOfDay}
                                                {t.fallbackTemplateName && ` · Template 24h: ${t.fallbackTemplateName.replace(/_/g, ' ')}`}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => handleUseTemplate(t)}
                                                className="px-2.5 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-[11px] font-bold transition-colors"
                                            >
                                                Usar
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteTemplate(t.id)}
                                                disabled={deletingTemplateId === t.id}
                                                className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                                title="Eliminar plantilla"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Pending list */}
                    {!loading && pendingReminders.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Programados</p>
                            {pendingReminders.map(r => (
                                <div key={r.id} className="flex items-start gap-3 p-3 rounded-2xl bg-amber-50 dark:bg-amber-900/15 border border-amber-100 dark:border-amber-800/30">
                                    <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-amber-700 dark:text-amber-400">{formatLocalDatetime(r.scheduledAt)}</p>
                                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{r.message}</p>
                                        {r.fallbackTemplateData?.name && (
                                            <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                                                Template 24h: {r.fallbackTemplateData.name}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleDelete(r.id)}
                                        disabled={deleting === r.id}
                                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
                                        title="Cancelar recordatorio"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {!loading && reminders.some(r => r.status === 'failed') && (
                        <div className="space-y-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No enviados</p>
                            {reminders.filter(r => r.status === 'failed').map(r => (
                                <div key={r.id} className="flex items-start gap-3 p-3 rounded-2xl bg-red-50 dark:bg-red-900/15 border border-red-100 dark:border-red-800/30">
                                    <Clock className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-red-600 dark:text-red-400">{formatLocalDatetime(r.scheduledAt)}</p>
                                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{r.message}</p>
                                        <p className="text-[10px] text-red-500 dark:text-red-300 mt-1">{r.failureReason || 'No se pudo enviar'}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Sent history */}
                    {!loading && sentReminders.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Enviados</p>
                            {sentReminders.map(r => (
                                <div key={r.id} className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 opacity-60">
                                    <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{formatLocalDatetime(r.scheduledAt)}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed line-clamp-2">{r.message}</p>
                                        {r.sentVia === 'template_fallback' && (
                                            <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                                                Enviado con template 24h: {r.fallbackTemplateData?.name}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default CandidateReminderModal;
