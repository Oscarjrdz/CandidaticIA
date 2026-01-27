import React, { useMemo } from 'react';
import { Sparkles, Brain, Zap, CheckCircle2, AlertCircle, Loader2, Command } from 'lucide-react';

/**
 * AIEnginePulse - The Zuckerberg/Meta Aesthetic
 * Premium glassmorphic status for AI execution.
 */
const AIEnginePulse = ({ running, logs = [], onShowDebug }) => {
    // Determine high-level status from logs
    const statusInfo = useMemo(() => {
        const logsArray = Array.isArray(logs) ? logs : [];
        if (!running && logsArray.length === 0) return null;

        const lastLog = logsArray[logsArray.length - 1] || '';
        let title = "Motor Activo";
        let sub = "Analizando secuencias...";
        let state = 'processing'; // processing, success, error

        if (lastLog.includes('Authenticating') || lastLog.includes('Configuración')) {
            title = "Autenticando";
            sub = "Validando llaves de acceso...";
        } else if (lastLog.includes('Evaluando') || lastLog.includes('🤔')) {
            title = "Analizando Perfiles";
            sub = "La IA está tomando decisiones...";
        } else if (lastLog.includes('Enviando') || lastLog.includes('🚀')) {
            title = "Sincronizando";
            sub = "Desplegando mensajes vía WhatsApp...";
        } else if (lastLog.includes('Finalizado') || lastLog.includes('🏁')) {
            title = "Secuencia Completa";
            sub = "Todo en orden. Motor en reposo.";
            state = 'success';
        } else if (lastLog.includes('❌') || lastLog.includes('🛑')) {
            title = "Atención Requerida";
            sub = "El motor encontró un obstáculo.";
            state = 'error';
        }

        return { title, sub, state };
    }, [running, logs]);

    if (!statusInfo && !running) return null;

    const { title, sub, state } = statusInfo || { title: 'Iniciando', sub: 'Preparando motor...', state: 'processing' };

    return (
        <div className="relative group overflow-hidden bg-white/5 dark:bg-black/40 backdrop-blur-xl border border-white/10 dark:border-white/5 rounded-[40px] p-8 shadow-2xl transition-all duration-700 animate-in zoom-in-95">
            {/* Animated Background Glow */}
            <div className={`absolute -inset-24 blur-[100px] opacity-20 transition-colors duration-1000 ${state === 'error' ? 'bg-red-500' :
                state === 'success' ? 'bg-green-500' : 'bg-blue-500 shadow-[0_0_100px_rgba(59,130,246,0.5)]'
                }`} />

            <div className="relative z-10 flex flex-col items-center text-center">
                {/* The Core Pulse */}
                <div className="relative mb-8">
                    <div className={`absolute inset-0 rounded-full blur-2xl opacity-40 animate-pulse ${state === 'error' ? 'bg-red-400' :
                        state === 'success' ? 'bg-green-400' : 'bg-blue-400'
                        }`} />

                    <div className={`w-24 h-24 rounded-full flex items-center justify-center relative border-4 transition-colors duration-500 ${state === 'error' ? 'border-red-500/30' :
                        state === 'success' ? 'border-green-500/30' : 'border-blue-500/30'
                        }`}>
                        {running ? (
                            <div className="relative">
                                <Loader2 className="w-10 h-10 text-blue-500 animate-spin-slow" />
                                <Sparkles className="w-4 h-4 text-blue-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                            </div>
                        ) : state === 'success' ? (
                            <CheckCircle2 className="w-12 h-12 text-green-500 animate-in zoom-in" />
                        ) : (
                            <AlertCircle className="w-12 h-12 text-red-500 animate-bounce" />
                        )}
                    </div>
                </div>

                {/* Typography */}
                <div className="space-y-1">
                    <h2 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white transition-all">
                        {title}
                    </h2>
                    <p className="text-sm font-medium text-gray-400 dark:text-gray-500 max-w-[280px] leading-relaxed">
                        {sub}
                    </p>
                </div>

                {/* Action Bar */}
                <div className="mt-8 flex items-center gap-3">
                    <button
                        onClick={onShowDebug}
                        className="text-[10px] font-bold tracking-[0.2em] text-gray-400 hover:text-blue-500 transition-colors bg-white/5 px-4 py-2 rounded-full border border-white/5"
                    >
                        DEBUG_TRACE
                    </button>
                    {state !== 'processing' && (
                        <div className="flex items-center text-[10px] font-black text-gray-500 italic">
                            v5.0_META_STABLE
                        </div>
                    )}
                </div>
            </div>

            {/* Micro-animations */}
            <div className="absolute top-4 right-10 flex space-x-1 opacity-20">
                <div className="w-1 h-3 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1 h-5 bg-white rounded-full animate-bounce" style={{ animationDelay: '100ms' }} />
                <div className="w-1 h-3 bg-white rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
            </div>
        </div>
    );
};

const style = document.createElement('style');
style.textContent = `
    @keyframes spin-slow {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .animate-spin-slow {
        animation: spin-slow 8s linear infinite;
    }
`;
if (typeof document !== 'undefined') document.head.appendChild(style);

export default AIEnginePulse;
