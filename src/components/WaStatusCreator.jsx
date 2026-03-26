import React, { useState, useRef, useEffect } from 'react';
import {
    X, Type, Image, Video, Send, Smile, Bold, Italic, Strikethrough,
    Palette, ChevronLeft, Camera, Mic, CheckCircle, Loader2,
    Eye, RotateCcw, Sparkles, Radio
} from 'lucide-react';

// ─── Emoji categories ───────────────────────────────────────────────────────
const EMOJI_DATA = {
    '😀 Caras': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿'],
    '👋 Gestos': ['👋','🤚','🖐','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💪','🦾','🦵','🦶','👂','🦻','👃','👀','👁','👄','🦷','🫀','🫁','🧠'],
    '❤️ Amor': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','🕊','💒','💍','💎','🌹','🌷','💐','🎁','🎀'],
    '🎉 Celebración': ['🎉','🎊','🎈','🎂','🎁','🎀','🪅','🎆','🎇','✨','🌟','⭐','💫','🌙','☀️','🌈','🔥','💥','🎵','🎶','🥂','🍾','🏆','🥇','🎖','🏅','🎗','🎟','🎪','🎠','🎡','🎢','🎭'],
    '🍕 Comida': ['🍕','🍔','🍟','🌭','🌮','🌯','🥙','🧆','🥚','🍳','🥘','🍲','🫕','🥣','🥗','🍿','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🍠','🧀','🍞','🥐','🥖','🥨','🥯','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍩','🍪','🌰','🍯','🍺','🍷','☕'],
    '💼 Trabajo': ['💼','📱','💻','🖥','🖨','⌨️','🖱','🖲','💽','💾','💿','📀','📺','📷','📸','📹','🎥','📡','📞','☎️','📟','📠','📧','📨','📩','📪','📫','📬','📭','📮','🗳','✏️','✒️','🖋','🖊','📝','📁','📂','📅','📆','🗒','📊','📈','📉','🗂','🗃','🗄','🗑'],
    '🌍 Lugares': ['🌍','🌎','🌏','🗺','🧭','🌋','🏔','⛰','🗻','🏕','🏖','🏜','🏝','🏞','🏟','🏛','🏗','🏘','🏚','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩','🕋','⛲','⛺','🌁','🌃','🏙','🌄','🌅','🌆','🌇','🌉'],
};

// ─── WhatsApp paleta de fondos ──────────────────────────────────────────────
const WA_COLORS = [
    '#075E54','#128C7E','#25D366','#1a1a2e','#16213e','#0f3460',
    '#533483','#e94560','#f5a623','#f7b731','#20bf6b','#0652DD',
    '#833471','#EA2027','#1B1B2F','#ffffff',
];

// ─── Fonts map ───────────────────────────────────────────────────────────────
const WA_FONTS = [
    { id: 0, name: 'Sans-serif', css: '"Helvetica Neue", sans-serif' },
    { id: 1, name: 'Serif',      css: 'Georgia, serif' },
    { id: 2, name: 'Monospace',  css: '"Courier New", monospace' },
    { id: 3, name: 'Script',     css: '"Pacifico", cursive' },
    { id: 4, name: 'Bold',       css: '"Arial Black", sans-serif' },
];

// ─── iPhone 17 Pro Max shell ────────────────────────────────────────────────
function IPhoneFrame({ children }) {
    return (
        <div
            className="relative rounded-[52px] overflow-hidden flex-shrink-0"
            style={{
                width: '330px', height: '710px',
                background: 'linear-gradient(180deg,#1c1c1e 0%,#111 100%)',
                boxShadow: '0 0 0 3px #2a2a2a, 0 0 0 4px #444, 0 40px 100px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.07)',
            }}
        >
            {/* Titanium shimmer */}
            <div className="absolute inset-0 rounded-[52px] pointer-events-none"
                style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.06) 0%,transparent 45%,rgba(255,255,255,0.02) 100%)' }} />

            {/* Screen */}
            <div className="absolute inset-[3px] rounded-[50px] overflow-hidden bg-black">
                {/* Dynamic Island */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 bg-black rounded-full" style={{ width:'110px',height:'32px',boxShadow:'0 0 0 1px #222' }} />

                {/* Status bar */}
                <div className="absolute top-0 left-0 right-0 h-14 z-40 flex items-end justify-between px-7 pb-1.5 pointer-events-none">
                    <span className="text-white text-[11px] font-semibold">9:41</span>
                    <div className="flex items-center gap-1.5">
                        <svg width="16" height="11" viewBox="0 0 16 11" fill="white"><rect x="0" y="7" width="3" height="4" rx="0.8"/><rect x="4.5" y="4.5" width="3" height="6.5" rx="0.8"/><rect x="9" y="2" width="3" height="9" rx="0.8"/><rect x="13.5" y="0" width="3" height="11" rx="0.8" opacity="0.35"/></svg>
                        <svg width="16" height="12" viewBox="0 0 16 12" fill="white" opacity="0.9"><path d="M8 9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/><path d="M8 5.5C5.8 5.5 3.8 6.4 2.3 7.9L1 6.6C2.9 4.7 5.3 3.5 8 3.5s5.1 1.2 7 3.1l-1.3 1.3C12.2 6.4 10.2 5.5 8 5.5z"/><path d="M8 1.5C4.7 1.5 1.7 2.8-.1 5L1.2 6.3C3.4 3.8 5.5 2.5 8 2.5s4.6 1.3 6.8 3.8L16 5C14.3 2.8 11.3 1.5 8 1.5z" opacity="0.45"/></svg>
                        <div className="flex items-center gap-[1px]">
                            <div className="relative w-[22px] h-[11px] border border-white/80 rounded-[3px] overflow-hidden"><div className="absolute left-[1px] top-[1px] bottom-[1px] bg-white rounded-[2px]" style={{width:'77%'}}/></div>
                            <div className="w-[2px] h-[6px] bg-white/50 rounded-r ml-[1px]"/>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="absolute inset-0 overflow-hidden">{children}</div>

                {/* Home indicator */}
                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-50 w-28 h-1 bg-white/35 rounded-full" />
            </div>

            {/* Side buttons */}
            <div className="absolute left-[-4px] top-[170px] w-[4px] h-9  bg-[#2a2a2a] rounded-l-sm"/>
            <div className="absolute left-[-4px] top-[220px] w-[4px] h-14 bg-[#2a2a2a] rounded-l-sm"/>
            <div className="absolute left-[-4px] top-[290px] w-[4px] h-14 bg-[#2a2a2a] rounded-l-sm"/>
            <div className="absolute right-[-4px] top-[200px] w-[4px] h-20 bg-[#2a2a2a] rounded-r-sm"/>
        </div>
    );
}

// ─── Preview screen inside iPhone ────────────────────────────────────────────
function StatusPreviewScreen({ type, content, caption, color, font, onClose }) {
    const fontFamily = WA_FONTS.find(f => f.id === font)?.css || WA_FONTS[0].css;
    const isLight    = ['#ffffff','#f5a623','#f7b731','#25D366','#20bf6b'].includes(color);
    const textColor  = isLight ? '#111' : '#fff';

    return (
        <div className="w-full h-full flex flex-col bg-black relative">
            {/* WA header (progress bar + back + info) */}
            <div className="absolute top-14 left-0 right-0 z-30 px-3 pt-2">
                {/* Progress bar */}
                <div className="h-[2px] bg-white/25 rounded-full mb-2"><div className="h-full bg-white rounded-full w-full"/></div>
                <div className="flex items-center gap-2">
                    <button onClick={onClose} className="text-white/90">
                        <ChevronLeft className="w-6 h-6"/>
                    </button>
                    <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-[11px] font-bold">Mi</span>
                    </div>
                    <div>
                        <p className="text-white text-[12px] font-semibold leading-none">Mi estado</p>
                        <p className="text-white/60 text-[9px]">justo ahora</p>
                    </div>
                    <div className="ml-auto flex items-center gap-3">
                        <span className="text-white/70"><Mic className="w-4 h-4"/></span>
                        <span className="text-white/70">⋮</span>
                    </div>
                </div>
            </div>

            {/* Media area */}
            <div className="flex-1 flex items-center justify-center relative overflow-hidden"
                style={{ backgroundColor: type === 'text' ? color : '#000' }}>

                {type === 'text' && (
                    <div className="px-7 text-center w-full" style={{
                        fontFamily,
                        fontSize: content.length > 100 ? '16px' : content.length > 50 ? '22px' : '30px',
                        color: textColor,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        wordBreak: 'break-word',
                        textShadow: isLight ? 'none' : '0 1px 4px rgba(0,0,0,0.25)',
                    }}>
                        {content || <span className="opacity-30">Tu estado aquí…</span>}
                    </div>
                )}

                {type === 'image' && content && (
                    <div className="w-full h-full relative">
                        <img src={content} alt="status" className="w-full h-full object-cover"
                            onError={e => { e.target.style.display = 'none'; }}/>
                        {caption && (
                            <div className="absolute bottom-14 left-0 right-0 px-5 text-center">
                                <p className="text-white text-[13px] font-medium drop-shadow-lg">{caption}</p>
                            </div>
                        )}
                    </div>
                )}
                {type === 'image' && !content && (
                    <div className="text-white/30 text-center">
                        <Image className="w-10 h-10 mx-auto mb-2 opacity-40"/>
                        <p className="text-[12px]">Imagen aquí</p>
                    </div>
                )}

                {type === 'video' && content && <video src={content} className="w-full h-full object-cover" autoPlay loop muted/>}
                {type === 'video' && !content && (
                    <div className="text-white/30 text-center">
                        <Video className="w-10 h-10 mx-auto mb-2 opacity-40"/>
                        <p className="text-[12px]">Video aquí</p>
                    </div>
                )}

                {/* Emoji reactions aside */}
                {content && (
                    <div className="absolute bottom-20 right-3 flex flex-col gap-2 opacity-75">
                        {['❤️','😂','😮','😢','👏','🙏'].map((e,i) => (
                            <span key={i} className="text-xl leading-none filter drop-shadow-sm">{e}</span>
                        ))}
                    </div>
                )}
            </div>

            {/* WA bottom bar */}
            <div className="absolute bottom-7 left-0 right-0 px-3 flex items-center gap-2 z-30">
                <div className="flex-1 bg-[#1f2c34] rounded-full px-4 py-2.5 flex items-center gap-2">
                    <Smile className="w-5 h-5 text-[#8696a0] flex-shrink-0"/>
                    <span className="text-[#8696a0] text-[12px] flex-1 leading-none">Responder</span>
                    <Camera className="w-4 h-4 text-[#8696a0]"/>
                    <Mic className="w-4 h-4 text-[#8696a0]"/>
                </div>
                <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center flex-shrink-0">
                    <Send className="w-5 h-5 text-white" style={{transform:'rotate(45deg)'}}/>
                </div>
            </div>
        </div>
    );
}

// ─── Emoji Picker ─────────────────────────────────────────────────────────────
function EmojiPicker({ onSelect, onClose }) {
    const [activeCategory, setActiveCategory] = useState(Object.keys(EMOJI_DATA)[0]);
    const ref = useRef(null);

    useEffect(() => {
        const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    return (
        <div ref={ref} className="w-[300px] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{ background: '#1f2c34', border: '1px solid rgba(255,255,255,0.08)' }}>
            {/* Category tabs */}
            <div className="flex gap-0 border-b border-white/10 overflow-x-auto">
                {Object.keys(EMOJI_DATA).map(cat => {
                    const icon = cat.split(' ')[0];
                    return (
                        <button key={cat} onClick={() => setActiveCategory(cat)}
                            className={`flex-shrink-0 px-3 py-2 text-[16px] transition-all hover:bg-white/10 border-b-2 ${activeCategory === cat ? 'border-[#00a884]' : 'border-transparent'}`}>
                            {icon}
                        </button>
                    );
                })}
            </div>
            {/* Emoji grid */}
            <div className="p-2 grid grid-cols-9 gap-0.5 max-h-44 overflow-y-auto">
                {(EMOJI_DATA[activeCategory] || []).map((emoji, i) => (
                    <button key={i} onClick={() => onSelect(emoji)}
                        className="text-[20px] p-1 hover:bg-white/10 rounded-lg transition-colors leading-none">
                        {emoji}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function WaStatusCreator({ onClose, showToast }) {
    const [type, setType]                 = useState('text');
    const [content, setContent]           = useState('');
    const [caption, setCaption]           = useState('');
    const [color, setColor]               = useState('#075E54');
    const [font, setFont]                 = useState(0);
    const [publishing, setPublishing]     = useState(false);
    const [published, setPublished]       = useState(false);
    const [imagePreview, setImagePreview] = useState('');
    const [showEmoji, setShowEmoji]       = useState(false);
    const textRef  = useRef(null);
    const fileRef  = useRef(null);

    const resetContent = () => { setContent(''); setCaption(''); setImagePreview(''); };

    const insertEmoji = (emoji) => {
        const el = textRef.current;
        if (!el) { setContent(p => p + emoji); return; }
        const s = el.selectionStart, e = el.selectionEnd;
        const next = content.substring(0, s) + emoji + content.substring(e);
        setContent(next);
        setTimeout(() => { el.selectionStart = el.selectionEnd = s + emoji.length; el.focus(); }, 0);
        setShowEmoji(false);
    };

    const applyFormat = (marker) => {
        const el = textRef.current;
        if (!el) return;
        const s = el.selectionStart, e = el.selectionEnd;
        setContent(content.substring(0, s) + marker + content.substring(s, e) + marker + content.substring(e));
    };

    const handleFile = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => { setContent(reader.result); setImagePreview(reader.result); };
        reader.readAsDataURL(file);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    };

    const handlePublish = async () => {
        if (!content && type === 'text') { showToast('Escribe algo para tu estado 📝', 'warning'); return; }
        if (!content && type !== 'text') { showToast('Agrega una imagen o video', 'warning'); return; }
        setPublishing(true);
        try {
            const res = await fetch('/api/whatsapp/send-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, content, caption, color, font }),
            });
            const data = await res.json();
            if (data.success) {
                setPublished(true);
                showToast('✅ Estado publicado en WhatsApp', 'success');
                setTimeout(() => onClose(), 2200);
            } else {
                showToast(`Error: ${data.error || data.data?.message || 'No se pudo publicar'}`, 'error');
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        } finally {
            setPublishing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(14px)' }}>

            {/* Close overlay */}
            <button className="absolute inset-0 w-full h-full cursor-default" onClick={onClose} tabIndex={-1}/>

            <div className="relative flex items-center gap-6 pointer-events-auto">

                {/* ── LEFT: Editor panel ─────────────────────────────── */}
                <div className="bg-[#111b21] rounded-2xl w-[330px] flex flex-col shadow-2xl border border-white/10 overflow-hidden relative"
                    style={{ maxHeight: '710px' }}>

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10 flex-shrink-0">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] flex items-center justify-center">
                                <Radio className="w-4 h-4 text-white"/>
                            </div>
                            <div>
                                <h2 className="text-white font-bold text-[13px] leading-none">Crear Estado</h2>
                                <p className="text-white/40 text-[10px] mt-0.5">WhatsApp Story</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="text-white/40 hover:text-white/80 p-1 rounded-lg hover:bg-white/10 transition-all">
                            <X className="w-4.5 h-4.5"/>
                        </button>
                    </div>

                    {/* Type selector */}
                    <div className="flex gap-1 p-2.5 bg-[#0d1418] flex-shrink-0">
                        {[
                            { id:'text',  icon:Type,  label:'Texto'  },
                            { id:'image', icon:Image, label:'Imagen' },
                            { id:'video', icon:Video, label:'Video'  },
                        ].map(({ id, icon:Icon, label }) => (
                            <button key={id} onClick={() => { setType(id); resetContent(); }}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-semibold transition-all ${
                                    type === id
                                        ? 'bg-[#00a884] text-white shadow-lg shadow-[#00a884]/20'
                                        : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}>
                                <Icon className="w-3.5 h-3.5"/> {label}
                            </button>
                        ))}
                    </div>

                    {/* Scrollable content */}
                    <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
                        <div className="p-4 space-y-4">

                            {/* TEXT ─────────────────────────────────────── */}
                            {type === 'text' && (
                                <>
                                    {/* Format bar */}
                                    <div className="flex items-center gap-1">
                                        {[
                                            { Icon:Bold,          action:() => applyFormat('*'),  title:'Negrita'  },
                                            { Icon:Italic,        action:() => applyFormat('_'),  title:'Cursiva'  },
                                            { Icon:Strikethrough, action:() => applyFormat('~'),  title:'Tachado'  },
                                        ].map(({ Icon, action, title }) => (
                                            <button key={title} onClick={action} title={title}
                                                className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all">
                                                <Icon className="w-4 h-4"/>
                                            </button>
                                        ))}
                                        {/* Emoji button */}
                                        <div className="relative ml-1">
                                            <button onClick={() => setShowEmoji(v => !v)}
                                                className={`p-2 rounded-lg transition-all ${showEmoji ? 'bg-[#00a884]/20 text-[#00a884]' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
                                                title="Emojis">
                                                <Smile className="w-4 h-4"/>
                                            </button>
                                        </div>
                                        <button onClick={resetContent} title="Limpiar" className="p-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/10 transition-all ml-auto">
                                            <RotateCcw className="w-3.5 h-3.5"/>
                                        </button>
                                    </div>

                                    {/* Textarea */}
                                    <textarea ref={textRef} value={content} onChange={e => setContent(e.target.value)}
                                        placeholder="¿Qué está pasando hoy?…" maxLength={700} rows={4}
                                        className="w-full bg-[#1f2c34] border border-white/10 rounded-xl px-4 py-3 text-white text-[14px] placeholder:text-white/25 resize-none focus:outline-none focus:border-[#00a884]/60 focus:ring-1 focus:ring-[#00a884]/20 transition-all"
                                        style={{ fontFamily: WA_FONTS.find(f => f.id === font)?.css }}/>
                                    <div className="text-right text-white/25 text-[10px] -mt-2">{content.length}/700</div>

                                    {/* Font */}
                                    <div>
                                        <p className="text-white/35 text-[9px] font-bold uppercase tracking-widest mb-2">Fuente</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {WA_FONTS.map(f => (
                                                <button key={f.id} onClick={() => setFont(f.id)}
                                                    className={`px-3 py-1.5 rounded-lg text-[11px] transition-all border ${
                                                        font === f.id ? 'border-[#00a884] bg-[#00a884]/20 text-[#00a884]' : 'border-white/10 text-white/45 hover:border-white/25'}`}
                                                    style={{ fontFamily: f.css }}>
                                                    {f.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Color palette */}
                                    <div>
                                        <p className="text-white/35 text-[9px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                            <Palette className="w-3 h-3"/> Fondo
                                        </p>
                                        <div className="grid grid-cols-8 gap-1.5">
                                            {WA_COLORS.map(c => (
                                                <button key={c} onClick={() => setColor(c)} title={c}
                                                    className="w-8 h-8 rounded-full border-2 transition-all hover:scale-110"
                                                    style={{ backgroundColor:c, borderColor: color === c ? '#00a884' : 'transparent',
                                                        outline: color === c ? '2px solid #00a884' : 'none', outlineOffset:'2px' }}/>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* IMAGE ────────────────────────────────────── */}
                            {type === 'image' && (
                                <>
                                    <div
                                        onDrop={handleDrop}
                                        onDragOver={e => e.preventDefault()}
                                        onClick={() => !imagePreview && fileRef.current?.click()}
                                        className={`relative rounded-2xl overflow-hidden border-2 border-dashed transition-all cursor-pointer ${
                                            imagePreview ? 'border-transparent' : 'border-white/20 hover:border-[#00a884]/60'}`}
                                        style={{ minHeight: '130px' }}>
                                        {imagePreview ? (
                                            <div className="relative">
                                                <img src={imagePreview} alt="preview" className="w-full rounded-2xl object-cover" style={{ maxHeight:'140px' }}/>
                                                <button onClick={e => { e.stopPropagation(); resetContent(); }}
                                                    className="absolute top-2 right-2 p-1 bg-black/70 rounded-full text-white/80 hover:text-white">
                                                    <X className="w-3.5 h-3.5"/>
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center py-10 text-white/30">
                                                <Camera className="w-8 h-8 mb-2 opacity-50"/>
                                                <p className="text-[11px]">Arrastra o toca para subir</p>
                                            </div>
                                        )}
                                    </div>
                                    <input type="file" ref={fileRef} accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])}/>
                                    <p className="text-white/20 text-[10px] text-center">— o URL —</p>
                                    <input type="text" value={imagePreview ? '' : content} onChange={e => { setContent(e.target.value); setImagePreview(''); }}
                                        placeholder="https://imagen.com/foto.jpg"
                                        className="w-full bg-[#1f2c34] border border-white/10 rounded-xl px-4 py-2.5 text-white text-[12px] placeholder:text-white/25 focus:outline-none focus:border-[#00a884]/60 transition-all"/>
                                    <div>
                                        <p className="text-white/35 text-[9px] font-bold uppercase tracking-widest mb-2">Pie de foto</p>
                                        <div className="relative">
                                            <textarea value={caption} onChange={e => setCaption(e.target.value)}
                                                placeholder="Escribe un pie de foto… 😊" maxLength={200} rows={2}
                                                className="w-full bg-[#1f2c34] border border-white/10 rounded-xl px-4 py-2.5 text-white text-[13px] placeholder:text-white/25 resize-none focus:outline-none focus:border-[#00a884]/60 transition-all"/>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* VIDEO ────────────────────────────────────── */}
                            {type === 'video' && (
                                <>
                                    <div>
                                        <p className="text-white/35 text-[9px] font-bold uppercase tracking-widest mb-2">URL del video</p>
                                        <input type="text" value={content} onChange={e => setContent(e.target.value)}
                                            placeholder="https://video.com/clip.mp4"
                                            className="w-full bg-[#1f2c34] border border-white/10 rounded-xl px-4 py-2.5 text-white text-[12px] placeholder:text-white/25 focus:outline-none focus:border-[#00a884]/60 transition-all"/>
                                    </div>
                                    <div>
                                        <p className="text-white/35 text-[9px] font-bold uppercase tracking-widest mb-2">Descripción</p>
                                        <textarea value={caption} onChange={e => setCaption(e.target.value)}
                                            placeholder="Descripción del video… 🎬" maxLength={200} rows={3}
                                            className="w-full bg-[#1f2c34] border border-white/10 rounded-xl px-4 py-2.5 text-white text-[13px] placeholder:text-white/25 resize-none focus:outline-none focus:border-[#00a884]/60 transition-all"/>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Publish CTA */}
                    <div className="p-4 border-t border-white/10 flex-shrink-0">
                        <button onClick={handlePublish}
                            disabled={publishing || published || !content}
                            className={`w-full py-3 rounded-xl font-bold text-[14px] flex items-center justify-center gap-2 transition-all ${
                                published      ? 'bg-emerald-500 text-white' :
                                (!content || publishing) ? 'bg-white/8 text-white/25 cursor-not-allowed' :
                                'bg-gradient-to-r from-[#25D366] to-[#128C7E] text-white hover:opacity-90 active:scale-[0.98] shadow-lg shadow-[#25D366]/20'}`}>
                            {published   ? <><CheckCircle className="w-5 h-5"/> ¡Publicado!</> :
                             publishing  ? <><Loader2 className="w-5 h-5 animate-spin"/> Publicando…</> :
                             <><Send className="w-5 h-5"/> Publicar Estado</>}
                        </button>
                        <p className="text-white/20 text-[9px] text-center mt-1.5">
                            Se publicará en tu estado de WhatsApp
                        </p>
                    </div>

                    {/* Hoisted Emoji Picker to avoid overflow-y clipping */}
                    {showEmoji && (
                        <div className="absolute top-[125px] left-1/2 -translate-x-1/2 z-[99999]">
                            <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmoji(false)} />
                        </div>
                    )}
                </div>

                {/* ── RIGHT: iPhone Preview ──────────────────────────── */}
                <div className="flex flex-col items-center gap-3 flex-shrink-0">
                    <div className="flex items-center gap-1.5 text-white/45 text-[10px] font-medium">
                        <Eye className="w-3 h-3"/> Vista previa · iPhone 17 Pro Max
                    </div>
                    <IPhoneFrame>
                        <StatusPreviewScreen
                            type={type}
                            content={content || imagePreview}
                            caption={caption}
                            color={color}
                            font={font}
                            onClose={onClose}
                        />
                    </IPhoneFrame>
                </div>
            </div>
        </div>
    );
}
