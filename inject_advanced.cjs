const fs = require('fs');
const path = './src/components/ChatSection.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Imports
content = content.replace(/import \{ UserSquare, MousePointerClick, Search, /, 'import { MapPin, List as ListIcon, ShoppingBag, UserSquare, MousePointerClick, Search, ');

// 2. MessageInputBox Props
content = content.replace(/onSendVCard, onSendInteractive \}, ref\) => \{/, 'onSendVCard, onSendInteractive, onSendLocation, onSendList, onSendProduct }, ref) => {');

// 3. MessageInputBox Buttons
const advancedButtons = `
                <button type="button" title="Enviar Ubicación" onClick={onSendLocation} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors"><MapPin className="w-[24px] h-[24px] stroke-[1.5]" /></button>
                <button type="button" title="Enviar Lista Interactiva" onClick={onSendList} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors"><ListIcon className="w-[24px] h-[24px] stroke-[1.5]" /></button>
                <button type="button" title="Enviar Producto (Catálogo)" onClick={onSendProduct} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors"><ShoppingBag className="w-[24px] h-[24px] stroke-[1.5]" /></button>
`;
content = content.replace(/<button type="button" title="Enviar Botones Interactivos"[\s\S]*?<\/button>/, match => match + advancedButtons);

// 4. ChatSection States
const advancedStates = `
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [locName, setLocName] = useState('');
    const [locAddress, setLocAddress] = useState('');
    const [locLat, setLocLat] = useState('');
    const [locLng, setLocLng] = useState('');

    const [showListModal, setShowListModal] = useState(false);
    const [listBody, setListBody] = useState('');
    const [listBtnText, setListBtnText] = useState('Ver opciones');
    const [listSection, setListSection] = useState('Opciones');
    const [listItems, setListItems] = useState([{title: '', description: ''}]);

    const [showProductModal, setShowProductModal] = useState(false);
    const [prodBody, setProdBody] = useState('');
    const [prodCatalog, setProdCatalog] = useState('');
    const [prodSku, setProdSku] = useState('');

    const [vcardCompany, setVcardCompany] = useState('');
    const [vcardTitle, setVcardTitle] = useState('');
    const [vcardEmail, setVcardEmail] = useState('');
    const [vcardUrl, setVcardUrl] = useState('');
`;
content = content.replace(/const \[interactiveBtns, setInteractiveBtns\] = useState\(\['', '', ''\]\);/, match => match + advancedStates);

// 5. Expand handleSendVCard
content = content.replace(/const handleSendVCard = \(name, phone\) => \{/, `const handleSendVCard = (name, phone, company, title, email, url) => {`);
content = content.replace(/extraParams: \{ contactName: name, contactPhone: phone \}/, `extraParams: { contactName: name, contactPhone: phone, company, title, email, url }`);

// 6. Advanced Handlers
const advancedHandlers = `
    const handleSendLocation = (name, address, lat, lng) => {
        if (!lat || !lng || !selectedChat) return;
        autoSilenceBot(selectedChat);
        const optimisticId = 'temp-' + Date.now();
        setMessages(prev => [...(prev || []), {
            id: optimisticId, content: \`[Ubicación: \${name || 'Mapa'}]\`, tipo: 'location', from: 'me', enviado_por_agente: 1, status: 'pending', fecha: new Date().toISOString()
        }]);
        fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: selectedChat.id, message: '', type: 'location', extraParams: { name, address, lat, lng } })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                setMessages(prev => prev.map(m => m.id === optimisticId ? data.message : m));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: selectedChat.id } }));
            } else setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m));
        });
    };

    const handleSendList = (bodyTxt, btnText, section, items) => {
        if (!bodyTxt || items.length === 0 || !selectedChat) return;
        autoSilenceBot(selectedChat);
        const optimisticId = 'temp-' + Date.now();
        setMessages(prev => [...(prev || []), {
            id: optimisticId, content: \`\${bodyTxt}\\n\\n[Lista: \${items.map(i=>i.title).join(', ')}]\`, tipo: 'interactive', from: 'me', enviado_por_agente: 1, status: 'pending', fecha: new Date().toISOString()
        }]);
        fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: selectedChat.id, message: bodyTxt, type: 'interactive', extraParams: { interactiveType: 'list', listButtonText: btnText, listSectionTitle: section, listItems: items } })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                setMessages(prev => prev.map(m => m.id === optimisticId ? data.message : m));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: selectedChat.id } }));
            } else setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m));
        });
    };

    const handleSendProduct = (bodyTxt, catalogId, productSku) => {
        if (!catalogId || !productSku || !selectedChat) return;
        autoSilenceBot(selectedChat);
        const optimisticId = 'temp-' + Date.now();
        setMessages(prev => [...(prev || []), {
            id: optimisticId, content: \`[Producto del Catálogo: \${productSku}]\`, tipo: 'interactive', from: 'me', enviado_por_agente: 1, status: 'pending', fecha: new Date().toISOString()
        }]);
        fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: selectedChat.id, message: bodyTxt, type: 'interactive', extraParams: { interactiveType: 'product', catalogId, productSku } })
        }).then(res => res.json()).then(data => {
            if (data.success && data.message) {
                setMessages(prev => prev.map(m => m.id === optimisticId ? data.message : m));
                window.dispatchEvent(new CustomEvent('candidate_replied', { detail: { candidateId: selectedChat.id } }));
            } else setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'failed', error: data.error } : m));
        });
    };
`;
content = content.replace(/const handleSendInteractive = \(bodyTxt, buttons\) => \{/, match => advancedHandlers + '\n    ' + match);

// 7. Prop drilling
content = content.replace(/onSendInteractive=\{.*?\}/, match => match + `
                        onSendLocation={() => setShowLocationModal(true)}
                        onSendList={() => setShowListModal(true)}
                        onSendProduct={() => setShowProductModal(true)}`);

// 8. Update VCard Modal Inputs
const vcardExtraInputs = `
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Empresa</label>
                                    <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white outline-none" value={vcardCompany} onChange={(e)=>setVcardCompany(e.target.value)} placeholder="Ej. Candidatic" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Puesto</label>
                                    <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white outline-none" value={vcardTitle} onChange={(e)=>setVcardTitle(e.target.value)} placeholder="Ej. Reclutador" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Email</label>
                                    <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white outline-none" value={vcardEmail} onChange={(e)=>setVcardEmail(e.target.value)} placeholder="ejemplo@correo.com" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Sitio Web</label>
                                    <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white outline-none" value={vcardUrl} onChange={(e)=>setVcardUrl(e.target.value)} placeholder="https://..." />
                                </div>
                            </div>`;
content = content.replace(/<button onClick=\{\(\) => \{ handleSendVCard\(vcardName, vcardPhone\); setShowVCardModal\(false\); \}\}/, match => vcardExtraInputs + '\n                            <button onClick={() => { handleSendVCard(vcardName, vcardPhone, vcardCompany, vcardTitle, vcardEmail, vcardUrl); setShowVCardModal(false); }}');

// 9. New Modals JSX
const advancedModals = `
            {/* --- Location Modal --- */}
            {showLocationModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
                        <button onClick={() => setShowLocationModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2"><MapPin className="w-6 h-6 text-red-500" /> Enviar Ubicación</h2>
                        <div className="space-y-3">
                            <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white" value={locName} onChange={e=>setLocName(e.target.value)} placeholder="Nombre del lugar (Ej. Oficinas)" />
                            <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white" value={locAddress} onChange={e=>setLocAddress(e.target.value)} placeholder="Dirección completa" />
                            <div className="grid grid-cols-2 gap-2">
                                <input type="number" step="any" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white" value={locLat} onChange={e=>setLocLat(e.target.value)} placeholder="Latitud (25.6866)" />
                                <input type="number" step="any" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white" value={locLng} onChange={e=>setLocLng(e.target.value)} placeholder="Longitud (-100.316)" />
                            </div>
                            <button onClick={() => { handleSendLocation(locName, locAddress, locLat, locLng); setShowLocationModal(false); }} disabled={!locLat || !locLng} className="w-full mt-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl">Enviar Mapa</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- List Message Modal --- */}
            {showListModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in">
                        <button onClick={() => setShowListModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2"><ListIcon className="w-6 h-6 text-indigo-500" /> Menú de Opciones (Lista)</h2>
                        <div className="space-y-3">
                            <textarea className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" rows="2" value={listBody} onChange={e=>setListBody(e.target.value)} placeholder="Mensaje principal..." />
                            <div className="grid grid-cols-2 gap-2">
                                <input type="text" maxLength="20" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" value={listBtnText} onChange={e=>setListBtnText(e.target.value)} placeholder="Texto botón (Ver Opciones)" />
                                <input type="text" maxLength="24" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" value={listSection} onChange={e=>setListSection(e.target.value)} placeholder="Título sección (Vacantes)" />
                            </div>
                            <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-3">
                                <label className="block text-xs font-semibold text-slate-500 mb-2">Ítems de la Lista (Máx 10)</label>
                                {listItems.map((item, i) => (
                                    <div key={i} className="flex flex-col gap-1 mb-2 bg-slate-50 dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 relative">
                                        <input type="text" maxLength="24" className="w-full bg-transparent border-none text-sm outline-none font-medium" value={item.title} onChange={e=>{const n=[...listItems]; n[i].title=e.target.value; setListItems(n)}} placeholder="Título (Ej. Almacenista)" />
                                        <input type="text" maxLength="72" className="w-full bg-transparent border-none text-xs text-slate-500 outline-none" value={item.description} onChange={e=>{const n=[...listItems]; n[i].description=e.target.value; setListItems(n)}} placeholder="Descripción breve" />
                                        {listItems.length > 1 && <button onClick={()=>{setListItems(listItems.filter((_,idx)=>idx!==i))}} className="absolute top-2 right-2 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>}
                                    </div>
                                ))}
                                {listItems.length < 10 && <button onClick={()=>setListItems([...listItems, {title:'', description:''}])} className="text-xs text-indigo-500 hover:text-indigo-600 font-bold flex items-center gap-1"><Plus className="w-3 h-3"/> Agregar Ítem</button>}
                            </div>
                            <button onClick={() => { const valids = listItems.filter(i=>i.title); handleSendList(listBody, listBtnText, listSection, valids); setShowListModal(false); }} disabled={!listBody || !listItems[0].title} className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl">Enviar Lista</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Product Catalog Modal --- */}
            {showProductModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in">
                        <button onClick={() => setShowProductModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2"><ShoppingBag className="w-6 h-6 text-emerald-500" /> Producto (Catálogo)</h2>
                        <div className="space-y-3">
                            <textarea className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" rows="2" value={prodBody} onChange={e=>setProdBody(e.target.value)} placeholder="Mensaje principal..." />
                            <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" value={prodCatalog} onChange={e=>setProdCatalog(e.target.value)} placeholder="Catalog ID (Ej. 1234567890)" />
                            <input type="text" className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-4 py-2 text-sm" value={prodSku} onChange={e=>setProdSku(e.target.value)} placeholder="Product Retailer ID (SKU)" />
                            <button onClick={() => { handleSendProduct(prodBody, prodCatalog, prodSku); setShowProductModal(false); }} disabled={!prodCatalog || !prodSku} className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl">Enviar Producto</button>
                        </div>
                    </div>
                </div>
            )}
`;
content = content.replace(/\{\/\* --- Interactive Buttons Modal --- \*\/\}/, match => advancedModals + '\n            ' + match);

// 10. Advanced UI Bubbles Rendering
const advancedBubblesReplacement = `                                                        // Detectar Lista
                                                        const isList = typeof msg.content === 'string' && msg.content.includes('[Lista:');
                                                        if (isList) {
                                                            const parts = msg.content.split('\\n\\n[Lista:');
                                                            const mainText = parts[0];
                                                            const itemsStr = parts[1]?.replace(']', '') || '';
                                                            const items = itemsStr.split(', ');
                                                            return (
                                                                <div className="flex flex-col w-full min-w-[220px]">
                                                                    <div dangerouslySetInnerHTML={{ __html: mainText.replace(/\\n/g, '<br/>') }} className="mb-2" />
                                                                    <div className="flex flex-col border border-indigo-100 dark:border-indigo-900/30 rounded-lg overflow-hidden mt-1">
                                                                        <div className="bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 text-xs font-bold py-1.5 px-3 flex justify-between items-center"><ListIcon className="w-3 h-3" /> VER OPCIONES</div>
                                                                        {items.map((it, i) => (
                                                                            <div key={i} className="py-2 px-3 bg-white dark:bg-[#111b21] text-sm border-t border-indigo-50 dark:border-indigo-900/10 font-medium">{it}</div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            );
                                                        }

                                                        // Detectar Ubicacion
                                                        const isLocation = typeof msg.content === 'string' && msg.content.startsWith('[Ubicación:');
                                                        if (isLocation) {
                                                            const nameMatch = msg.content.match(/\\[Ubicación:\\s*(.+)\\]/i);
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

                                                        // Detectar Producto
                                                        const isProduct = typeof msg.content === 'string' && msg.content.startsWith('[Producto del Catálogo:');
                                                        if (isProduct) {
                                                            const skuMatch = msg.content.match(/\\[Producto del Catálogo:\\s*(.+)\\]/i);
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
`;
content = content.replace(/return <div dangerouslySetInnerHTML=\{\{ __html: rawHtml \}\} \/>;/, advancedBubblesReplacement + '\n                                                        return <div dangerouslySetInnerHTML={{ __html: rawHtml }} />;');

fs.writeFileSync(path, content, 'utf8');
console.log('Advanced UI Patched');
