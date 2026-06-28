import React from 'react';
import { MapPin, List as ListIcon, ShoppingBag, UserSquare, Paperclip, Smile, Reply, X } from 'lucide-react';
import { safeFormatTime } from './chatUtils';
import AudioPlayer from './AudioPlayer';
import MessageStatusTicks from './MessageStatusTicks';

const MessageBubble = React.memo(function MessageBubble({
    msg,
    chatWhatsapp,
    chatNombre,
    chatId,
    reactionPopupId,
    onReaction,
    onReply,
    onSendReaction,
    allMessages,
}) {
    const isMe = msg.from === 'me' || msg.from === 'bot';
    const isFirstInSeries = msg._isFirstInSeries;

    return (
        <div className={`px-[5%] flex ${isMe ? 'justify-end' : 'justify-start'} group max-w-full relative ${!isFirstInSeries ? 'mt-0.5' : 'mt-2'} ${(msg.reactions && msg.reactions.length > 0) ? 'pb-5' : ''}`}>
            <div className={`
                max-w-[75%] rounded-[7.5px] px-2 pt-1.5 pb-1 shadow-[0_1px_0.5px_rgba(11,20,26,.13)] relative text-[14.2px] z-10
                ${isMe
                    ? `bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] ${isFirstInSeries ? 'rounded-tr-none' : ''}`
                    : `bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] ${isFirstInSeries ? 'rounded-tl-none' : ''}`}
            `}>
                {isFirstInSeries && (
                    <div className={`absolute top-0 w-[11px] h-[13px] overflow-hidden ${isMe ? '-right-[11px] text-[#d9fdd3] dark:text-[#005c4b]' : '-left-[11px] text-white dark:text-[#202c33]'}`}>
                        <svg viewBox="0 0 8 13" width="8" height="13" className={`fill-current ${isMe ? 'float-left' : 'float-right scale-x-[-1]'}`}><path d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z"></path></svg>
                    </div>
                )}

                <div className="relative inline-block min-w-[110px] max-w-full group/msgbody">
                    {msg.contextInfo?.quotedMessage && (
                        <div
                            className="mb-1.5 mt-0.5 rounded px-2 py-1.5 border-l-4 text-[12.5px] cursor-default bg-black/5 dark:bg-white/5"
                            style={{
                                borderColor: (msg.contextInfo.quotedMessage.participant && msg.contextInfo.quotedMessage.participant.includes(chatWhatsapp)) ? '#eb5398' : (isMe ? '#027a61' : '#53bdeb')
                            }}
                        >
                            <div
                                className="font-bold mb-0.5 capitalize truncate"
                                style={{ color: (msg.contextInfo.quotedMessage.participant && msg.contextInfo.quotedMessage.participant.includes(chatWhatsapp)) ? '#eb5398' : (isMe ? '#027a61' : '#53bdeb') }}
                            >
                                {(msg.contextInfo.quotedMessage.participant && msg.contextInfo.quotedMessage.participant.includes(chatWhatsapp)) ? (chatNombre?.split(' ')[0] || 'Candidato') : 'Tú'}
                            </div>
                            <div className="line-clamp-3 text-[#111b21]/80 dark:text-[#e9edef]/80 break-words leading-tight">
                                {(() => {
                                    const qText = msg.contextInfo.quotedMessage.text;
                                    if (qText) return qText;
                                    const quotedMsg = allMessages.find(m => m.id === msg.contextInfo.quotedMessage.stanzaId || m.ultraMsgId === msg.contextInfo.quotedMessage.stanzaId);
                                    if (quotedMsg && quotedMsg.content) {
                                        return quotedMsg.content.replace(/<[^>]*>?/gm, '').substring(0, 100);
                                    }
                                    return '📄 Mensaje multimedia';
                                })()}
                            </div>
                        </div>
                    )}

                    {msg.mediaUrl && (
                        <div className="mb-0.5 rounded overflow-hidden mt-1 cursor-pointer">
                            {msg.type === 'image' && (
                                <img src={msg.mediaUrl} alt="media" loading="lazy" width="260" height="260" className="max-w-[260px] aspect-square object-cover rounded shadow-sm bg-gray-100 dark:bg-gray-800 animate-pulse" onLoad={(e) => e.target.classList.remove('animate-pulse')} />
                            )}
                            {msg.type === 'sticker' && (
                                <img src={msg.mediaUrl} alt="sticker" loading="lazy" width="100" height="100" className="max-w-[100px] max-h-[100px] object-contain" onLoad={(e) => e.target.classList.remove('animate-pulse')} />
                            )}
                            {msg.type === 'video' && (
                                <video src={msg.mediaUrl} controls width="260" className="w-[260px] aspect-video rounded shadow-sm bg-black" />
                            )}
                            {(msg.type === 'audio' || msg.type === 'ptt' || msg.type === 'voice') && (
                                <AudioPlayer src={msg.mediaUrl} />
                            )}
                            {msg.type === 'document' && (
                                <a href={msg.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 bg-black/5 dark:bg-white/5 rounded text-blue-500 hover:text-blue-600 font-medium break-all">
                                    <Paperclip className="w-4 h-4 shrink-0" /> {msg.filename || 'DOCUMENTO ADJUNTO'}
                                </a>
                            )}
                        </div>
                    )}

                    {msg.content && msg.type !== 'sticker' && (
                        <div className="whitespace-pre-wrap leading-[1.35] inline-block break-words" style={{ paddingBottom: '16px', paddingRight: '80px', paddingTop: msg.mediaUrl ? '2px' : '0' }}>
                            {(() => {
                                const rawHtml = msg._formattedHtml || msg.content;

                                const isContact = typeof msg.content === 'string' && msg.content.startsWith('[Tarjeta de Contacto:');
                                if (isContact) {
                                    const nameMatch = msg.content.match(/\[Tarjeta de Contacto:\s*(.+)\]/i);
                                    const name = nameMatch ? nameMatch[1] : 'Contacto';
                                    return (
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-3 bg-black/5 dark:bg-white/5 p-3 rounded-lg border border-black/10 dark:border-white/10 my-1 min-w-[200px] mb-2">
                                                <div className="w-10 h-10 rounded-full bg-[#00a884]/20 flex items-center justify-center shrink-0">
                                                    <UserSquare className="w-6 h-6 text-[#00a884] dark:text-[#00a884]" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{name}</span>
                                                    <span className="text-[11px] text-gray-500 dark:text-gray-400">Tarjeta de Contacto</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                const isInteractive = typeof msg.content === 'string' && msg.content.includes('[Botones:');
                                if (isInteractive) {
                                    const parts = msg.content.split('\n\n[Botones:');
                                    const mainText = parts[0];
                                    const btnsStr = parts[1]?.replace(']', '') || '';
                                    const btns = btnsStr.split(' | ').filter(b => b.trim());
                                    return (
                                        <div className="flex flex-col w-full min-w-[220px]">
                                            <div dangerouslySetInnerHTML={{ __html: mainText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>') }} className="mb-2" />
                                            <div className="flex flex-col gap-1 w-full mt-1">
                                                {btns.map((b, i) => (
                                                    <div key={i} className="w-full text-center py-2 px-3 bg-black/5 dark:bg-white/5 text-blue-500 dark:text-blue-400 text-sm rounded-lg border border-black/10 dark:border-white/10 transition-colors font-medium">
                                                        {b}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                }

                                const isList = typeof msg.content === 'string' && msg.content.includes('[Lista:');
                                if (isList) {
                                    const parts = msg.content.split('\n\n[Lista:');
                                    const mainText = parts[0];
                                    const itemsStr = parts[1]?.replace(']', '') || '';
                                    const items = itemsStr.split(', ');
                                    return (
                                        <div className="flex flex-col w-full min-w-[220px]">
                                            <div dangerouslySetInnerHTML={{ __html: mainText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>') }} className="mb-2" />
                                            <div className="flex flex-col border border-indigo-100 dark:border-indigo-900/30 rounded-lg overflow-hidden mt-1">
                                                <div className="bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 text-xs font-bold py-1.5 px-3 flex justify-between items-center"><ListIcon className="w-3 h-3" /> VER OPCIONES</div>
                                                {items.map((it, i) => (
                                                    <div key={i} className="py-2 px-3 bg-white dark:bg-[#111b21] text-sm border-t border-indigo-50 dark:border-indigo-900/10 font-medium">{it}</div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                }

                                const isLocation = typeof msg.content === 'string' && msg.content.startsWith('[Ubicación:');
                                if (isLocation) {
                                    const nameMatch = msg.content.match(/\[Ubicación:\s*(.+)\]/i);
                                    const name = nameMatch ? nameMatch[1] : 'Mapa';
                                    return (
                                        <div className="flex flex-col w-full min-w-[200px]">
                                            <div className="h-[100px] bg-slate-100 dark:bg-slate-800 w-full rounded-t-lg flex items-center justify-center overflow-hidden relative border border-slate-200 dark:border-slate-700 border-b-0">
                                                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-400 to-transparent"></div>
                                                <MapPin className="w-8 h-8 text-red-500 relative z-10" />
                                            </div>
                                            <div className="bg-white dark:bg-[#111b21] p-3 rounded-b-lg border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
                                                <span className="font-bold text-sm text-slate-800 dark:text-slate-200">{name}</span>
                                                <span className="text-xs text-blue-500 mt-1 cursor-pointer hover:underline">Ver en el mapa</span>
                                            </div>
                                        </div>
                                    );
                                }

                                const isTemplate = typeof msg.content === 'string' && msg.content.startsWith('⚡ Plantilla oficial:');
                                if (isTemplate) {
                                    const lines = msg.content.split('\n\n');
                                    const titleLine = lines[0].replace('⚡ Plantilla oficial:', '').replace(/\*/g, '').trim();
                                    const bodyLines = lines.slice(1).join('\n\n');
                                    return (
                                        <div className="flex flex-col w-full min-w-[220px]">
                                            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#008069]/10 dark:bg-[#00a884]/10 rounded-t-md border-b border-[#008069]/20 dark:border-[#00a884]/20 -mx-0.5 mb-1">
                                                <span className="text-[13px]">⚡</span>
                                                <span className="text-[11px] font-bold text-[#008069] dark:text-[#00a884] uppercase tracking-wide truncate">{titleLine}</span>
                                            </div>
                                            {bodyLines && (
                                                <div className="whitespace-pre-wrap leading-[1.35] text-[14.2px]">
                                                    {bodyLines}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }

                                const isProduct = typeof msg.content === 'string' && msg.content.startsWith('[Producto del Catálogo:');
                                if (isProduct) {
                                    const skuMatch = msg.content.match(/\[Producto del Catálogo:\s*(.+)\]/i);
                                    const sku = skuMatch ? skuMatch[1] : 'SKU';
                                    return (
                                        <div className="flex flex-col w-full min-w-[200px]">
                                            <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg border border-emerald-100 dark:border-emerald-800/30">
                                                <div className="w-10 h-10 rounded bg-white dark:bg-slate-800 flex items-center justify-center shadow-sm">
                                                    <ShoppingBag className="w-6 h-6 text-emerald-500" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-sm text-emerald-800 dark:text-emerald-400">Producto</span>
                                                    <span className="text-xs text-emerald-600 dark:text-emerald-500">Ref: {sku}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                return <div dangerouslySetInnerHTML={{ __html: rawHtml }} />;
                            })()}
                        </div>
                    )}

                    {msg.reactions && msg.reactions.length > 0 && (
                        <div className="absolute -bottom-2.5 right-0 bg-white dark:bg-[#202c33] shadow-md rounded-full px-1.5 py-0.5 text-[11px] z-20 flex gap-0.5 border border-gray-100 dark:border-gray-800">
                            {Array.isArray(msg.reactions) ? msg.reactions.map((r, rIdx) => <span key={rIdx}>{r.emoji || r}</span>) : <span>{msg.reactions}</span>}
                        </div>
                    )}
                </div>

                <div className={`absolute top-1 ${isMe ? '-left-[72px]' : '-right-[72px]'} opacity-0 group-hover:opacity-100 flex gap-1 z-30 transition-opacity`}>
                    <button onClick={() => onReaction(msg.id)} title="Reaccionar" className="p-1.5 bg-white dark:bg-[#202c33] hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm border border-black/5 dark:border-white/5 rounded-[10px]"><Smile className="w-[18px] h-[18px] text-[#54656f] dark:text-[#8696a0]" /></button>
                    <button onClick={() => onReply(msg)} title="Responder" className="p-1.5 bg-white dark:bg-[#202c33] hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm border border-black/5 dark:border-white/5 rounded-[10px]"><Reply className="w-[18px] h-[18px] text-[#54656f] dark:text-[#8696a0]" /></button>
                </div>

                {reactionPopupId === msg.id && (
                    <div className={`absolute -top-[44px] ${isMe ? 'right-0' : 'left-0'} bg-white dark:bg-[#202c33] shadow-lg rounded-full px-3 py-2 flex items-center gap-3 z-50 border border-gray-200 dark:border-gray-800 slide-in-from-bottom-2`}>
                        {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                            <button key={emoji} onClick={() => onSendReaction(msg, emoji)} className="text-xl hover:scale-150 transition-transform origin-bottom">{emoji}</button>
                        ))}
                        <button onClick={() => onReaction(null)} className="ml-1 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"><X className="w-3.5 h-3.5 text-gray-400" /></button>
                    </div>
                )}

                {(() => {
                    const hasVisibleText = msg.content && msg.type !== 'sticker';
                    return (
                        <div className={`flex items-center space-x-1 select-none pr-1 ${
                            hasVisibleText
                                ? 'absolute bottom-[3px] right-2'
                                : 'justify-end mt-1 pb-0.5'
                        }`}>
                            <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-medium leading-none whitespace-nowrap">
                                {safeFormatTime(msg.timestamp)}
                            </p>
                            {isMe && (
                                <MessageStatusTicks status={msg.status} />
                            )}
                        </div>
                    );
                })()}
            </div>

            {msg.status === 'failed' && msg.error && (() => {
                const errStr = String(msg.error).toLowerCase();
                const is24h = msg.metaCode === 131047 || String(msg.metaCode) === '131047'
                    || errStr.includes('131047') || errStr.includes('24 hour') || errStr.includes('re-engagement');
                return (
                    <div className={`text-[10px] text-red-500 font-medium mt-1 ${isMe ? 'text-right' : 'text-left'}`}>
                        {is24h
                            ? '⛔ Ventana de 24 hrs cerrada. Usa el Rayito Verde ⚡ para enviar plantilla.'
                            : `⚠️ Meta: ${msg.error}`}
                    </div>
                );
            })()}
        </div>
    );
}, (prev, next) =>
    prev.msg === next.msg &&
    prev.reactionPopupId === next.reactionPopupId &&
    prev.chatWhatsapp === next.chatWhatsapp &&
    prev.chatId === next.chatId
);

export default MessageBubble;
