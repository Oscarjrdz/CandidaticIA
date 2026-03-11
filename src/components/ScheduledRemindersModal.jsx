import React, { useState } from 'react';
import { X, Bell, Plus, Trash2, Clock, ChevronDown } from 'lucide-react';

const PRESET_HOURS = [
    { label: '24 horas antes', value: 24 },
    { label: '12 horas antes', value: 12 },
    { label: '2 horas antes', value: 2 },
    { label: '1 hora antes', value: 1 },
];

const TEMPLATE_VARS = ['{{nombre}}', '{{citaFecha}}', '{{citaHora}}'];

function generateId() {
    return `rem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const ScheduledRemindersModal = ({ step, onSave, onClose }) => {
    const [reminders, setReminders] = useState(
        step.scheduledReminders?.length
            ? step.scheduledReminders
            : []
    );

    const addReminder = () => {
        setReminders(prev => [...prev, {
            id: generateId(),
            hoursBefor: 24,
            message: 'Hola {{nombre}} 👋, te recordamos que mañana tienes entrevista el {{citaFecha}} a las {{citaHora}}. ¡Te esperamos! 🌟',
            enabled: true
        }]);
    };

    const removeReminder = (id) => {
        setReminders(prev => prev.filter(r => r.id !== id));
    };

    const updateReminder = (id, field, value) => {
        setReminders(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const toggleReminder = (id) => {
        setReminders(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
    };

    const insertVar = (id, varName, textareaRef) => {
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const current = reminders.find(r => r.id === id)?.message || '';
        const newVal = current.substring(0, start) + varName + current.substring(end);
        updateReminder(id, 'message', newVal);
        setTimeout(() => {
            ta.focus();
            ta.setSelectionRange(start + varName.length, start + varName.length);
        }, 0);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                            <Bell className="w-5 h-5 text-amber-500" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-slate-800 dark:text-white">Mensajes Programados</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Paso: <span className="font-bold">{step.name}</span></p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">

                    {/* Info */}
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/50 rounded-2xl p-4">
                        <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
                            <span className="font-bold">¿Cómo funciona?</span> Cuando un candidato sea movido a este paso con una cita confirmada,
                            se programarán estos mensajes para enviarse automáticamente N horas antes de la entrevista vía WhatsApp.
                        </p>
                    </div>

                    {/* Reminder list */}
                    {reminders.map((reminder) => {
                        const textareaRef = React.createRef();
                        return (
                            <div
                                key={reminder.id}
                                className={`rounded-2xl border-2 p-4 space-y-3 transition-all ${reminder.enabled
                                    ? 'border-amber-200 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10'
                                    : 'border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 opacity-60'
                                    }`}
                            >
                                {/* Top row */}
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                        <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">Recordatorio</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => toggleReminder(reminder.id)}
                                            className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full transition-colors ${reminder.enabled
                                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                                }`}
                                        >
                                            {reminder.enabled ? 'Activo' : 'Inactivo'}
                                        </button>
                                        <button
                                            onClick={() => removeReminder(reminder.id)}
                                            className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                            title="Eliminar"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Hours before */}
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Horas antes de la cita</label>
                                    <div className="flex items-center gap-2">
                                        <div className="relative flex-1">
                                            <select
                                                value={reminder.hoursBefor}
                                                onChange={(e) => updateReminder(reminder.id, 'hoursBefor', Number(e.target.value))}
                                                className="w-full appearance-none bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-amber-400 outline-none pr-8"
                                            >
                                                {PRESET_HOURS.map(p => (
                                                    <option key={p.value} value={p.value}>{p.label}</option>
                                                ))}
                                                <option value="48">48 horas antes</option>
                                                <option value="72">72 horas antes</option>
                                            </select>
                                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                                        </div>
                                        <span className="text-xs text-slate-400 whitespace-nowrap">antes del evento</span>
                                    </div>
                                </div>

                                {/* Message */}
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mensaje</label>
                                        <div className="flex items-center gap-1">
                                            {TEMPLATE_VARS.map(v => (
                                                <button
                                                    key={v}
                                                    onClick={() => insertVar(reminder.id, v, textareaRef)}
                                                    className="text-[9px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 px-2 py-0.5 rounded-md hover:bg-amber-100 hover:text-amber-700 transition-colors"
                                                    title={`Insertar ${v}`}
                                                >
                                                    {v}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <textarea
                                        ref={textareaRef}
                                        value={reminder.message}
                                        onChange={(e) => updateReminder(reminder.id, 'message', e.target.value)}
                                        rows={3}
                                        className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 outline-none resize-none"
                                        placeholder="Ej: Hola {{nombre}}, tu entrevista es mañana {{citaFecha}} a las {{citaHora}} 🕐"
                                    />
                                    <p className="text-[9px] text-slate-400">
                                        Variables disponibles: <code>{'{{nombre}}'}</code>, <code>{'{{citaFecha}}'}</code>, <code>{'{{citaHora}}'}</code>
                                    </p>
                                </div>
                            </div>
                        );
                    })}

                    {/* Add button */}
                    <button
                        onClick={addReminder}
                        className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl border-2 border-dashed border-amber-200 dark:border-amber-700/40 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors font-bold text-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Agregar recordatorio
                    </button>

                    {reminders.length === 0 && (
                        <p className="text-center text-sm text-slate-400 py-2">
                            Sin recordatorios configurados — los candidatos no recibirán mensajes automáticos.
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-sm transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => onSave(reminders)}
                        className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors shadow-lg shadow-amber-500/20"
                    >
                        Guardar recordatorios
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ScheduledRemindersModal;
