import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Users, Calendar, Megaphone, ChevronRight, Loader2, ArrowUpRight, BarChart3, Clock, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { getAdsStats } from '../services/adsService';
import { formatRelativeDate } from '../utils/formatters';

const AdsStatisticsSection = ({ showToast }) => {
    const [stats, setStats] = useState({ ads: [], totalAdsLeads: 0 });
    const [loading, setLoading] = useState(true);
    const [selectedAd, setSelectedAd] = useState(null);

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

    const bestAd = stats.ads.length > 0 ? stats.ads[0] : null;
    const todayLeadsTotal = stats.ads.reduce((acc, ad) => acc + (ad.todayLeads || 0), 0);

    const formatId = (id) => {
        if (!id) return '';
        return `${id.substring(0, 5)}...${id.substring(id.length - 4)}`;
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        showToast && showToast('Copiado al portapapeles', 'success');
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
                <div className="flex space-x-2">
                    <a
                        href="/api/webhook-logs"
                        target="_blank"
                        className="flex items-center px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors shadow-sm text-sm font-medium"
                    >
                        Ver Logs del Webhook
                    </a>
                    <button
                        onClick={loadStats}
                        disabled={loading}
                        className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Actualizar
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-20 transform group-hover:scale-110 transition-transform duration-500">
                        <Users className="w-24 h-24" />
                    </div>
                    <div className="relative z-10">
                        <p className="text-indigo-100 font-medium mb-1">Candidatos Totales por Ads</p>
                        <h2 className="text-4xl font-bold mb-2">{loading ? <Loader2 className="w-8 h-8 animate-spin" /> : stats.totalAdsLeads}</h2>
                        <div className="flex items-center text-sm text-indigo-100">
                            <TrendingUp className="w-4 h-4 mr-1" />
                            <span>Tráfico atribuido por Meta API</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                    <div className="absolute top-4 right-4 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 p-2 rounded-xl">
                        <Calendar className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-gray-500 dark:text-gray-400 font-medium mb-1">Candidatos Hoy (Ads)</p>
                        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                            {loading ? '-' : `+${todayLeadsTotal}`}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Nuevas conversaciones en las últimas 24h
                        </p>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                    <div className="absolute top-4 right-4 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 p-2 rounded-xl">
                        <Megaphone className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-gray-500 dark:text-gray-400 font-medium mb-1">Anuncio Principal</p>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1 truncate pr-12" title={bestAd?.adHeadline || 'N/A'}>
                            {loading ? '-' : (bestAd ? bestAd.adHeadline : 'Sin datos')}
                        </h2>
                        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                            <BarChart3 className="w-4 h-4 mr-1 text-orange-500" />
                            <span>{bestAd ? `${bestAd.totalLeads} conversiones` : 'Esperando tráfico...'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Ads List */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                        <Megaphone className="w-5 h-5 mr-2 text-gray-400" />
                        Rendimiento por Anuncio
                    </h3>
                </div>
                
                {loading ? (
                    <div className="p-12 flex flex-col items-center justify-center text-gray-400">
                        <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
                        <p>Cargando atribuciones de Meta...</p>
                    </div>
                ) : stats.ads.length === 0 ? (
                    <div className="p-12 flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
                            <Target className="w-8 h-8 text-gray-400" />
                        </div>
                        <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Aún no hay conversiones registradas</h4>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md">
                            Los candidatos que ingresen a través de tus anuncios de "Click-to-WhatsApp" con la configuración de Atribución activa aparecerán aquí automáticamente.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                        {stats.ads.map((ad, idx) => (
                            <div key={idx} className="p-5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center space-x-3 mb-1">
                                        <h4 className="text-base font-bold text-gray-900 dark:text-white truncate" title={ad.adHeadline}>
                                            {ad.adHeadline}
                                        </h4>
                                        {ad.todayLeads > 0 && (
                                            <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs font-bold whitespace-nowrap">
                                                +{ad.todayLeads} hoy
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                                        {ad.adId && (
                                            <div className="flex items-center">
                                                <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{formatId(ad.adId)}</span>
                                                <button onClick={() => copyToClipboard(ad.adId)} className="ml-1 p-1 hover:text-gray-700 dark:hover:text-gray-200">
                                                    <Copy className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
                                        {ad.adUrl && (
                                            <a href={ad.adUrl} target="_blank" rel="noreferrer" className="flex items-center text-blue-500 hover:text-blue-600 transition-colors">
                                                Ver Origen <ExternalLink className="w-3 h-3 ml-1" />
                                            </a>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between md:justify-end gap-6">
                                    <div className="text-center">
                                        <p className="text-2xl font-black text-gray-900 dark:text-white">{ad.totalLeads}</p>
                                        <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Candidatos</p>
                                    </div>
                                    
                                    <button 
                                        onClick={() => setSelectedAd(selectedAd?.adId === ad.adId ? null : ad)}
                                        className="flex items-center px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl transition-colors text-sm font-medium"
                                    >
                                        Ver Leads
                                        <ChevronRight className={`w-4 h-4 ml-1 transform transition-transform ${selectedAd?.adId === ad.adId ? 'rotate-90' : ''}`} />
                                    </button>
                                </div>

                                {/* Expanded View */}
                                {selectedAd?.adId === ad.adId && ad.recentCandidates && ad.recentCandidates.length > 0 && (
                                    <div className="w-full mt-4 md:mt-0 md:col-span-full border-t border-gray-100 dark:border-gray-700 pt-4 animate-in slide-in-from-top-2 duration-200">
                                        <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Últimos Candidatos Capturados</h5>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {ad.recentCandidates.map(c => (
                                                <div key={c.id} className="flex items-center p-3 rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-colors">
                                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/50 dark:to-purple-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-sm shrink-0">
                                                        {c.nombre ? c.nombre.charAt(0).toUpperCase() : 'U'}
                                                    </div>
                                                    <div className="ml-3 min-w-0 flex-1">
                                                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={c.nombre}>{c.nombre || 'Desconocido'}</p>
                                                        <p className="text-xs text-gray-500 font-mono truncate">{c.whatsapp}</p>
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
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdsStatisticsSection;
