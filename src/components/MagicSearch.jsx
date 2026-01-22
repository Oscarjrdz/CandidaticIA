import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, X, Loader2, Command } from 'lucide-react';
import { aiQuery } from '../services/candidatesService';

const MagicSearch = ({ onResults, showToast }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const modalRef = useRef(null);

    // Cerrar al hacer clic fuera o presionar Escape
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
        console.log('🚀 AI Search starting for:', query);
        try {
            const result = await aiQuery(query);
            console.log('📦 AI Query result:', result);
            if (result.success) {
                console.log('✅ Search success, calling onResults');
                onResults(result.candidates, result.ai);
                console.log('👋 Closing MagicSearch modal');
                setIsOpen(false);
                showToast(`IA encontró ${result.count} candidatos`, 'success');
            } else {
                console.error('❌ AI Query Error (result not success):', result.error);
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
            className="flex items-center space-x-2 px-3 py-1.5 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-300 rounded-lg border border-purple-100 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-all group"
        >
            <Sparkles className="w-4 h-4 animate-pulse" />
            <span className="text-xs font-semibold">Candidatic Intelligence</span>
            <div className="flex items-center space-x-1 bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-700">
                <Command className="w-2.5 h-2.5" />
                <span className="text-[10px]">K</span>
            </div>
        </button>
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                ref={modalRef}
                className="w-full max-w-2xl bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-white/20 dark:border-gray-700/50 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            >
                <div className="p-4 border-b border-gray-100 dark:border-gray-800">
                    <form onSubmit={handleSearch} className="relative flex items-center">
                        <div className="absolute left-4 text-purple-600 dark:text-purple-400">
                            {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6" />}
                        </div>
                        <input
                            type="text"
                            autoFocus
                            placeholder="Pregúntame algo... (ej: 'Busca gente de Monterrey interesada en ventas')"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="w-full pl-14 pr-12 py-4 bg-transparent text-lg font-medium text-gray-900 dark:text-white focus:outline-none placeholder-gray-400 dark:placeholder-gray-600"
                        />
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="absolute right-4 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </form>
                </div>

                <div className="p-4 bg-gray-50/50 dark:bg-gray-800/50">
                    <div className="flex flex-col space-y-3">
                        <div className="flex items-center space-x-2 text-xs text-gray-500 font-medium">
                            <span className="uppercase tracking-wider">Sugerencias rápidas</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {[
                                "Búscame a los de Monterrey",
                                "Prospectos para Chofer",
                                "Gente con buena actitud",
                                "Candidatos sin empleo actual"
                            ].map(suggestion => (
                                <button
                                    key={suggestion}
                                    onClick={() => setQuery(suggestion)}
                                    className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full text-xs text-gray-600 dark:text-gray-300 hover:border-purple-300 hover:text-purple-600 transition-all"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 flex justify-between items-center">
                    <div className="flex items-center space-x-4 text-[10px] text-gray-400 font-mono">
                        <div className="flex items-center space-x-1">
                            <span className="bg-gray-100 dark:bg-gray-800 px-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">↵</span>
                            <span>Buscar</span>
                        </div>
                        <div className="flex items-center space-x-1">
                            <span className="bg-gray-100 dark:bg-gray-800 px-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">ESC</span>
                            <span>Cerrar</span>
                        </div>
                    </div>
                    <div className="flex items-center space-x-1 text-[10px] text-gray-400">
                        <span>Powered by</span>
                        <span className="font-bold text-gray-600 dark:text-gray-300">Gemini 1.5 Flash</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MagicSearch;
