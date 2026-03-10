import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Calendar as CalendarIcon, Clock, X } from 'lucide-react';
import Button from './ui/Button';

// Utility to get days in a month
const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

export default function InteractiveCalendar({ options = [], onChange }) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(null);
    const [timeInput, setTimeInput] = useState('10:00 AM');

    // Parse options into a map of YYYY-MM-DD -> [times] and keep legacy ones separate.
    const [dateMap, setDateMap] = useState({});
    const [legacyOptions, setLegacyOptions] = useState([]);

    useEffect(() => {
        const newMap = {};
        const legacy = [];

        options.forEach(opt => {
            const match = opt.match(/^(\d{4}-\d{2}-\d{2})\s+@\s+(.+)$/);
            if (match) {
                const [, dateStr, timeStr] = match;
                if (!newMap[dateStr]) newMap[dateStr] = [];
                newMap[dateStr].push(timeStr);
            } else {
                legacy.push(opt);
            }
        });

        setDateMap(newMap);
        setLegacyOptions(legacy);
    }, [options]);

    const handleSaveNewOptions = (newMap, newLegacy) => {
        const out = [...newLegacy];
        Object.keys(newMap).forEach(dateStr => {
            newMap[dateStr].forEach(timeStr => {
                out.push(`${dateStr} @ ${timeStr}`);
            });
        });
        onChange(out);
    };

    const addTimeSlot = () => {
        if (!selectedDate || !timeInput.trim()) return;

        // [FIX]: Ensure date mapping uses local timezone string (YYYY-MM-DD) instead of UTC shift
        const dateStr = selectedDate.toLocaleDateString('en-CA');
        const updatedMap = { ...dateMap };
        if (!updatedMap[dateStr]) updatedMap[dateStr] = [];

        if (!updatedMap[dateStr].includes(timeInput.trim())) {
            updatedMap[dateStr].push(timeInput.trim());
            updatedMap[dateStr].sort((a, b) => {
                const parseTime = (t) => {
                    const match = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
                    if (!match) return 0;
                    let [, h, m, mpm] = match;
                    h = parseInt(h, 10);
                    if (mpm?.toUpperCase() === 'PM' && h !== 12) h += 12;
                    if (mpm?.toUpperCase() === 'AM' && h === 12) h = 0;
                    return h * 60 + parseInt(m, 10);
                };
                return parseTime(a) - parseTime(b);
            });
            handleSaveNewOptions(updatedMap, legacyOptions);
        }
    };

    const removeTimeSlot = (dateStr, timeStr) => {
        const updatedMap = { ...dateMap };
        if (updatedMap[dateStr]) {
            updatedMap[dateStr] = updatedMap[dateStr].filter(t => t !== timeStr);
            if (updatedMap[dateStr].length === 0) {
                delete updatedMap[dateStr];
            }
        }
        handleSaveNewOptions(updatedMap, legacyOptions);
    };

    // ✨ New: delete ALL slots for a given date
    const removeEntireDate = (dateStr) => {
        const updatedMap = { ...dateMap };
        delete updatedMap[dateStr];
        // If we just deleted the currently selected date, deselect it
        if (selectedDate && selectedDate.toLocaleDateString('en-CA') === dateStr) {
            setSelectedDate(null);
        }
        handleSaveNewOptions(updatedMap, legacyOptions);
    };

    const removeLegacy = (idx) => {
        const updated = legacyOptions.filter((_, i) => i !== idx);
        handleSaveNewOptions(dateMap, updated);
    };

    const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const dayNames = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];

    // Spanish month names for the active-dates panel
    const monthNamesShort = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    const formatDateLabel = (dateStr) => {
        // dateStr is YYYY-MM-DD
        const [y, m, d] = dateStr.split('-');
        const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
        const weekDays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
        return `${weekDays[dateObj.getDay()]} ${Number(d)} ${monthNamesShort[Number(m) - 1]} ${y}`;
    };

    // Generate common time slots (every 30 mins from 8 AM to 8 PM)
    const generateTimeSlots = () => {
        const slots = [];
        for (let h = 8; h <= 20; h++) {
            for (let m = 0; m < 60; m += 30) {
                const isPM = h >= 12;
                const displayH = h > 12 ? h - 12 : (h === 0 ? 12 : h);
                const amPm = isPM ? "PM" : "AM";
                const timeStr = `${displayH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${amPm}`;
                slots.push(timeStr);
            }
        }
        return slots;
    };

    const PREDEFINED_TIMES = generateTimeSlots();

    const todayStr = new Date().toISOString().split('T')[0];

    // All active date keys sorted ascending
    const activeDateKeys = Object.keys(dateMap).sort();
    const hasActiveDates = activeDateKeys.length > 0;

    const renderCalendarDays = () => {
        const days = [];
        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`empty-${i}`} className="h-10"></div>);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = date.toLocaleDateString('en-CA');
            const isSelected = selectedDate && selectedDate.toLocaleDateString('en-CA') === dateStr;
            const isToday = dateStr === todayStr;
            const hasSlots = dateMap[dateStr] && dateMap[dateStr].length > 0;
            const slotCount = hasSlots ? dateMap[dateStr].length : 0;
            const isPast = dateStr < todayStr;

            days.push(
                <button
                    key={dateStr}
                    onClick={() => setSelectedDate(date)}
                    disabled={isPast}
                    className={`
                        relative h-10 w-10 flex items-center justify-center rounded-full text-sm font-medium transition-all
                        ${isPast ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800'}
                        ${isSelected ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-md shadow-emerald-500/30' : 'text-slate-700 dark:text-slate-300'}
                        ${isToday && !isSelected ? 'border border-emerald-500 text-emerald-600 dark:text-emerald-400' : ''}
                    `}
                >
                    {day}
                    {hasSlots && (
                        <div className="absolute top-0 right-0 w-3.5 h-3.5 bg-blue-500 border-2 border-white dark:border-slate-900 rounded-full flex items-center justify-center text-[7px] text-white font-bold">
                            {slotCount}
                        </div>
                    )}
                </button>
            );
        }
        return days;
    };

    const selectedDateStr = selectedDate ? selectedDate.toLocaleDateString('en-CA') : null;
    const slotsForSelected = selectedDateStr ? (dateMap[selectedDateStr] || []) : [];

    return (
        <div className="flex flex-col md:flex-row gap-6 bg-white dark:bg-slate-900 rounded-2xl p-2">
            {/* Left: Calendar */}
            <div className="flex-1 max-w-[300px] mx-auto">
                <div className="flex items-center justify-between mb-4">
                    <button onClick={prevMonth} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <h4 className="font-bold text-slate-800 dark:text-white capitalize">
                        {monthNames[month]} {year}
                    </h4>
                    <button onClick={nextMonth} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500">
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-7 gap-1 mb-2 text-center">
                    {dayNames.map(d => (
                        <div key={d} className="text-xs font-bold text-slate-400">{d}</div>
                    ))}
                </div>

                <div className="grid grid-cols-7 gap-1 place-items-center">
                    {renderCalendarDays()}
                </div>

                {/* ✨ Active Dates Summary — visible below the calendar */}
                {hasActiveDates && (
                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                        <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1">
                            <CalendarIcon className="w-3 h-3" /> Fechas con horarios
                        </h5>
                        <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                            {activeDateKeys.map(ds => {
                                const isPastDate = ds < todayStr;
                                return (
                                    <div
                                        key={ds}
                                        className={`flex items-center justify-between rounded-lg px-2 py-1 text-xs group cursor-pointer
                                            ${isPastDate
                                                ? 'bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40'
                                                : 'bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/10'
                                            }`}
                                        onClick={() => {
                                            // Navigate calendar to that month and select date
                                            const [y, m, d] = ds.split('-').map(Number);
                                            const dateObj = new Date(y, m - 1, d);
                                            setCurrentDate(new Date(y, m - 1, 1));
                                            setSelectedDate(dateObj);
                                        }}
                                    >
                                        <span className={`font-semibold ${isPastDate ? 'text-red-500 line-through' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {formatDateLabel(ds)}
                                            {isPastDate && <span className="ml-1 text-[9px] font-bold text-red-400 no-underline" style={{ textDecoration: 'none' }}>VENCIDA</span>}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <span className="text-[9px] font-black text-slate-400">{dateMap[ds].length}h</span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); removeEntireDate(ds); }}
                                                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all p-0.5 rounded"
                                                title="Eliminar esta fecha completa"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Right: Slots for selected date & Legacy */}
            <div className="flex-1 flex flex-col border-l border-slate-100 dark:border-slate-800/50 pl-0 md:pl-6 pt-4 md:pt-0 min-h-[300px]">
                {selectedDate ? (
                    <div className="flex-1 flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300">
                        {/* ✨ Date header + delete entire date button */}
                        <div className="mb-4 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 min-w-0">
                                <CalendarIcon className="w-5 h-5 flex-shrink-0" />
                                <h4 className="font-bold text-base whitespace-nowrap">
                                    {selectedDate.getDate()} {monthNames[selectedDate.getMonth()]} {selectedDate.getFullYear()}
                                </h4>
                            </div>
                            {slotsForSelected.length > 0 && (
                                <button
                                    onClick={() => removeEntireDate(selectedDateStr)}
                                    className="flex items-center gap-1 text-xs font-bold text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded-lg transition-all whitespace-nowrap flex-shrink-0"
                                    title="Eliminar este día completo"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Eliminar día
                                </button>
                            )}
                        </div>

                        <div className="flex gap-2 mb-4">
                            <div className="relative flex-1">
                                <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 z-10 pointer-events-none" />
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-xs">▼</div>
                                <select
                                    value={timeInput}
                                    onChange={(e) => setTimeInput(e.target.value)}
                                    className="w-full pl-9 pr-8 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 appearance-none cursor-pointer hover:bg-white dark:hover:bg-slate-800 transition-all shadow-sm"
                                >
                                    {PREDEFINED_TIMES.map(time => (
                                        <option key={time} value={time}>{time}</option>
                                    ))}
                                </select>
                            </div>
                            <Button
                                onClick={addTimeSlot}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 flex-shrink-0 shadow-md shadow-emerald-500/30 font-bold"
                                disabled={!timeInput.trim()}
                            >
                                <Plus className="w-5 h-5" />
                            </Button>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                            {slotsForSelected.length === 0 ? (
                                <div className="text-center py-8 text-slate-400">
                                    <p className="text-sm">No hay horarios para este día.</p>
                                </div>
                            ) : (
                                slotsForSelected.map((timeStr, idx) => (
                                    <div key={idx} className="flex justify-between items-center bg-emerald-50 dark:bg-emerald-900/10 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-800/30 group">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                            <span className="font-medium text-slate-700 dark:text-slate-300 text-sm">{timeStr}</span>
                                        </div>
                                        <button
                                            onClick={() => removeTimeSlot(selectedDateStr, timeStr)}
                                            className="text-slate-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-all"
                                            title="Eliminar esta hora"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 p-4">
                        <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800/50 rounded-full flex items-center justify-center mb-4">
                            <CalendarIcon className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                        </div>
                        <p className="text-sm font-medium">Selecciona un día en el calendario<br />para gestionar sus horarios</p>
                    </div>
                )}
            </div>

            {/* Legacy/Other Options list below if they exist */}
            {legacyOptions.length > 0 && (
                <div className="w-full mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/50">
                    <h5 className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Opciones Manuales Antiguas</h5>
                    <div className="flex flex-wrap gap-2">
                        {legacyOptions.map((opt, idx) => (
                            <div key={`legacy-${idx}`} className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-md text-xs border border-slate-200 dark:border-slate-700">
                                <span className="text-slate-600 dark:text-slate-300 truncate max-w-[200px]">{opt}</span>
                                <button onClick={() => removeLegacy(idx)} className="text-slate-400 hover:text-red-500 ml-1">
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
