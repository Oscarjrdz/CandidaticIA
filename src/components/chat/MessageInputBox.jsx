import React, { useState, useRef, lazy, Suspense } from 'react';
const EmojiPicker = lazy(() => import('emoji-picker-react'));
import { MapPin, List as ListIcon, ShoppingBag, UserSquare, MousePointerClick, Plus, Smile, Mic, Send, X, Zap } from 'lucide-react';

const MessageInputBox = React.forwardRef(({ onSend, onTyping, fileInputRef, handleFileUpload, replyingToMsg, onCancelReply, metaTemplates = [], onSendTemplate, onSendVCard, onSendInteractive, onSendLocation, onSendList, onSendProduct, isMobile, hasPendingMedia }, ref) => {
    const [localMessage, setLocalMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [showEmojis, setShowEmojis] = useState(false);
    const [showTemplates, setShowTemplates] = useState(false);
    const textareaRef = useRef(null);

    React.useImperativeHandle(ref, () => ({
        injectText: (newText) => {
            setLocalMessage(prev => {
                const baseStr = prev ? prev.trim() + '\n\n' : '';
                return baseStr + newText;
            });
            setTimeout(() => {
                const input = textareaRef.current;
                if (input) {
                    input.focus();
                    input.style.height = 'auto';
                    input.style.height = input.scrollHeight + 'px';
                }
            }, 50);
        },
        clearText: () => {
            setLocalMessage('');
            const input = textareaRef.current;
            if (input) input.style.height = 'auto';
        },
        getText: () => localMessage,
        setText: (text) => {
            setLocalMessage(text || '');
            setTimeout(() => {
                const input = textareaRef.current;
                if (input) {
                    input.style.height = 'auto';
                    if (text) {
                        input.style.height = input.scrollHeight + 'px';
                        input.focus();
                    }
                }
            }, 50);
        },
        setSendingState: (state) => setSending(state)
    }));

    const handleSubmit = (e) => {
        if (e) e.preventDefault();
        const msg = localMessage.trim();
        if ((!msg && !hasPendingMedia) || sending) return;
        onSend(msg);
        setTimeout(() => {
            const input = textareaRef.current;
            if (input) input.style.height = 'auto';
        }, 50);
    };

    if (isMobile) {
        return (
            <div className="w-full flex flex-col shadow-[0_-2px_10px_rgba(0,0,0,0.02)] z-20 shrink-0">
                {replyingToMsg && (
                    <div className="px-4 py-2 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-gray-800 flex justify-between items-center slide-in-from-bottom-2 duration-200">
                        <div className="flex-1 flex flex-col pl-3 border-l-4 border-blue-500 bg-black/5 dark:bg-white/5 py-1 px-3 rounded-r-lg max-w-[80%]">
                            <span className="text-[11px] font-bold text-blue-500 mb-0.5">Respondiendo a {(replyingToMsg.from === 'me' || replyingToMsg.from === 'bot') ? 'Ti' : 'Candidato'}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{replyingToMsg.content || '📄 Mensaje multimedia'}</span>
                        </div>
                        <button onClick={onCancelReply} className="ml-4 p-2 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}
                <form onSubmit={handleSubmit} className="px-4 py-[10px] bg-[#f0f2f5] dark:bg-[#202c33] flex flex-col gap-2 relative">
                    {showEmojis && (
                        <div className="absolute bottom-full left-2 mb-2 shadow-2xl z-[100] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                            <Suspense fallback={<div className="w-[320px] h-[400px] flex items-center justify-center bg-white dark:bg-[#222e35] rounded-xl"><div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" /></div>}>
                                <EmojiPicker
                                    onEmojiClick={(eData) => setLocalMessage(prev => prev + eData.emoji)}
                                    theme="auto" width={320} height={400}
                                    searchPlaceholder="Buscar emojis..." lazyLoadEmojis={true} skinTonesDisabled={true}
                                />
                            </Suspense>
                        </div>
                    )}

                    <div className="flex items-center gap-4 w-full bg-white/50 dark:bg-black/20 rounded-lg py-2 px-3.5 border border-gray-200/50 dark:border-gray-800/50 overflow-x-auto scrollbar-none shrink-0 text-[#54656f] dark:text-[#8696a0]">
                        <button type="button" title="Emojis" onClick={() => {setShowEmojis(!showEmojis); setShowTemplates(false);}} className={`hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors shrink-0 ${showEmojis ? 'text-blue-500' : ''}`}><Smile className="w-[22px] h-[22px] stroke-[1.5]" /></button>
                        <button type="button" title="Adjuntar Documento" onClick={() => fileInputRef.current?.click()} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors shrink-0"><Plus className="w-[22px] h-[22px] stroke-[1.5]" /></button>
                        <button type="button" title="Enviar Tarjeta de Contacto (vCard)" onClick={onSendVCard} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors shrink-0"><UserSquare className="w-[21px] h-[21px] stroke-[1.5]" /></button>
                        <button type="button" title="Enviar Botones Interactivos" onClick={onSendInteractive} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors shrink-0"><MousePointerClick className="w-[21px] h-[21px] stroke-[1.5]" /></button>
                        <button type="button" title="Enviar Ubicación" onClick={onSendLocation} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors shrink-0"><MapPin className="w-[21px] h-[21px] stroke-[1.5]" /></button>
                        <button type="button" title="Enviar Lista Interactiva" onClick={onSendList} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors shrink-0"><ListIcon className="w-[21px] h-[21px] stroke-[1.5]" /></button>
                        <button type="button" title="Enviar Producto (Catálogo)" onClick={onSendProduct} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors shrink-0"><ShoppingBag className="w-[21px] h-[21px] stroke-[1.5]" /></button>

                        <div className="relative shrink-0">
                            <button type="button" title="Enviar Plantilla Oficial" onClick={() => {setShowTemplates(!showTemplates); setShowEmojis(false);}} className={`hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors ${showTemplates ? 'text-green-500' : ''}`}>
                                <Zap className="w-[21px] h-[21px] stroke-[1.5]" />
                            </button>
                            {showTemplates && (
                                <div className="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-[#111b21] rounded-lg shadow-xl border border-gray-200 dark:border-gray-800 z-[100] max-h-[250px] flex flex-col overflow-hidden">
                                    <div className="px-3 py-2 bg-green-50 dark:bg-green-900/20 text-xs text-green-700 dark:text-green-400 font-bold border-b border-green-100 dark:border-green-800">Plantillas Meta</div>
                                    <div className="overflow-y-auto w-full">
                                        {metaTemplates.length === 0 ? (
                                            <div className="p-3 text-xs text-gray-400 text-center">Buscando plantillas...</div>
                                        ) : (
                                            metaTemplates.map(t => {
                                                const bodyComp = (t.components || []).find(c => (c.type || '').toUpperCase() === 'BODY');
                                                const bodyText = bodyComp?.text || '';
                                                return (
                                                    <button key={t.id} type="button"
                                                        className="w-full text-left p-2.5 hover:bg-gray-50 dark:hover:bg-[#202c33] border-b border-gray-100 dark:border-gray-800 transition-colors"
                                                        onClick={(e) => { e.preventDefault(); onSendTemplate(t); setShowTemplates(false); }}
                                                    >
                                                        <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{t.name}</div>
                                                        {bodyText && <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate mt-0.5" title={bodyText}>{bodyText}</div>}
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                    </div>

                    <div className="flex items-end w-full gap-2">
                        <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-lg border-none shadow-[0_1px_0_rgba(11,20,26,.05)] focus-within:shadow-[0_1px_2px_rgba(11,20,26,.1)] transition-shadow flex items-center pr-1">
                            <textarea
                                ref={textareaRef}
                                id="chat-msg-input"
                                autoComplete="off" rows={1}
                                className="w-full bg-transparent border-none outline-none py-2.5 px-3 text-[#111b21] dark:text-[#d1d7db] placeholder-[#8696a0] resize-none text-[14px] max-h-24 overflow-y-auto min-h-[36px]"
                                placeholder="Escribe un mensaje"
                                value={localMessage}
                                onChange={(e) => { setLocalMessage(e.target.value); onTyping(); }}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
                                onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                            />
                            {localMessage && (
                                <button type="button" title="Limpiar texto"
                                    onClick={() => { setLocalMessage(''); const el = textareaRef.current; if (el) el.style.height = 'auto'; }}
                                    className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded-full mr-1 shrink-0"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                        <div className="mb-[4px] text-[#54656f] dark:text-[#8696a0] shrink-0">
                            {(localMessage.trim() || hasPendingMedia) ? (
                                <button type="submit" disabled={sending} className="p-1.5 text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors">
                                    <Send className="w-[22px] h-[22px]" />
                                </button>
                            ) : (
                                <button type="button" className="p-1.5 hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors">
                                    <Mic className="w-[22px] h-[22px]" />
                                </button>
                            )}
                        </div>
                    </div>
                </form>
            </div>
        );
    }

    return (
        <div className="w-full flex flex-col shadow-[0_-2px_10px_rgba(0,0,0,0.02)] z-20 shrink-0">
            {replyingToMsg && (
                <div className="px-4 py-2 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-gray-800 flex justify-between items-center slide-in-from-bottom-2 duration-200">
                    <div className="flex-1 flex flex-col pl-3 border-l-4 border-blue-500 bg-black/5 dark:bg-white/5 py-1 px-3 rounded-r-lg max-w-[80%]">
                        <span className="text-[11px] font-bold text-blue-500 mb-0.5">Respondiendo a {(replyingToMsg.from === 'me' || replyingToMsg.from === 'bot') ? 'Ti' : 'Candidato'}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{replyingToMsg.content || '📄 Mensaje multimedia'}</span>
                    </div>
                    <button onClick={onCancelReply} className="ml-4 p-2 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}
            <form onSubmit={handleSubmit} className="px-3 py-2 bg-[#f0f2f5] dark:bg-[#202c33] flex items-end gap-2 relative">
                {showEmojis && (
                    <div className="absolute bottom-full left-2 mb-2 shadow-2xl z-[100] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                        <Suspense fallback={<div className="w-[320px] h-[400px] flex items-center justify-center bg-white dark:bg-[#222e35] rounded-xl"><div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" /></div>}>
                            <EmojiPicker
                                onEmojiClick={(eData) => setLocalMessage(prev => prev + eData.emoji)}
                                theme="auto" width={320} height={400}
                                searchPlaceholder="Buscar emojis..." lazyLoadEmojis={true} skinTonesDisabled={true}
                            />
                        </Suspense>
                    </div>
                )}

                {showTemplates && (
                    <div className="absolute bottom-full left-2 mb-2 w-64 bg-white dark:bg-[#111b21] rounded-lg shadow-xl border border-gray-200 dark:border-gray-800 z-[100] max-h-[300px] flex flex-col overflow-hidden">
                        <div className="px-3 py-2 bg-green-50 dark:bg-green-900/20 text-xs text-green-700 dark:text-green-400 font-bold border-b border-green-100 dark:border-green-800">Plantillas Meta</div>
                        <div className="overflow-y-auto w-full font-sans">
                            {metaTemplates.length === 0 ? (
                                <div className="p-3 text-xs text-gray-400 text-center">Buscando plantillas...</div>
                            ) : (
                                metaTemplates.map(t => {
                                    const bodyComp = (t.components || []).find(c => (c.type || '').toUpperCase() === 'BODY');
                                    const bodyText = bodyComp?.text || '';
                                    return (
                                        <button key={t.id} type="button"
                                            className="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-[#202c33] border-b border-gray-100 dark:border-gray-800 transition-colors"
                                            onClick={(e) => { e.preventDefault(); onSendTemplate(t); setShowTemplates(false); }}
                                        >
                                            <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{t.name}</div>
                                            {bodyText && <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5" title={bodyText}>{bodyText}</div>}
                                            <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-widest mt-1">{t.category}</div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}

                <div className="flex items-center text-[#54656f] dark:text-[#8696a0] shrink-0">
                    <button type="button" title="Emojis" onClick={() => {setShowEmojis(!showEmojis); setShowTemplates(false);}} className={`w-9 h-9 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${showEmojis ? 'text-blue-500' : ''}`}><Smile className="w-[22px] h-[22px] stroke-[1.5]" /></button>
                    <button type="button" title="Adjuntar Documento" onClick={() => fileInputRef.current?.click()} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><Plus className="w-[22px] h-[22px] stroke-[1.5]" /></button>
                    <button type="button" title="Enviar Tarjeta de Contacto (vCard)" onClick={onSendVCard} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><UserSquare className="w-[22px] h-[22px] stroke-[1.5]" /></button>
                    <button type="button" title="Enviar Botones Interactivos" onClick={onSendInteractive} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><MousePointerClick className="w-[22px] h-[22px] stroke-[1.5]" /></button>
                    <button type="button" title="Enviar Ubicación" onClick={onSendLocation} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><MapPin className="w-[22px] h-[22px] stroke-[1.5]" /></button>
                    <button type="button" title="Enviar Lista Interactiva" onClick={onSendList} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><ListIcon className="w-[22px] h-[22px] stroke-[1.5]" /></button>
                    <button type="button" title="Enviar Producto (Catálogo)" onClick={onSendProduct} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><ShoppingBag className="w-[22px] h-[22px] stroke-[1.5]" /></button>
                    <button type="button" title="Enviar Plantilla Oficial" onClick={() => {setShowTemplates(!showTemplates); setShowEmojis(false);}} className={`w-9 h-9 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${showTemplates ? 'text-green-500' : ''}`}><Zap className="w-[22px] h-[22px] stroke-[1.5]" /></button>
                </div>

                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />

                <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-lg shadow-[0_1px_0_rgba(11,20,26,.05)] focus-within:shadow-[0_1px_2px_rgba(11,20,26,.1)] transition-shadow flex items-center pr-2 min-w-0">
                    <textarea
                        ref={textareaRef}
                        id="chat-msg-input"
                        autoComplete="off" rows={1}
                        className="w-full bg-transparent border-none outline-none py-2 px-3 text-[#111b21] dark:text-[#d1d7db] placeholder-[#8696a0] resize-none text-[15px] max-h-36 overflow-y-auto min-h-[36px]"
                        placeholder="Escribe un mensaje"
                        value={localMessage}
                        onChange={(e) => { setLocalMessage(e.target.value); onTyping(); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
                        onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                    />
                    {localMessage && (
                        <button type="button" title="Limpiar texto"
                            onClick={() => { setLocalMessage(''); const el = textareaRef.current; if (el) el.style.height = 'auto'; }}
                            className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded-full shrink-0"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                <div className="text-[#54656f] dark:text-[#8696a0] shrink-0">
                    {(localMessage.trim() || hasPendingMedia) ? (
                        <button type="submit" disabled={sending} className="p-1.5 text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors">
                            <Send className="w-[22px] h-[22px]" />
                        </button>
                    ) : (
                        <button type="button" className="p-1.5 hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors">
                            <Mic className="w-[22px] h-[22px]" />
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
});

export default MessageInputBox;
