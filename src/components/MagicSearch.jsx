import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, X, Loader2, Command } from 'lucide-react';
import { aiQuery } from '../services/candidatesService';

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
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-300">
            <div
                ref={modalRef}
                className="w-full max-w-2xl ios-glass rounded-[24px] shadow-ios overflow-hidden animate-spring-in relative"
            >
                <div className="p-8 space-y-6">
                    {/* Header: Human-centric and clean */}
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                Hola, <span className="capitalize">{userName || 'Oscar'}</span>
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                                ¿Cómo puedo ayudarte con tus candidatos?
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="p-2 rounded-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:scale-110 transition-transform"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <form onSubmit={handleSearch} className="relative group">
                        <div className="relative flex items-center bg-gray-200/60 dark:bg-gray-800/60 rounded-2xl px-5 transition-all ring-offset-2 ring-blue-500/0 focus-within:ring-2 focus-within:ring-blue-500/40">
                            <div className="mr-3">
                                {loading ? (
                                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                                ) : (
                                    <Search className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                                )}
                            </div>
                            <input
                                type="text"
                                autoFocus
                                placeholder="Ej: Candidatos de más de 40 años en Monterrey..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                className="w-full py-5 bg-transparent outline-none ring-0 placeholder-gray-400 text-xl font-medium text-gray-900 dark:text-white"
                            />
                        </div>
                    </form>

                    {/* Subtle Status Footer */}
                    <div className="flex items-center justify-between pt-2 text-[11px] text-gray-400 font-medium">
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-1.5 translate-y-[-1px]">
                                <Sparkles className="w-3.5 h-3.5 text-blue-500 opacity-70" />
                                <span>IA Optimizada</span>
                            </div>
                            <div className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                            <div className="flex items-center space-x-1 opacity-60">
                                <span>Powered by</span>
                                <span className="font-bold text-gray-700 dark:text-gray-300">Gemini 1.5 Ultra</span>
                            </div>
                        </div>
                        <span className="opacity-50">v2.0 Beta</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MagicSearch;
