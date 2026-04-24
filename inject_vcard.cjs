const fs = require('fs');
const path = './src/components/ChatSection.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Imports
content = content.replace(/import \{ Search, /, 'import { UserSquare, MousePointerClick, Search, ');

// 2. MessageInputBox Props
content = content.replace(/onCancelReply, metaTemplates = \[\], onSendTemplate \}, ref\) => \{/, 'onCancelReply, metaTemplates = [], onSendTemplate, onSendVCard, onSendInteractive }, ref) => {');

// 3. MessageInputBox Buttons
const buttonsInjection = `
                <button type="button" title="Enviar Tarjeta de Contacto (vCard)" onClick={onSendVCard} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors"><UserSquare className="w-[24px] h-[24px] stroke-[1.5]" /></button>
                <button type="button" title="Enviar Botones Interactivos" onClick={onSendInteractive} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors"><MousePointerClick className="w-[24px] h-[24px] stroke-[1.5]" /></button>
`;
content = content.replace(/<button type="button" title="Adjuntar Documento"[\s\S]*?<\/button>/, match => match + buttonsInjection);

// 4. ChatSection States
const statesInjection = `
    const [showVCardModal, setShowVCardModal] = useState(false);
    const [showInteractiveModal, setShowInteractiveModal] = useState(false);
    const [vcardName, setVcardName] = useState('');
    const [vcardPhone, setVcardPhone] = useState('');
    const [interactiveBody, setInteractiveBody] = useState('');
    const [interactiveBtns, setInteractiveBtns] = useState(['', '', '']);
`;
content = content.replace(/const \[selectedChat, setSelectedChat\] = useState\(null\);/, match => match + statesInjection);

// 5. handleSendVCard & handleSendInteractive
const handlersInjection = `
    const handleSendVCard = (name, phone) => {
        if (!name || !phone || !selectedChat) return;
        autoSilenceBot(selectedChat);
        
        const optimisticId = 'temp-' + Date.now();
        setMessages(prev => [...(prev || []), {
            id: optimisticId,
            content: \`[Tarjeta de Contacto: \${name}]\`,
            tipo: 'contacts',
            from: 'me',
            enviado_por_agente: 1,
            status: 'pending',
            fecha: new Date().toISOString()
        }]);

        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                candidateId: selectedChat.id, 
                message: name, 
                type: 'contacts', 
                extraParams: { contactName: name, contactPhone: phone } 
            })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                setMessages(prev => prev.map(m => m.id === optimisticId ? data.message : m));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: selectedChat.id } }));
            } else {
                setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m));
                showToast && showToast(\`Error al enviar vCard: \${data.error || 'Desconocido'}\`, 'error');
            }
        });
    };

    const handleSendInteractive = (bodyTxt, buttons) => {
        if (!bodyTxt || buttons.length === 0 || !selectedChat) return;
        autoSilenceBot(selectedChat);
        
        const optimisticId = 'temp-' + Date.now();
        setMessages(prev => [...(prev || []), {
            id: optimisticId,
            content: \`\${bodyTxt}\\n\\n[Botones: \${buttons.join(' | ')}]\`,
            tipo: 'interactive',
            from: 'me',
            enviado_por_agente: 1,
            status: 'pending',
            fecha: new Date().toISOString()
        }]);

        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                candidateId: selectedChat.id, 
                message: bodyTxt, 
                type: 'interactive', 
                extraParams: { buttons } 
            })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                setMessages(prev => prev.map(m => m.id === optimisticId ? data.message : m));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: selectedChat.id } }));
            } else {
                setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m));
                if (data.error?.includes('131047')) {
                    showToast('Bloqueado por Meta 🛑: Han pasado >24 hrs.', 'error', 8000);
                } else {
                    showToast(\`Error de Meta: \${data.error || 'Desconocido'}\`, 'error');
                }
            }
        });
    };
`;
content = content.replace(/const handleSend = \(msg\) => \{/, match => handlersInjection + '\n    ' + match);

// 6. Prop drilling in MessageInputBox
content = content.replace(/onSendTemplate=\{handleSendTemplate\}/, `onSendTemplate={handleSendTemplate}
                        onSendVCard={() => setShowVCardModal(true)}
                        onSendInteractive={() => setShowInteractiveModal(true)}`);

// 7. Render Modals
const modalsInjection = `
            {/* --- VCard Modal --- */}
            {showVCardModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
                        <button onClick={() => setShowVCardModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2">
                            <UserSquare className="w-6 h-6 text-blue-500" />
                            Enviar Contacto (vCard)
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Nombre del Contacto</label>
                                <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={vcardName} onChange={(e)=>setVcardName(e.target.value)} placeholder="Ej. Recursos Humanos" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Número de Teléfono</label>
                                <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={vcardPhone} onChange={(e)=>setVcardPhone(e.target.value)} placeholder="Ej. 8112345678" />
                            </div>
                            <button onClick={() => { handleSendVCard(vcardName, vcardPhone); setShowVCardModal(false); }} disabled={!vcardName || !vcardPhone} className="w-full mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all shadow-md hover:shadow-lg">
                                Enviar Tarjeta
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Interactive Buttons Modal --- */}
            {showInteractiveModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
                        <button onClick={() => setShowInteractiveModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2">
                            <MousePointerClick className="w-6 h-6 text-purple-500" />
                            Botones Interactivos
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Mensaje Principal</label>
                                <textarea className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none resize-none transition-all" rows="2" value={interactiveBody} onChange={(e)=>setInteractiveBody(e.target.value)} placeholder="¿Te interesa continuar con el proceso?" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Opciones (Máx 3, 20 caract. c/u)</label>
                                {[0,1,2].map(i => (
                                    <input key={i} type="text" maxLength="20" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none mb-2 transition-all" value={interactiveBtns[i]} onChange={(e) => {
                                        const newBtns = [...interactiveBtns];
                                        newBtns[i] = e.target.value;
                                        setInteractiveBtns(newBtns);
                                    }} placeholder={\`Opción \${i+1}\`} />
                                ))}
                            </div>
                            <button onClick={() => { 
                                const validBtns = interactiveBtns.filter(b => b.trim());
                                handleSendInteractive(interactiveBody, validBtns); 
                                setShowInteractiveModal(false); 
                            }} disabled={!interactiveBody || interactiveBtns.filter(b => b.trim()).length === 0} className="w-full mt-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all shadow-md hover:shadow-lg">
                                Enviar Botones
                            </button>
                        </div>
                    </div>
                </div>
            )}
`;
content = content.replace(/<ConfirmModal config=\{confirmModal\} onClose=\{/, match => modalsInjection + '\n            ' + match);

fs.writeFileSync(path, content, 'utf8');
console.log('ChatSection.jsx updated successfully.');
