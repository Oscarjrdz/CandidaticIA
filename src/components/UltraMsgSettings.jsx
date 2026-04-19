import React, { useState, useEffect } from 'react';
import { Smartphone, Wifi, Check, Copy, Shield, Zap } from 'lucide-react';
import Card from './ui/Card';

/**
 * WhatsAppSettings — Meta Cloud API Single Line Status
 * Clean, read-only display of the connected Meta WhatsApp Business line.
 */
const WhatsAppSettings = ({ showToast }) => {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const checkConnection = async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/whatsapp/meta-status');
                if (res.ok) {
                    const data = await res.json();
                    setStatus(data);
                }
            } catch (e) {
                setStatus({ connected: false, error: e.message });
            } finally {
                setLoading(false);
            }
        };
        checkConnection();
    }, []);

    const handleCopy = () => {
        navigator.clipboard.writeText(`${window.location.origin}/api/whatsapp/webhook`);
        setCopied(true);
        showToast?.('URL del webhook copiada', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card
            title="WhatsApp Business API"
            icon={Smartphone}
            actions={
                <span className="text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Shield className="w-3 h-3" /> API Oficial Meta
                </span>
            }
        >
            <div className="space-y-4">
                {/* Connection Status Card */}
                <div className={`
                    rounded-xl p-4 border smooth-transition
                    ${status?.connected
                        ? 'border-emerald-200 dark:border-emerald-800 bg-gradient-to-r from-emerald-50/50 to-white dark:from-emerald-950/20 dark:to-gray-800'
                        : loading
                            ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'
                            : 'border-red-200 dark:border-red-800 bg-gradient-to-r from-red-50/50 to-white dark:from-red-950/20 dark:to-gray-800'}
                `}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${
                                loading ? 'bg-gray-300 animate-pulse' :
                                status?.connected ? 'bg-emerald-500' : 'bg-red-500'
                            }`} />
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                        {status?.displayName || 'Candidatic IA'}
                                    </span>
                                    <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                        META CLOUD
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {loading ? (
                                        <span className="text-[11px] text-gray-400">Verificando conexión...</span>
                                    ) : status?.connected ? (
                                        <>
                                            <Wifi className="w-3 h-3 text-emerald-500" />
                                            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                                Conectada — {status?.phoneNumber || '+52 81 8085 9480'}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="text-[11px] text-red-500">Error de conexión</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {status?.connected && (
                            <div className="flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5 text-amber-500" />
                                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                    {status?.qualityRating === 'GREEN' ? '🟢 Calidad Alta' :
                                     status?.qualityRating === 'YELLOW' ? '🟡 Calidad Media' :
                                     status?.qualityRating === 'RED' ? '🔴 Calidad Baja' :
                                     '⚪ Sin calificación'}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Details grid */}
                    {status?.connected && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                            <div>
                                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Nombre Verificado</p>
                                <p className="text-xs text-gray-800 dark:text-white font-medium mt-0.5">{status?.verifiedName || '—'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Plataforma</p>
                                <p className="text-xs text-gray-800 dark:text-white font-medium mt-0.5">{status?.platformType || 'CLOUD_API'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Throughput</p>
                                <p className="text-xs text-gray-800 dark:text-white font-medium mt-0.5">{status?.throughput || 'STANDARD'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Verificación</p>
                                <p className="text-xs text-gray-800 dark:text-white font-medium mt-0.5">
                                    {status?.codeVerification === 'VERIFIED' ? '✅ Verificado' : status?.codeVerification || '—'}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Webhook URL */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            Webhook URL (configurado en Meta Dashboard):
                        </span>
                        <button
                            onClick={handleCopy}
                            className="text-[10px] text-blue-600 hover:text-blue-700 font-bold flex items-center space-x-1"
                        >
                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copied ? 'Copiado' : 'Copiar URL'}</span>
                        </button>
                    </div>
                    <code className="block w-full p-2 bg-gray-100 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-xs font-mono break-all text-gray-700 dark:text-gray-300">
                        {typeof window !== 'undefined' ? window.location.origin : 'https://candidatic-ia.vercel.app'}/api/whatsapp/webhook
                    </code>
                </div>

                {/* Info footer */}
                <div className="flex items-start gap-2 p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg border border-blue-100 dark:border-blue-900/30">
                    <Shield className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[11px] text-blue-800 dark:text-blue-300 font-medium">API Oficial de Meta WhatsApp Cloud</p>
                        <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5 leading-relaxed">
                            Conexión directa sin intermediarios. Sin riesgo de baneo, sin proxies, sin reconexión manual.
                            Administra tu número desde <a href="https://business.facebook.com" target="_blank" rel="noreferrer" className="underline">Meta Business Suite</a>.
                        </p>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default WhatsAppSettings;
