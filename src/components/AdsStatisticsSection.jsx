import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Users, Calendar, Megaphone, ChevronDown, ChevronUp, Loader2, BarChart3, Clock, Copy, ExternalLink, RefreshCw, Image, Video, User, DollarSign, Eye, MousePointerClick, Percent, AlertTriangle } from 'lucide-react';
import { getAdsStats } from '../services/adsService';
import { formatRelativeDate } from '../utils/formatters';

const AdsStatisticsSection = ({ showToast }) => {
    const [stats, setStats] = useState({ ads: [], totalAdsLeads: 0 });
    const [loading, setLoading] = useState(true);
    const [expandedAd, setExpandedAd] = useState(null);

    const loadStats = async () => {
        setLoading(true);
        const data = await getAdsStats();
        if (data.success) {
            setStats({
                ads: data.ads || [],
                totalAdsLeads: data.totalAdsLeads || 0
            });
        } else {
            showToast && showToast('Error al cargar estadísticas de Ads', 'error');
        }
        setLoading(false);
    };

    useEffect(() => {
        loadStats();
    }, []);

    const todayLeadsTotal = stats.ads.reduce((acc, ad) => acc + (ad.todayLeads || 0), 0);
    const activeAdsCount = stats.ads.length;

    const formatId = (id) => {
        if (!id) return '';
        return `${id.substring(0, 6)}…${id.substring(id.length - 4)}`;
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        showToast && showToast('Copiado al portapapeles', 'success');
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('es-MX', {
            day: '2-digit', month: 'short', year: 'numeric',
            timeZone: 'America/Monterrey'
        });
    };

    // Calculate cost per lead if we have spend data
    const calcCPL = (ad) => {
        if (!ad.spend || !ad.totalLeads) return null;
        return (parseFloat(ad.spend) / ad.totalLeads).toFixed(2);
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                        <Target className="w-6 h-6 mr-3 text-indigo-500" />
                        Estadísticas de Meta Ads
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                        Rendimiento de campañas "Click-to-WhatsApp" y atribución de candidatos.
                    </p>
                </div>
                <button
                    onClick={loadStats}
                    disabled={loading}
                    className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Actualizar
                </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-15 transform group-hover:scale-110 transition-transform duration-500">
                        <Users className="w-20 h-20" />
                    </div>
                    <div className="relative z-10">
                        <p className="text-indigo-100 font-medium text-sm mb-1">Candidatos por Ads</p>
                        <h2 className="text-4xl font-bold mb-1">{loading ? <Loader2 className="w-8 h-8 animate-spin" /> : stats.totalAdsLeads}</h2>
                        <p className="text-xs text-indigo-200">Total histórico atribuido por Meta</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                    <div className="absolute top-4 right-4 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 p-2 rounded-xl">
                        <Calendar className="w-5 h-5" />
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 font-medium text-sm mb-1">Candidatos Hoy</p>
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                        {loading ? '-' : `+${todayLeadsTotal}`}
                    </h2>
                    <p className="text-xs text-gray-400">Nuevos en las últimas 24h</p>
                </div>

                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                    <div className="absolute top-4 right-4 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 p-2 rounded-xl">
                        <Megaphone className="w-5 h-5" />
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 font-medium text-sm mb-1">Anuncios Activos</p>
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                        {loading ? '-' : activeAdsCount}
                    </h2>
                    <p className="text-xs text-gray-400">Con tráfico registrado</p>
                </div>
            </div>

            {/* Ads Cards */}
            {loading ? (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-12 flex flex-col items-center justify-center text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
                    <p>Cargando atribuciones de Meta...</p>
                </div>
            ) : stats.ads.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-12 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
                        <Target className="w-8 h-8 text-gray-400" />
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Aún no hay conversiones registradas</h4>
                    <p className="text-gray-500 dark:text-gray-400 max-w-md text-sm">
                        Los candidatos que ingresen a través de tus anuncios "Click-to-WhatsApp" aparecerán aquí.
                    </p>
                </div>
            ) : (
                <div className="space-y-6">
                    {stats.ads.map((ad, idx) => {
                        const isExpanded = expandedAd === idx;
                        const cpl = calcCPL(ad);
                        return (
                            <div key={idx} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                                
                                {/* Facebook Post Header */}
                                <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                                            <span className="text-white text-sm font-bold">f</span>
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-gray-900 dark:text-white leading-tight">
                                                {ad.adHeadline}
                                            </h3>
                                            <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                                                <span>{ad.adSource === 'ad' ? '📣 Anuncio pagado' : '📝 Post orgánico'}</span>
                                                {ad.adId && (
                                                    <>
                                                        <span>•</span>
                                                        <span className="font-mono text-[10px] bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                                            onClick={() => copyToClipboard(ad.adId)}
                                                            title="Copiar ID completo"
                                                        >
                                                            {formatId(ad.adId)} <Copy className="w-2.5 h-2.5 inline ml-0.5 opacity-50" />
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {ad.adUrl && (
                                        <a href={ad.adUrl} target="_blank" rel="noreferrer"
                                            className="shrink-0 flex items-center text-xs text-blue-500 hover:text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg transition-colors font-medium"
                                        >
                                            Ver en FB <ExternalLink className="w-3 h-3 ml-1" />
                                        </a>
                                    )}
                                </div>

                                {/* Ad Body Text */}
                                {ad.adBody && (
                                    <div className="px-5 pb-3">
                                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed">
                                            {ad.adBody}
                                        </p>
                                    </div>
                                )}

                                {/* Image - Full width like a Facebook post */}
                                {(ad.adImageUrl || ad.adVideoUrl) && (
                                    <div className="relative w-full bg-gray-100 dark:bg-gray-900">
                                        {ad.adMediaType === 'video' && ad.adVideoUrl ? (
                                            <div className="relative w-full h-[300px] sm:h-[400px] flex items-center justify-center bg-black">
                                                <Video className="w-16 h-16 text-white/40" />
                                                <span className="absolute bottom-3 left-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-lg backdrop-blur-sm">Video Ad</span>
                                            </div>
                                        ) : (
                                            <img
                                                src={ad.adImageUrl}
                                                alt={ad.adHeadline}
                                                className="w-full max-h-[450px] object-contain bg-black/5 dark:bg-black/20"
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.style.display = 'none';
                                                }}
                                            />
                                        )}
                                    </div>
                                )}

                                {/* Stats Grid */}
                                <div className="p-5">
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                                        {/* Candidatos */}
                                        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl p-3.5 text-center border border-indigo-100/80 dark:border-indigo-800/30">
                                            <Users className="w-4 h-4 text-indigo-400 mx-auto mb-1" />
                                            <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{ad.totalLeads}</p>
                                            <p className="text-[10px] uppercase font-bold text-indigo-400 dark:text-indigo-500 tracking-wider mt-0.5">Candidatos</p>
                                        </div>
                                        {/* Hoy */}
                                        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-3.5 text-center border border-green-100/80 dark:border-green-800/30">
                                            <TrendingUp className="w-4 h-4 text-green-400 mx-auto mb-1" />
                                            <p className="text-2xl font-black text-green-600 dark:text-green-400">+{ad.todayLeads}</p>
                                            <p className="text-[10px] uppercase font-bold text-green-400 dark:text-green-500 tracking-wider mt-0.5">Hoy</p>
                                        </div>
                                        {/* Primer Lead */}
                                        <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3.5 text-center border border-gray-100 dark:border-gray-700">
                                            <Calendar className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                                            <p className="text-sm font-bold text-gray-700 dark:text-gray-300">{formatDate(ad.firstSeen)}</p>
                                            <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mt-0.5">Primer Lead</p>
                                        </div>
                                        {/* Último Lead */}
                                        <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3.5 text-center border border-gray-100 dark:border-gray-700">
                                            <Clock className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                                            <p className="text-sm font-bold text-gray-700 dark:text-gray-300">{formatDate(ad.lastSeen)}</p>
                                            <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mt-0.5">Último Lead</p>
                                        </div>
                                    </div>

                                    {/* Meta Ads Insights (if available) */}
                                    {(ad.impressions || ad.spend || ad.clicks) && (
                                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                                            {ad.impressions && (
                                                <div className="bg-blue-50/50 dark:bg-blue-900/10 rounded-xl p-3 text-center border border-blue-100/50 dark:border-blue-800/20">
                                                    <Eye className="w-3.5 h-3.5 text-blue-400 mx-auto mb-0.5" />
                                                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{Number(ad.impressions).toLocaleString()}</p>
                                                    <p className="text-[9px] uppercase font-bold text-blue-400 tracking-wider">Impresiones</p>
                                                </div>
                                            )}
                                            {ad.reach && (
                                                <div className="bg-cyan-50/50 dark:bg-cyan-900/10 rounded-xl p-3 text-center border border-cyan-100/50 dark:border-cyan-800/20">
                                                    <Users className="w-3.5 h-3.5 text-cyan-400 mx-auto mb-0.5" />
                                                    <p className="text-lg font-bold text-cyan-600 dark:text-cyan-400">{Number(ad.reach).toLocaleString()}</p>
                                                    <p className="text-[9px] uppercase font-bold text-cyan-400 tracking-wider">Alcance</p>
                                                </div>
                                            )}
                                            {ad.clicks && (
                                                <div className="bg-amber-50/50 dark:bg-amber-900/10 rounded-xl p-3 text-center border border-amber-100/50 dark:border-amber-800/20">
                                                    <MousePointerClick className="w-3.5 h-3.5 text-amber-400 mx-auto mb-0.5" />
                                                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{Number(ad.clicks).toLocaleString()}</p>
                                                    <p className="text-[9px] uppercase font-bold text-amber-400 tracking-wider">Clics</p>
                                                </div>
                                            )}
                                            {ad.spend && (
                                                <div className="bg-rose-50/50 dark:bg-rose-900/10 rounded-xl p-3 text-center border border-rose-100/50 dark:border-rose-800/20">
                                                    <DollarSign className="w-3.5 h-3.5 text-rose-400 mx-auto mb-0.5" />
                                                    <p className="text-lg font-bold text-rose-600 dark:text-rose-400">${Number(ad.spend).toLocaleString()}</p>
                                                    <p className="text-[9px] uppercase font-bold text-rose-400 tracking-wider">Gasto</p>
                                                </div>
                                            )}
                                            {ad.ctr && (
                                                <div className="bg-violet-50/50 dark:bg-violet-900/10 rounded-xl p-3 text-center border border-violet-100/50 dark:border-violet-800/20">
                                                    <Percent className="w-3.5 h-3.5 text-violet-400 mx-auto mb-0.5" />
                                                    <p className="text-lg font-bold text-violet-600 dark:text-violet-400">{Number(ad.ctr).toFixed(2)}%</p>
                                                    <p className="text-[9px] uppercase font-bold text-violet-400 tracking-wider">CTR</p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Extra Meta Insights Row: CPC, CPM, CPL */}
                                    {(ad.cpc || ad.cpm || cpl) && (
                                        <div className="flex flex-wrap gap-3 mb-4 text-xs">
                                            {ad.cpc && (
                                                <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700/40 px-3 py-1.5 rounded-lg border border-gray-100 dark:border-gray-700">
                                                    <MousePointerClick className="w-3 h-3 text-gray-400" />
                                                    <span className="text-gray-500 dark:text-gray-400">CPC:</span>
                                                    <span className="font-bold text-gray-700 dark:text-gray-200">${Number(ad.cpc).toFixed(2)}</span>
                                                </div>
                                            )}
                                            {ad.cpm && (
                                                <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700/40 px-3 py-1.5 rounded-lg border border-gray-100 dark:border-gray-700">
                                                    <Eye className="w-3 h-3 text-gray-400" />
                                                    <span className="text-gray-500 dark:text-gray-400">CPM:</span>
                                                    <span className="font-bold text-gray-700 dark:text-gray-200">${Number(ad.cpm).toFixed(2)}</span>
                                                </div>
                                            )}
                                            {cpl && (
                                                <div className="flex items-center gap-1.5 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-lg border border-green-100 dark:border-green-800/30">
                                                    <DollarSign className="w-3 h-3 text-green-500" />
                                                    <span className="text-green-600 dark:text-green-400">CPL:</span>
                                                    <span className="font-bold text-green-700 dark:text-green-300">${cpl}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* No insights banner */}
                                    {!ad.impressions && !ad.spend && (
                                        <div className="flex items-center gap-2 bg-amber-50/50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400 text-xs px-4 py-2.5 rounded-xl border border-amber-200/50 dark:border-amber-800/20 mb-4">
                                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                            <span>Métricas de rendimiento (impresiones, clics, gasto, CTR) no disponibles. Requiere conectar la <strong>Marketing API</strong> de Meta con permisos <code className="bg-amber-100 dark:bg-amber-900/30 px-1 rounded">ads_read</code>.</span>
                                        </div>
                                    )}

                                    {/* Expand/Collapse Button */}
                                    <button
                                        onClick={() => setExpandedAd(isExpanded ? null : idx)}
                                        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 bg-gray-50 dark:bg-gray-700/30 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-xl transition-all border border-gray-100 dark:border-gray-700"
                                    >
                                        <User className="w-3.5 h-3.5" />
                                        {isExpanded ? 'Ocultar candidatos' : `Ver ${ad.recentCandidates?.length || 0} candidatos recientes`}
                                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </button>
                                </div>

                                {/* Expanded Candidates List */}
                                {isExpanded && ad.recentCandidates && ad.recentCandidates.length > 0 && (
                                    <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 p-5 animate-in slide-in-from-top-2 duration-200">
                                        <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                            <Users className="w-3.5 h-3.5" />
                                            Últimos Candidatos Capturados
                                        </h5>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {ad.recentCandidates.map(c => (
                                                <div key={c.id} className="flex items-center p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-all hover:shadow-sm">
                                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm">
                                                        {c.nombre ? c.nombre.charAt(0).toUpperCase() : 'U'}
                                                    </div>
                                                    <div className="ml-3 min-w-0 flex-1">
                                                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{c.nombre || 'Desconocido'}</p>
                                                        <p className="text-xs text-gray-400 font-mono truncate">{c.whatsapp}</p>
                                                    </div>
                                                    <div className="text-right ml-2 shrink-0">
                                                        <p className="text-[10px] text-gray-400 flex items-center justify-end">
                                                            <Clock className="w-3 h-3 mr-0.5" />
                                                            {formatRelativeDate(c.fecha)}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default AdsStatisticsSection;
