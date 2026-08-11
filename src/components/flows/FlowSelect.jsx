import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

// Reemplazo del <select> nativo: mismo look que el resto del drawer y el panel de
// opciones SIEMPRE se abre hacia abajo (position: absolute, top: 100%) — un <select>
// nativo deja que el navegador decida y a veces lo abre hacia arriba si no hay espacio.
const FlowSelect = ({ value, onChange, options, placeholder = 'Elige...', ringClass = 'focus:ring-indigo-500', emptyLabel = 'Sin opciones' }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    const selected = options.find(o => o.value === value);

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800 bg-white text-sm text-left outline-none focus:ring-2 ${ringClass} transition-colors`}
            >
                <span className={`truncate ${selected ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                    {selected ? selected.label : placeholder}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute left-0 top-full mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-lg z-[300] py-1">
                    {options.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">{emptyLabel}</p>}
                    {options.map(opt => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => { onChange(opt.value); setOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-sm truncate hover:bg-gray-50 dark:hover:bg-gray-700/50 ${opt.value === value ? 'bg-gray-50 dark:bg-gray-700/50 font-medium text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-200'}`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default FlowSelect;
