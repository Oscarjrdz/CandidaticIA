import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, X, Loader2, Command } from 'lucide-react';
import { aiQuery } from '../services/candidatesService';

const STATUS_STEPS = [
    "Interpretando tu solicitud...",
    "Accediendo a la red de candidatos...",
    "Analizando perfiles y chats...",
    "Filtrando por criterios de IA...",
    "Casi listo..."
];

// Sugerencias eliminadas para diseño minimalista

/**
 * Buscador Inteligente - Diseño iOS / Minimalista (Totalmente Neutro)
 */
const MagicSearch = ({ onResults, showToast, initialMode = 'search', customTitle, customPlaceholder, onAction, isOpenProp, onClose }) => {
    const [statusText, setStatusText] = useState('');
    const [statusInterval, setStatusInterval] = useState(null);
    const [internalOpen, setInternalOpen] = useState(false);
    const [mode, setMode] = useState(initialMode);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [userName, setUserName] = useState('');
    const modalRef = useRef(null);

    // Controlled vs Uncontrolled
    const isOpen = isOpenProp !== undefined ? isOpenProp : internalOpen;
    const handleClose = onClose || (() => setInternalOpen(false));

    // Status message cycler
    useEffect(() => {
        if (loading) {
            let i = 0;
            setStatusText(STATUS_STEPS[0]);
            const interval = setInterval(() => {
                i++;
                if (i < STATUS_STEPS.length) {
                    setStatusText(STATUS_STEPS[i]);
                }
            }, 1200);
            setStatusInterval(interval);
        } else {
            if (statusInterval) clearInterval(statusInterval);
            setStatusText('');
        }
        return () => {
            if (statusInterval) clearInterval(statusInterval);
        };
    }, [loading]);

    // Cargar nombre del usuario
    useEffect(() => {
        const session = localStorage.getItem('candidatic_user_session');
        if (session) {
            try {
                const data = JSON.parse(session);
                if (data.name) setUserName(data.name.split(' ')[0]);
            } catch (e) { }
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            setMode(initialMode);
            setQuery('');
        }
    }, [isOpen, initialMode]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setInternalOpen(prev => !prev);
            }
            if (e.key === 'Escape' && isOpen) handleClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleClose]);

    const handleSearch = async (e, forcedQuery) => {
        if (e) e.preventDefault();
        const finalQuery = forcedQuery || query;
        if (!finalQuery.trim() || loading) return;

        setLoading(true);
        try {
            if (mode === 'action' && onAction) {
                await onAction(finalQuery);
            } else {
                const result = await aiQuery(finalQuery);
                if (result.success) {
                    onResults(result.candidates, result.ai, finalQuery);
                    handleClose();
                    showToast(`IA encontró ${result.count} candidatos`, 'success');
                } else {
                    showToast(result.error || 'Error en la búsqueda', 'error');
                }
            }
        } catch (error) {
            showToast(`Error: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen && isOpenProp === undefined) return (
        <button
            onClick={() => setInternalOpen(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-100 dark:bg-gray-800/80 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full border border-gray-200 dark:border-gray-700/50 transition-all font-medium group"
        >
            <Search className="w-4 h-4 opacity-70 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-semibold">Buscador Inteligente</span>
            <div className="flex items-center space-x-1 opacity-50 px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600">
                <Command className="w-2.5 h-2.5" />
                <span className="text-[10px] font-bold">K</span>
            </div>
        </button>
    );

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 bg-gray-900/60 backdrop-blur-xl animate-in fade-in duration-300">
            <div
                ref={modalRef}
                className="w-full max-w-2xl bg-white dark:bg-gray-950 rounded-[40px] shadow-[0_40px_100px_rgba(0,0,0,0.5)] overflow-hidden animate-spring-in border border-white/20"
            >
                <div className="p-8 space-y-6">
                    {/* Header: Zuckerberg Style */}
                    <div className="flex items-start justify-between">
                        <div className="space-y-2">
                            <h2 className="text-[42px] font-bold text-gray-900 dark:text-white tracking-[-0.04em] leading-tight">
                                {customTitle ? (
                                    <span className="text-blue-600">{customTitle}</span>
                                ) : (
                                    <>
                                        Hola, <span className="text-blue-600">
                                            {userName ? userName.charAt(0).toUpperCase() + userName.slice(1).toLowerCase() : 'Recruiter'}
                                        </span>
                                    </>
                                )}
                            </h2>
                            <p className="text-[18px] text-gray-500 dark:text-gray-400 font-medium tracking-tight">
                                {mode === 'action' ? '¿Qué hacemos con estos candidatos?' : '¿Qué talento estás buscando hoy?'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleClose}
                            className="p-2.5 rounded-full bg-gray-100/50 dark:bg-gray-900/50 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all hover:scale-110 active:scale-95"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>

                    {/* Input Section */}
                    <div className="space-y-6">
                        <form onSubmit={handleSearch} className="relative group">
                            <div className="flex items-center space-x-6">
                                <div className="flex-shrink-0">
                                    {loading ? (
                                        <div className="relative w-12 h-12">
                                            <div className="absolute inset-0 border-[3px] border-blue-600/10 border-t-blue-600 rounded-2xl animate-spin"></div>
                                            <Sparkles className="absolute inset-3 w-6 h-6 text-blue-600 animate-pulse" />
                                        </div>
                                    ) : (
                                        <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center justify-center border border-blue-100/50 dark:border-blue-800/30">
                                            <Sparkles className={`w-5 h-5 ${mode === 'action' ? 'text-purple-600' : 'text-blue-600'}`} />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1">
                                    <input
                                        type="text"
                                        autoFocus
                                        placeholder={customPlaceholder || "Describe a tu candidato ideal..."}
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        className="w-full bg-transparent outline-none text-[22px] font-semibold text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-700 border-none focus:ring-0 p-0"
                                    />
                                </div>
                            </div>

                            {/* Status Pills */}
                            {loading && (
                                <div className="mt-6 flex justify-start animate-in slide-in-from-bottom-2 duration-500">
                                    <div className="bg-blue-50/80 dark:bg-blue-900/20 px-4 py-2 rounded-full border border-blue-100/50 dark:border-blue-800/30 flex items-center space-x-3">
                                        <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                                        <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                                            {statusText}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </form>

                        {/* Result Skeleton */}
                        {loading && (
                            <div className="space-y-4 animate-in fade-in duration-1000">
                                {[1, 2].map(i => (
                                    <div key={i} className="flex items-center space-x-4 p-5 rounded-[24px] bg-gray-50/30 dark:bg-gray-900/20 border border-gray-100/50 dark:border-gray-800/50">
                                        <div className="w-12 h-12 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse"></div>
                                        <div className="flex-1 space-y-3">
                                            <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded-full w-1/4 animate-pulse"></div>
                                            <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded-full w-1/2 animate-pulse"></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer: Tech Branding */}
                    <div className="flex items-center justify-between pt-8 border-t border-gray-100 dark:border-gray-900">
                        <div className="flex items-center space-x-3 grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all cursor-default">
                            <div className="w-6 h-6 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-md flex items-center justify-center shadow-lg shadow-blue-500/20">
                                <Sparkles className="w-3.5 h-3.5 text-white" />
                            </div>
                            <span className="text-[11px] font-bold tracking-[0.2em] text-gray-400 dark:text-gray-500 uppercase">
                                By Gemini 2.0
                            </span>
                        </div>

                        <div className="flex items-center space-x-2 text-[10px] font-bold text-gray-300 dark:text-gray-600">
                            <kbd className="px-2 py-1 bg-gray-50 dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-800">ESC</kbd>
                            <span>to close</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MagicSearch;
