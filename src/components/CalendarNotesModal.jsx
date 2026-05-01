import React, { useState, useEffect, useMemo } from 'react';
import { X, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Trash2, Loader2, User, FileText, MapPin, GraduationCap, MessageCircle } from 'lucide-react';
import Button from './ui/Button';

// Utilities
const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();
const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const dayNames = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];
const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3000';

const calculateAge = (fechaNac, edad) => edad || (fechaNac ? Math.floor((new Date() - new Date(fechaNac)) / 31557600000) + ' años' : null);
const formatPhone = (phone) => phone ? '+' + String(phone).replace(/\D/g, '') : 'Sin teléfono';

export default function CalendarNotesModal({ isOpen, onClose, projectId, projectName, candidateId, candidateName, candidates = [], onChat }) {
    const [notes, setNotes] = useState([]);
    const [loading, setLoading] = useState(true);
    
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [newNoteContent, setNewNoteContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen && projectId) {
            loadNotes();
            // Reset state
            setCurrentDate(new Date());
            setSelectedDate(new Date());
            setNewNoteContent('');
        }
    }, [isOpen, projectId]);

    const loadNotes = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/calendar_notes?projectId=${projectId}`);
            const data = await res.json();
            if (data.success) {
                setNotes(data.notes || []);
            }
        } catch (e) {
            console.error('Error loading notes:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleAddNote = async () => {
        if (!newNoteContent.trim() || !selectedDate) return;

        setIsSaving(true);
        const dateStr = selectedDate.toLocaleDateString('en-CA'); // YYYY-MM-DD
        
        try {
            const res = await fetch(`${API_BASE}/api/calendar_notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create',
                    projectId,
                    date: dateStr,
                    content: newNoteContent.trim(),
                    candidateId: candidateId || null,
                    candidateName: candidateName || null
                })
            });
            const data = await res.json();
            if (data.success) {
                setNotes(prev => [...prev, data.note]);
                setNewNoteContent('');
            }
        } catch (e) {
            console.error('Error saving note:', e);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteNote = async (noteId) => {
        try {
            const res = await fetch(`${API_BASE}/api/calendar_notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', projectId, noteId })
            });
            const data = await res.json();
            if (data.success) {
                setNotes(prev => prev.filter(n => n.id !== noteId));
            }
        } catch (e) {
            console.error('Error deleting note:', e);
        }
    };

    // Derived data
    const dateMap = useMemo(() => {
        const map = {};
        notes.forEach(note => {
            if (!map[note.date]) map[note.date] = [];
            map[note.date].push(note);
        });
        return map;
    }, [notes]);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const todayStr = new Date().toLocaleDateString('en-CA');
    const selectedDateStr = selectedDate ? selectedDate.toLocaleDateString('en-CA') : null;

    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));

    const renderCalendarDays = () => {
        const days = [];
        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`empty-${i}`} className="h-10"></div>);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = date.toLocaleDateString('en-CA');
            const isSelected = selectedDateStr === dateStr;
            const isToday = dateStr === todayStr;
            const dayNotes = dateMap[dateStr] || [];
            const hasNotes = dayNotes.length > 0;

            days.push(
                <button
                    key={dateStr}
                    onClick={() => setSelectedDate(date)}
                    className={`
                        relative h-10 w-10 flex items-center justify-center rounded-full text-sm font-medium transition-all cursor-pointer
                        ${isSelected ? 'bg-orange-500 text-white shadow-md shadow-orange-500/30 hover:bg-orange-600' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}
                        ${isToday && !isSelected ? 'border border-orange-500 text-orange-600 dark:text-orange-400' : ''}
                    `}
                >
                    {day}
                    {hasNotes && !isSelected && (
                        <div className="absolute bottom-1 w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                    )}
                    {hasNotes && isSelected && (
                        <div className="absolute bottom-1 w-1.5 h-1.5 bg-white rounded-full"></div>
                    )}
                </button>
            );
        }
        return days;
    };

    if (!isOpen) return null;

    const selectedDayNotes = selectedDateStr ? (dateMap[selectedDateStr] || []) : [];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[85vh] md:h-[600px] border border-white/20 dark:border-slate-700/50">
                
                {/* LEFT SIDE: Calendar */}
                <div className="w-full md:w-80 bg-slate-50/50 dark:bg-slate-800/30 p-6 flex flex-col border-r border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center">
                                <CalendarIcon className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-slate-800 dark:text-white leading-tight truncate w-40" title={projectName}>{projectName}</h2>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Calendario</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 transition-colors md:hidden">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex items-center justify-between mb-6 bg-white dark:bg-slate-800 p-2 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                        <button onClick={prevMonth} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl text-slate-500 transition-colors">
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <h4 className="font-bold text-slate-700 dark:text-slate-200 capitalize select-none">
                            {monthNames[month]} {year}
                        </h4>
                        <button onClick={nextMonth} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl text-slate-500 transition-colors">
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1 mb-2 text-center select-none">
                        {dayNames.map(d => (
                            <div key={d} className="text-xs font-bold text-slate-400">{d}</div>
                        ))}
                    </div>

                    <div className="grid grid-cols-7 gap-1 place-items-center flex-1">
                        {renderCalendarDays()}
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700/50 text-center">
                        <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
                            Días con anotaciones
                        </p>
                    </div>
                </div>

                {/* RIGHT SIDE: Notes for selected date */}
                <div className="flex-1 flex flex-col p-6 relative">
                    <button onClick={onClose} className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors hidden md:block">
                        <X className="w-5 h-5" />
                    </button>

                    <div className="mb-6">
                        <h3 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                            {selectedDate ? (
                                <>
                                    {selectedDate.getDate()} {monthNames[selectedDate.getMonth()]} {selectedDate.getFullYear()}
                                    {selectedDateStr === todayStr && <span className="text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 px-2 py-0.5 rounded-full uppercase tracking-wider ml-2">Hoy</span>}
                                </>
                            ) : 'Selecciona un día'}
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">
                            {selectedDayNotes.length} {selectedDayNotes.length === 1 ? 'anotación' : 'anotaciones'} para este día
                        </p>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar mb-6">
                        {loading ? (
                            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>
                        ) : selectedDayNotes.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center opacity-60">
                                <FileText className="w-16 h-16 text-slate-300 dark:text-slate-600 mb-4" />
                                <p className="text-slate-500 font-medium">El día está libre.</p>
                                <p className="text-xs text-slate-400 mt-1">Añade una nota o recordatorio abajo.</p>
                            </div>
                        ) : (
                            selectedDayNotes.map(note => (
                                <div key={note.id} className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 group hover:border-orange-200 dark:hover:border-orange-900/50 transition-colors">
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="flex-1 min-w-0">
                                            {(() => {
                                                const cand = note.candidateId ? candidates.find(c => c.id === note.candidateId) : null;
                                                if (cand) {
                                                    return (
                                                        <div className="mb-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm group/cand">
                                                            <div className="flex items-center gap-2">
                                                                {cand.profilePic ? (
                                                                    <img src={cand.profilePic} className="w-8 h-8 rounded-full object-cover" alt="" />
                                                                ) : (
                                                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                                                        {(cand.nombreReal || cand.from || cand.nombre || '?')[0]?.toUpperCase()}
                                                                    </div>
                                                                )}
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{cand.nombreReal || cand.from || cand.nombre || 'Sin nombre'}</p>
                                                                    <p className="text-[10px] text-slate-400 truncate">{formatPhone(cand.whatsapp)}</p>
                                                                </div>
                                                                <div className="flex gap-1">
                                                                    <button onClick={(e) => { e.stopPropagation(); onChat && onChat(cand); }}
                                                                        className="relative p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 transition-colors"
                                                                        title="Abrir chat">
                                                                        <MessageCircle className="w-4 h-4" />
                                                                        {Number(cand.unreadMsgCount) > 0 && (
                                                                            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-white dark:border-slate-800"></span>
                                                                            </span>
                                                                        )}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500 font-medium mt-2.5">
                                                                {cand.municipio && (
                                                                    <div className="flex items-center gap-1 whitespace-nowrap">
                                                                        <MapPin className="w-3 h-3 text-blue-500" />
                                                                        {cand.municipio}
                                                                    </div>
                                                                )}
                                                                {cand.escolaridad && (
                                                                    <div className="flex items-center gap-1 whitespace-nowrap">
                                                                        <GraduationCap className="w-3 h-3 text-blue-500" />
                                                                        {cand.escolaridad}
                                                                    </div>
                                                                )}
                                                                {(cand.edad || cand.fechaNacimiento) && (
                                                                    <div className="flex items-center gap-1 whitespace-nowrap">
                                                                        <CalendarIcon className="w-3 h-3 text-blue-500" />
                                                                        {calculateAge(cand.fechaNacimiento, cand.edad)}
                                                                    </div>
                                                                )}
                                                                {cand.genero && cand.genero !== 'Desconocido' && (
                                                                    <div className="flex items-center gap-1 whitespace-nowrap">
                                                                        <User className="w-3 h-3 text-blue-500" />
                                                                        {cand.genero}
                                                                    </div>
                                                                )}
                                                                {cand.categoria && (
                                                                    <div className="flex items-center gap-1 whitespace-nowrap px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800/50">
                                                                        {cand.categoria}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                // Fallback if candidate object not found but name exists
                                                if (note.candidateName) {
                                                    return (
                                                        <div className="flex items-center gap-1.5 mb-2">
                                                            <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                                                                <User className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                                            </div>
                                                            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 truncate">
                                                                {note.candidateName}
                                                            </span>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}
                                            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{note.content}</p>
                                        </div>
                                        <button 
                                            onClick={() => handleDeleteNote(note.id)}
                                            className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                                            title="Eliminar anotación"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="mt-3 text-[10px] text-slate-400 font-medium">
                                        Creado a las {new Date(note.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* New Note Form */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
                        {candidateName && (
                            <div className="mb-2 flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Agendando a:</span>
                                <span className="text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 px-2 py-0.5 rounded-md">{candidateName}</span>
                            </div>
                        )}
                        <div className="flex items-end gap-3">
                            <div className="flex-1">
                                <textarea
                                    value={newNoteContent}
                                    onChange={(e) => setNewNoteContent(e.target.value)}
                                    placeholder="Escribe una nota o recordatorio..."
                                    className="w-full bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 resize-none h-[60px] transition-all"
                                />
                            </div>
                            <Button 
                                onClick={handleAddNote} 
                                disabled={!newNoteContent.trim() || isSaving}
                                className="h-[60px] px-6 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:shadow-none"
                            >
                                {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
