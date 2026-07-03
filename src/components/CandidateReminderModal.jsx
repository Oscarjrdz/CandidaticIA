import React, { useState, useEffect, useCallback } from 'react';
import { X, Bell, Trash2, Clock, Send } from 'lucide-react';
import { renderMetaTemplatePreviewText } from '../utils/metaTemplatePreview';

const API = '/api/candidate-reminders';

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

const CandidateReminderModal = ({ candidate, onClose }) => {
    const [reminders, setReminders] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(null);

    // New reminder form state
    const [scheduledAt, setScheduledAt] = useState(defaultDatetime());
    const [message, setMessage] = useState('');
    const [fallbackTemplateId, setFallbackTemplateId] = useState('');

    const nombre = candidate.nombreReal || candidate.nombre || candidate.whatsapp;
    const firstName = String(nombre || '').trim().split(/\s+/)[0] || 'Candidato';
    const selectedTemplate = templates.find(t => t.id === fallbackTemplateId) || null;

    useEffect(() => {
        const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const fetchReminders = useCallback(async () => {
        setLoading(true);
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

    const pendingReminders = reminders.filter(r => r.status === 'pending');
    const sentReminders    = reminders.filter(r => r.status === 'sent');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg h-[90vh] max-h-[760px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

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
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mensaje para {firstName}</label>
                            <textarea
                                rows={3}
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                placeholder={`Ej: Hola ${firstName}, recuerda que tu entrevista es hoy a las 9:00am 🌟`}
                                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none resize-none text-slate-800 dark:text-slate-200 placeholder-slate-400"
                            />
                        </div>
                        <div className="space-y-2 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/70 dark:bg-emerald-900/10 p-3">
                            <div>
                                <label className="text-[10px] font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">Elige un template para ventana de 24 horas expirada</label>
                            </div>
                            <select
                                value={fallbackTemplateId}
                                onChange={e => {
                                    setFallbackTemplateId(e.target.value);
                                }}
                                className="w-full bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-emerald-400 outline-none text-slate-800 dark:text-slate-200"
                            >
                                <option value="">{templatesLoading ? 'Cargando plantillas...' : 'Sin template para ventana expirada'}</option>
                                {templates.map(t => (
                                    <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
                                ))}
                            </select>

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
                        <button
                            onClick={handleCreate}
                            disabled={!message.trim() || !scheduledAt || saving}
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors shadow-md shadow-amber-500/20"
                        >
                            <Send className="w-3.5 h-3.5" />
                            {saving ? 'Programando...' : 'Programar mensaje'}
                        </button>
                    </div>

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

                    {loading && (
                        <div className="flex justify-center py-4">
                            <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CandidateReminderModal;
