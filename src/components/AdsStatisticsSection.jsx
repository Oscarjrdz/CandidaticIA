import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Target, TrendingUp, Users, Calendar, Megaphone, Loader2, Clock, Copy, ExternalLink, RefreshCw, Video, DollarSign, Eye, MousePointerClick, Percent, MessageCircle, Heart, ArrowUpRight, Trash2, X, Send, MessageSquare, ChevronDown, ChevronUp, CornerDownRight, Tag, Plus, Check, Archive, ArchiveRestore } from 'lucide-react';
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
    const [errorMsg, setErrorMsg] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);
    const [replyText, setReplyText] = useState('');
    const [sending, setSending] = useState(false);
    const [expandedReplies, setExpandedReplies] = useState(new Set());
    const commentsAbortRef = useRef(null);

    const fetchComments = useCallback(async ({ silent = false } = {}) => {
        if (!ad?.adId) return;
        commentsAbortRef.current?.abort();
        const controller = new AbortController();
        commentsAbortRef.current = controller;
        if (!silent) setLoading(true);
        setErrorMsg(null);
        try {
            const res = await fetch(`/api/ads-comments?adId=${ad.adId}`, { signal: controller.signal });
            const data = await res.json();
            if (data.success) {
                setComments(data.comments || []);
                // If it succeeded but explicitly returned a message (e.g. no post linked)
                if (data.message && (!data.comments || data.comments.length === 0)) {
                    setErrorMsg(data.message);
                }
            } else {
                setErrorMsg(data.error || 'Error al cargar comentarios');
                showToast?.(data.error || 'Error al cargar comentarios', 'error');
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            setErrorMsg('Error de red al cargar comentarios');
            showToast?.('Error de red', 'error');
        }
        if (!controller.signal.aborted) setLoading(false);
    }, [ad?.adId, showToast]);

    useEffect(() => {
        if (!ad?.adId) return;
        fetchComments();
        return () => commentsAbortRef.current?.abort();
    }, [ad?.adId, fetchComments]);

    const addReplyToThread = useCallback((targetId, reply) => {
        const parentId = comments.find(comment =>
            comment.id === targetId || comment.replies?.some(r => r.id === targetId)
        )?.id;

        setComments(prev => prev.map(comment => {
            const isParent = comment.id === targetId;
            const isChild = comment.replies?.some(r => r.id === targetId);

            if (!isParent && !isChild) return comment;

            const replies = [...(comment.replies || []), reply];
            return {
                ...comment,
                replies,
                replyCount: Math.max(comment.replyCount || 0, replies.length)
            };
        }));

        if (parentId) {
            setExpandedReplies(prev => {
                const next = new Set(prev);
                next.add(parentId);
                return next;
            });
        }
    }, [comments]);

    const handleReply = async (commentId) => {
        if (!replyText.trim()) return;
        const message = replyText.trim();
        setSending(true);
        try {
            const res = await fetch('/api/ads-comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commentId, message, adId: ad.adId })
            });
            const data = await res.json();
            if (data.success) {
                const optimisticReply = data.reply || {
                    id: data.replyId || `local-${Date.now()}`,
                    message,
                    from: { name: 'Página', id: '' },
                    createdTime: new Date().toISOString(),
                    likeCount: 0
                };
                addReplyToThread(commentId, optimisticReply);
                showToast?.('Respuesta enviada ✅', 'success');
                setReplyText('');
                setReplyingTo(null);
                fetchComments({ silent: true });
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
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => fetchComments()}
                            disabled={loading}
                            title="Actualizar comentarios"
                            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                            <X className="w-4 h-4 text-gray-500" />
                        </button>
                    </div>
                </div>

                {/* Comments List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                            <p className="text-xs text-gray-400">Cargando comentarios...</p>
                        </div>
                    ) : errorMsg ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-2 text-red-400">
                            <Target className="w-10 h-10 opacity-50 mb-2" />
                            <p className="text-sm font-bold text-center px-4">Error de permisos</p>
                            <p className="text-xs opacity-80 text-center px-4 max-w-sm">
                                {errorMsg}
                            </p>
                            <div className="mt-4 p-3 bg-red-50/10 rounded-lg text-[10px] border border-red-500/20 max-w-sm">
                                Para ver y contestar comentarios, asegúrate de que el token en META_ACCESS_TOKEN tenga los permisos <strong>pages_read_user_content</strong>, <strong>pages_read_engagement</strong> y <strong>pages_manage_engagement</strong>, y que la Página de Facebook esté asignada al Usuario del Sistema en el Administrador Comercial.
                            </div>
                        </div>
                    ) : comments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
                            <MessageCircle className="w-10 h-10 opacity-30" />
                            <p className="text-sm font-medium">Sin comentarios aún</p>
                            <p className="text-xs opacity-60">Los comentarios del post aparecerán aquí</p>
                        </div>
                    ) : (
                        comments.map(comment => (
                            <div key={comment.id} className="space-y-1.5 pt-2">
                                {/* Main Comment */}
                                <div className="flex items-start gap-2">
                                    {/* Avatar */}
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
                                        {(comment.from?.name || '?').charAt(0).toUpperCase()}
                                    </div>
                                    
                                    <div className="flex-1 min-w-0">
                                        {/* Gray Bubble */}
                                        <div className="inline-block bg-[#f0f2f5] dark:bg-[#3a3b3c] rounded-[18px] px-3 py-2 max-w-full">
                                            <span className="text-[13px] font-bold text-[#050505] dark:text-[#e4e6eb] block leading-tight mb-0.5">
                                                {comment.from?.name || 'Usuario'}
                                            </span>
                                            {comment.message && (
                                                <span className="text-[14px] text-[#050505] dark:text-[#e4e6eb] leading-snug break-words">
                                                    {comment.message}
                                                </span>
                                            )}
                                            {comment.attachment?.media?.image?.src && (
                                                <img src={comment.attachment.media.image.src} alt="" className="mt-1 max-w-[200px] rounded-lg" />
                                            )}
                                        </div>
                                        
                                        {/* Action Links */}
                                        <div className="flex items-center gap-3 px-3 mt-1 mb-1 text-[12px] font-semibold text-[#65676B] dark:text-[#b0b3b8]">
                                            <span className="cursor-pointer hover:underline">Me gusta</span>
                                            <span 
                                                className="cursor-pointer hover:underline"
                                                onClick={() => { setReplyingTo(replyingTo === comment.id ? null : comment.id); setReplyText(''); }}
                                            >
                                                Responder
                                            </span>
                                            <span className="font-normal hover:underline cursor-pointer">{timeAgo(comment.createdTime)}</span>
                                            
                                            {comment.likeCount > 0 && (
                                                <span className="flex items-center gap-1 ml-auto font-normal">
                                                    <span className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                                                        <Heart className="w-2.5 h-2.5 text-white fill-current" />
                                                    </span>
                                                    <span>{comment.likeCount}</span>
                                                </span>
                                            )}
                                        </div>

                                        {/* View Replies Button */}
                                        {comment.replyCount > 0 && !expandedReplies.has(comment.id) && (
                                            <div className="px-3 mt-1.5 mb-2">
                                                <button
                                                    onClick={() => toggleReplies(comment.id)}
                                                    className="flex items-center gap-2 text-[13px] font-semibold text-[#65676B] dark:text-[#b0b3b8] hover:underline"
                                                >
                                                    <CornerDownRight className="w-4 h-4" />
                                                    Ver {comment.replyCount} respuesta{comment.replyCount !== 1 ? 's' : ''}
                                                </button>
                                            </div>
                                        )}
                                        {comment.replyCount > 0 && expandedReplies.has(comment.id) && (
                                            <div className="px-3 mt-1.5 mb-2">
                                                <button
                                                    onClick={() => toggleReplies(comment.id)}
                                                    className="flex items-center gap-2 text-[13px] font-semibold text-[#65676B] dark:text-[#b0b3b8] hover:underline"
                                                >
                                                    Ocultar respuestas
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Replies */}
                                {expandedReplies.has(comment.id) && comment.replies?.length > 0 && (
                                    <div className="ml-10 space-y-3 mt-2">
                                        {comment.replies.map(reply => (
                                            <div key={reply.id} className="flex items-start gap-2">
                                                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5">
                                                    {(reply.from?.name || '?').charAt(0).toUpperCase()}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="inline-block bg-[#f0f2f5] dark:bg-[#3a3b3c] rounded-[18px] px-3 py-1.5 max-w-full">
                                                        <span className="text-[12px] font-bold text-[#050505] dark:text-[#e4e6eb] block leading-tight mb-0.5">
                                                            {reply.from?.name || 'Usuario'}
                                                        </span>
                                                        <span className="text-[13px] text-[#050505] dark:text-[#e4e6eb] leading-snug break-words">
                                                            {reply.message}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3 px-3 mt-1 text-[11px] font-semibold text-[#65676B] dark:text-[#b0b3b8]">
                                                        <span className="cursor-pointer hover:underline">Me gusta</span>
                                                        <span 
                                                            className="cursor-pointer hover:underline"
                                                            onClick={() => { setReplyingTo(replyingTo === reply.id ? null : reply.id); setReplyText(''); }}
                                                        >
                                                            Responder
                                                        </span>
                                                        <span className="font-normal hover:underline cursor-pointer">{timeAgo(reply.createdTime)}</span>
                                                        {reply.likeCount > 0 && (
                                                            <span className="flex items-center gap-0.5 ml-auto font-normal">
                                                                <Heart className="w-3 h-3 text-red-500 fill-current" /> {reply.likeCount}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Reply Input */}
                                {(replyingTo === comment.id || comment.replies?.some(r => r.id === replyingTo)) && (
                                    <div className="ml-10 flex gap-2 items-start animate-in fade-in slide-in-from-top-2 duration-200 mt-2">
                                        <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 text-[10px] font-bold shrink-0 mt-1">
                                            Tú
                                        </div>
                                        <div className="flex-1 relative">
                                            <textarea
                                                value={replyText}
                                                onChange={e => setReplyText(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        handleReply(replyingTo);
                                                    }
                                                }}
                                                placeholder="Escribe una respuesta..."
                                                className="w-full text-[13px] px-3 py-2 pr-10 rounded-[18px] bg-[#f0f2f5] dark:bg-[#3a3b3c] text-[#050505] dark:text-[#e4e6eb] focus:outline-none resize-none overflow-hidden min-h-[36px]"
                                                rows={1}
                                                autoFocus
                                            />
                                            <button
                                                onClick={() => handleReply(replyingTo)}
                                                disabled={!replyText.trim() || sending}
                                                className="absolute right-2 top-1.5 p-1 rounded-full text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                                            >
                                                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                            </button>
                                        </div>
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
const PRESET_COLORS = ['#a855f7','#3b82f6','#22c55e','#f97316','#ef4444','#eab308','#06b6d4','#ec4899','#64748b','#10b981'];

const AdsStatisticsSection = () => {
    const { showToast } = useToastContext();
    const [stats, setStats] = useState({ ads: [], totalAdsLeads: 0 });
    const [loading, setLoading] = useState(true);
    const [commentsAd, setCommentsAd] = useState(null);
    const { confirmModalJSX, showConfirm } = useConfirmModal();

    /* ── Ad Labels state ── */
    const [adLabels, setAdLabels] = useState([]);
    const [showLabelForm, setShowLabelForm] = useState(false);
    const [editingLabel, setEditingLabel] = useState(null); // null = crear, object = editar
    const [labelForm, setLabelForm] = useState({ adIds: '', name: '', emoji: '', color: '#a855f7', company: '' });
    const [labelSaving, setLabelSaving] = useState(false);
    // La tarjeta de etiquetas ocupa mucho alto (todos los Ad IDs). Se puede contraer para
    // ahorrar espacio; el estado se recuerda en localStorage. Default: contraída.
    const [labelsCollapsed, setLabelsCollapsed] = useState(() => {
        try { return localStorage.getItem('adLabelsCollapsed') !== 'false'; } catch { return true; }
    });
    const persistLabelsCollapsed = (next) => {
        setLabelsCollapsed(next);
        try { localStorage.setItem('adLabelsCollapsed', String(next)); } catch { /* ignore */ }
    };

    const loadAdLabels = async () => {
        try {
            const res = await fetch('/api/ad-labels');
            const data = await res.json();
            if (data.success) setAdLabels(data.labels || []);
        } catch { /* silent */ }
    };

    /* ── Asignación de etiqueta por anuncio (chip en cada tarjeta) ── */
    const [labelMenu, setLabelMenu] = useState(null); // { ad, x, y } | null

    const nameOnlyOf = (label) => label.emoji ? label.tagName.replace(label.emoji + ' ', '') : label.tagName;
    const labelIdsOf = (label) => (label.adIds || (label.adId ? [label.adId] : [])).map(String);
    const findLabelForAd = (adId) => adLabels.find(l => labelIdsOf(l).includes(String(adId)));

    // Reutiliza el PUT existente de /api/ad-labels: al agregar un adId nuevo, el backend
    // ademas retro-aplica la etiqueta a los candidatos existentes de ese anuncio.
    const putLabelAdIds = async (label, newIds, successMsg) => {
        try {
            const res = await fetch('/api/ad-labels', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: label.id, adIds: newIds.join(', '), name: nameOnlyOf(label), emoji: label.emoji || '', color: label.color, company: label.company || '' })
            });
            const data = await res.json();
            if (data.success) {
                setAdLabels(prev => prev.map(l => l.id === label.id ? data.label : l));
                showToast?.(successMsg(data), 'success');
                return true;
            }
            showToast?.(data.error || 'Error', 'error');
        } catch { showToast?.('Error de red', 'error'); }
        return false;
    };

    const assignAdToLabel = async (ad, label) => {
        const current = findLabelForAd(ad.adId);
        setLabelMenu(null);
        const ids = [...new Set([...labelIdsOf(label), String(ad.adId)])];
        const ok = await putLabelAdIds(label, ids, (d) => `Asignado a ${label.tagName}${d.renamed ? ` — etiqueta aplicada a ${d.renamed} candidatos` : ''}`);
        // Si venia de otra etiqueta, es un "mover": quitarlo de la anterior
        if (ok && current && current.id !== label.id) {
            const rest = labelIdsOf(current).filter(id => id !== String(ad.adId));
            if (rest.length) await putLabelAdIds(current, rest, () => `Quitado de ${current.tagName}`);
        }
    };

    const unassignAd = async (ad, label) => {
        setLabelMenu(null);
        const rest = labelIdsOf(label).filter(id => id !== String(ad.adId));
        if (!rest.length) {
            showToast?.('Es el único ID de esa etiqueta — elimínala o edítala desde la tarjeta de etiquetas', 'warning');
            return;
        }
        await putLabelAdIds(label, rest, () => `ID quitado de ${label.tagName} (los candidatos ya etiquetados la conservan)`);
    };

    const openCreateWithAdId = (ad) => {
        setLabelMenu(null);
        setLabelForm({ adIds: String(ad.adId), name: '', emoji: '', color: '#a855f7', company: '' });
        setEditingLabel(null);
        setShowLabelForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
        setLabelForm({ adIds: '', name: '', emoji: '', color: '#a855f7', company: '' });
        setEditingLabel(null);
        setShowLabelForm(false);
    };

    const handleOpenEdit = (label) => {
        const nameOnly = label.emoji ? label.tagName.replace(label.emoji + ' ', '') : label.tagName;
        const ids = label.adIds || (label.adId ? [label.adId] : []);
        setLabelForm({ adIds: ids.join(', '), name: nameOnly, emoji: label.emoji || '', color: label.color, company: label.company || '' });
        setEditingLabel(label);
        setShowLabelForm(true);
    };

    const handleSubmitLabel = async (e) => {
        e.preventDefault();
        if (!labelForm.adIds.trim() || !labelForm.name.trim()) return;
        setLabelSaving(true);
        try {
            const isEdit = !!editingLabel;
            const res = await fetch('/api/ad-labels', {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(isEdit ? { id: editingLabel.id, ...labelForm } : labelForm),
            });
            // body already has adIds as comma-string; backend parses it
            const data = await res.json();
            if (data.success) {
                if (isEdit) {
                    setAdLabels(prev => prev.map(l => l.id === editingLabel.id ? data.label : l));
                    showToast?.(`Etiqueta actualizada${data.renamed > 0 ? ` en ${data.renamed} candidatos` : ''}`, 'success');
                    // Notificar rename al instante en ChatSection
                    if (data.oldTagName !== data.label.tagName) {
                        window.dispatchEvent(new CustomEvent('ad_label_renamed', {
                            detail: { oldTagName: data.oldTagName, newTagName: data.label.tagName, color: data.label.color }
                        }));
                    } else {
                        // Solo cambio de color — recargar tags
                        window.dispatchEvent(new CustomEvent('ad_label_color_changed', {
                            detail: { tagName: data.label.tagName, color: data.label.color }
                        }));
                    }
                } else {
                    setAdLabels(prev => [...prev, data.label]);
                    showToast?.(`Etiqueta creada y aplicada a ${data.applied} candidatos`, 'success');
                    window.dispatchEvent(new CustomEvent('ad_label_created', {
                        detail: { adId: data.label.adId, tagName: data.label.tagName, color: data.label.color }
                    }));
                }
                resetForm();
            } else {
                showToast?.(data.error || 'Error', 'error');
            }
        } catch {
            showToast?.('Error de red', 'error');
        } finally {
            setLabelSaving(false);
        }
    };

    const handleDeleteLabel = async (label) => {
        const ok = await showConfirm({
            title: 'Eliminar Etiqueta Ad',
            message: `¿Eliminar "${label.tagName}" en profundidad? Se quitará de la lista global de etiquetas y de TODOS los candidatos que la tengan. Esta acción no se puede deshacer.`,
            confirmText: 'Eliminar todo',
            variant: 'danger'
        });
        if (!ok) return;
        try {
            const res = await fetch(`/api/ad-labels?id=${label.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                setAdLabels(prev => prev.filter(l => l.id !== label.id));
                showToast?.(`Etiqueta eliminada de ${data.removedFrom} candidatos y de la lista global`, 'success');
                // Quitar etiqueta del estado local de ChatSection al instante
                window.dispatchEvent(new CustomEvent('ad_label_deleted', {
                    detail: { tagName: label.tagName }
                }));
            }
        } catch { showToast?.('Error de red', 'error'); }
    };

    const [showArchived, setShowArchived] = useState(false);
    const showArchivedRef = useRef(false);

    const loadStats = async (includeArchived = showArchivedRef.current, opts = {}) => {
        if (!opts.silent) setLoading(true);
        const data = await getAdsStats(includeArchived, !!opts.refresh);
        if (data.success) {
            setStats({ ads: data.ads || [], totalAdsLeads: data.totalAdsLeads || 0 });
            // Respuesta stale (copia instantanea): refrescar en segundo plano sin
            // bloquear la UI — cuando llegue lo fresco, se actualiza solo.
            if (data.stale && !opts.refresh) {
                loadStats(includeArchived, { silent: true, refresh: true });
            }
        } else if (!opts.silent) {
            showToast?.('Error al cargar estadísticas', 'error');
        }
        if (!opts.silent) setLoading(false);
    };

    useEffect(() => { loadStats(); loadAdLabels(); }, []);

    const toggleArchivedView = () => {
        const next = !showArchived;
        setShowArchived(next);
        showArchivedRef.current = next;
        loadStats(next);
    };

    const handleRestoreAd = async (ad) => {
        const adKey = ad.adId || ad.adHeadline || 'unknown';
        try {
            const res = await fetch('/api/ads-stats', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adKey, restore: true })
            });
            const data = await res.json();
            if (data.success) {
                setStats(prev => ({ ...prev, ads: prev.ads.map(a => (a.adId || a.adHeadline || 'unknown') === adKey ? { ...a, archived: false } : a) }));
                showToast?.('Anuncio restaurado', 'success');
            } else {
                showToast?.(data.error || 'Error', 'error');
            }
        } catch { showToast?.('Error de red', 'error'); }
    };

    const handleHideAd = async (ad) => {
        const adKey = ad.adId || ad.adHeadline || 'unknown';
        const adName = ad.adHeadline || ad.adName || 'este anuncio';

        const ok = await showConfirm({
            title: 'Archivar Anuncio',
            message: `¿Archivar "${adName}"? Sus ${ad.totalLeads || 0} leads siguen en la base de datos y puedes restaurarlo cuando quieras desde "Ver archivados".`,
            confirmText: 'Archivar',
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
                // Optimista: en vista normal desaparece; en "ver archivados" solo se marca
                setStats(prev => showArchivedRef.current
                    ? { ...prev, ads: prev.ads.map(a => (a.adId || a.adHeadline || 'unknown') === adKey ? { ...a, archived: true } : a) }
                    : {
                        ...prev,
                        ads: prev.ads.filter(a => (a.adId || a.adHeadline || 'unknown') !== adKey),
                        totalAdsLeads: Math.max(0, prev.totalAdsLeads - (ad.totalLeads || 0))
                    });
                showToast?.('Anuncio archivado — puedes restaurarlo desde "Ver archivados"', 'success');
            } else {
                showToast?.(data.error || 'Error al archivar', 'error');
            }
        } catch (e) {
            showToast?.('Error de red', 'error');
        }
    };

    const todayLeadsTotal = stats.ads.reduce((a, ad) => a + (ad.todayLeads || 0), 0);
    const totalSpend = stats.ads.reduce((a, ad) => a + (parseFloat(ad.spend) || 0), 0);
    // #5 Costo por candidato: gasto de Meta / candidatos calificados (completos) del CRM.
    const totalComplete = stats.ads.reduce((a, ad) => a + (ad.completeLeads || 0), 0);
    const costPerCand = (totalSpend > 0 && totalComplete > 0) ? totalSpend / totalComplete : null;
    const _fId = (id) => id || '';
    const cp = (t) => { navigator.clipboard.writeText(t); showToast?.('Copiado', 'success'); };
    const fD = (d) => !d ? '-' : new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'short', timeZone:'America/Monterrey' });
    const f$ = (v) => v ? `$${Number(v).toFixed(2)}` : '-';
    const fN = (v) => v ? Number(v).toLocaleString() : '-';
    const fP = (v) => v ? `${Number(v).toFixed(1)}%` : '-';

    // w-full: sin esto, mx-auto sobre un hijo de flex-column encoge el contenedor al
    // contenido (shrink-to-fit) y el ancho brincaba al abrir/cerrar etiquetas.
    return (
        <div className="max-w-[1400px] w-full mx-auto space-y-5">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Target className="w-5 h-5 text-indigo-500" /> Estadísticas Meta Ads
                    </h1>
                    <p className="text-gray-400 text-xs mt-0.5">Campañas Click-to-WhatsApp</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={toggleArchivedView} disabled={loading}
                        className={`flex items-center px-3 py-1.5 text-xs border rounded-lg transition-colors shadow-sm disabled:opacity-50 ${
                            showArchived
                                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}>
                        <Archive className="w-3.5 h-3.5 mr-1.5" /> {showArchived ? 'Ocultar archivados' : 'Ver archivados'}
                    </button>
                    <button onClick={() => loadStats(showArchivedRef.current, { refresh: true })} disabled={loading}
                        className="flex items-center px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm disabled:opacity-50">
                        <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
                    </button>
                </div>
            </div>

            {/* ── ETIQUETAS ADS ──────────────────────────────────────────────── */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <button
                        onClick={() => persistLabelsCollapsed(!labelsCollapsed)}
                        className="flex items-center gap-2 min-w-0 group"
                        title={labelsCollapsed ? 'Expandir etiquetas' : 'Contraer etiquetas'}
                    >
                        <ChevronDown className={`w-4 h-4 text-gray-400 group-hover:text-violet-500 transition-transform ${labelsCollapsed ? '-rotate-90' : ''}`} />
                        <Tag className="w-4 h-4 text-violet-500" />
                        <h2 className="font-bold text-sm text-gray-900 dark:text-white">Etiquetas de Anuncios</h2>
                        {adLabels.length > 0 && <span className="text-[10px] font-bold text-violet-600 bg-violet-50 dark:bg-violet-500/10 px-2 py-0.5 rounded-full">{adLabels.length}</span>}
                    </button>
                    <button onClick={() => { persistLabelsCollapsed(false); if (editingLabel) resetForm(); else setShowLabelForm(v => !v); }}
                        className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 hover:bg-violet-100 dark:hover:bg-violet-500/20 px-3 py-1.5 rounded-lg transition-colors">
                        <Plus className="w-3.5 h-3.5" /> Nueva Etiqueta
                    </button>
                </div>

                {!labelsCollapsed && (<>
                {/* Form */}
                {showLabelForm && (
                    <form onSubmit={handleSubmitLabel} className="px-5 py-4 bg-violet-50/50 dark:bg-violet-500/5 border-b border-violet-100 dark:border-violet-500/20">
                        <p className="text-xs font-semibold text-violet-700 dark:text-violet-400 mb-3">
                            {editingLabel ? `Editar: ${editingLabel.tagName}` : 'Nueva Etiqueta Ad'}
                        </p>
                        <div className="flex flex-col gap-3 mb-3">
                            <div>
                                <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">
                                    Ad IDs * <span className="font-normal normal-case text-gray-400">— separa varios con coma</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="ej: 120245715187570620, 120245715187570621"
                                    value={labelForm.adIds}
                                    onChange={e => setLabelForm(f => ({ ...f, adIds: e.target.value }))}
                                    className="w-full text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white outline-none focus:border-violet-400 dark:focus:border-violet-500 transition-colors font-mono"
                                    required
                                />
                                {labelForm.adIds && (
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                        {labelForm.adIds.split(',').map(s => s.trim()).filter(Boolean).map((id, i) => (
                                            <span key={i} className="text-[9px] font-mono bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full">
                                                {id}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Nombre *</label>
                                <input
                                    type="text"
                                    placeholder="ej: Metálsa Apodaca"
                                    value={labelForm.name}
                                    onChange={e => setLabelForm(f => ({ ...f, name: e.target.value }))}
                                    className="w-full text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white outline-none focus:border-violet-400 transition-colors"
                                    required
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Empresa</label>
                                <input
                                    type="text"
                                    placeholder="ej: Metalsa S.A. de C.V."
                                    value={labelForm.company}
                                    onChange={e => setLabelForm(f => ({ ...f, company: e.target.value }))}
                                    className="w-full text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white outline-none focus:border-violet-400 transition-colors"
                                />
                            </div>
                        </div>
                        <div className="flex items-end gap-3 mb-3">
                            <div className="w-24">
                                <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Emoji</label>
                                <input
                                    type="text"
                                    placeholder="🏭"
                                    value={labelForm.emoji}
                                    onChange={e => setLabelForm(f => ({ ...f, emoji: e.target.value }))}
                                    className="w-full text-center text-lg px-2 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 outline-none focus:border-violet-400 transition-colors"
                                    maxLength={4}
                                />
                            </div>
                            <div className="flex-1">
                                <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Color</label>
                                <div className="flex items-center gap-2 flex-wrap">
                                    {PRESET_COLORS.map(c => (
                                        <button key={c} type="button" onClick={() => setLabelForm(f => ({ ...f, color: c }))}
                                            className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
                                            style={{ backgroundColor: c, borderColor: labelForm.color === c ? 'white' : 'transparent', outline: labelForm.color === c ? `2px solid ${c}` : 'none' }}
                                        />
                                    ))}
                                    <input type="color" value={labelForm.color} onChange={e => setLabelForm(f => ({ ...f, color: e.target.value }))}
                                        className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent" title="Color personalizado" />
                                </div>
                            </div>
                            <div className="shrink-0">
                                <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Preview</label>
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white px-3 py-1 rounded-full"
                                    style={{ backgroundColor: labelForm.color }}>
                                    {labelForm.emoji && <span>{labelForm.emoji}</span>}
                                    {labelForm.name || 'Etiqueta'}
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button type="submit" disabled={labelSaving || !labelForm.adIds.trim() || !labelForm.name.trim()}
                                className="flex items-center gap-1.5 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors">
                                {labelSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                {labelSaving ? (editingLabel ? 'Guardando...' : 'Aplicando...') : (editingLabel ? 'Guardar cambios' : 'Crear y aplicar')}
                            </button>
                            <button type="button" onClick={resetForm}
                                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                Cancelar
                            </button>
                        </div>
                    </form>
                )}

                {/* Label list */}
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {adLabels.length === 0 ? (
                        <div className="px-5 py-6 text-center text-xs text-gray-400 dark:text-gray-500">
                            No hay etiquetas creadas. Crea una para vincular un Ad ID a una etiqueta automática.
                        </div>
                    ) : (
                        adLabels.map(label => (
                            <div key={label.id} className={`px-5 py-3 flex items-center justify-between gap-4 transition-colors ${editingLabel?.id === label.id ? 'bg-violet-50/60 dark:bg-violet-500/5' : ''}`}>
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="flex flex-col gap-0.5 shrink-0">
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white px-3 py-1 rounded-full"
                                            style={{ backgroundColor: label.color }}>
                                            {label.emoji && <span>{label.emoji}</span>}
                                            {label.tagName.replace(label.emoji ? label.emoji + ' ' : '', '')}
                                        </span>
                                        {label.company && (
                                            <span className="text-[10px] text-gray-500 dark:text-gray-400 px-1 font-medium truncate max-w-[160px]">{label.company}</span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-1 min-w-0">
                                        {(label.adIds || (label.adId ? [label.adId] : [])).map(id => (
                                            <span key={id} className="text-[9px] font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded truncate max-w-[160px]">{id}</span>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button onClick={() => handleOpenEdit(label)}
                                        title="Editar etiqueta"
                                        className="p-1.5 text-gray-400 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-lg transition-colors">
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </button>
                                    <button onClick={() => handleDeleteLabel(label)}
                                        title="Eliminar etiqueta (en profundidad)"
                                        className="p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                </>)}
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {loading ? (
                    <>
                        <KpiSkeleton accent />
                        <KpiSkeleton />
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
                        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl p-3 text-white shadow-md" title="Gasto de Meta ÷ candidatos calificados (perfil completo)">
                            <p className="text-[10px] text-emerald-100 font-medium">$/Candidato</p>
                            <p className="text-2xl font-bold">{costPerCand ? f$(costPerCand) : '-'}</p>
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
                    {stats.ads.filter(ad => ad.adId || ad.adHeadline !== 'Anuncio sin título' || ad.adBody || ad.adImageUrl).map((ad, i) => {
                        const has = ad.impressions || ad.spend;
                        // #5 Costo por lead y por candidato calificado (completo) de este anuncio.
                        const adSpend = parseFloat(ad.spend) || 0;
                        const cLead = (adSpend > 0 && ad.totalLeads > 0) ? adSpend / ad.totalLeads : null;
                        const cQual = (adSpend > 0 && ad.completeLeads > 0) ? adSpend / ad.completeLeads : null;
                        return (
                            <div key={i} className={`bg-white dark:bg-gray-800 border rounded-2xl shadow-sm overflow-hidden hover:shadow-lg transition-shadow group/card relative ${
                                    ad.archived ? 'border-amber-300 dark:border-amber-700 opacity-75' : 'border-gray-200 dark:border-gray-700'
                                }`}
                                style={{ maxWidth:'420px', margin:'0 auto', width:'100%' }}>
                                {ad.archived && (
                                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 text-[9px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 px-1.5 py-0.5 rounded-full">
                                        <Archive className="w-2.5 h-2.5" /> Archivado
                                    </div>
                                )}
                                
                                {/* Header */}
                                <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0">
                                            <span className="text-white text-[10px] font-bold">f</span>
                                        </div>
                                        <div className="min-w-0">
                                            {/* Nombre REAL del anuncio en Meta (adName). El referral de CTWA manda
                                                el nombre de la pagina como headline, por eso 74 tarjetas decian
                                                "Candidatic IA" — indistinguibles entre si. */}
                                            <p className="text-xs font-bold text-gray-900 dark:text-white truncate leading-tight" title={ad.adName || ad.adHeadline}>
                                                {ad.adName || ad.adHeadline}
                                            </p>
                                            <div className="flex items-center gap-1 text-[9px] text-gray-400">
                                                <span>{ad.adSource === 'ad' ? '📣' : '📝'}</span>
                                                {ad.effectiveStatus && <StatusBadge status={ad.effectiveStatus} />}
                                                {ad.adId && (
                                                <span className="font-mono text-[8px] bg-gray-100 dark:bg-gray-700 px-1 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 select-all"
                                                        onClick={() => cp(ad.adId)}>{ad.adId}<Copy className="w-2 h-2 inline ml-0.5 opacity-40" /></span>
                                                )}
                                            </div>
                                            {/* Etiqueta de Anuncio de este ID: asignada (editable) o aviso de sin asignar */}
                                            {ad.adId && (() => {
                                                const lbl = findLabelForAd(ad.adId);
                                                return (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const r = e.currentTarget.getBoundingClientRect();
                                                            setLabelMenu({ ad, x: r.left, y: r.bottom + 4 });
                                                        }}
                                                        className={`mt-1 inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full transition-all hover:scale-105 hover:shadow ${
                                                            lbl ? 'text-white' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 border-dashed'
                                                        }`}
                                                        style={lbl ? { backgroundColor: lbl.color } : undefined}
                                                        title={lbl ? `Asignado a ${lbl.tagName} — clic para cambiar` : 'Este ID no está asignado a ninguna etiqueta — clic para asignar'}
                                                    >
                                                        {lbl ? <>🏷️ {lbl.tagName}</> : <>⚠️ Sin etiqueta · Asignar</>}
                                                    </button>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {/* Archivar / Restaurar — visible on hover */}
                                        {ad.archived ? (
                                            <button
                                                onClick={() => handleRestoreAd(ad)}
                                                className="p-1.5 rounded-lg opacity-0 group-hover/card:opacity-100 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-gray-400 hover:text-emerald-600 transition-all duration-200"
                                                title="Restaurar anuncio"
                                            >
                                                <ArchiveRestore className="w-3.5 h-3.5" />
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleHideAd(ad)}
                                                className="p-1.5 rounded-lg opacity-0 group-hover/card:opacity-100 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-gray-400 hover:text-amber-600 transition-all duration-200"
                                                title="Archivar anuncio"
                                            >
                                                <Archive className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                        {ad.adUrl && (
                                            <a href={ad.adUrl} target="_blank" rel="noreferrer" className="text-[9px] text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                                                FB<ExternalLink className="w-2.5 h-2.5" />
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {/* Body — tamaño uniforme: máx 10 renglones, el resto oculto */}
                                {ad.adBody && (
                                    <p className="px-3 pb-1.5 text-[11px] text-gray-600 dark:text-gray-400 leading-snug whitespace-pre-line"
                                        style={{ display: '-webkit-box', WebkitLineClamp: 10, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{ad.adBody}</p>
                                )}

                                {/* Imagen — altura fija SIEMPRE (con o sin imagen) para tarjetas uniformes */}
                                <div className="w-full bg-gray-50 dark:bg-gray-900 flex items-center justify-center" style={{ height: '200px' }}>
                                    {ad.adMediaType === 'video' && !ad.adImageUrl ? (
                                        <Video className="w-10 h-10 text-gray-300" />
                                    ) : ad.adImageUrl ? (
                                        <img src={ad.adImageUrl} alt="" loading="lazy" decoding="async" className="max-w-full max-h-full object-contain"
                                            onError={(e) => { e.target.onerror = null; e.target.style.display='none'; }} />
                                    ) : (
                                        <Megaphone className="w-10 h-10 text-gray-200 dark:text-gray-700" />
                                    )}
                                </div>

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
                                                {cLead && <T l="$/Lead" v={f$(cLead)} hl />}
                                                {cQual && <T l="$/Calif" v={f$(cQual)} hl />}
                                                {ad.completeLeads > 0 && <T l="Calif" v={fN(ad.completeLeads)} />}
                                                {ad.cpc && <T l="CPC" v={f$(ad.cpc)} />}
                                                {ad.cpm && <T l="CPM" v={f$(ad.cpm)} />}
                                                {ad.costPerConversation && <T l="$/Chat" v={f$(ad.costPerConversation)} />}
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

            {/* Menú de asignación de Etiqueta de Anuncio (fixed: escapa el overflow de la tarjeta) */}
            {labelMenu && (() => {
                const current = findLabelForAd(labelMenu.ad.adId);
                return (
                    <>
                        <div className="fixed inset-0 z-[140]" onClick={() => setLabelMenu(null)} />
                        <div
                            className="fixed z-[150] w-60 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl py-1.5"
                            style={{ left: Math.max(8, Math.min(labelMenu.x, window.innerWidth - 250)), top: Math.min(labelMenu.y, window.innerHeight - 320) }}
                        >
                            <p className="px-3 py-1 text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                                {current ? <>Asignado a <span style={{ color: current.color }}>{current.tagName}</span></> : 'No asignado a ninguna etiqueta'}
                            </p>
                            <p className="px-3 pb-1 text-[9px] font-mono text-gray-400 truncate">{labelMenu.ad.adId}</p>
                            <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                            {adLabels.filter(l => l.id !== current?.id).map(l => (
                                <button
                                    key={l.id}
                                    onClick={() => assignAdToLabel(labelMenu.ad, l)}
                                    className="w-full text-left px-3 py-1.5 text-[11px] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                                >
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                                    <span className="truncate">{current ? 'Mover a' : 'Asignar a'} <strong>{l.tagName}</strong></span>
                                </button>
                            ))}
                            {current && (
                                <button
                                    onClick={() => unassignAd(labelMenu.ad, current)}
                                    className="w-full text-left px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                                >
                                    <span className="w-2.5 h-2.5 shrink-0 text-center leading-none">✕</span>
                                    Quitar de {current.tagName}
                                </button>
                            )}
                            <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                            <button
                                onClick={() => openCreateWithAdId(labelMenu.ad)}
                                className="w-full text-left px-3 py-1.5 text-[11px] text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 font-semibold"
                            >
                                ＋ Nueva etiqueta con este ID
                            </button>
                        </div>
                    </>
                );
            })()}

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
