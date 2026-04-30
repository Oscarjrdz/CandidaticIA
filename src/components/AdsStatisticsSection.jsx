import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Users, Calendar, Megaphone, Loader2, Clock, Copy, ExternalLink, RefreshCw, Image, Video, DollarSign, Eye, MousePointerClick, Percent, MessageCircle, Heart, ArrowUpRight } from 'lucide-react';
import { getAdsStats } from '../services/adsService';

const AdsStatisticsSection = ({ showToast }) => {
    const [stats, setStats] = useState({ ads: [], totalAdsLeads: 0 });
    const [loading, setLoading] = useState(true);

    const loadStats = async () => {
        setLoading(true);
        const data = await getAdsStats();
        if (data.success) {
            setStats({ ads: data.ads || [], totalAdsLeads: data.totalAdsLeads || 0 });
        } else {
            showToast && showToast('Error al cargar estadísticas de Ads', 'error');
        }
        setLoading(false);
    };

    useEffect(() => { loadStats(); }, []);

    const todayLeadsTotal = stats.ads.reduce((acc, ad) => acc + (ad.todayLeads || 0), 0);
    const totalSpend = stats.ads.reduce((acc, ad) => acc + (parseFloat(ad.spend) || 0), 0);

    const formatId = (id) => !id ? '' : `${id.substring(0, 6)}…${id.substring(id.length - 4)}`;
    const copyToClipboard = (text) => { navigator.clipboard.writeText(text); showToast && showToast('Copiado', 'success'); };
    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Monterrey' });
    };
    const fmtMoney = (v) => v ? `$${Number(v).toFixed(2)}` : '-';
    const fmtNum = (v) => v ? Number(v).toLocaleString() : '-';
    const fmtPct = (v) => v ? `${Number(v).toFixed(2)}%` : '-';

    return (
        <div className="max-w-[1400px] mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                        <Target className="w-6 h-6 mr-3 text-indigo-500" />
                        Estadísticas de Meta Ads
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Rendimiento de campañas Click-to-WhatsApp</p>
                </div>
                <button onClick={loadStats} disabled={loading}
                    className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm disabled:opacity-50">
                    <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Actualizar
                </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white shadow-lg relative overflow-hidden">
                    <Users className="absolute top-3 right-3 w-10 h-10 opacity-15" />
                    <p className="text-indigo-100 font-medium text-xs mb-1">Candidatos por Ads</p>
                    <h2 className="text-3xl font-bold">{loading ? <Loader2 className="w-6 h-6 animate-spin" /> : stats.totalAdsLeads}</h2>
                </div>
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-1"><p className="text-gray-500 dark:text-gray-400 font-medium text-xs">Hoy</p><Calendar className="w-4 h-4 text-green-500" /></div>
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white">+{loading ? '-' : todayLeadsTotal}</h2>
                </div>
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-1"><p className="text-gray-500 dark:text-gray-400 font-medium text-xs">Gasto Total</p><DollarSign className="w-4 h-4 text-rose-500" /></div>
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{loading ? '-' : fmtMoney(totalSpend)}</h2>
                </div>
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-1"><p className="text-gray-500 dark:text-gray-400 font-medium text-xs">Anuncios</p><Megaphone className="w-4 h-4 text-orange-500" /></div>
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{loading ? '-' : stats.ads.length}</h2>
                </div>
            </div>

            {/* Ads Grid - 3 columns, phone-sized cards */}
            {loading ? (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-12 flex flex-col items-center justify-center text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
                    <p>Cargando atribuciones de Meta...</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {stats.ads.map((ad, idx) => (
                        <AdCard key={idx} ad={ad} formatId={formatId} copyToClipboard={copyToClipboard} formatDate={formatDate} fmtMoney={fmtMoney} fmtNum={fmtNum} fmtPct={fmtPct} />
                    ))}
                    {/* Placeholder slots for future ads */}
                    {stats.ads.length < 3 && Array.from({ length: 3 - stats.ads.length }).map((_, i) => (
                        <div key={`placeholder-${i}`} className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl flex flex-col items-center justify-center py-20 text-gray-300 dark:text-gray-600 bg-gray-50/50 dark:bg-gray-800/30">
                            <Megaphone className="w-10 h-10 mb-3 opacity-40" />
                            <p className="text-sm font-medium opacity-50">Próximo anuncio</p>
                            <p className="text-xs opacity-30 mt-1">Aparecerá aquí automáticamente</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── Ad Card Component (phone-sized, like a social feed) ───
const AdCard = ({ ad, formatId, copyToClipboard, formatDate, fmtMoney, fmtNum, fmtPct }) => {
    const hasInsights = ad.impressions || ad.spend;

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden hover:shadow-lg transition-shadow flex flex-col"
            style={{ maxWidth: '430px', margin: '0 auto', width: '100%' }}>
            
            {/* Header */}
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0">
                        <span className="text-white text-xs font-bold">f</span>
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">{ad.adHeadline}</h3>
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-0.5">
                            <span>{ad.adSource === 'ad' ? '📣 Anuncio' : '📝 Orgánico'}</span>
                            {ad.adId && (
                                <>
                                    <span>•</span>
                                    <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                        onClick={() => copyToClipboard(ad.adId)} title="Copiar ID">
                                        {formatId(ad.adId)} <Copy className="w-2 h-2 inline ml-0.5 opacity-50" />
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                {ad.adUrl && (
                    <a href={ad.adUrl} target="_blank" rel="noreferrer"
                        className="shrink-0 text-[10px] text-blue-500 hover:text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded-lg font-medium flex items-center gap-1">
                        FB <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                )}
            </div>

            {/* Body Text */}
            {ad.adBody && (
                <div className="px-4 pb-2">
                    <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed line-clamp-4">{ad.adBody}</p>
                </div>
            )}

            {/* Image */}
            {(ad.adImageUrl || ad.adVideoUrl) && (
                <div className="relative w-full bg-gray-100 dark:bg-gray-900" style={{ aspectRatio: '1/1', maxHeight: '400px' }}>
                    {ad.adMediaType === 'video' && ad.adVideoUrl ? (
                        <div className="w-full h-full flex items-center justify-center bg-black">
                            <Video className="w-12 h-12 text-white/40" />
                        </div>
                    ) : (
                        <img src={ad.adImageUrl} alt={ad.adHeadline}
                            className="w-full h-full object-cover"
                            onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }} />
                    )}
                </div>
            )}

            {/* Stats Section */}
            <div className="p-4 space-y-3 flex-1 flex flex-col">
                {/* Candidatos Row */}
                <div className="grid grid-cols-4 gap-2">
                    <MiniBox icon={<Users className="w-3 h-3" />} value={ad.totalLeads} label="Leads" gradient="from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20" textColor="text-indigo-600 dark:text-indigo-400" />
                    <MiniBox icon={<TrendingUp className="w-3 h-3" />} value={`+${ad.todayLeads}`} label="Hoy" gradient="from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20" textColor="text-green-600 dark:text-green-400" />
                    <MiniBox icon={<Calendar className="w-3 h-3" />} value={formatDate(ad.firstSeen)} label="1° Lead" gradient="from-gray-50 to-gray-50 dark:from-gray-700/30 dark:to-gray-700/30" textColor="text-gray-600 dark:text-gray-300" small />
                    <MiniBox icon={<Clock className="w-3 h-3" />} value={formatDate(ad.lastSeen)} label="Último" gradient="from-gray-50 to-gray-50 dark:from-gray-700/30 dark:to-gray-700/30" textColor="text-gray-600 dark:text-gray-300" small />
                </div>

                {/* Meta Insights */}
                {hasInsights && (
                    <>
                        <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                <ArrowUpRight className="w-3 h-3" /> Meta Ads
                            </p>
                            <div className="grid grid-cols-3 gap-1.5">
                                <MetricCell icon={<Eye className="w-3 h-3" />} value={fmtNum(ad.impressions)} label="Impresiones" color="text-blue-500" />
                                <MetricCell icon={<Users className="w-3 h-3" />} value={fmtNum(ad.reach)} label="Alcance" color="text-cyan-500" />
                                <MetricCell icon={<MousePointerClick className="w-3 h-3" />} value={fmtNum(ad.clicks)} label="Clics" color="text-amber-500" />
                                <MetricCell icon={<Percent className="w-3 h-3" />} value={fmtPct(ad.ctr)} label="CTR" color="text-violet-500" />
                                <MetricCell icon={<MessageCircle className="w-3 h-3" />} value={fmtNum(ad.messagingConnections)} label="Chats" color="text-green-500" />
                                <MetricCell icon={<Heart className="w-3 h-3" />} value={fmtNum(ad.reactions)} label="Reacciones" color="text-pink-500" />
                            </div>
                        </div>

                        {/* Cost Pills */}
                        <div className="flex flex-wrap gap-1.5 mt-auto">
                            {ad.spend && <Pill label="Gasto" value={fmtMoney(ad.spend)} className="bg-rose-50 dark:bg-rose-900/15 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-800/20" />}
                            {ad.cpc && <Pill label="CPC" value={fmtMoney(ad.cpc)} className="bg-amber-50 dark:bg-amber-900/15 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800/20" />}
                            {ad.cpm && <Pill label="CPM" value={fmtMoney(ad.cpm)} className="bg-blue-50 dark:bg-blue-900/15 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-800/20" />}
                            {ad.costPerConversation && <Pill label="$/Chat" value={fmtMoney(ad.costPerConversation)} className="bg-green-50 dark:bg-green-900/15 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800/20 ring-1 ring-green-300/50 dark:ring-green-700/50" />}
                            {ad.costPerLinkClick && <Pill label="$/Click" value={fmtMoney(ad.costPerLinkClick)} className="bg-violet-50 dark:bg-violet-900/15 text-violet-600 dark:text-violet-400 border-violet-100 dark:border-violet-800/20" />}
                            {ad.frequency && <Pill label="Freq" value={`${Number(ad.frequency).toFixed(1)}x`} className="bg-gray-50 dark:bg-gray-700/30 text-gray-600 dark:text-gray-400 border-gray-100 dark:border-gray-700" />}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// ─── Tiny Sub-components ───
const MiniBox = ({ icon, value, label, gradient, textColor, small }) => (
    <div className={`bg-gradient-to-br ${gradient} rounded-lg p-2 text-center border border-white/50 dark:border-gray-700/50`}>
        <div className={`${textColor} opacity-50 mx-auto mb-0.5`}>{icon}</div>
        <p className={`${small ? 'text-[10px]' : 'text-base'} font-black ${textColor} leading-tight`}>{value}</p>
        <p className="text-[8px] uppercase font-bold text-gray-400 tracking-wider mt-0.5">{label}</p>
    </div>
);

const MetricCell = ({ icon, value, label, color }) => (
    <div className="bg-gray-50/80 dark:bg-gray-700/20 rounded-lg p-2 text-center border border-gray-100/50 dark:border-gray-700/30">
        <div className={`${color} opacity-50 mx-auto mb-0.5`}>{icon}</div>
        <p className={`text-sm font-bold ${color} leading-tight`}>{value}</p>
        <p className="text-[7px] uppercase font-bold text-gray-400 tracking-wider mt-0.5">{label}</p>
    </div>
);

const Pill = ({ label, value, className }) => (
    <span className={`inline-flex items-center gap-1 ${className} px-2 py-1 rounded-md border text-[10px] font-medium`}>
        <span className="opacity-60">{label}:</span>
        <span className="font-bold">{value}</span>
    </span>
);

export default AdsStatisticsSection;
