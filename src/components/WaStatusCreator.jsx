import React, { useState, useRef, useCallback } from 'react';
import {
    X, Type, Image, Video, Send, Smile, Bold, Italic, Strikethrough,
    Palette, AlignCenter, ChevronLeft, Camera, Mic, Link, CheckCircle,
    Loader2, Eye, RotateCcw, Sun, Moon, Sparkles
} from 'lucide-react';

// ─── WhatsApp color presets ────────────────────────────────────────────────
const WA_COLORS = [
    { hex: '#075E54', name: 'Verde WA' },
    { hex: '#128C7E', name: 'Verde menta' },
    { hex: '#25D366', name: 'Verde claro' },
    { hex: '#1a1a2e', name: 'Azul oscuro' },
    { hex: '#16213e', name: 'Marino' },
    { hex: '#0f3460', name: 'Azul mediano' },
    { hex: '#533483', name: 'Morado' },
    { hex: '#e94560', name: 'Rosa coral' },
    { hex: '#f5a623', name: 'Naranja' },
    { hex: '#f7b731', name: 'Amarillo' },
    { hex: '#20bf6b', name: 'Verde esmeralda' },
    { hex: '#0652DD', name: 'Azul eléctrico' },
    { hex: '#833471', name: 'Púrpura' },
    { hex: '#EA2027', name: 'Rojo vivo' },
    { hex: '#1B1B2F', name: 'Negro azulado' },
    { hex: '#ffffff', name: 'Blanco' },
];

// WhatsApp font index map
const WA_FONTS = [
    { id: 0, name: 'Sans-serif', css: '"Helvetica Neue", Helvetica, sans-serif' },
    { id: 1, name: 'Serif', css: 'Georgia, serif' },
    { id: 2, name: 'Monospace', css: '"Courier New", monospace' },
    { id: 3, name: 'Script', css: '"Pacifico", cursive' },
    { id: 4, name: 'Sans Bold', css: '"Arial Black", sans-serif' },
];

// ─── iPhone 17 Pro Max Frame ────────────────────────────────────────────────
function IPhoneFrame({ children }) {
    return (
        <div className="relative flex justify-center items-center select-none" style={{ height: '780px' }}>
            {/* Phone body */}
            <div
                className="relative rounded-[52px] overflow-hidden shadow-[0_40px_120px_rgba(0,0,0,0.6)] border-[3px] border-[#2a2a2a]"
                style={{
                    width: '360px',
                    height: '780px',
                    background: 'linear-gradient(180deg, #1c1c1e 0%, #111 100%)',
                    boxShadow: '0 0 0 1px #444, 0 40px 120px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
            >
                {/* Titanium side shimmer */}
                <div className="absolute inset-0 rounded-[52px] pointer-events-none"
                    style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, transparent 40%, rgba(255,255,255,0.03) 100%)' }} />

                {/* Screen area */}
                <div className="absolute inset-[3px] rounded-[50px] overflow-hidden bg-black">
                    {/* Dynamic Island */}
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50">
                        <div className="bg-black rounded-full" style={{ width: '120px', height: '34px', boxShadow: '0 0 0 1px #222' }} />
                    </div>

                    {/* Status bar */}
                    <div className="absolute top-0 left-0 right-0 h-14 z-40 flex items-end justify-between px-8 pb-1.5 pointer-events-none">
                        <span className="text-white text-[11px] font-semibold">9:41</span>
                        <div className="flex items-center gap-1">
                            {/* Signal bars */}
                            <svg width="18" height="12" viewBox="0 0 18 12" fill="white">
                                <rect x="0" y="8" width="3" height="4" rx="1" />
                                <rect x="4.5" y="5" width="3" height="7" rx="1" />
                                <rect x="9" y="2.5" width="3" height="9.5" rx="1" />
                                <rect x="13.5" y="0" width="3" height="12" rx="1" opacity="0.4" />
                            </svg>
                            {/* WiFi */}
                            <svg width="16" height="12" viewBox="0 0 16 12" fill="white" opacity="0.9">
                                <path d="M8 9.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/>
                                <path d="M8 5.5C5.8 5.5 3.8 6.4 2.3 7.9L1 6.6C2.9 4.7 5.3 3.5 8 3.5s5.1 1.2 7 3.1l-1.3 1.3C12.2 6.4 10.2 5.5 8 5.5z"/>
                                <path d="M8 1.5C4.7 1.5 1.7 2.8-.1 5L1.2 6.3C3.4 3.8 5.5 2.5 8 2.5s4.6 1.3 6.8 3.8L16 5C14.3 2.8 11.3 1.5 8 1.5z" opacity="0.5"/>
                            </svg>
                            {/* Battery */}
                            <div className="flex items-center">
                                <div className="relative w-6 h-3 border border-white rounded-[3px] overflow-hidden">
                                    <div className="absolute left-[1px] top-[1px] bottom-[1px] bg-white rounded-[2px]" style={{ width: '80%' }} />
                                </div>
                                <div className="w-[2px] h-1.5 bg-white/50 rounded-r ml-[1px]" />
                            </div>
                        </div>
                    </div>

                    {/* Screen content */}
                    <div className="absolute inset-0 overflow-hidden">
                        {children}
                    </div>

                    {/* Home indicator */}
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-50 w-32 h-1 bg-white/40 rounded-full" />
                </div>
            </div>

            {/* Side buttons */}
            <div className="absolute left-[-4px] top-[180px] w-[4px] h-10 bg-[#2a2a2a] rounded-l-sm shadow-sm" />
            <div className="absolute left-[-4px] top-[230px] w-[4px] h-14 bg-[#2a2a2a] rounded-l-sm shadow-sm" />
            <div className="absolute left-[-4px] top-[298px] w-[4px] h-14 bg-[#2a2a2a] rounded-l-sm shadow-sm" />
            <div className="absolute right-[-4px] top-[210px] w-[4px] h-20 bg-[#2a2a2a] rounded-r-sm shadow-sm" />
        </div>
    );
}

// ─── Status Preview Screen (inside iPhone) ─────────────────────────────────
function StatusPreviewScreen({ type, content, caption, backgroundColor, font, onAddText, onAddImage, onMenuClose }) {
    const [time] = useState(() => {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    });

    const fontFamily = WA_FONTS.find(f => f.id === font)?.css || WA_FONTS[0].css;
    const isLightBg = ['#ffffff', '#f5a623', '#f7b731', '#25D366', '#20bf6b'].includes(backgroundColor);

    return (
        <div className="w-full h-full flex flex-col" style={{ background: '#000' }}>
            {/* WhatsApp Status bar header */}
            <div className="absolute top-14 left-0 right-0 z-30 px-4 pt-2 pb-2 flex items-center gap-3"
                style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)' }}>
                <button onClick={onMenuClose} className="text-white opacity-90 hover:opacity-100">
                    <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="flex items-center gap-2 flex-1">
                    <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center">
                        <span className="text-white text-xs font-bold">Mi</span>
                    </div>
                    <div>
                        <p className="text-white text-[12px] font-semibold leading-none">Mi estado</p>
                        <p className="text-white/70 text-[10px]">{time}</p>
                    </div>
                </div>
                {/* Progress bar */}
                <div className="absolute top-0 left-0 right-0 flex gap-1 px-3 pt-1">
                    <div className="flex-1 h-[2px] bg-white rounded-full opacity-90" />
                </div>
            </div>

            {/* Content area */}
            <div
                className="flex-1 flex items-center justify-center relative overflow-hidden"
                style={{ backgroundColor: type === 'text' ? backgroundColor : '#000' }}
            >
                {type === 'text' && content && (
                    <div
                        className="px-8 text-center w-full"
                        style={{
                            fontFamily,
                            fontSize: content.length > 80 ? '18px' : content.length > 40 ? '24px' : '32px',
                            color: isLightBg ? '#1a1a1a' : '#ffffff',
                            fontWeight: 600,
                            lineHeight: 1.35,
                            textShadow: isLightBg ? 'none' : '0 1px 4px rgba(0,0,0,0.3)',
                            wordBreak: 'break-word',
                        }}
                    >
                        {content}
                    </div>
                )}

                {type === 'text' && !content && (
                    <div className="text-white/40 text-center px-8">
                        <Type className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-[13px]">Escribe tu estado aquí</p>
                    </div>
                )}

                {type === 'image' && content && (
                    <div className="w-full h-full relative">
                        <img src={content} alt="Preview" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                        {caption && (
                            <div className="absolute bottom-16 left-0 right-0 px-6 text-center">
                                <p className="text-white text-[14px] font-medium" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>{caption}</p>
                            </div>
                        )}
                    </div>
                )}

                {type === 'image' && !content && (
                    <div className="text-white/40 text-center px-8">
                        <Image className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-[13px]">Pega o sube una imagen</p>
                    </div>
                )}

                {type === 'video' && content && (
                    <video src={content} className="w-full h-full object-cover" autoPlay loop muted />
                )}

                {type === 'video' && !content && (
                    <div className="text-white/40 text-center px-8">
                        <Video className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-[13px]">Pega URL de video</p>
                    </div>
                )}

                {/* WA Emoji reaction floating */}
                {content && (
                    <div className="absolute bottom-20 right-4 flex flex-col gap-2 opacity-70">
                        {['❤️', '😂', '😮', '😢', '👏', '🙏'].map((e, i) => (
                            <span key={i} className="text-lg leading-none">{e}</span>
                        ))}
                    </div>
                )}
            </div>

            {/* Bottom WA toolbar */}
            <div className="absolute bottom-8 left-0 right-0 px-4 flex items-center justify-between z-30">
                <div className="flex-1 bg-[#1f2c34] rounded-full px-4 py-2.5 flex items-center gap-3 mr-3">
                    <Smile className="w-5 h-5 text-[#8696a0]" />
                    <span className="text-[#8696a0] text-[13px] flex-1">Responder al estado</span>
                    <Camera className="w-5 h-5 text-[#8696a0]" />
                    <Mic className="w-5 h-5 text-[#8696a0]" />
                </div>
                <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center flex-shrink-0">
                    <Send className="w-5 h-5 text-white" style={{ transform: 'rotate(45deg)' }} />
                </div>
            </div>
        </div>
    );
}

// ─── Main WhatsApp Status Creator Modal ────────────────────────────────────
export default function WaStatusCreator({ onClose, showToast }) {
    const [type, setType] = useState('text'); // 'text' | 'image' | 'video'
    const [content, setContent] = useState('');
    const [caption, setCaption] = useState('');
    const [backgroundColor, setBackgroundColor] = useState('#075E54');
    const [font, setFont] = useState(0);
    const [publishing, setPublishing] = useState(false);
    const [published, setPublished] = useState(false);
    const [imagePreview, setImagePreview] = useState('');
    const textRef = useRef(null);
    const fileRef = useRef(null);

    const handlePublish = async () => {
        if (!content && type === 'text') { showToast('Escribe algo para el estado', 'warning'); return; }
        if (!content && type !== 'text') { showToast('Agrega una imagen o video', 'warning'); return; }

        setPublishing(true);
        try {
            const res = await fetch('/api/whatsapp/send-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, content, caption, backgroundColor, font }),
            });
            const data = await res.json();
            if (data.success) {
                setPublished(true);
                showToast('✅ Estado publicado en WhatsApp', 'success');
                setTimeout(() => onClose(), 2000);
            } else {
                showToast(`Error: ${data.error || data.data?.message || 'No se pudo publicar'}`, 'error');
            }
        } catch (e) {
            showToast('Error de conexión al publicar', 'error');
        } finally {
            setPublishing(false);
        }
    };

    const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => {
            const b64 = reader.result;
            setContent(b64);
            setImagePreview(b64);
        };
        reader.readAsDataURL(file);
    };

    const applyFormat = (marker) => {
        const el = textRef.current;
        if (!el) return;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const selected = content.substring(start, end);
        const newText = content.substring(0, start) + marker + selected + marker + content.substring(end);
        setContent(newText);
    };

    const resetContent = () => {
        setContent('');
        setCaption('');
        setImagePreview('');
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}>
            <div className="relative flex gap-8 items-start max-h-[95vh]">

                {/* ── Left panel: Editor controls ───────────────────────── */}
                <div className="bg-[#111b21] rounded-2xl w-[340px] flex flex-col shadow-2xl border border-white/10 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] flex items-center justify-center">
                                <Sparkles className="w-4 h-4 text-white" />
                            </div>
                            <div>
                                <h2 className="text-white font-bold text-[14px] leading-none">Crear Estado</h2>
                                <p className="text-white/40 text-[10px] mt-0.5">WhatsApp Status</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Type selector */}
                    <div className="flex gap-1 p-3 bg-[#0d1418]">
                        {[
                            { id: 'text', icon: Type, label: 'Texto' },
                            { id: 'image', icon: Image, label: 'Imagen' },
                            { id: 'video', icon: Video, label: 'Video' },
                        ].map(({ id, icon: Icon, label }) => (
                            <button
                                key={id}
                                onClick={() => { setType(id); resetContent(); }}
                                className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[11px] font-semibold transition-all ${type === id
                                    ? 'bg-[#00a884] text-white shadow-lg shadow-[#00a884]/20'
                                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                                    }`}
                            >
                                <Icon className="w-4 h-4" />
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ maxHeight: '520px' }}>
                        <div className="p-4 space-y-4">

                            {/* ── TEXT type ── */}
                            {type === 'text' && (
                                <>
                                    {/* Text formatting tools */}
                                    <div className="flex gap-1">
                                        {[
                                            { icon: Bold, action: () => applyFormat('*'), title: 'Negrita' },
                                            { icon: Italic, action: () => applyFormat('_'), title: 'Cursiva' },
                                            { icon: Strikethrough, action: () => applyFormat('~'), title: 'Tachado' },
                                        ].map(({ icon: Icon, action, title }) => (
                                            <button key={title} onClick={action} title={title}
                                                className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-all">
                                                <Icon className="w-4 h-4" />
                                            </button>
                                        ))}
                                        <button onClick={resetContent} title="Limpiar"
                                            className="p-2 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-all ml-auto">
                                            <RotateCcw className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* Text area */}
                                    <textarea
                                        ref={textRef}
                                        value={content}
                                        onChange={(e) => setContent(e.target.value)}
                                        placeholder="¿Qué está pasando hoy?..."
                                        maxLength={700}
                                        rows={5}
                                        className="w-full bg-[#1f2c34] border border-white/10 rounded-xl px-4 py-3 text-white text-[14px] placeholder:text-white/30 resize-none focus:outline-none focus:border-[#00a884]/60 focus:ring-1 focus:ring-[#00a884]/30 transition-all"
                                        style={{ fontFamily: WA_FONTS.find(f => f.id === font)?.css }}
                                    />
                                    <div className="text-right text-white/30 text-[10px] -mt-2">{content.length}/700</div>

                                    {/* Font selector */}
                                    <div>
                                        <p className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-2">Fuente</p>
                                        <div className="flex gap-2 flex-wrap">
                                            {WA_FONTS.map(f => (
                                                <button
                                                    key={f.id}
                                                    onClick={() => setFont(f.id)}
                                                    className={`px-3 py-1.5 rounded-lg text-[11px] transition-all border ${font === f.id
                                                        ? 'border-[#00a884] bg-[#00a884]/20 text-[#00a884]'
                                                        : 'border-white/10 text-white/50 hover:border-white/30'
                                                        }`}
                                                    style={{ fontFamily: f.css }}
                                                >
                                                    {f.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Background color palette */}
                                    <div>
                                        <p className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <Palette className="w-3 h-3" />
                                            Fondo
                                        </p>
                                        <div className="grid grid-cols-8 gap-2">
                                            {WA_COLORS.map(c => (
                                                <button
                                                    key={c.hex}
                                                    onClick={() => setBackgroundColor(c.hex)}
                                                    title={c.name}
                                                    className={`w-8 h-8 rounded-full border-2 transition-all transform hover:scale-110 ${backgroundColor === c.hex ? 'border-[#00a884] scale-110 shadow-lg' : 'border-transparent'}`}
                                                    style={{ backgroundColor: c.hex }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* ── IMAGE type ── */}
                            {type === 'image' && (
                                <>
                                    <div>
                                        <p className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-2">Imagen</p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => fileRef.current?.click()}
                                                className="flex-1 flex items-center gap-2 justify-center py-3 rounded-xl bg-[#1f2c34] border border-dashed border-white/20 text-white/60 hover:text-white hover:border-[#00a884]/60 transition-all text-[12px]"
                                            >
                                                <Camera className="w-4 h-4" />
                                                Subir archivo
                                            </button>
                                            <input type="file" ref={fileRef} accept="image/*" className="hidden" onChange={handleFileChange} />
                                        </div>
                                        <p className="text-white/30 text-[10px] mt-2 text-center">— o —</p>
                                        <input
                                            type="text"
                                            value={!imagePreview ? content : ''}
                                            onChange={(e) => { setContent(e.target.value); setImagePreview(''); }}
                                            placeholder="https://... URL de imagen"
                                            className="w-full mt-2 bg-[#1f2c34] border border-white/10 rounded-xl px-4 py-2.5 text-white text-[12px] placeholder:text-white/30 focus:outline-none focus:border-[#00a884]/60 transition-all"
                                        />
                                        {imagePreview && (
                                            <div className="mt-2 relative rounded-xl overflow-hidden h-24">
                                                <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
                                                <button onClick={resetContent}
                                                    className="absolute top-1 right-1 p-1 bg-black/60 rounded-full text-white/80 hover:text-white">
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-2">Pie de foto (opcional)</p>
                                        <textarea
                                            value={caption}
                                            onChange={(e) => setCaption(e.target.value)}
                                            placeholder="Escribe un pie de foto..."
                                            maxLength={200}
                                            rows={3}
                                            className="w-full bg-[#1f2c34] border border-white/10 rounded-xl px-4 py-3 text-white text-[13px] placeholder:text-white/30 resize-none focus:outline-none focus:border-[#00a884]/60 transition-all"
                                        />
                                    </div>
                                </>
                            )}

                            {/* ── VIDEO type ── */}
                            {type === 'video' && (
                                <>
                                    <div>
                                        <p className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-2">Video URL</p>
                                        <input
                                            type="text"
                                            value={content}
                                            onChange={(e) => setContent(e.target.value)}
                                            placeholder="https://... URL del video"
                                            className="w-full bg-[#1f2c34] border border-white/10 rounded-xl px-4 py-2.5 text-white text-[12px] placeholder:text-white/30 focus:outline-none focus:border-[#00a884]/60 transition-all"
                                        />
                                    </div>
                                    <div>
                                        <p className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-2">Pie de video (opcional)</p>
                                        <textarea
                                            value={caption}
                                            onChange={(e) => setCaption(e.target.value)}
                                            placeholder="Descripción del video..."
                                            maxLength={200}
                                            rows={3}
                                            className="w-full bg-[#1f2c34] border border-white/10 rounded-xl px-4 py-3 text-white text-[13px] placeholder:text-white/30 resize-none focus:outline-none focus:border-[#00a884]/60 transition-all"
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Publish button */}
                    <div className="p-4 border-t border-white/10">
                        <button
                            onClick={handlePublish}
                            disabled={publishing || published || (!content)}
                            className={`w-full py-3.5 rounded-xl font-bold text-[14px] flex items-center justify-center gap-2 transition-all ${published
                                ? 'bg-emerald-500 text-white'
                                : (!content || publishing)
                                    ? 'bg-white/10 text-white/30 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-[#25D366] to-[#128C7E] text-white hover:opacity-90 active:scale-[0.98] shadow-lg shadow-[#25D366]/20'
                                }`}
                        >
                            {published ? (
                                <><CheckCircle className="w-5 h-5" /> ¡Publicado!</>
                            ) : publishing ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> Publicando...</>
                            ) : (
                                <><Send className="w-5 h-5" /> Publicar Estado</>
                            )}
                        </button>
                        <p className="text-white/20 text-[10px] text-center mt-2">
                            Se publicará en tu estado de WhatsApp
                        </p>
                    </div>
                </div>

                {/* ── Right panel: iPhone preview ───────────────────────── */}
                <div className="flex flex-col items-center gap-3">
                    <div className="flex items-center gap-2 text-white/50 text-[11px] font-medium">
                        <Eye className="w-3.5 h-3.5" />
                        Vista previa — iPhone 17 Pro Max
                    </div>
                    <IPhoneFrame>
                        <StatusPreviewScreen
                            type={type}
                            content={content || imagePreview}
                            caption={caption}
                            backgroundColor={backgroundColor}
                            font={font}
                            onMenuClose={onClose}
                        />
                    </IPhoneFrame>
                </div>
            </div>
        </div>
    );
}
