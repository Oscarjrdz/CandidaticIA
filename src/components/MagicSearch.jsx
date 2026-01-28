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
                    onResults(result.candidates, result.ai);
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
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 bg-gray-900/60 backdrop-blur-md animate-in fade-in duration-300">
            <div
                ref={modalRef}
                className="w-full max-w-3xl bg-white dark:bg-gray-950 rounded-[2.5rem] shadow-[0_30px_70px_rgba(0,0,0,0.5)] overflow-hidden animate-spring-in border-2 border-blue-500/30"
            >
                <div className="p-10 space-y-8">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                        <div className="space-y-1">
                            <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tighter">
                                {customTitle ? (
                                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">{customTitle}</span>
                                ) : (
                                    <>
                                        Hola, <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
                                            {userName ? userName.charAt(0).toUpperCase() + userName.slice(1).toLowerCase() : 'Recruiter'}
                                        </span>
                                    </>
                                )}
                            </h2>
                            <p className="text-lg text-gray-500 dark:text-gray-400 font-medium tracking-tight">
                                {mode === 'action' ? '¿Qué hacemos con estos candidatos?' : '¿Qué talento estás buscando hoy?'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleClose}
                            className="p-3 rounded-full bg-gray-100 dark:bg-gray-900 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all hover:rotate-90"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>

                    {/* Input Section */}
                    <div className="space-y-6">
                        <form onSubmit={handleSearch} className="relative group">
                            <div className="relative flex items-center px-4 py-8 bg-white dark:bg-gray-900 rounded-3xl border-2 border-transparent focus-within:border-blue-500/50 transition-all shadow-sm">
                                <div className="mr-6">
                                    {loading ? (
                                        <div className="relative w-10 h-10">
                                            <div className="absolute inset-0 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin"></div>
                                            <Sparkles className="absolute inset-2 w-6 h-6 text-blue-600 animate-pulse" />
                                        </div>
                                    ) : (
                                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                                            <Sparkles className={`w-8 h-8 ${mode === 'action' ? 'text-purple-600' : 'text-blue-600'}`} />
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
                                        className="w-full bg-transparent outline-none text-2xl font-bold text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-700 border-none focus:ring-0"
                                    />
                                </div>
                                {loading && (
                                    <div className="absolute right-6 top-1/2 -translate-y-1/2">
                                        <span className="text-sm font-bold text-blue-600 animate-pulse bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                                            {statusText}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </form>

                        {/* Smart Suggestions eliminadas */}

                        {/* Skeleton State */}
                        {loading && (
                            <div className="space-y-4 animate-in fade-in duration-700">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="flex items-center space-x-4 p-4 rounded-3xl bg-gray-50/50 dark:bg-gray-900/30 border border-gray-100/50 dark:border-gray-800/50">
                                        <div className="w-12 h-12 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse"></div>
                                        <div className="flex-1 space-y-3">
                                            <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded-full w-1/3 animate-pulse"></div>
                                            <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded-full w-2/3 animate-pulse"></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between pt-6 border-t border-gray-100 dark:border-gray-800">
                        <div className="flex items-center space-x-2">
                            <div className="p-1 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg">
                                <Sparkles className="w-3 h-3 text-white" />
                            </div>
                            <span className="text-[10px] font-black tracking-[0.1em] text-gray-400 uppercase">Powered with Gemini</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MagicSearch;
