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
            className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-purple-600/10 to-blue-600/10 hover:from-purple-600/20 hover:to-blue-600/20 text-purple-600 dark:text-purple-300 rounded-xl border border-purple-500/20 hover:border-purple-500/40 transition-all group relative overflow-hidden animate-pulse-glow"
        >
            <Sparkles className="w-4 h-4 text-purple-500 group-hover:rotate-12 transition-transform" />
            <span className="text-xs font-bold tracking-tight">Candidatic Intelligencia</span>
            <div className="flex items-center space-x-1 bg-white/40 dark:bg-black/40 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-700/50">
                <Command className="w-2.5 h-2.5" />
                <span className="text-[10px] font-bold">K</span>
            </div>
        </button>
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
            <div
                ref={modalRef}
                className="w-full max-w-3xl crystal-effect rounded-[32px] shadow-[0_0_50px_-12px_rgba(139,92,246,0.3)] overflow-hidden animate-float animate-in zoom-in-95 slide-in-from-bottom-8 duration-500 relative"
            >
                {/* Decorative gradients */}
                <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-600/20 blur-[100px] pointer-events-none" />
                <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-600/20 blur-[100px] pointer-events-none" />

                <div className="p-8 space-y-6 relative">
                    {/* Greeting Header */}
                    <div className="space-y-1 animate-in slide-in-from-top-4 duration-700 delay-100">
                        <div className="flex items-center space-x-2 text-purple-500 dark:text-purple-400">
                            <Sparkles className="w-5 h-5 animate-pulse" />
                            <span className="text-xs font-bold uppercase tracking-[0.2em]">Sistemas de Inteligencia</span>
                        </div>
                        <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                            Hola <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-500 to-blue-500">{userName || 'Oscar'}</span>, <br />
                            <span className="opacity-80">¿Qué haremos hoy?</span>
                        </h2>
                    </div>

                    {/* Search Input */}
                    <form onSubmit={handleSearch} className="relative group">
                        <div className={`absolute left-0 top-1/2 -translate-y-1/2 flex items-center justify-center p-1 rounded-full border-2 border-transparent transition-all duration-500 ${loading ? 'rotate-180 scale-110 border-purple-500' : 'group-focus-within:border-blue-500'}`}>
                            {loading ? (
                                <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white shadow-lg">
                                    <Search className="w-4 h-4" />
                                </div>
                            )}
                        </div>
                        <input
                            type="text"
                            autoFocus
                            placeholder="Busca candidatos, habilidades, o genera un reporte..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="w-full pl-14 pr-4 py-6 bg-white/5 dark:bg-black/5 border-b-2 border-white/10 dark:border-white/5 focus:border-purple-500/50 outline-none text-2xl font-light text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="absolute right-0 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-white/10 dark:hover:bg-white/5 text-gray-400 dark:text-gray-500 transition-colors"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </form>

                    {/* Footer / Status */}
                    <div className="flex items-center justify-between pt-4 border-t border-white/10 dark:border-white/5 text-[10px] text-gray-500 dark:text-gray-400 font-medium tracking-widest uppercase">
                        <div className="flex items-center space-x-6">
                            <div className="flex items-center space-x-2">
                                <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                                <span>Neuronal Link: Connected</span>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Command className="w-3 h-3" />
                                <span>+ K</span>
                            </div>
                        </div>
                        <div className="flex items-center space-x-1 opacity-50">
                            <span>Powered by</span>
                            <span className="font-black text-gray-900 dark:text-white">Gemini 1.5 Ultra-Safe</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MagicSearch;
