import React, { useState, useEffect } from 'react';
import { Smartphone, Wifi, Check, Copy, Shield, Zap, TrendingUp, DollarSign, MessageCircle, BarChart3 } from 'lucide-react';
import Card from './ui/Card';

/**
 * WhatsAppSettings — Meta Cloud API Status + Usage Analytics
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

    const analytics = status?.analytics;

    const qualityLabel = (q) =>
        q === 'GREEN' ? '🟢 Calidad Alta' :
        q === 'YELLOW' ? '🟡 Calidad Media' :
        q === 'RED' ? '🔴 Calidad Baja' : '⚪ Sin calificación';

    // Tarjeta de un número (loading / conectado / error). Un WABA puede tener varios.
    const numberCard = ({ n = null, loading: isLoading = false, key = 'card' }) => {
        const connected = !!n && !isLoading;
        return (
            <div key={key} className={`
                rounded-xl p-4 border smooth-transition
                ${connected
                    ? 'border-emerald-200 dark:border-emerald-800 bg-gradient-to-r from-emerald-50/50 to-white dark:from-emerald-950/20 dark:to-gray-800'
                    : isLoading
                        ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'
                        : 'border-red-200 dark:border-red-800 bg-gradient-to-r from-red-50/50 to-white dark:from-red-950/20 dark:to-gray-800'}
            `}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${
                            isLoading ? 'bg-gray-300 animate-pulse' :
                            connected ? 'bg-emerald-500' : 'bg-red-500'
                        }`} />
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                    {n?.verifiedName || 'Candidatic IA'}
                                </span>
                                <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                    META CLOUD
                                </span>
                                {n?.isPrimary && (
                                    <span className="text-[10px] font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded">
                                        PRINCIPAL
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                {isLoading ? (
                                    <span className="text-[11px] text-gray-400">Verificando conexión...</span>
                                ) : connected ? (
                                    <>
                                        <Wifi className="w-3 h-3 text-emerald-500" />
                                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                            Conectada — {n.phoneNumber}
                                        </span>
                                    </>
                                ) : (
                                    <span className="text-[11px] text-red-500">Error de conexión</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {connected && (
                        <div className="flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-amber-500" />
                            <span className="text-[10px] text-gray-500 dark:text-gray-400">{qualityLabel(n.qualityRating)}</span>
                        </div>
                    )}
                </div>

                {(connected || isLoading) && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                        <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Nombre Verificado</p>
                            {isLoading ? <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mt-1 animate-pulse"></div> : <p className="text-xs text-gray-800 dark:text-white font-medium mt-0.5">{n?.verifiedName || '—'}</p>}
                        </div>
                        <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Plataforma</p>
                            {isLoading ? <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 mt-1 animate-pulse"></div> : <p className="text-xs text-gray-800 dark:text-white font-medium mt-0.5">{n?.platformType || 'CLOUD_API'}</p>}
                        </div>
                        <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Throughput</p>
                            {isLoading ? <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 mt-1 animate-pulse"></div> : <p className="text-xs text-gray-800 dark:text-white font-medium mt-0.5">{n?.throughput || 'STANDARD'}</p>}
                        </div>
                        <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Verificación</p>
                            {isLoading ? <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mt-1 animate-pulse"></div> : <p className="text-xs text-gray-800 dark:text-white font-medium mt-0.5">
                                {n?.codeVerification === 'VERIFIED' ? '✅ Verificado' : n?.codeVerification || '—'}
                            </p>}
                        </div>
                    </div>
                )}
            </div>
        );
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
                {/* Connection Status — una tarjeta por número conectado al WABA */}
                {loading
                    ? numberCard({ loading: true, key: 'loading' })
                    : status?.connected
                        ? (status.numbers && status.numbers.length > 0
                            ? status.numbers
                            : [{
                                phoneNumber: status.phoneNumber,
                                verifiedName: status.verifiedName,
                                qualityRating: status.qualityRating,
                                platformType: status.platformType,
                                throughput: status.throughput,
                                codeVerification: status.codeVerification,
                                isPrimary: true
                            }]
                        ).map((n, i) => numberCard({ n, key: n.phoneNumberId || i }))
                        : numberCard({ key: 'error' })
                }

                {/* ====== USAGE ANALYTICS ====== */}
                {((status?.connected && analytics && !analytics.error) || loading) && (
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                        {/* Header */}
                        <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                <span className="text-xs font-bold text-gray-700 dark:text-gray-200">
                                    {loading ? 'Calculando consumo...' : `Consumo del Mes — ${analytics?.period}`}
                                </span>
                            </div>
                            <span className="text-[9px] font-semibold text-blue-500 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded-full">
                                PER-MESSAGE PRICING
                            </span>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-gray-100 dark:divide-gray-700">
                            {/* Total Sent */}
                            <div className="p-4 text-center">
                                <div className="flex items-center justify-center gap-1.5 mb-1">
                                    <MessageCircle className="w-3.5 h-3.5 text-blue-400" />
                                    <span className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider">Enviados</span>
                                </div>
                                {loading ? <div className="h-7 w-12 bg-gray-200 dark:bg-gray-700 rounded mx-auto mt-1 mb-1 animate-pulse"></div> : <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{analytics?.totalSent?.toLocaleString() || '0'}</p>}
                                <p className="text-[10px] text-blue-500/70 mt-0.5">mensajes</p>
                            </div>

                            {/* Delivered */}
                            <div className="p-4 text-center">
                                <div className="flex items-center justify-center gap-1.5 mb-1">
                                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                                    <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">Entregados</span>
                                </div>
                                {loading ? <div className="h-7 w-12 bg-gray-200 dark:bg-gray-700 rounded mx-auto mt-1 mb-1 animate-pulse"></div> : <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{analytics?.totalDelivered?.toLocaleString() || '0'}</p>}
                                <p className="text-[10px] text-emerald-500/70 mt-0.5">confirmados</p>
                            </div>

                            {/* Paid Templates */}
                            <div className="p-4 text-center">
                                <div className="flex items-center justify-center gap-1.5 mb-1">
                                    <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
                                    <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">Con Costo</span>
                                </div>
                                {loading ? <div className="h-7 w-12 bg-gray-200 dark:bg-gray-700 rounded mx-auto mt-1 mb-1 animate-pulse"></div> : <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{analytics?.paidMessages?.toLocaleString() || '0'}</p>}
                                <p className="text-[10px] text-amber-500/70 mt-0.5">mensajes</p>
                            </div>

                            {/* Cost */}
                            <div className="p-4 text-center">
                                <div className="flex items-center justify-center gap-1.5 mb-1">
                                    <DollarSign className="w-3.5 h-3.5 text-purple-500" />
                                    <span className="text-[10px] font-semibold text-purple-500 uppercase tracking-wider">Costo Real</span>
                                </div>
                                {loading ? <div className="h-7 w-16 bg-gray-200 dark:bg-gray-700 rounded mx-auto mt-1 mb-1 animate-pulse"></div> : <p className="text-xl font-bold text-purple-600 dark:text-purple-400">${analytics?.estimatedCostMXN?.toLocaleString() || '0'}</p>}
                                <p className="text-[10px] text-purple-500/70 mt-0.5">MXN (~${analytics?.estimatedCostUSD || '0'} USD)</p>
                            </div>
                        </div>


                    </div>
                )}

                {/* Analytics error */}
                {analytics?.error && (
                    <div className="rounded-lg p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-800/30">
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                            ⚠️ Analytics: {analytics.error}
                        </p>
                    </div>
                )}

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
