import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Mic, Send, Eye, Camera, Smile, Trash2, Loader2, Users } from 'lucide-react';

const WA_FONTS = [
    { id: 0, name: 'Sans-serif', css: '"Helvetica Neue", sans-serif' },
    { id: 1, name: 'Serif', css: 'Georgia, serif' },
    { id: 2, name: 'Monospace', css: '"Courier New", monospace' },
    { id: 3, name: 'Script', css: '"Pacifico", cursive' },
    { id: 4, name: 'Bold', css: '"Arial Black", sans-serif' },
];

/**
 * Muestra el anillo del estado + visor de pantalla completa estilo WhatsApp con soporte para múltiples historias
 */
export default function WaStatusViewer({ triggerRefresh = 0 }) {
    const [statuses, setStatuses] = useState([]);
    const [viewerOpen, setViewerOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [deleting, setDeleting] = useState(false);
    const [showViewers, setShowViewers] = useState(false);

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/whatsapp/get-status');
            const data = await res.json();
            if (data.success && data.statuses && data.statuses.length > 0) {
                // Ensure array format
                const s = Array.isArray(data.statuses) ? data.statuses : [data.statuses];
                setStatuses(s);
                // Reset index only if viewer is closed to avoid jumping
                if (!viewerOpen) setCurrentIndex(0);
            } else {
                setStatuses([]);
            }
        } catch (e) {
            console.error('Error fetching status:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, [triggerRefresh]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && viewerOpen) setViewerOpen(false);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [viewerOpen]);

    if (loading && statuses.length === 0) return null; 
    if (statuses.length === 0 && !loading) return null; 

    // Render the active status based on index
    const activeStatus = statuses[currentIndex] || statuses[0];
    const { id: statusId, type, content, caption, color, font, timestamp, views = [] } = activeStatus;
    
    const fontFamily = WA_FONTS.find(f => f.id === font)?.css || WA_FONTS[0].css;
    const isLight = ['#ffffff', '#f5a623', '#f7b731', '#25D366', '#20bf6b'].includes(color);
    const textColor = isLight ? '#111' : '#fff';
    
    // Relative time string (e.g. "hace 5 min")
    const getRelativeTimeString = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const diffMs = Date.now() - d.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'justo ahora';
        if (diffMins < 60) return `hace ${diffMins} min`;
        const diffHrs = Math.floor(diffMins / 60);
        return `hace ${diffHrs} h`;
    };

    const nextStatus = () => {
        if (currentIndex < statuses.length - 1) setCurrentIndex(p => p + 1);
        else setViewerOpen(false); // Close if it's the last one
    };

    const prevStatus = () => {
        if (currentIndex > 0) setCurrentIndex(p => p - 1);
    };

    const handleDelete = async (idOfStatus) => {
        if (!confirm('¿Seguro que deseas eliminar este estado del dashboard?')) return;
        setDeleting(true);
        try {
            await fetch('/api/whatsapp/delete-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: idOfStatus })
            });
            // Update local state without waiting for full refetch
            const newArray = statuses.filter(s => s.id !== idOfStatus);
            if (newArray.length === 0) {
                setViewerOpen(false);
                setStatuses([]);
            } else {
                setStatuses(newArray);
                setCurrentIndex(p => Math.max(0, p - 1));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <>
            {/* The circular WA Status Avatar Ring */}
            <div className="flex items-center gap-3 ml-2 mr-2 cursor-pointer transition-all hover:opacity-80" onClick={() => setViewerOpen(true)}>
                <div className="relative">
                    <div className="w-10 h-10 rounded-full p-[2px] bg-gradient-to-tr from-[#25D366] to-[#128C7E]">
                        <div 
                            className="w-full h-full bg-white dark:bg-gray-800 rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center overflow-hidden"
                            style={{ backgroundColor: statuses[0]?.type === 'text' ? statuses[0]?.color : undefined }}
                        >
                            {statuses[0]?.type === 'image' && statuses[0].content ? (
                                <img src={statuses[0].content} className="w-full h-full object-cover" alt="State" />
                            ) : statuses[0]?.type === 'video' && statuses[0].content ? (
                                <video src={statuses[0].content} className="w-full h-full object-cover" />
                            ) : statuses[0]?.type === 'text' ? (
                                <span className="text-white font-bold text-[10px] uppercase text-center w-full break-words px-0.5 leading-tight" 
                                      style={{ fontFamily: WA_FONTS.find(f => f.id === statuses[0].font)?.css || WA_FONTS[0].css, textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
                                    {statuses[0].content?.substring(0, 3)}
                                </span>
                            ) : (
                                <span className="text-[#128C7E] font-bold text-[12px]">Mi</span>
                            )}
                        </div>
                    </div>
                </div>
                {/* Meta details next to ring */}
                <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-gray-800 dark:text-gray-200 leading-none">Mi estado ({statuses.length})</span>
                    <span className="text-[9px] text-gray-500 dark:text-gray-400 mt-[2px]">{getRelativeTimeString(statuses[0]?.timestamp)}</span>
                </div>
            </div>

            {/* WA FullScreen Viewer Modal */}
            {viewerOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-xl animate-fade-in">
                    <button className="absolute top-6 right-6 z-50 p-2 text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors hidden md:block" onClick={() => setViewerOpen(false)}>
                        <X className="w-6 h-6" />
                    </button>

                    <div className="w-full max-w-[420px] h-[100dvh] flex flex-col bg-black relative mx-auto" style={{
                        boxShadow: '0 0 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.05)'
                    }}>
                        {/* 👆 Progress bars (Snapchat style) */}
                        <div className="absolute top-0 left-0 right-0 z-40 px-3 pt-3 flex gap-1">
                            {statuses.map((s, idx) => (
                                <div key={idx} className="h-[2px] bg-white/30 rounded-full flex-1 overflow-hidden transition-all duration-300">
                                    <div 
                                        className="h-full bg-white rounded-full transition-all duration-300"
                                        style={{ width: idx < currentIndex ? '100%' : idx === currentIndex ? '100%' : '0%' }}
                                    />
                                </div>
                            ))}
                        </div>

                        {/* Status bar details */}
                        <div className="absolute top-0 left-0 right-0 z-30 px-3 pt-6 bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-6 pointer-events-none">
                            <div className="flex items-center gap-2 px-1 pointer-events-auto">
                                <button onClick={() => setViewerOpen(false)} className="text-white hover:opacity-100 flex items-center drop-shadow-md">
                                    <ChevronLeft className="w-7 h-7 -ml-1" />
                                </button>
                                <div className="w-9 h-9 rounded-full bg-[#128C7E] flex items-center justify-center border border-white/10 shadow-sm flex-shrink-0">
                                    <span className="text-white text-[13px] font-bold">Mi</span>
                                </div>
                                <div className="ml-1">
                                    <p className="text-white text-[14px] font-semibold leading-tight drop-shadow-md">Mi estado</p>
                                    <p className="text-white/80 text-[11px] font-medium drop-shadow-md">{getRelativeTimeString(timestamp)}</p>
                                </div>
                                <div className="ml-auto flex items-center gap-2">
                                    {/* Action buttons inside status */}
                                    <button 
                                        onClick={() => handleDelete(statusId)}
                                        disabled={deleting}
                                        className="p-2 bg-black/40 hover:bg-red-500/80 rounded-full text-white/90 transition-all backdrop-blur-sm shadow-xl"
                                        title="Eliminar este estado"
                                    >
                                        {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Navigation Overlay Click Areas */}
                        <div 
                            className="absolute top-20 bottom-24 left-0 w-1/3 z-20 cursor-w-resize" 
                            onClick={(e) => { e.stopPropagation(); prevStatus(); }}
                        />
                        <div 
                            className="absolute top-20 bottom-24 right-0 w-2/3 z-20 cursor-e-resize" 
                            onClick={(e) => { e.stopPropagation(); nextStatus(); }}
                        />

                        {/* Story Content Area */}
                        <div className="flex-1 flex items-center justify-center relative overflow-hidden h-full z-10"
                            style={{ backgroundColor: type === 'text' ? color : '#000' }}
                            onClick={() => setShowViewers(false)}>
                            
                            {type === 'text' && (
                                <div className="px-8 text-center w-full animate-fade-in" style={{
                                    fontFamily,
                                    fontSize: content?.length > 100 ? '20px' : content?.length > 50 ? '28px' : '40px',
                                    color: textColor,
                                    fontWeight: 600,
                                    lineHeight: 1.35,
                                    wordBreak: 'break-word',
                                    textShadow: isLight ? 'none' : '0 1px 4px rgba(0,0,0,0.25)',
                                }}>
                                    {content}
                                </div>
                            )}

                            {type === 'image' && (
                                <div className="w-full h-full relative flex items-center justify-center">
                                    <img src={content} alt="status" className="max-w-full max-h-full object-contain pointer-events-none" />
                                    {caption && (
                                        <div className="absolute bottom-16 left-0 right-0 px-5 text-center bg-gradient-to-t from-black/80 to-transparent pt-6 pb-2">
                                            <p className="text-white text-[15px] font-medium drop-shadow-lg">{caption}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {type === 'video' && content && (
                                <video src={content} className="w-full h-full object-contain pointer-events-none" autoPlay loop muted playsInline />
                            )}
                        </div>

                        {/* Bottom Reply Bar & Views Tracker */}
                        <div className="absolute bottom-6 left-0 right-0 px-4 flex flex-col gap-4 z-40">
                            
                            {/* Viewers Bubble */}
                            <div className="flex justify-center z-50 relative pointer-events-auto cursor-pointer" onClick={(e) => { e.stopPropagation(); setShowViewers(prev => !prev); }}>
                                <div className="bg-black/60 backdrop-blur-md rounded-full px-4 py-2 border border-white/10 flex items-center gap-2 shadow-xl hover:bg-black/80 transition-colors">
                                    <Eye className="w-4 h-4 text-white/90" />
                                    <span className="text-white font-semibold text-[13px]">{views?.length || 0}</span>
                                    <div className="w-[1px] h-3 bg-white/20 mx-1"></div>
                                    <Users className="w-4 h-4 text-white/50" />
                                </div>
                                
                                {/* Lista extendida de Vistas (Desplegable) */}
                                {showViewers && (
                                    <div className="absolute bottom-full mb-3 right-0 left-0 mx-auto w-56 bg-black/85 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-3 animate-fade-in cursor-default" onClick={e => e.stopPropagation()}>
                                        <div className="flex justify-between items-center mb-3 pb-2 border-b border-white/10">
                                            <span className="text-white text-[12px] font-bold">Visto por</span>
                                            <button onClick={() => setShowViewers(false)} className="text-white/50 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
                                        </div>
                                        <div className="max-h-40 overflow-y-auto overflow-x-hidden flex flex-col gap-2">
                                            {!views || views.length === 0 ? (
                                                <p className="text-center text-white/40 text-[11px] py-3">Nadie ha visto esto aún 👀</p>
                                            ) : (
                                                views.map((phone, i) => (
                                                    <div key={i} className="flex items-center gap-2 bg-white/5 rounded-lg p-2 flex-shrink-0">
                                                        <div className="w-6 h-6 rounded-full bg-[#128C7E] flex items-center justify-center flex-shrink-0">
                                                            <span className="text-white text-[9px] font-bold">{phone.substring(0,2)}</span>
                                                        </div>
                                                        <span className="text-white/90 text-[12px] font-medium">{phone}</span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-5 py-3 flex items-center gap-3 shadow-lg pointer-events-none">
                                <span className="text-white/60 text-[14px] flex-1">Responder...</span>
                                <Smile className="w-6 h-6 text-white/80"/>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
