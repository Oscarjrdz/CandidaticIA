import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, X, Loader2, Command } from 'lucide-react';
import { aiQuery } from '../services/candidatesService';

/**
 * Buscador Inteligente - Diseño iOS / Minimalista (Totalmente Neutro)
 */
const MagicSearch = ({ onResults, showToast }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [userName, setUserName] = useState('');
    const modalRef = useRef(null);

    // Cargar nombre del usuario
    useEffect(() => {
        const session = localStorage.getItem('candidatic_user_session');
        if (session) {
            try {
                const data = JSON.parse(session);
                if (data.name) {
                    setUserName(data.name.split(' ')[0]);
                }
            } catch (e) { }
        }
    }, []);

    // Atajos de teclado
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(prev => !prev);
            }
            if (e.key === 'Escape' && isOpen) {
                setIsOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!query.trim() || loading) return;

        setLoading(true);
        try {
            const result = await aiQuery(query);
            if (result.success) {
                onResults(result.candidates, result.ai);
                setIsOpen(false);
                showToast(`IA encontró ${result.count} candidatos`, 'success');
            } else {
                showToast(result.error || 'Error en la búsqueda', 'error');
            }
        } catch (error) {
            showToast(`Error: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return (
        <button
            onClick={() => setIsOpen(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-100 dark:bg-gray-800/80 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full border border-gray-200 dark:border-gray-700/50 transition-all font-medium"
        >
            <Search className="w-4 h-4 opacity-70" />
            <span className="text-sm font-semibold">Buscador Inteligente</span>
            <div className="flex items-center space-x-1 opacity-50 px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600">
                <Command className="w-2.5 h-2.5" />
                <span className="text-[10px] font-bold">K</span>
            </div>
        </button>
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div
                ref={modalRef}
                className="w-full max-w-3xl bg-white dark:bg-gray-900 rounded-3xl shadow-2xl overflow-hidden animate-spring-in border border-gray-100 dark:border-gray-800"
            >
                <div className="p-10 space-y-8">
                    {/* Header: Clean & Personal */}
                    <div className="flex items-start justify-between">
                        <div className="space-y-1">
                            <h2 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                                Hola, <span className="text-blue-600 dark:text-blue-400">{userName || 'Recruiter'}</span>
                            </h2>
                            <p className="text-lg text-gray-500 dark:text-gray-400 font-medium">
                                ¿Qué talento estás buscando hoy?
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="p-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>

                    {/* Neutral Search Input - Modern & Large */}
                    <form onSubmit={handleSearch} className="relative group">
                        <div className="relative flex items-center bg-white dark:bg-gray-950 rounded-2xl px-6 py-2 border-2 border-gray-100 dark:border-gray-800 shadow-sm transition-all focus-within:border-gray-300 dark:focus-within:border-gray-700 focus-within:shadow-md">
                            <div className="mr-5">
                                {loading ? (
                                    <Loader2 className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin" />
                                ) : (
                                    <Sparkles className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                                )}
                            </div>
                            <input
                                type="text"
                                autoFocus
                                placeholder="Describe a tu candidato ideal y deja que la IA haga su magia..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                className="w-full py-6 bg-transparent outline-none ring-0 border-none shadow-none text-2xl font-medium text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600"
                            />
                        </div>
                    </form>

                    {/* Status Footer - Neutral */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-800">
                        <div className="flex items-center space-x-2 text-xs font-bold tracking-widest text-gray-400 uppercase">
                            <Sparkles className="w-3 h-3" />
                            <span>Powered by Gemini AI</span>
                        </div>
                        <div className="flex items-center space-x-4 text-xs font-medium text-gray-400">
                            <span className="flex items-center space-x-1">
                                <span className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">↵</span>
                                <span>para buscar</span>
                            </span>
                            <span className="flex items-center space-x-1">
                                <span className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">esc</span>
                                <span>para cerrar</span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MagicSearch;
