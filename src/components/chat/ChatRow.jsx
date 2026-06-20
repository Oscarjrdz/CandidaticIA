import React from 'react';
import { Pin, Trash2, Bell } from 'lucide-react';
import { formatRelativeDate } from '../../utils/formatters';
import { isProfileComplete } from '../../utils/profileUtils';
import { toTitleCase, checkIfUnread, AVATAR_COLORS } from './chatUtils';
import MessageStatusTicks from './MessageStatusTicks';

const ChatRow = React.memo(({ chat, isSelected, isPinned, onSelect, onBlock, onDelete, onTogglePin, onlineReaders, blockLoading, userId, onOpenProfileModal, onMarkAsRead, onMarkAsUnread, onScheduleReminder, tagColorMap }) => {
    const isUnread = checkIfUnread(chat);
    const profileComplete = isProfileComplete(chat);
    const avatarColor = AVATAR_COLORS[((chat.nombre||'C').charCodeAt(0)*7)%10];
    const isEmptyChat = chat.mensajesTotales === 0 || !chat.ultimoMensaje;
    const [imgError, setImgError] = React.useState(false);

    return (
        <div
            onClick={() => onSelect(chat)}
            className={`group flex items-center px-3 py-3 cursor-pointer hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] transition-all duration-200 border-l-0 md:border-l-4 ${isSelected ? 'bg-[#f0f2f5] dark:bg-[#2a3942] border-[#25d366] dark:border-[#00a884] md:shadow-sm md:relative md:z-10' : 'border-transparent'}`}
        >
            <div className={`w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center mr-3 relative overflow-hidden ${isEmptyChat ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[#ffffff] dark:ring-offset-[#111b21]' : ''}`}>
                {chat.profilePic && !imgError ? (
                    <img src={chat.profilePic} className="w-full h-full object-cover" alt="profile" loading="lazy"
                        onError={() => setImgError(true)} />
                ) : (
                    <span className="flex items-center justify-center w-full h-full text-lg font-bold text-white rounded-full"
                        style={{ background: avatarColor }}>
                        {(chat.nombre || 'C')[0].toUpperCase()}
                    </span>
                )}
            </div>
            <div className="flex-1 min-w-0 border-b border-[#f0f2f5] dark:border-[#222e35] pb-3 pt-1">
                <div className="flex flex-row justify-between items-center mb-1 w-full min-w-0">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {isPinned && <Pin className="w-3 h-3 text-[#25d366] dark:text-[#00a884] shrink-0 fill-current" />}
                        <h3 className={`text-[17px] truncate flex-1 min-w-0 transition-colors ${isUnread ? 'text-[#111b21] dark:text-[#e9edef] font-bold' : 'text-[#111b21] dark:text-[#e9edef]'}`}>
                            {toTitleCase(chat.nombreReal || chat.nombre) || chat.whatsapp}
                        </h3>
                        {chat.whatsapp && chat.platform !== 'messenger' && <span className="hidden lg:inline text-[10px] text-[#8696a0] dark:text-[#697882] shrink-0 ml-1">{chat.whatsapp}</span>}
                    </div>
                    <div className="flex flex-col items-end shrink-0 ml-2 gap-0.5">
                        <div className="flex items-center gap-1">
                            {chat.lastMessageFrom === 'me' || chat.lastMessageFrom === 'bot' ? (
                                <MessageStatusTicks status={chat.lastMessageStatus} size="sm" />
                            ) : null}
                            <span className={`text-xs whitespace-nowrap ${isUnread ? 'text-[#25d366] dark:text-[#00a884] font-medium' : 'text-[#667781] dark:text-[#8696a0]'}`}>
                                {formatRelativeDate(chat.ultimoMensaje)}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex justify-between items-center mt-0.5 min-h-[20px]">
                    <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                        {chat.currentVacancyName && (
                            <p className={`text-[14px] truncate flex-1 min-w-0 ${isUnread ? 'text-[#111b21] dark:text-[#e9edef] font-medium' : 'text-[#667781] dark:text-[#8696a0]'}`}>
                                {chat.currentVacancyName}
                            </p>
                        )}
                        <span
                            onClick={(e) => { e.stopPropagation(); onOpenProfileModal && onOpenProfileModal(chat); }}
                            className={`hidden lg:inline text-[11px] font-light tracking-wide shrink-0 font-sans cursor-pointer hover:underline ${profileComplete ? 'text-green-500/90 dark:text-green-400/80' : 'text-red-400/90 dark:text-red-400/70'}`}
                            title="Haz clic para ver/editar el perfil extraído por Brenda"
                        >
                            {chat.currentVacancyName ? '• ' : ''}{profileComplete ? 'Perfil completo' : 'Perfil incompleto'}
                        </span>
                    </div>
                    <div className="flex items-center shrink-0 ml-1 gap-1">
                        {isUnread ? (
                            <>
                                <button
                                    onClick={(e) => onMarkAsRead(chat, e)}
                                    className="hidden lg:block px-1.5 py-0.5 mr-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-[10px] font-medium text-gray-600 dark:text-gray-300 rounded shadow-sm transition-colors shrink-0"
                                    title="Quitar notificación"
                                >
                                    Marcar leído
                                </button>
                                <div className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#25d366] dark:bg-[#00a884] flex items-center justify-center mr-1 shadow-sm shrink-0 text-white text-[11px] font-bold">
                                    {chat.unreadMsgCount || 1}
                                </div>
                            </>
                        ) : (
                            <button
                                onClick={(e) => onMarkAsUnread(chat, e)}
                                className="hidden lg:block px-1.5 py-0.5 mr-1 text-[10px] font-normal text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                                title="Marcar como no leído"
                            >
                                No leído
                            </button>
                        )}

                        <button
                            onClick={(e) => { e.stopPropagation(); onScheduleReminder && onScheduleReminder(chat); }}
                            className="hidden lg:block p-1 rounded text-gray-400 hover:text-amber-500 dark:hover:text-amber-400 transition-colors"
                            title="Programar mensaje"
                        >
                            <Bell className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onTogglePin(chat.id); }}
                            className={`hidden lg:block p-1 rounded transition-colors ${isPinned ? 'text-[#25d366] dark:text-[#00a884]' : 'text-gray-400 hover:text-amber-500 dark:hover:text-amber-400'}`}
                            title={isPinned ? 'Desfijar chat' : 'Fijar chat (máx 3)'}
                        >
                            <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-current' : ''}`} />
                        </button>
                        <button
                            onClick={(e) => onBlock(chat, e)}
                            disabled={blockLoading}
                            className={`hidden lg:flex w-7 h-3.5 rounded-full relative transition-colors duration-200 focus:outline-none flex items-center shadow-inner ${chat.blocked ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                            title={chat.blocked ? 'Reactivar Chat IA' : 'Silenciar Chat IA'}
                        >
                            <div className={`absolute w-2.5 h-2.5 rounded-full bg-white shadow transition-transform duration-200 ${chat.blocked ? 'translate-x-[16px]' : 'translate-x-0.5'}`}></div>
                        </button>
                        <button
                            onClick={(e) => onDelete(chat, e)}
                            className="hidden lg:block ml-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                            title="Eliminar chat"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="hidden lg:flex items-center gap-2 mt-1 text-[10px] text-[#8696a0] dark:text-[#697882] truncate">
                    {chat.edad && <span className="shrink-0">{chat.edad} años</span>}
                    {chat.edad && chat.escolaridad && <span className="shrink-0">•</span>}
                    {chat.escolaridad && <span className="truncate shrink-0">{chat.escolaridad}</span>}
                    {(chat.edad || chat.escolaridad) && chat.municipio && <span className="shrink-0">•</span>}
                    {chat.municipio && <span className="truncate shrink-0">{chat.municipio}</span>}
                    {(chat.edad || chat.escolaridad || chat.municipio) && chat.categoria && <span className="shrink-0">•</span>}
                    {chat.categoria && <span className="truncate shrink-0">{toTitleCase(chat.categoria)}</span>}
                </div>
                {Array.isArray(chat.tags) && chat.tags.length > 0 && (
                    <div className="hidden lg:flex flex-wrap items-center gap-1 mt-1">
                        {chat.tags.slice(0, 4).map(t => {
                            const color = tagColorMap?.get(t) || '#64748b';
                            return (
                                <span key={t} className="inline-flex items-center text-[9px] font-semibold text-white px-2 py-0.5 rounded-full shrink-0"
                                    style={{ backgroundColor: color }}>
                                    {t}
                                </span>
                            );
                        })}
                        {chat.tags.length > 4 && (
                            <span className="text-[9px] text-[#8696a0] dark:text-[#697882]">+{chat.tags.length - 4}</span>
                        )}
                    </div>
                )}
                {(chat.adId || chat.adHeadline || onlineReaders.length > 0) && (
                    <div className="hidden lg:flex items-center justify-between mt-0.5 text-[10px] text-[#8696a0] dark:text-[#697882]">
                        <span className="flex items-center gap-1.5 min-w-0 truncate">
                            {chat.adId && (
                                <button
                                    type="button"
                                    title="Copiar Ad ID"
                                    onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(chat.adId); }}
                                    className="shrink-0 font-mono text-[9px] text-violet-400 dark:text-violet-500 bg-violet-50 dark:bg-violet-500/10 hover:bg-violet-100 dark:hover:bg-violet-500/20 px-1.5 py-0.5 rounded border border-violet-200/60 dark:border-violet-500/20 transition-colors"
                                >
                                    📢 {chat.adId}
                                </button>
                            )}
                        </span>
                        {onlineReaders.length > 0 && (
                            <div className="flex gap-1 shrink-0 ml-2">
                                {onlineReaders.map((r, idx) => (
                                    <span key={idx} className="text-[10px] text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap">
                                        {r.userId === userId ? 'Tú' : (r.userName || '?')}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.chat === nextProps.chat &&
        prevProps.isSelected === nextProps.isSelected &&
        prevProps.isPinned === nextProps.isPinned &&
        prevProps.blockLoading === nextProps.blockLoading &&
        prevProps.onlineReaders.length === nextProps.onlineReaders.length &&
        prevProps.userId === nextProps.userId &&
        prevProps.tagColorMap === nextProps.tagColorMap
    );
});

export default ChatRow;
