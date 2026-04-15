import React, { useState, useRef, useEffect } from 'react';

const Select = ({ 
    value, 
    onChange, 
    options = [], 
    placeholder = "Seleccionar...", 
    label, 
    disabled = false,
    className = "",
    renderOption, // Optional custom renderer for options
    renderValue   // Optional custom renderer for selected value
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find(opt => opt.value === value);

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            {label && (
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                    {label}
                </label>
            )}
            
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`w-full h-12 px-4 border-2 rounded-xl bg-white dark:bg-slate-900 text-sm font-bold text-left flex items-center justify-between gap-2 transition-all ${
                    disabled ? 'opacity-50 cursor-not-allowed border-slate-100 dark:border-slate-800' :
                    isOpen
                        ? 'border-amber-500 ring-4 ring-amber-500/10'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
            >
                <div className="flex-1 truncate">
                    {selectedOption ? (
                        renderValue ? renderValue(selectedOption) : (
                            <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200 truncate">
                                {selectedOption.color && (
                                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selectedOption.color }}></span>
                                )}
                                {selectedOption.label}
                            </span>
                        )
                    ) : (
                        <span className="text-slate-400">{placeholder}</span>
                    )}
                </div>
                <svg className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>

            {isOpen && (
                <div className="absolute z-50 top-full mt-2 left-0 right-0 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-52 overflow-y-auto">
                    {options.map((opt, idx) => (
                        <button
                            key={opt.value || idx}
                            type="button"
                            onClick={() => {
                                onChange(opt.value);
                                setIsOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2.5 text-sm font-medium flex items-center gap-3 transition-colors ${
                                value === opt.value
                                    ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                            }`}
                        >
                            {renderOption ? renderOption(opt) : (
                                <>
                                    {opt.color && (
                                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: opt.color }}></span>
                                    )}
                                    <span className="truncate">{opt.label}</span>
                                    {opt.count !== undefined && (
                                        <span className="ml-auto text-[10px] font-bold text-slate-400">({opt.count})</span>
                                    )}
                                </>
                            )}
                        </button>
                    ))}
                    {options.length === 0 && (
                        <div className="px-4 py-3 text-sm text-slate-400 text-center">
                            No hay opciones disponibles
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default Select;
