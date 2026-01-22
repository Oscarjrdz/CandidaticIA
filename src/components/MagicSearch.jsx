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
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
            <div
                ref={modalRef}
                className="w-full max-w-2xl ios-glass rounded-[24px] shadow-ios overflow-hidden animate-spring-in relative"
            >
                <div className="p-8 space-y-6">
                    {/* Header: Clean & Personal */}
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                Hola, <span className="capitalize">{userName || 'Oscar'}</span>
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium opacity-80">
                                ¿Cómo puedo ayudarte hoy?
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="p-2 rounded-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Neutral Search Input - NO BLUE RINGS */}
                    <form onSubmit={handleSearch} className="relative group">
                        <div className="relative flex items-center bg-gray-100 dark:bg-gray-900/60 rounded-2xl px-5 border-2 border-transparent transition-all focus-within:border-gray-300 dark:focus-within:border-gray-700">
                            <div className="mr-3">
                                {loading ? (
                                    <Loader2 className="w-6 h-6 text-gray-900 dark:text-white animate-spin" />
                                ) : (
                                    <Search className="w-5 h-5 text-gray-400" />
                                )}
                            </div>
                            <input
                                type="text"
                                autoFocus
                                placeholder="Ej: Candidatos mayores a 40 años en Monterrey..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                className="w-full py-5 bg-transparent outline-none ring-0 border-none shadow-none text-xl font-medium text-gray-900 dark:text-white placeholder-gray-400"
                            />
                        </div>
                    </form>

                    {/* Status Footer - Neutral */}
                    <div className="flex items-center justify-between pt-2 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-1.5 opacity-60">
                                <Sparkles className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                                <span>Powered by Gemini AI</span>
                            </div>
                            <div className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                            <span className="opacity-40 font-medium">Búsqueda Inteligente v2.0</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MagicSearch;
