import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Users, Calendar, Megaphone, ChevronDown, ChevronUp, Loader2, Clock, Copy, ExternalLink, RefreshCw, Image, Video, User, DollarSign, Eye, MousePointerClick, Percent, AlertTriangle, MessageCircle, Heart, ArrowUpRight } from 'lucide-react';
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

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        showToast && showToast('Copiado', 'success');
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Monterrey' });
    };

    const fmtMoney = (v) => v ? `$${Number(v).toFixed(2)}` : '-';
    const fmtNum = (v) => v ? Number(v).toLocaleString() : '-';
    const fmtPct = (v) => v ? `${Number(v).toFixed(2)}%` : '-';

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                        <Target className="w-6 h-6 mr-3 text-indigo-500" />
                        Estadísticas de Meta Ads
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                        Rendimiento de campañas "Click-to-WhatsApp" y atribución de candidatos.
                    </p>
                </div>
                <button onClick={loadStats} disabled={loading}
                    className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm disabled:opacity-50">
                    <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Actualizar
                </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white shadow-lg relative overflow-hidden">
                    <Users className="absolute top-3 right-3 w-10 h-10 opacity-15" />
                    <p className="text-indigo-100 font-medium text-xs mb-1">Candidatos por Ads</p>
                    <h2 className="text-3xl font-bold">{loading ? <Loader2 className="w-6 h-6 animate-spin" /> : stats.totalAdsLeads}</h2>
                    <p className="text-[10px] text-indigo-200 mt-1">Total histórico</p>
                </div>
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-gray-500 dark:text-gray-400 font-medium text-xs">Hoy</p>
                        <Calendar className="w-4 h-4 text-green-500" />
                    </div>
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white">+{loading ? '-' : todayLeadsTotal}</h2>
                    <p className="text-[10px] text-gray-400 mt-1">Candidatos nuevos</p>
                </div>
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-gray-500 dark:text-gray-400 font-medium text-xs">Gasto Total</p>
                        <DollarSign className="w-4 h-4 text-rose-500" />
                    </div>
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{loading ? '-' : fmtMoney(totalSpend)}</h2>
                    <p className="text-[10px] text-gray-400 mt-1">MXN invertido</p>
                </div>
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-gray-500 dark:text-gray-400 font-medium text-xs">Anuncios</p>
                        <Megaphone className="w-4 h-4 text-orange-500" />
                    </div>
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{loading ? '-' : stats.ads.length}</h2>
                    <p className="text-[10px] text-gray-400 mt-1">Con tráfico</p>
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
                    <p className="text-gray-500 dark:text-gray-400 max-w-md text-sm">Los candidatos que ingresen a través de tus anuncios "Click-to-WhatsApp" aparecerán aquí.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {stats.ads.map((ad, idx) => {
                        const isExpanded = expandedAd === idx;
                        const hasInsights = ad.impressions || ad.spend;
                        return (
                            <div key={idx} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">

                                {/* Facebook Post Header */}
                                <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                                            <span className="text-white text-sm font-bold">f</span>
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-gray-900 dark:text-white leading-tight">{ad.adHeadline}</h3>
                                            <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                                                <span>{ad.adSource === 'ad' ? '📣 Anuncio' : '📝 Post orgánico'}</span>
                                                {ad.adId && (
                                                    <>
                                                        <span>•</span>
                                                        <span className="font-mono text-[10px] bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                                            onClick={() => copyToClipboard(ad.adId)} title="Copiar ID">
                                                            {formatId(ad.adId)} <Copy className="w-2.5 h-2.5 inline ml-0.5 opacity-50" />
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {ad.adUrl && (
                                        <a href={ad.adUrl} target="_blank" rel="noreferrer"
                                            className="shrink-0 flex items-center text-xs text-blue-500 hover:text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg transition-colors font-medium">
                                            Ver en FB <ExternalLink className="w-3 h-3 ml-1" />
                                        </a>
                                    )}
                                </div>

                                {/* Ad Body */}
                                {ad.adBody && (
                                    <div className="px-5 pb-3">
                                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed">{ad.adBody}</p>
                                    </div>
                                )}

                                {/* Image - Full width */}
                                {(ad.adImageUrl || ad.adVideoUrl) && (
                                    <div className="relative w-full bg-gray-100 dark:bg-gray-900">
                                        {ad.adMediaType === 'video' && ad.adVideoUrl ? (
                                            <div className="relative w-full h-[300px] sm:h-[400px] flex items-center justify-center bg-black">
                                                <Video className="w-16 h-16 text-white/40" />
                                            </div>
                                        ) : (
                                            <img src={ad.adImageUrl} alt={ad.adHeadline}
                                                className="w-full max-h-[450px] object-contain bg-black/5 dark:bg-black/20"
                                                onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }} />
                                        )}
                                    </div>
                                )}

                                <div className="p-5 space-y-4">
                                    {/* Candidatos Stats */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <StatCard icon={<Users className="w-4 h-4" />} value={ad.totalLeads} label="Candidatos" color="indigo" />
                                        <StatCard icon={<TrendingUp className="w-4 h-4" />} value={`+${ad.todayLeads}`} label="Hoy" color="green" />
                                        <StatCard icon={<Calendar className="w-4 h-4" />} value={formatDate(ad.firstSeen)} label="Primer Lead" color="gray" small />
                                        <StatCard icon={<Clock className="w-4 h-4" />} value={formatDate(ad.lastSeen)} label="Último Lead" color="gray" small />
                                    </div>

                                    {/* Meta Insights - Rendimiento */}
                                    {hasInsights && (
                                        <>
                                            <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                                    <ArrowUpRight className="w-3.5 h-3.5" /> Rendimiento Meta Ads
                                                </h4>
                                                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                                                    <MiniStat icon={<Eye className="w-3.5 h-3.5" />} value={fmtNum(ad.impressions)} label="Impresiones" color="blue" />
                                                    <MiniStat icon={<Users className="w-3.5 h-3.5" />} value={fmtNum(ad.reach)} label="Alcance" color="cyan" />
                                                    <MiniStat icon={<MousePointerClick className="w-3.5 h-3.5" />} value={fmtNum(ad.clicks)} label="Clics" color="amber" />
                                                    <MiniStat icon={<Percent className="w-3.5 h-3.5" />} value={fmtPct(ad.ctr)} label="CTR" color="violet" />
                                                    <MiniStat icon={<MessageCircle className="w-3.5 h-3.5" />} value={fmtNum(ad.messagingConnections)} label="Conversaciones" color="green" />
                                                    <MiniStat icon={<Heart className="w-3.5 h-3.5" />} value={fmtNum(ad.reactions)} label="Reacciones" color="pink" />
                                                </div>
                                            </div>

                                            {/* Costos */}
                                            <div className="flex flex-wrap gap-2">
                                                {ad.spend && <CostPill label="Gasto" value={fmtMoney(ad.spend)} color="rose" />}
                                                {ad.cpc && <CostPill label="CPC" value={fmtMoney(ad.cpc)} color="amber" />}
                                                {ad.cpm && <CostPill label="CPM" value={fmtMoney(ad.cpm)} color="blue" />}
                                                {ad.costPerConversation && <CostPill label="Costo/Conversación" value={fmtMoney(ad.costPerConversation)} color="green" highlight />}
                                                {ad.costPerLinkClick && <CostPill label="Costo/Click" value={fmtMoney(ad.costPerLinkClick)} color="violet" />}
                                                {ad.frequency && <CostPill label="Frecuencia" value={Number(ad.frequency).toFixed(1) + 'x'} color="gray" />}
                                            </div>
                                        </>
                                    )}

                                    {/* No insights */}
                                    {!hasInsights && (
                                        <div className="flex items-center gap-2 bg-amber-50/50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400 text-xs px-4 py-2.5 rounded-xl border border-amber-200/50 dark:border-amber-800/20">
                                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                            <span>Métricas de Meta Ads no disponibles. Requiere <strong>Marketing API</strong> con permiso <code className="bg-amber-100 dark:bg-amber-900/30 px-1 rounded">ads_read</code>.</span>
                                        </div>
                                    )}

                                    {/* Expand */}
                                    <button onClick={() => setExpandedAd(isExpanded ? null : idx)}
                                        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 bg-gray-50 dark:bg-gray-700/30 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-xl transition-all border border-gray-100 dark:border-gray-700">
                                        <User className="w-3.5 h-3.5" />
                                        {isExpanded ? 'Ocultar candidatos' : `Ver ${ad.recentCandidates?.length || 0} candidatos recientes`}
                                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </button>
                                </div>

                                {/* Expanded Candidates */}
                                {isExpanded && ad.recentCandidates?.length > 0 && (
                                    <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 p-5">
                                        <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                            <Users className="w-3.5 h-3.5" /> Últimos Candidatos
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
                                                    <p className="text-[10px] text-gray-400 flex items-center ml-2 shrink-0">
                                                        <Clock className="w-3 h-3 mr-0.5" />
                                                        {formatRelativeDate(c.fecha)}
                                                    </p>
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

// ─── Sub-components ───
const colorMap = {
    indigo: 'from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border-indigo-100/80 dark:border-indigo-800/30 text-indigo-600 dark:text-indigo-400',
    green: 'from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-100/80 dark:border-green-800/30 text-green-600 dark:text-green-400',
    gray: 'from-gray-50 to-gray-50 dark:from-gray-700/30 dark:to-gray-700/30 border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-300',
};

const StatCard = ({ icon, value, label, color, small }) => (
    <div className={`bg-gradient-to-br ${colorMap[color]} rounded-xl p-3.5 text-center border`}>
        <div className={`mx-auto mb-1 opacity-60`}>{icon}</div>
        <p className={`${small ? 'text-sm' : 'text-2xl'} font-black`}>{value}</p>
        <p className="text-[10px] uppercase font-bold opacity-50 tracking-wider mt-0.5">{label}</p>
    </div>
);

const miniColorMap = {
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-900/15 border-blue-100/50 dark:border-blue-800/20',
    cyan: 'text-cyan-600 dark:text-cyan-400 bg-cyan-50/60 dark:bg-cyan-900/15 border-cyan-100/50 dark:border-cyan-800/20',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-900/15 border-amber-100/50 dark:border-amber-800/20',
    violet: 'text-violet-600 dark:text-violet-400 bg-violet-50/60 dark:bg-violet-900/15 border-violet-100/50 dark:border-violet-800/20',
    green: 'text-green-600 dark:text-green-400 bg-green-50/60 dark:bg-green-900/15 border-green-100/50 dark:border-green-800/20',
    pink: 'text-pink-600 dark:text-pink-400 bg-pink-50/60 dark:bg-pink-900/15 border-pink-100/50 dark:border-pink-800/20',
};

const MiniStat = ({ icon, value, label, color }) => (
    <div className={`${miniColorMap[color]} rounded-lg p-2.5 text-center border`}>
        <div className="mx-auto mb-0.5 opacity-60">{icon}</div>
        <p className="text-base font-bold leading-tight">{value}</p>
        <p className="text-[9px] uppercase font-bold opacity-50 tracking-wider mt-0.5">{label}</p>
    </div>
);

const costPillColors = {
    rose: 'bg-rose-50 dark:bg-rose-900/15 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-800/20',
    amber: 'bg-amber-50 dark:bg-amber-900/15 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800/20',
    blue: 'bg-blue-50 dark:bg-blue-900/15 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-800/20',
    green: 'bg-green-50 dark:bg-green-900/15 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800/20',
    violet: 'bg-violet-50 dark:bg-violet-900/15 text-violet-600 dark:text-violet-400 border-violet-100 dark:border-violet-800/20',
    gray: 'bg-gray-50 dark:bg-gray-700/30 text-gray-600 dark:text-gray-400 border-gray-100 dark:border-gray-700',
};

const CostPill = ({ label, value, color, highlight }) => (
    <div className={`flex items-center gap-1.5 ${costPillColors[color]} px-3 py-1.5 rounded-lg border text-xs ${highlight ? 'ring-1 ring-green-300 dark:ring-green-700 font-bold' : ''}`}>
        <span className="opacity-70">{label}:</span>
        <span className="font-bold">{value}</span>
    </div>
);

export default AdsStatisticsSection;
