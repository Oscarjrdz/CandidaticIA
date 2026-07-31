import React from 'react';
import { MapPin, List as ListIcon, ShoppingBag, UserSquare, Paperclip, Smile, Reply, X } from 'lucide-react';
import { safeFormatTime } from './chatUtils';
import AudioPlayer from './AudioPlayer';
import MessageStatusTicks from './MessageStatusTicks';

const playedEntryAnimations = new Set();
const playedEntryAnimationOrder = [];
const MAX_PLAYED_ENTRY_ANIMATIONS = 800;
const OUTGOING_STATUS_REVEAL_MS = 800;
// Evento que avisa que la FASE 1 (fila abriendo el espacio, .chat-row-enter) de una
// burbuja terminó — lo escucha ChatSection.jsx para encolar la siguiente burbuja de un
// grupo (texto + fotos del banco) recién cuando la anterior de verdad terminó de entrar,
// en vez de un setTimeout a ciegas. Ver MEDIA_REVEAL_FALLBACK_MS más abajo para el caso
// sin animación (prefers-reduced-motion) donde este evento nunca dispara solo.
export const ENTRY_REVEALED_EVENT = 'chat-bubble-entry-revealed';
const MEDIA_REVEAL_FALLBACK_MS = 260;

const rememberEntryAnimation = (key) => {
    if (!key || playedEntryAnimations.has(key)) return;
    playedEntryAnimations.add(key);
    playedEntryAnimationOrder.push(key);
    while (playedEntryAnimationOrder.length > MAX_PLAYED_ENTRY_ANIMATIONS) {
        const oldest = playedEntryAnimationOrder.shift();
        if (oldest) playedEntryAnimations.delete(oldest);
    }
};

// Fade-in de imagen: se corre EXACTAMENTE UNA VEZ por URL. Sin esto, cuando la burbuja se
// re-renderiza/re-monta (merge del eco optimista↔servidor, Virtuoso re-insertando el nodo,
// palomita de estado) el estado de "cargada" se reiniciaba y la imagen hacía fade OTRA VEZ →
// "se ve dos veces la animación sobre la misma foto". Un Set a nivel de módulo (como el de las
// entradas de burbuja) recuerda qué imágenes ya aparecieron: la 2ª vez se muestran al instante.
const fadedInImages = new Set();
const fadedInImagesOrder = [];
const MAX_FADED_IN_IMAGES = 600;
const rememberFadedInImage = (url) => {
    if (!url || fadedInImages.has(url)) return;
    fadedInImages.add(url);
    fadedInImagesOrder.push(url);
    while (fadedInImagesOrder.length > MAX_FADED_IN_IMAGES) {
        const oldest = fadedInImagesOrder.shift();
        if (oldest) fadedInImages.delete(oldest);
    }
};

const SmoothMediaImage = React.memo(function SmoothMediaImage({ src, previewSrc, alt, className, width, height, loading = 'lazy', fetchPriority = 'auto', revealReady = true }) {
    const initialSrc = previewSrc || src;
    const [visibleSrc, setVisibleSrc] = React.useState(initialSrc);
    const [overlaySrc, setOverlaySrc] = React.useState(null);
    const [overlayVisible, setOverlayVisible] = React.useState(false);
    const visibleSrcRef = React.useRef(initialSrc);
    const transitionTimerRef = React.useRef(null);

    // Fade-in al cargar: las imágenes del BANCO son URLs de red (sin preview local como al
    // subir desde el teléfono), así que la burbuja entra con el marco gris y la imagen
    // "aparece de golpe" ~100-300ms después = parpadeo. Con esto la imagen entra con un fade
    // suave sobre el marco. Las que ya están en caché/completas se marcan cargadas sin fade
    // (no re-parpadean al re-renderizar).
    const primaryImgRef = React.useRef(null);
    // Arranca "cargada" (sin fade) si:
    //   a) ya hizo fade en esta sesión (Set), o
    //   b) el browser ya la tiene en caché (complete+naturalWidth): sucede con imágenes del
    //      banco que el reclutador ya vio en el panel de preview antes de inyectarlas → el
    //      primer render nace directamente en opacity-100, sin marco gris ni parpadeo.
    const [primaryLoaded, setPrimaryLoaded] = React.useState(() => {
        if (fadedInImages.has(visibleSrc)) return true;
        // Probe de caché síncrono: funciona sólo en el browser (no SSR).
        if (typeof document !== 'undefined' && visibleSrc) {
            const probe = new window.Image();
            probe.src = visibleSrc;
            if (probe.complete && probe.naturalWidth > 0) {
                rememberFadedInImage(visibleSrc);
                return true;
            }
        }
        return false;
    });
    // Usamos un ref para la URL visible activa, así markPrimaryLoaded no recrea la referencia
    // (y no vuelve a disparar el useEffect) cada vez que visibleSrc cambia. Esto elimina un
    // ciclo extra de setPrimaryLoaded(false) → re-render opaco → parpadeo en imágenes del banco.
    const visibleSrcForCallbackRef = React.useRef(visibleSrc);
    React.useLayoutEffect(() => { visibleSrcForCallbackRef.current = visibleSrc; }, [visibleSrc]);
    const markPrimaryLoaded = React.useCallback(() => {
        rememberFadedInImage(visibleSrcForCallbackRef.current);
        setPrimaryLoaded(true);
    }, []); // estable — no depende de visibleSrc directamente
    React.useEffect(() => {
        if (fadedInImages.has(visibleSrc)) { setPrimaryLoaded(prev => prev ? prev : true); return; }
        const el = primaryImgRef.current;
        if (el && el.complete && el.naturalWidth > 0) { markPrimaryLoaded(); return; }
        // Solo bajar a "no cargada" si aún no estamos en false (evita el re-render extra que
        // provoca el parpadeo gris en las imágenes de banco sin previewSrc local).
        setPrimaryLoaded(prev => prev ? false : prev);
    }, [visibleSrc, markPrimaryLoaded]);

    React.useEffect(() => {
        if (!src || src === visibleSrcRef.current) return undefined;

        let cancelled = false;
        let settled = false;
        const finishWithOverlay = () => {
            if (cancelled || settled) return;
            settled = true;
            setOverlaySrc(src);
            requestAnimationFrame(() => setOverlayVisible(true));
            if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
            transitionTimerRef.current = window.setTimeout(() => {
                visibleSrcRef.current = src;
                setVisibleSrc(src);
                setOverlaySrc(null);
                setOverlayVisible(false);
            }, 180);
        };
        const nextImage = new Image();
        nextImage.decoding = 'async';
        nextImage.onload = finishWithOverlay;
        nextImage.onerror = () => {
            if (cancelled) return;
            visibleSrcRef.current = src;
            setVisibleSrc(src);
        };
        nextImage.src = src;

        if (nextImage.complete && nextImage.naturalWidth > 0) {
            finishWithOverlay();
        }

        return () => {
            cancelled = true;
            if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
        };
    }, [src]);

    return (
        <span className="relative block h-full w-full overflow-hidden">
            <img
                ref={primaryImgRef}
                src={visibleSrc || src}
                alt={alt}
                loading={loading}
                decoding="async"
                fetchPriority={fetchPriority}
                width={width}
                height={height}
                draggable={false}
                onLoad={markPrimaryLoaded}
                className={`${className} transition-opacity duration-300 ease-out ${primaryLoaded && revealReady ? 'opacity-100' : 'opacity-0'}`}
            />
            {overlaySrc && (
                <img
                    src={overlaySrc}
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                    fetchPriority={fetchPriority}
                    width={width}
                    height={height}
                    draggable={false}
                    className={`${className} absolute inset-0 transition-opacity duration-200 ease-out ${overlayVisible ? 'opacity-100' : 'opacity-0'}`}
                />
            )}
        </span>
    );
});

const MessageBubble = React.memo(function MessageBubble({
    msg,
    chatWhatsapp,
    chatNombre,
    _chatId,
    reactionPopupId,
    onReaction,
    onReply,
    onSendReaction,
}) {
    const isMe = msg.from === 'me' || msg.from === 'bot';
    const isFirstInSeries = msg._isFirstInSeries;
    const entryAnimationKey = String(msg._clientKey || msg.id || msg.ultraMsgId || `${msg.timestamp || msg.fecha || ''}-${msg.content || msg.mediaUrl || ''}`);
    const entryAnimationDecisionRef = React.useRef({ key: null, value: false });
    if (entryAnimationDecisionRef.current.key !== entryAnimationKey) {
        entryAnimationDecisionRef.current = {
            key: entryAnimationKey,
            value: Boolean(msg._animateIn && entryAnimationKey && !playedEntryAnimations.has(entryAnimationKey))
        };
    }
    const shouldPlayEntryAnimation = entryAnimationDecisionRef.current.value;
    const [heldStatusAnimationKey, setHeldStatusAnimationKey] = React.useState(() =>
        isMe && shouldPlayEntryAnimation ? entryAnimationKey : null
    );
    const displayStatus = heldStatusAnimationKey === entryAnimationKey ? 'pending' : msg.status;
    const mediaFrameClass = msg.type === 'image'
        ? 'w-[260px] max-w-[70vw] aspect-square bg-gray-100 dark:bg-gray-800'
        : msg.type === 'sticker'
            ? 'w-[100px] h-[100px]'
            : '';
    // entryDone: al terminar la animación se RETIRAN las clases + el opacity:0 para siempre.
    // Sin esto, cuando Virtuoso re-inserta el nodo de la burbuja para re-medir (frecuente bajo
    // TRÁFICO, y más en burbujas largas como la info de vacante), el navegador REINICIABA la
    // animación con la clase aún puesta → parpadeo repetido ("estática de TV"). Igual que el
    // fix del doble-fade en ChatRow.
    const [entryDone, setEntryDone] = React.useState(false);
    const playEntry = shouldPlayEntryAnimation && !entryDone;
    const hasMedia = Boolean(msg.mediaUrl);
    // Fase 1 (fila abre el espacio, clip-path) aplica a CUALQUIER burbuja con entrada nueva,
    // media o no — no cambia layout, así que es Virtuoso-safe también para media.
    const playRowEntry = playEntry;
    const rowEntryClass = playRowEntry ? 'chat-message-row-enter' : '';
    // Fase 2 (el globo entero se desliza+fade) solo para SIN media: una burbuja con imagen ya
    // tiene su propio fade en SmoothMediaImage — animar el globo completo ENCIMA de eso era
    // el doble-fade/parpadeo que había antes. Ahora se coordinan en SECUENCIA (no se quita
    // ninguna): la fase 1 revela el marco vacío, y solo CUANDO ESA termina (mediaRevealReady,
    // más abajo) se le permite a SmoothMediaImage empezar su propio fade — nunca al mismo tiempo.
    const playBubbleEntry = playEntry && !hasMedia;
    const bubbleEntryClass = playBubbleEntry
        ? (isMe ? 'chat-message-enter-outgoing' : 'chat-message-enter-incoming')
        : '';

    // Arranca en false SOLO si esta burbuja tiene media Y va a animar su entrada — en ese caso
    // SmoothMediaImage debe esperar a que la fase 1 (fila) termine antes de mostrar la foto. Si
    // no hay media o no hay animación de entrada (mensaje histórico), no hay nada que esperar.
    const [mediaRevealReady, setMediaRevealReady] = React.useState(() => !(hasMedia && playRowEntry));
    // Red de seguridad: si el navegador nunca dispara el animationend de la fase 1 (usuario con
    // prefers-reduced-motion, donde la animación CSS se desactiva por completo — ver index.css),
    // la imagen se quedaría invisible para siempre esperando un evento que nunca llega.
    React.useEffect(() => {
        if (mediaRevealReady) return undefined;
        const timer = window.setTimeout(() => setMediaRevealReady(true), MEDIA_REVEAL_FALLBACK_MS);
        return () => window.clearTimeout(timer);
    }, [mediaRevealReady]);

    React.useEffect(() => {
        if (!shouldPlayEntryAnimation) return undefined;
        rememberEntryAnimation(entryAnimationKey);

        if (!isMe) return undefined;
        setHeldStatusAnimationKey(entryAnimationKey);
        const timer = window.setTimeout(() => {
            setHeldStatusAnimationKey(currentKey => currentKey === entryAnimationKey ? null : currentKey);
        }, OUTGOING_STATUS_REVEAL_MS);
        return () => window.clearTimeout(timer);
    }, [shouldPlayEntryAnimation, entryAnimationKey, isMe]);

    // Bubble starts invisible; CSS animation overrides once it fires. Se retira con entryDone.
    // Solo para burbujas SIN media (las de media no animan el globo → no deben nacer invisibles).
    const bubbleEntryStyle = playBubbleEntry ? { opacity: 0 } : undefined;

    return (
        <div
            onAnimationEnd={(e) => {
                if (e.animationName === 'chat-message-enter-outgoing' || e.animationName === 'chat-message-enter-incoming') setEntryDone(true);
                if (e.animationName === 'chat-row-enter') {
                    setMediaRevealReady(true);
                    // Avisa a quien esté esperando (p.ej. el envío escalonado del banco de
                    // respuestas en ChatSection.jsx) que ESTA burbuja ya terminó de entrar.
                    window.dispatchEvent(new CustomEvent(ENTRY_REVEALED_EVENT, { detail: { key: entryAnimationKey } }));
                }
            }}
            className={`px-[5%] flex ${isMe ? 'justify-end' : 'justify-start'} group max-w-full relative ${!isFirstInSeries ? 'mt-0.5' : 'mt-2'} ${(msg.reactions && msg.reactions.length > 0) ? 'pb-5' : ''} ${rowEntryClass}`}>
            <div style={bubbleEntryStyle} className={`
                max-w-[75%] rounded-[7.5px] px-2 pt-1.5 pb-1 shadow-[0_1px_0.5px_rgba(11,20,26,.13)] relative text-[14.2px] z-10
                ${bubbleEntryClass}
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
                            {(() => {
                                const q = msg.contextInfo.quotedMessage;
                                if (q.text) return <div className="line-clamp-3 text-[#111b21]/80 dark:text-[#e9edef]/80 break-words leading-tight">{q.text}</div>;

                                // Sin texto guardado: el padre ya resolvió la cita en el memo de
                                // displayMessages (_quotedResolved) para NO pasar allMessages a cada
                                // burbuja (eso re-renderizaba todas en cada mensaje SSE → parpadeo).
                                const quotedMsg = msg._quotedResolved;
                                if (quotedMsg?.content) {
                                    return <div className="line-clamp-3 text-[#111b21]/80 dark:text-[#e9edef]/80 break-words leading-tight">{quotedMsg.content.replace(/<[^>]*>?/gm, '').substring(0, 100)}</div>;
                                }

                                const mediaUrl = q.mediaUrl || quotedMsg?.mediaUrl;
                                const mediaType = q.type || quotedMsg?.type;
                                const MEDIA_LABELS = { image: '📷 Foto', sticker: '🖼️ Sticker', video: '🎥 Video', audio: '🎵 Audio', ptt: '🎵 Audio', voice: '🎵 Audio', document: '📄 Documento' };
                                const label = MEDIA_LABELS[mediaType] || '📄 Mensaje multimedia';

                                return (
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 min-w-0 line-clamp-3 text-[#111b21]/80 dark:text-[#e9edef]/80 break-words leading-tight">{label}</div>
                                        {mediaUrl && (mediaType === 'image' || mediaType === 'sticker') && (
                                            <img src={mediaUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" loading="lazy" />
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {msg.mediaUrl && (
                        <div className={`${mediaFrameClass} mb-0.5 rounded overflow-hidden mt-1 cursor-pointer`}>
                            {msg.type === 'image' && (
                                <SmoothMediaImage src={msg.mediaUrl} previewSrc={msg._displayMediaUrl || msg._localMediaUrl} alt="media" loading={isMe ? 'eager' : 'lazy'} fetchPriority={isMe ? 'high' : 'auto'} width="260" height="260" className="h-full w-full object-cover rounded shadow-sm bg-gray-100 dark:bg-gray-800" revealReady={mediaRevealReady} />
                            )}
                            {msg.type === 'sticker' && (
                                <SmoothMediaImage src={msg.mediaUrl} previewSrc={msg._displayMediaUrl || msg._localMediaUrl} alt="sticker" loading={isMe ? 'eager' : 'lazy'} fetchPriority={isMe ? 'high' : 'auto'} width="100" height="100" className="h-full w-full object-contain" revealReady={mediaRevealReady} />
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

                                const isTemplate = typeof msg.content === 'string' && msg.content.startsWith('⚡ Plantilla');
                                if (isTemplate) {
                                    const lines = msg.content.split('\n\n');
                                    const titleLine = lines[0].replace(/^⚡\s*Plantilla[^:]*:/, '').replace(/\*/g, '').trim();
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

                <div className={`absolute top-1 ${isMe ? '-left-[72px]' : '-right-[72px]'} w-[68px] h-8 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto flex gap-1 z-30`}>
                    <button onClick={() => onReaction(msg.id)} title="Reaccionar" className="w-8 h-8 flex items-center justify-center bg-white dark:bg-[#202c33] hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm border border-black/5 dark:border-white/5 rounded-[10px]"><Smile className="w-[18px] h-[18px] text-[#54656f] dark:text-[#8696a0]" /></button>
                    <button onClick={() => onReply(msg)} title="Responder" className="w-8 h-8 flex items-center justify-center bg-white dark:bg-[#202c33] hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm border border-black/5 dark:border-white/5 rounded-[10px]"><Reply className="w-[18px] h-[18px] text-[#54656f] dark:text-[#8696a0]" /></button>
                </div>

                {reactionPopupId === msg.id && (
                    <div className={`absolute -top-[44px] ${isMe ? 'right-0' : 'left-0'} bg-white dark:bg-[#202c33] shadow-lg rounded-full px-3 py-2 flex items-center gap-3 z-50 border border-gray-200 dark:border-gray-800 slide-in-from-bottom-2`}>
                        {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                            <button key={emoji} onClick={() => onSendReaction(msg, emoji)} className="text-xl leading-none hover:bg-black/5 dark:hover:bg-white/5 rounded-full w-8 h-8 flex items-center justify-center">{emoji}</button>
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
                                : 'justify-end mt-1 pb-0.5 min-h-[13px]'
                        }`}>
                            <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-medium leading-none whitespace-nowrap">
                                {safeFormatTime(msg.timestamp || msg.fecha)}
                            </p>
                            {isMe && (
                                <MessageStatusTicks status={displayStatus} />
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
