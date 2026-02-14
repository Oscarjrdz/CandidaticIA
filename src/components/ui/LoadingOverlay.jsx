import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

const LoadingOverlay = ({ message = 'Cargando Brenda...' }) => {
    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white/70 dark:bg-gray-900/80 backdrop-blur-xl animate-in fade-in duration-500">
            <div className="relative">
                {/* Outer Ring */}
                <div className="w-24 h-24 rounded-full border-4 border-blue-500/10 border-t-blue-500 animate-spin"></div>

                {/* Inner Pulse */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-xl shadow-blue-500/30 animate-bounce flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-white" />
                    </div>
                </div>
            </div>

            <div className="mt-8 text-center space-y-2">
                <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">
                    {message}
                </h2>
                <div className="flex items-center justify-center gap-2">
                    <div className="h-1 w-12 bg-blue-500 rounded-full animate-pulse"></div>
                    <div className="h-1 w-4 bg-blue-300 rounded-full animate-pulse delay-75"></div>
                    <div className="h-1 w-2 bg-blue-100 rounded-full animate-pulse delay-150"></div>
                </div>
            </div>
        </div>
    );
};

export default LoadingOverlay;
