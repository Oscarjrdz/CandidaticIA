import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, Mic, Send, Eye, Camera, Smile } from 'lucide-react';

const WA_FONTS = [
    { id: 0, name: 'Sans-serif', css: '"Helvetica Neue", sans-serif' },
    { id: 1, name: 'Serif', css: 'Georgia, serif' },
    { id: 2, name: 'Monospace', css: '"Courier New", monospace' },
    { id: 3, name: 'Script', css: '"Pacifico", cursive' },
    { id: 4, name: 'Bold', css: '"Arial Black", sans-serif' },
];

/**
 * Muestra el anillo del estado + visor de pantalla completa estilo WhatsApp
 */
export default function WaStatusViewer({ triggerRefresh = 0 }) {
    const [statusData, setStatusData] = useState(null);
    const [viewerOpen, setViewerOpen] = useState(false);
    const [loading, setLoading] = useState(true);

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/whatsapp/get-status');
            const { success, status } = await res.json();
            if (success && status) {
                setStatusData(status);
            } else {
                setStatusData(null);
            }
        } catch (e) {
            console.error('Error fetching status:', e);
        } finally {
            setLoading(false);
        }
    };

    // Refetch when component mounts or parent triggers refresh (e.g. after publishing)
    useEffect(() => {
        fetchStatus();
    }, [triggerRefresh]);

    if (loading && !statusData) return null; // Wait for initial fetch
    if (!statusData && !loading) return null; // No active status 

    const { type, content, caption, color, font, timestamp } = statusData;
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

    return (
        <>
            {/* The circular WA Status Avatar Ring */}
            <div 
                className="relative cursor-pointer group flex items-center gap-2 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
                onClick={() => setViewerOpen(true)}
                title="Ver último estado publicado"
            >
                <div className="relative w-8 h-8 rounded-full shadow-sm bg-gray-200 dark:bg-gray-700 overflow-hidden flex-shrink-0"
                     style={{ 
                         padding: '2px', 
                         background: 'linear-gradient(45deg, #00a884, #25D366)', 
                         boxShadow: '0 0 0 2px rgba(37,211,102,0.2)' 
                     }}
                >
                    <div className="w-full h-full rounded-full border-[1.5px] border-white dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden flex items-center justify-center relative">
                        {type === 'image' ? (
                            <img src={content} alt="estado" className="w-full h-full object-cover" />
                        ) : type === 'video' ? (
                            <div className="w-full h-full bg-black/80 flex items-center justify-center">
                                <span className="text-[7px] font-black text-white">VID</span>
                            </div>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: color }}>
                                <span className="text-[7px] text-white/90 font-bold" style={{ textShadow: isLight ? 'none' : '0 1px 2px rgba(0,0,0,0.5)' }}>Txt</span>
                            </div>
                        )}
                    </div>
                </div>
                {/* Meta details next to ring */}
                <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-gray-800 dark:text-gray-200 leading-none">Mi estado</span>
                    <span className="text-[9px] text-gray-500 dark:text-gray-400 mt-[2px]">{getRelativeTimeString(timestamp)}</span>
                </div>
            </div>

            {/* WA FullScreen Viewer Modal */}
            {viewerOpen && (
                <div 
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-xl animate-fade-in"
                >
                    <button className="absolute top-6 right-6 z-50 p-2 text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors" onClick={() => setViewerOpen(false)}>
                        <X className="w-6 h-6" />
                    </button>

                    <div className="w-full max-w-[420px] h-[100dvh] flex flex-col bg-black relative mx-auto" style={{
                        boxShadow: '0 0 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.05)'
                    }}>
                        {/* Status bar */}
                        <div className="absolute top-0 left-0 right-0 z-30 px-3 pt-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-6">
                            <div className="h-[2px] bg-white/30 rounded-full mb-3">
                                <div className="h-full bg-white rounded-full w-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                            </div>
                            <div className="flex items-center gap-2 px-1">
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
                                <div className="ml-auto flex items-center gap-4 px-2">
                                    <Eye className="w-5 h-5 text-white drop-shadow-md" />
                                </div>
                            </div>
                        </div>

                        {/* Story Content Area */}
                        <div className="flex-1 flex items-center justify-center relative overflow-hidden h-full"
                            style={{ backgroundColor: type === 'text' ? color : '#000' }}>
                            
                            {type === 'text' && (
                                <div className="px-8 text-center w-full" style={{
                                    fontFamily,
                                    fontSize: content.length > 100 ? '22px' : content.length > 50 ? '30px' : '38px',
                                    color: textColor,
                                    fontWeight: 600,
                                    lineHeight: 1.35,
                                    wordBreak: 'break-word',
                                    textShadow: isLight ? 'none' : '0 1px 8px rgba(0,0,0,0.5)',
                                }}>
                                    {content}
                                </div>
                            )}

                            {type === 'image' && content && (
                                <div className="w-full h-full relative flex flex-col justify-center bg-black">
                                    <img src={content} alt="status" className="w-full object-contain" style={{ maxHeight: '85vh' }} />
                                    {caption && (
                                        <div className="absolute bottom-24 left-0 right-0 px-6 py-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-center">
                                            <p className="text-white text-[16px] font-medium drop-shadow-lg leading-snug">{caption}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {type === 'video' && content && (
                                <div className="w-full h-full relative bg-black flex flex-col justify-center">
                                    <video src={content} className="w-full object-contain" style={{ maxHeight: '85vh' }} autoPlay loop controls={false} />
                                    {caption && (
                                        <div className="absolute bottom-24 left-0 right-0 px-6 py-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-center">
                                            <p className="text-white text-[16px] font-medium drop-shadow-lg leading-snug">{caption}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Bottom Reply Bar */}
                        <div className="absolute bottom-6 left-0 right-0 px-4 flex items-center gap-3 z-30">
                            <div className="flex-1 bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-5 py-3 flex items-center gap-3 shadow-lg">
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
