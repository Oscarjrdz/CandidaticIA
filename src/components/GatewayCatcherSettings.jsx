import React, { useState } from 'react';
import { Database, Link, Copy, Check, ShieldAlert, FishSymbol } from 'lucide-react';
import Card from './ui/Card';

const GatewayCatcherSettings = ({ showToast }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(`${window.location.origin}/api/gateway/catcher`);
        setCopied(true);
        showToast?.('URL del webhook de Catcher copiada', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card
            title="Gateway Catcher (Atrapaleads silencioso)"
            icon={Database}
            actions={
                <span className="text-[10px] font-bold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <FishSymbol className="w-3 h-3" /> Base de Datos
                </span>
            }
        >
            <div className="space-y-4">
                {/* Introduction / Explain */}
                <div className="rounded-xl p-4 border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50/50 to-white dark:from-purple-950/20 dark:to-gray-800">
                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex flex-shrink-0 items-center justify-center border border-purple-200 dark:border-purple-800/50 mt-1">
                            <FishSymbol className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                    Receptor Independiente
                                </span>
                            </div>
                            <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
                                Escucha mensajes entrantes desde una instancia Baileys / EvolutionAPI / WappGateway para <strong>capturar número, nombre y foto</strong> del prospecto. Almacena silenciosamente en la base de datos para posteriores envíos masivos via Meta Oficial.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Webhook URL */}
                <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            Webhook URL Catcher:
                        </span>
                        <button
                            onClick={handleCopy}
                            className="text-[10px] text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 font-bold flex items-center space-x-1 transition-colors"
                        >
                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copied ? 'Copiado' : 'Copiar URL'}</span>
                        </button>
                    </div>
                    <code className="block w-full p-2.5 bg-gray-50 dark:bg-gray-900/80 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-mono break-all text-gray-700 dark:text-gray-300 shadow-inner">
                        {typeof window !== 'undefined' ? window.location.origin : 'https://candidatic-ia.vercel.app'}/api/gateway/catcher
                    </code>
                </div>

                {/* Status indicator note */}
                <div className="flex items-start gap-2.5 p-3.5 bg-amber-50/70 dark:bg-amber-950/20 rounded-lg border border-amber-200/60 dark:border-amber-900/30">
                    <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[11px] text-amber-800 dark:text-amber-300 font-bold tracking-tight">AI BLOQUEADA ESTRICTAMENTE</p>
                        <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80 mt-0.5 leading-relaxed font-medium">
                            Los candidatos que entren por este Webhook serán etiquetados como <code className="bg-amber-100 dark:bg-amber-900/40 px-1 py-[1.5px] rounded border border-amber-200 dark:border-amber-800">Capturado</code> y <strong>Brenda IA nunca los atenderá ni les enviará mensajes.</strong> Quedan a la espera pasiva en la BD.
                        </p>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default GatewayCatcherSettings;
