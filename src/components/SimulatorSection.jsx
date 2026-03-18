import React, { useState, useEffect, useRef } from 'react';
import { Send, RefreshCw, Smartphone } from 'lucide-react';
import Button from './ui/Button';

// iPhone 17 Pro Max Dimensions/Proportions (Scaled down ~15%)
const IPHONE_WIDTH = 300;
const IPHONE_HEIGHT = 630;

const SimulatorSection = ({ showToast }) => {
    const [messages, setMessages] = useState([
        { id: 1, sender: 'bot', text: '¡Hola! Soy Brenda, la asistente virtual de Candidatic. ¿En qué te puedo ayudar hoy?', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = async (e) => {
        e?.preventDefault();
        if (!inputValue.trim() || isLoading) return;

        const userMsg = {
            id: Date.now(),
            sender: 'user',
            text: inputValue,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setIsLoading(true);

        try {
            const response = await fetch('/api/ai/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg.text, sessionId: 'simulator_123' })
            });
            const data = await response.json();

            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                sender: 'bot',
                text: data.reply || 'Sin respuesta del bot.',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }]);
        } catch (error) {
            console.error('Sim error:', error);
            showToast('Error al procesar el mensaje', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleRestart = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/ai/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reset: true, sessionId: 'simulator_123' })
            });
            const data = await response.json();
            setMessages([
                { id: Date.now(), sender: 'bot', text: data.reply || 'Conversación reiniciada. ¡Hola! Soy Brenda.', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
            ]);
            showToast('Chat reiniciado', 'info');
        } catch (error) {
            console.error('Reset error:', error);
            showToast('Error al reiniciar', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="h-full flex flex-col space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-3 text-gray-900 dark:text-white">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg text-blue-600 dark:text-blue-400">
                            <Smartphone className="w-6 h-6" />
                        </div>
                        📱 Simulador de Brenda 🚀
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Prueba los flujos conversacionales, respuestas y el Radar de FAQs en tiempo real 💬.</p>
                </div>
                <div className="flex items-center space-x-4">
                    <Button onClick={handleRestart} variant="outline" className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" />
                        Reiniciar Chat
                    </Button>
                </div>
            </div>

            {/* Main Area: 3 Columns Layout */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden">
                
                {/* COLUMN 1: iPhone 17 Pro Max Mockup */}
                <div className="flex flex-col items-center justify-center p-4">
                    <div 
                        className="relative bg-black rounded-[55px] shadow-2xl overflow-hidden border-[8px] border-slate-900 ring-1 ring-white/10"
                        style={{ width: IPHONE_WIDTH, height: IPHONE_HEIGHT, maxWidth: '100%' }}
                    >
                        {/* Dynamic Island */}
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-8 bg-black rounded-full z-20" />

                        {/* Screen Content: WhatsApp Clone UI */}
                        <div className="absolute inset-0 bg-[#EFEAE2] flex flex-col pt-12">
                            {/* WA Header */}
                            <div className="bg-[#00A884] text-white px-4 py-3 flex items-center space-x-3 shadow-sm z-10 shrink-0">
                                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center shrink-0">
                                    <span className="font-bold text-lg">B</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-[15px] truncate">Brenda (Simulador)</h3>
                                    <p className="text-xs text-white/80">en línea</p>
                                </div>
                            </div>

                            {/* WA Chat Area */}
                            <div 
                                className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar" 
                                style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")', backgroundSize: 'contain' }}
                            >
                                {messages.map((msg) => (
                                    <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div 
                                            className={`max-w-[85%] rounded-lg px-3 py-2 text-[15px] shadow-sm relative ${
                                                msg.sender === 'user' 
                                                ? 'bg-[#D9FDD3] rounded-tr-none' 
                                                : 'bg-white rounded-tl-none'
                                            }`}
                                        >
                                            <p className="text-gray-900 whitespace-pre-wrap">{msg.text}</p>
                                            <div className="text-[10px] text-gray-500 text-right mt-1 font-medium">
                                                {msg.time}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {isLoading && (
                                    <div className="flex justify-start">
                                        <div className="bg-white rounded-lg rounded-tl-none px-4 py-3 shadow-sm flex items-center space-x-2">
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* WA Input Area */}
                            <div className="bg-[#F0F2F5] p-3 flex items-end space-x-2 shrink-0 pb-6">
                                <form onSubmit={handleSendMessage} className="flex-1 flex items-center bg-white rounded-2xl px-4 py-2 min-h-[44px] shadow-sm">
                                    <input
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        placeholder="Escribe un mensaje"
                                        className="flex-1 bg-transparent outline-none text-[15px]"
                                        disabled={isLoading}
                                    />
                                </form>
                                {inputValue.trim() && (
                                    <button 
                                        onClick={handleSendMessage}
                                        className="w-11 h-11 bg-[#00A884] rounded-full flex items-center justify-center text-white shrink-0 hover:bg-[#008f6f] transition-colors"
                                    >
                                        <Send className="w-5 h-5 ml-1" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* COLUMN 2: Controles & Rayos X (To be implemented) */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col h-full">
                    <h3 className="font-bold text-gray-900 dark:text-white mb-4">⚙️ Configuración del Simulador</h3>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        <p>Selecciona una vacante para inyectar su contexto en Brenda y probar su comportamiento.</p>
                    </div>
                </div>

                {/* COLUMN 3: Radar Log (To be implemented) */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col h-full">
                    <h3 className="font-bold text-gray-900 dark:text-white mb-4">🧠 Rayos X (Memoria AI)</h3>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        <p>Aquí verás el ADN extraído y los temas que el Radar de FAQs disparó internamente durante el chat.</p>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default SimulatorSection;
