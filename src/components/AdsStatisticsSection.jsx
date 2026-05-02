import React, { useState, useEffect, useCallback } from 'react';
import { Target, TrendingUp, Users, Calendar, Megaphone, Loader2, Clock, Copy, ExternalLink, RefreshCw, Video, DollarSign, Eye, MousePointerClick, Percent, MessageCircle, Heart, ArrowUpRight, Trash2, X, Send, MessageSquare, ChevronDown, ChevronUp, CornerDownRight } from 'lucide-react';
import { useConfirmModal } from './ui/ConfirmModal';
import { getAdsStats } from '../services/adsService';
import { useToastContext } from '../contexts/ToastContext';

/* ─── Skeleton Components ─────────────────────────────────────────────── */
const Shimmer = ({ className = '' }) => (
    <div className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className}`} />
);

const KpiSkeleton = ({ accent = false }) => (
    <div className={`${accent ? 'bg-gradient-to-br from-indigo-500/80 to-purple-600/80' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700'} rounded-xl p-3 shadow-sm`}>
        <div className={`h-2.5 w-14 rounded ${accent ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'} mb-2`} />
        <div className={`h-7 w-20 rounded ${accent ? 'bg-white/25' : 'bg-gray-200 dark:bg-gray-700'} animate-pulse`} />
    </div>
);

const AdCardSkeleton = () => (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden"
         style={{ maxWidth:'420px', margin:'0 auto', width:'100%' }}>
        {/* Header */}
        <div className="px-3 pt-3 pb-1.5 flex items-center gap-2">
            <Shimmer className="w-8 h-8 rounded-full shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
                <Shimmer className="h-3 w-3/4 rounded" />
                <Shimmer className="h-2 w-1/2 rounded" />
            </div>
            <Shimmer className="w-10 h-4 rounded shrink-0" />
        </div>
        {/* Body text */}
        <div className="px-3 pb-1.5 space-y-1">
            <Shimmer className="h-2 w-full rounded" />
            <Shimmer className="h-2 w-5/6 rounded" />
            <Shimmer className="h-2 w-2/3 rounded" />
        </div>
        {/* Image area */}
        <div className="w-full bg-gray-100 dark:bg-gray-900 animate-pulse" style={{ height: '200px' }} />
        {/* Stats */}
        <div className="px-3 py-2.5 space-y-2">
            <div className="flex gap-1.5">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex-1 bg-gray-50 dark:bg-gray-700/30 rounded-lg py-2.5 flex flex-col items-center gap-1">
                        <Shimmer className="h-3 w-8 rounded" />
                        <Shimmer className="h-1.5 w-6 rounded" />
                    </div>
                ))}
            </div>
            <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
                <div className="grid grid-cols-6 gap-1 text-center mb-1.5">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="flex flex-col items-center gap-0.5">
                            <Shimmer className="h-2.5 w-7 rounded" />
                            <Shimmer className="h-1 w-5 rounded" />
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap gap-1">
                    {[...Array(5)].map((_, i) => (
                        <Shimmer key={i} className="h-4 w-16 rounded" />
                    ))}
                </div>
            </div>
        </div>
    </div>
);

/* ─── Comments Modal ──────────────────────────────────────────────────── */
const CommentsModal = ({ ad, onClose, showToast }) => {
    const [comments, setComments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [replyingTo, setReplyingTo] = useState(null);
    const [replyText, setReplyText] = useState('');
    const [sending, setSending] = useState(false);
    const [expandedReplies, setExpandedReplies] = useState(new Set());

    useEffect(() => {
        if (!ad?.adId) return;
        fetchComments();
    }, [ad?.adId]);

    const fetchComments = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/ads-comments?adId=${ad.adId}`);
            const data = await res.json();
            if (data.success) {
                setComments(data.comments || []);
            } else {
                showToast?.(data.error || 'Error al cargar comentarios', 'error');
            }
        } catch (e) {
            showToast?.('Error de red', 'error');
        }
        setLoading(false);
    };

    const handleReply = async (commentId) => {
        if (!replyText.trim()) return;
        setSending(true);
        try {
            const res = await fetch('/api/ads-comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commentId, message: replyText.trim() })
            });
            const data = await res.json();
            if (data.success) {
                showToast?.('Respuesta enviada ✅', 'success');
                setReplyText('');
                setReplyingTo(null);
                fetchComments();
            } else {
                showToast?.(data.error || 'Error al responder', 'error');
            }
        } catch (e) {
            showToast?.('Error de red', 'error');
        }
        setSending(false);
    };

    const toggleReplies = (commentId) => {
        setExpandedReplies(prev => {
            const next = new Set(prev);
            if (next.has(commentId)) next.delete(commentId);
            else next.add(commentId);
            return next;
        });
    };

    const timeAgo = (dateStr) => {
        if (!dateStr) return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h`;
        const days = Math.floor(hrs / 24);
        return `${days}d`;
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                 onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0">
                            <MessageSquare className="w-4 h-4 text-white" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">
                                Comentarios
                            </h3>
                            <p className="text-[10px] text-gray-400 truncate">{ad.adHeadline}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                        <X className="w-4 h-4 text-gray-500" />
                    </button>
                </div>

                {/* Comments List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                            <p className="text-xs text-gray-400">Cargando comentarios...</p>
                        </div>
                    ) : comments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
                            <MessageCircle className="w-10 h-10 opacity-30" />
                            <p className="text-sm font-medium">Sin comentarios aún</p>
                            <p className="text-xs opacity-60">Los comentarios del post aparecerán aquí</p>
                        </div>
                    ) : (
                        comments.map(comment => (
                            <div key={comment.id} className="space-y-1.5">
                                {/* Main Comment */}
                                <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-3">
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5">
                                            {(comment.from?.name || '?').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-gray-900 dark:text-white">
                                                    {comment.from?.name || 'Usuario'}
                                                </span>
                                                <span className="text-[9px] text-gray-400">
                                                    {timeAgo(comment.createdTime)}
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-gray-700 dark:text-gray-300 mt-0.5 leading-relaxed break-words">
                                                {comment.message}
                                            </p>
                                            {/* Attachment */}
                                            {comment.attachment?.media?.image?.src && (
                                                <img src={comment.attachment.media.image.src} alt="" className="mt-2 max-w-[180px] rounded-lg shadow-sm" />
                                            )}
                                            {/* Actions */}
                                            <div className="flex items-center gap-3 mt-1.5">
                                                {comment.likeCount > 0 && (
                                                    <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
                                                        <Heart className="w-2.5 h-2.5" /> {comment.likeCount}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => { setReplyingTo(replyingTo === comment.id ? null : comment.id); setReplyText(''); }}
                                                    className="text-[10px] font-semibold text-blue-500 hover:text-blue-600 transition-colors"
                                                >
                                                    Responder
                                                </button>
                                                {comment.replyCount > 0 && (
                                                    <button
                                                        onClick={() => toggleReplies(comment.id)}
                                                        className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-0.5 transition-colors"
                                                    >
                                                        {expandedReplies.has(comment.id) ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                                                        {comment.replyCount} respuesta{comment.replyCount !== 1 ? 's' : ''}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Replies */}
                                {expandedReplies.has(comment.id) && comment.replies?.length > 0 && (
                                    <div className="ml-6 space-y-1.5">
                                        {comment.replies.map(reply => (
                                            <div key={reply.id} className="bg-blue-50/50 dark:bg-blue-900/10 rounded-lg p-2.5 border-l-2 border-blue-300 dark:border-blue-700">
                                                <div className="flex items-start gap-2">
                                                    <CornerDownRight className="w-3 h-3 text-blue-400 shrink-0 mt-0.5" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-bold text-gray-800 dark:text-gray-200">
                                                                {reply.from?.name || 'Usuario'}
                                                            </span>
                                                            <span className="text-[8px] text-gray-400">{timeAgo(reply.createdTime)}</span>
                                                        </div>
                                                        <p className="text-[10px] text-gray-600 dark:text-gray-400 mt-0.5 break-words">
                                                            {reply.message}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Reply Input */}
                                {replyingTo === comment.id && (
                                    <div className="ml-6 flex gap-2 items-end animate-in fade-in slide-in-from-top-2 duration-200">
                                        <input
                                            type="text"
                                            value={replyText}
                                            onChange={e => setReplyText(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleReply(comment.id)}
                                            placeholder="Escribe tu respuesta..."
                                            className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                            autoFocus
                                        />
                                        <button
                                            onClick={() => handleReply(comment.id)}
                                            disabled={!replyText.trim() || sending}
                                            className="p-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                                        >
                                            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

/* ─── Main Component ──────────────────────────────────────────────────── */
const AdsStatisticsSection = () => {
    const { showToast } = useToastContext();
    const [stats, setStats] = useState({ ads: [], totalAdsLeads: 0 });
    const [loading, setLoading] = useState(true);
    const [commentsAd, setCommentsAd] = useState(null);
    const { confirmModalJSX, showConfirm } = useConfirmModal();

    const loadStats = async () => {
        setLoading(true);
        const data = await getAdsStats();
        if (data.success) setStats({ ads: data.ads || [], totalAdsLeads: data.totalAdsLeads || 0 });
        else showToast?.('Error al cargar estadísticas', 'error');
        setLoading(false);
    };

    useEffect(() => { loadStats(); }, []);

    const handleHideAd = async (ad) => {
        const adKey = ad.adId || ad.adHeadline || 'unknown';
        const adName = ad.adHeadline || ad.adName || 'este anuncio';

        const ok = await showConfirm({
            title: 'Ocultar Anuncio',
            message: `¿Seguro que quieres ocultar "${adName}" del dashboard? Sus ${ad.totalLeads || 0} leads seguirán en la base de datos pero el anuncio ya no aparecerá aquí.`,
            confirmText: 'Ocultar',
            variant: 'warning'
        });
        if (!ok) return;

        try {
            const res = await fetch('/api/ads-stats', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adKey })
            });
            const data = await res.json();
            if (data.success) {
                // Optimistic removal
                setStats(prev => ({
                    ...prev,
                    ads: prev.ads.filter(a => (a.adId || a.adHeadline || 'unknown') !== adKey),
                    totalAdsLeads: Math.max(0, prev.totalAdsLeads - (ad.totalLeads || 0))
                }));
                showToast?.('Anuncio ocultado', 'success');
            } else {
                showToast?.(data.error || 'Error al ocultar', 'error');
            }
        } catch (e) {
            showToast?.('Error de red', 'error');
        }
    };

    const todayLeadsTotal = stats.ads.reduce((a, ad) => a + (ad.todayLeads || 0), 0);
    const totalSpend = stats.ads.reduce((a, ad) => a + (parseFloat(ad.spend) || 0), 0);
    const fId = (id) => !id ? '' : `${id.slice(0,5)}…${id.slice(-4)}`;
    const cp = (t) => { navigator.clipboard.writeText(t); showToast?.('Copiado', 'success'); };
    const fD = (d) => !d ? '-' : new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'short', timeZone:'America/Monterrey' });
    const f$ = (v) => v ? `$${Number(v).toFixed(2)}` : '-';
    const fN = (v) => v ? Number(v).toLocaleString() : '-';
    const fP = (v) => v ? `${Number(v).toFixed(1)}%` : '-';

    return (
        <div className="max-w-[1400px] mx-auto space-y-5">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Target className="w-5 h-5 text-indigo-500" /> Estadísticas Meta Ads
                    </h1>
                    <p className="text-gray-400 text-xs mt-0.5">Campañas Click-to-WhatsApp</p>
                </div>
                <button onClick={loadStats} disabled={loading}
                    className="flex items-center px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm disabled:opacity-50">
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
                </button>
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-4 gap-3">
                {loading ? (
                    <>
                        <KpiSkeleton accent />
                        <KpiSkeleton />
                        <KpiSkeleton />
                        <KpiSkeleton />
                    </>
                ) : (
                    <>
                        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-3 text-white shadow-md">
                            <p className="text-[10px] text-indigo-200 font-medium">Leads Ads</p>
                            <p className="text-2xl font-bold">{stats.totalAdsLeads}</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
                            <p className="text-[10px] text-gray-400 font-medium">Hoy</p>
                            <p className="text-2xl font-bold text-green-600 dark:text-green-400">+{todayLeadsTotal}</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
                            <p className="text-[10px] text-gray-400 font-medium">Gasto</p>
                            <p className="text-2xl font-bold text-gray-900 dark:text-white">{f$(totalSpend)}</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
                            <p className="text-[10px] text-gray-400 font-medium">Anuncios</p>
                            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.ads.length}</p>
                        </div>
                    </>
                )}
            </div>

            {/* Cards Grid */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <AdCardSkeleton />
                    <AdCardSkeleton />
                    <AdCardSkeleton />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {stats.ads.map((ad, i) => {
                        const has = ad.impressions || ad.spend;
                        return (
                            <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden hover:shadow-lg transition-shadow group/card relative"
                                style={{ maxWidth:'420px', margin:'0 auto', width:'100%' }}>
                                
                                {/* Header */}
                                <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0">
                                            <span className="text-white text-[10px] font-bold">f</span>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold text-gray-900 dark:text-white truncate leading-tight">{ad.adHeadline}</p>
                                            <div className="flex items-center gap-1 text-[9px] text-gray-400">
                                                <span>{ad.adSource === 'ad' ? '📣' : '📝'}</span>
                                                {ad.effectiveStatus && <StatusBadge status={ad.effectiveStatus} />}
                                                {ad.adId && (
                                                    <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600"
                                                        onClick={() => cp(ad.adId)}>{fId(ad.adId)}<Copy className="w-2 h-2 inline ml-0.5 opacity-40" /></span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {/* Delete button — visible on hover */}
                                        <button
                                            onClick={() => handleHideAd(ad)}
                                            className="p-1.5 rounded-lg opacity-0 group-hover/card:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-all duration-200"
                                            title="Ocultar anuncio"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                        {ad.adUrl && (
                                            <a href={ad.adUrl} target="_blank" rel="noreferrer" className="text-[9px] text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                                                FB<ExternalLink className="w-2.5 h-2.5" />
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {/* Body - max 2 lines */}
                                {ad.adBody && (
                                    <p className="px-3 pb-1.5 text-[11px] text-gray-600 dark:text-gray-400 leading-snug whitespace-pre-line">{ad.adBody}</p>
                                )}

                                {/* Image - contained, smaller */}
                                {(ad.adImageUrl || ad.adVideoUrl) && (
                                    <div className="w-full bg-gray-50 dark:bg-gray-900 flex items-center justify-center" style={{ height: '200px' }}>
                                        {ad.adMediaType === 'video' && ad.adVideoUrl ? (
                                            <Video className="w-10 h-10 text-gray-300" />
                                        ) : (
                                            <img src={ad.adImageUrl} alt="" className="max-w-full max-h-full object-contain"
                                                onError={(e) => { e.target.onerror = null; e.target.style.display='none'; }} />
                                        )}
                                    </div>
                                )}

                                {/* Compact Stats */}
                                <div className="px-3 py-2.5 space-y-2">
                                    {/* Lead stats - single row */}
                                    <div className="flex gap-1.5">
                                        <div className="flex-1 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg py-1.5 text-center">
                                            <p className="text-sm font-black text-indigo-600 dark:text-indigo-400 leading-none">{ad.totalLeads}</p>
                                            <p className="text-[7px] uppercase font-bold text-indigo-400 mt-0.5">Leads</p>
                                        </div>
                                        <div className="flex-1 bg-green-50 dark:bg-green-900/20 rounded-lg py-1.5 text-center">
                                            <p className="text-sm font-black text-green-600 dark:text-green-400 leading-none">+{ad.todayLeads}</p>
                                            <p className="text-[7px] uppercase font-bold text-green-400 mt-0.5">Hoy</p>
                                        </div>
                                        <div className="flex-1 bg-gray-50 dark:bg-gray-700/30 rounded-lg py-1.5 text-center">
                                            <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 leading-none">{fD(ad.firstSeen)}</p>
                                            <p className="text-[7px] uppercase font-bold text-gray-400 mt-0.5">1° Lead</p>
                                        </div>
                                        <div className="flex-1 bg-gray-50 dark:bg-gray-700/30 rounded-lg py-1.5 text-center">
                                            <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 leading-none">{fD(ad.lastSeen)}</p>
                                            <p className="text-[7px] uppercase font-bold text-gray-400 mt-0.5">Último</p>
                                        </div>
                                    </div>

                                    {/* Meta insights - compact 2 rows */}
                                    {has && (
                                        <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
                                            <div className="grid grid-cols-6 gap-1 text-center mb-1.5">
                                                <C v={fN(ad.impressions)} l="Impr" c="text-blue-500" />
                                                <C v={fN(ad.reach)} l="Alc" c="text-cyan-500" />
                                                <C v={fN(ad.clicks)} l="Clics" c="text-amber-500" />
                                                <C v={fP(ad.ctr)} l="CTR" c="text-violet-500" />
                                                <C v={fN(ad.messagingConnections)} l="Chats" c="text-green-500" />
                                                <C v={fN(ad.reactions)} l="React" c="text-pink-500" />
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                {ad.spend && <T l="Gasto" v={f$(ad.spend)} />}
                                                {ad.cpc && <T l="CPC" v={f$(ad.cpc)} />}
                                                {ad.cpm && <T l="CPM" v={f$(ad.cpm)} />}
                                                {ad.costPerConversation && <T l="$/Chat" v={f$(ad.costPerConversation)} hl />}
                                                {ad.frequency && <T l="Freq" v={`${Number(ad.frequency).toFixed(1)}x`} />}
                                            </div>
                                        </div>
                                    )}

                                    {/* Comments Button */}
                                    {ad.adId && (
                                        <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
                                            <button
                                                onClick={() => setCommentsAd(ad)}
                                                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                            >
                                                <MessageSquare className="w-3 h-3" />
                                                Ver Comentarios
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {/* Placeholders */}
                    {stats.ads.length < 3 && Array.from({ length: 3 - stats.ads.length }).map((_, i) => (
                        <div key={`ph-${i}`} className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl flex flex-col items-center justify-center py-16 text-gray-300 dark:text-gray-600 bg-gray-50/50 dark:bg-gray-800/30"
                            style={{ maxWidth:'420px', margin:'0 auto', width:'100%' }}>
                            <Megaphone className="w-8 h-8 mb-2 opacity-30" />
                            <p className="text-xs font-medium opacity-40">Próximo anuncio</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Comments Modal */}
            {commentsAd && (
                <CommentsModal ad={commentsAd} onClose={() => setCommentsAd(null)} showToast={showToast} />
            )}

            {/* Confirm Modal Portal */}
            {confirmModalJSX}
        </div>
    );
};

// Ultra-compact metric cell
const C = ({ v, l, c }) => (
    <div>
        <p className={`text-[11px] font-bold ${c} leading-none`}>{v}</p>
        <p className="text-[6px] uppercase font-bold text-gray-400 mt-0.5">{l}</p>
    </div>
);

// Cost tag
const T = ({ l, v, hl }) => (
    <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${hl ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700 font-bold' : 'bg-gray-50 dark:bg-gray-700/30 text-gray-500 dark:text-gray-400 border-gray-100 dark:border-gray-700'}`}>
        <span className="opacity-60">{l}</span> <span className="font-semibold">{v}</span>
    </span>
);

// Status badge
const statusConfig = {
    ACTIVE: { label: 'Activo', dot: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' },
    PAUSED: { label: 'Pausado', dot: 'bg-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400' },
    DELETED: { label: 'Eliminado', dot: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400' },
    ARCHIVED: { label: 'Archivado', dot: 'bg-gray-500', bg: 'bg-gray-100 dark:bg-gray-700/40 text-gray-600 dark:text-gray-400' },
    CAMPAIGN_PAUSED: { label: 'Campaña pausada', dot: 'bg-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400' },
    ADSET_PAUSED: { label: 'Conjunto pausado', dot: 'bg-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400' },
    DISAPPROVED: { label: 'Rechazado', dot: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400' },
    PENDING_REVIEW: { label: 'En revisión', dot: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' },
};

const StatusBadge = ({ status }) => {
    const cfg = statusConfig[status] || { label: status, dot: 'bg-gray-400', bg: 'bg-gray-100 dark:bg-gray-700/40 text-gray-500 dark:text-gray-400' };
    return (
        <span className={`inline-flex items-center gap-1 ${cfg.bg} px-1.5 py-0.5 rounded-full text-[8px] font-bold`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${status === 'ACTIVE' ? 'animate-pulse' : ''}`}></span>
            {cfg.label}
        </span>
    );
};

export default AdsStatisticsSection;
