const fs = require('fs');
const path = './src/components/ChatSection.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Quoted Message Fix
const quotedMatch = `                                                    <div className="line-clamp-3 text-[#111b21]/80 dark:text-[#e9edef]/80 break-words leading-tight">
                                                        {msg.contextInfo.quotedMessage.text || '📄 Mensaje multimedia'}
                                                    </div>`;

const quotedReplacement = `                                                    <div className="line-clamp-3 text-[#111b21]/80 dark:text-[#e9edef]/80 break-words leading-tight">
                                                        {(() => {
                                                            const qText = msg.contextInfo.quotedMessage.text;
                                                            if (qText) return qText;
                                                            // Intentar recuperar el texto original buscando en los mensajes renderizados
                                                            const quotedMsg = messages.find(m => m.id === msg.contextInfo.quotedMessage.stanzaId || m.ultraMsgId === msg.contextInfo.quotedMessage.stanzaId);
                                                            if (quotedMsg && quotedMsg.content) {
                                                                return quotedMsg.content.replace(/<[^>]*>?/gm, '').substring(0, 100);
                                                            }
                                                            return '📄 Mensaje multimedia';
                                                        })()}
                                                    </div>`;
content = content.replace(quotedMatch, quotedReplacement);

// 2. Beautiful Bubbles for VCard and Buttons
const textMatch = `                                            {/* Text Rendering */}
                                            {msg.content && (
                                                <div className="whitespace-pre-wrap leading-[1.35] inline-block break-words" style={{ paddingBottom: '16px', paddingRight: '80px', paddingTop: msg.mediaUrl ? '2px' : '0' }} dangerouslySetInnerHTML={{ __html: msg._formattedHtml }}></div>
                                            )}`;

const textReplacement = `                                            {/* Text Rendering */}
                                            {msg.content && (
                                                <div className="whitespace-pre-wrap leading-[1.35] inline-block break-words" style={{ paddingBottom: '16px', paddingRight: '80px', paddingTop: msg.mediaUrl ? '2px' : '0' }}>
                                                    {(() => {
                                                        const rawHtml = msg._formattedHtml || msg.content;
                                                        
                                                        // Detectar Tarjeta de Contacto
                                                        const isContact = typeof msg.content === 'string' && msg.content.startsWith('[Tarjeta de Contacto:');
                                                        if (isContact) {
                                                            const nameMatch = msg.content.match(/\\[Tarjeta de Contacto:\\s*(.+)\\]/i);
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

                                                        // Detectar Botones
                                                        const isInteractive = typeof msg.content === 'string' && msg.content.includes('[Botones:');
                                                        if (isInteractive) {
                                                            const parts = msg.content.split('\\n\\n[Botones:');
                                                            const mainText = parts[0];
                                                            const btnsStr = parts[1]?.replace(']', '') || '';
                                                            const btns = btnsStr.split(' | ').filter(b => b.trim());
                                                            
                                                            return (
                                                                <div className="flex flex-col w-full min-w-[220px]">
                                                                    <div dangerouslySetInnerHTML={{ __html: mainText.replace(/\\n/g, '<br/>') }} className="mb-2" />
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

                                                        return <div dangerouslySetInnerHTML={{ __html: rawHtml }} />;
                                                    })()}
                                                </div>
                                            )}`;
content = content.replace(textMatch, textReplacement);

fs.writeFileSync(path, content, 'utf8');
console.log('UI Patched');
