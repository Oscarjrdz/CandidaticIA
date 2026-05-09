import { useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, Maximize2, Send, Sparkles, X } from 'lucide-react';
import Button from './ui/Button';

const sparkleKeyframes = `
@keyframes sparkle-glow {
  0%, 100% { filter: drop-shadow(0 0 2px rgba(96,165,250,0.4)); transform: scale(1) rotate(0deg); opacity: 0.8; }
  25% { filter: drop-shadow(0 0 6px rgba(34,211,238,0.8)); transform: scale(1.15) rotate(8deg); opacity: 1; }
  50% { filter: drop-shadow(0 0 10px rgba(168,85,247,0.7)); transform: scale(1.25) rotate(-5deg); opacity: 1; }
  75% { filter: drop-shadow(0 0 6px rgba(96,165,250,0.8)); transform: scale(1.1) rotate(3deg); opacity: 0.9; }
}
`;

const AVATAR_SRC = '/brenda/avatar-candidatic.png';

const INITIAL_MESSAGES = [
    {
        role: 'assistant',
        content: 'Estoy aqui como copiloto ligero. Puedo ayudarte a pensar tareas, skills y pasos dentro de Candidatic.'
    }
];

function BrendaAvatar({ size = 'md', active = false }) {
    const sizes = {
        sm: 'w-9 h-9',
        md: 'w-12 h-12',
        lg: 'w-16 h-16'
    };

    return (
        <div className={`relative ${sizes[size]} shrink-0`}>
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-400 via-fuchsia-400 to-cyan-300 blur-md opacity-70" />
            <div className="relative w-full h-full rounded-full p-[2px] bg-gradient-to-br from-white via-blue-100 to-fuchsia-100 shadow-xl">
                <img
                    src={AVATAR_SRC}
                    alt="Brenda Rodriguez"
                    className="w-full h-full rounded-full object-cover bg-gray-100"
                    style={{ objectPosition: '78% 42%' }}
                />
            </div>
            {active && (
                <span className="absolute -right-0.5 bottom-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white dark:border-gray-950 shadow-sm" />
            )}
        </div>
    );
}

export default function FloatingCopilot({ onOpenFull }) {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState(INITIAL_MESSAGES);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const bottomRef = useRef(null);

    const history = useMemo(() => messages.map(({ role, content }) => ({ role, content })), [messages]);
    const canSend = input.trim().length > 0 && !loading;

    const scrollToBottom = () => {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
    };

    const sendMessage = async (text = input) => {
        const cleanText = text.trim();
        if (!cleanText || loading) return;

        setMessages(prev => [...prev, { role: 'user', content: cleanText }]);
        setInput('');
        setLoading(true);
        setOpen(true);
        scrollToBottom();

        try {
            const res = await fetch('/api/copilot/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: cleanText,
                    history
                })
            });

            const rawText = await res.text();
            let data;
            try {
                data = JSON.parse(rawText);
            } catch {
                throw new Error('El servidor no respondió correctamente. Intenta de nuevo en unos segundos.');
            }

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'No pude consultar a Brenda');
            }

            setMessages(prev => [...prev, { role: 'assistant', content: data.reply || 'No recibi respuesta.' }]);
        } catch (error) {
            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    content: `No pude responder ahorita. Revisa la configuracion de OpenAI. ${error.message}`
                }
            ]);
        } finally {
            setLoading(false);
            scrollToBottom();
        }
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        sendMessage();
    };

    return (
        <div className="fixed bottom-6 right-24 z-40 flex flex-col items-end gap-3 pointer-events-none">
            {open && (
                <div className="pointer-events-auto w-[calc(100vw-2.5rem)] max-w-[360px] h-[520px] rounded-[32px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.15)] border-[1px] border-white/40 dark:border-white/10 bg-white/5 dark:bg-black/10 backdrop-blur-md flex flex-col relative before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/10 before:to-transparent before:pointer-events-none">
                    <div className="relative px-4 py-4 bg-gradient-to-br from-blue-500/10 via-indigo-500/8 to-purple-500/10 backdrop-blur-xl border-b border-white/10 z-10">
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent opacity-30" />
                        <div className="relative flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <BrendaAvatar size="md" active />
                                <div className="min-w-0">
                                    <style>{sparkleKeyframes}</style>
                                    <div className="flex items-center gap-1.5">
                                        <h3 className="text-gray-900 dark:text-white text-sm font-black tracking-tight truncate drop-shadow-md">Brenda IA</h3>
                                        <Sparkles className="w-3.5 h-3.5 text-blue-500 dark:text-cyan-300" style={{ animation: 'sparkle-glow 2.5s ease-in-out infinite' }} />
                                    </div>
                                    <p className="text-[11px] text-blue-700 dark:text-blue-200 font-medium truncate opacity-90">Copiloto</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setOpen(false)}
                                    className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 border border-white/20 text-gray-800 dark:text-white flex items-center justify-center transition-all backdrop-blur-sm"
                                    title="Minimizar"
                                >
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-transparent z-10">
                        {messages.map((message, index) => {
                            const isUser = message.role === 'user';
                            return (
                                <div key={`${message.role}-${index}`} className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                                    {!isUser && <BrendaAvatar size="sm" />}
                                    <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap shadow-sm backdrop-blur-md border ${
                                        isUser
                                            ? 'bg-blue-600/60 text-white border-blue-400/20 rounded-br-md shadow-[0_4px_12px_rgba(37,99,235,0.1)]'
                                            : 'bg-white/30 dark:bg-gray-900/30 text-gray-800 dark:text-gray-100 border-white/40 dark:border-white/10 rounded-bl-md shadow-[0_4px_12px_rgba(0,0,0,0.05)]'
                                    }`}>
                                        {message.content}
                                    </div>
                                </div>
                            );
                        })}

                        {loading && (
                            <div className="flex gap-2 justify-start">
                                <BrendaAvatar size="sm" active />
                                <div className="bg-white/60 dark:bg-gray-900/60 border border-white/50 dark:border-white/10 backdrop-blur-md rounded-2xl rounded-bl-md px-4 py-2.5 text-[13px] text-gray-600 dark:text-gray-300 shadow-sm flex items-center gap-2">
                                    <span className="animate-pulse">Procesando</span>
                                    <span className="flex gap-0.5">
                                        <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </span>
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>

                    <form onSubmit={handleSubmit} className="p-3 bg-white/30 dark:bg-black/30 backdrop-blur-xl border-t border-white/40 dark:border-white/10 z-10">
                        <div className="flex items-end gap-2 rounded-[20px] bg-white/50 dark:bg-gray-900/50 border border-white/60 dark:border-white/10 shadow-inner p-2 backdrop-blur-md transition-all focus-within:bg-white/70 focus-within:shadow-[0_0_15px_rgba(255,255,255,0.5)]">
                            <textarea
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault();
                                        sendMessage();
                                    }
                                }}
                                rows={1}
                                placeholder="Escríbele a Brenda..."
                                className="min-h-9 max-h-24 flex-1 resize-none bg-transparent px-3 py-2 text-[13.5px] text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 outline-none"
                            />
                            <Button
                                type="submit"
                                icon={Send}
                                disabled={!canSend}
                                loading={loading}
                                className="rounded-xl !px-3 !py-2 bg-gradient-to-r from-blue-600 to-indigo-600 border-none shadow-md hover:shadow-lg hover:from-blue-500 hover:to-indigo-500 transition-all text-white"
                            >
                                <span className="sr-only">Enviar</span>
                            </Button>
                        </div>
                    </form>
                </div>
            )}

            {!open && (
                <button
                    onClick={() => setOpen(true)}
                    className="pointer-events-auto group relative flex items-center gap-3 rounded-full bg-white/90 dark:bg-gray-950/90 border border-white/70 dark:border-white/10 shadow-[0_18px_55px_rgba(15,23,42,0.24)] pl-2 pr-4 py-2 backdrop-blur-2xl hover:-translate-y-0.5 transition-all"
                    title="Abrir Copiloto Brenda"
                >
                    <BrendaAvatar size="lg" active />
                    <div className="text-left hidden sm:block">
                        <div className="flex items-center gap-1.5">
                            <span className="text-sm font-black text-gray-900 dark:text-white">Brenda</span>
                            <Bot className="w-3.5 h-3.5 text-blue-500" />
                        </div>
                        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Copiloto listo</p>
                    </div>
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-400 border-2 border-white dark:border-gray-950 shadow-sm group-hover:animate-pulse" />
                </button>
            )}

            {open && (
                <button
                    onClick={() => setOpen(false)}
                    className="pointer-events-auto sm:hidden fixed top-4 right-4 w-9 h-9 rounded-full bg-gray-950/70 text-white flex items-center justify-center backdrop-blur-xl"
                    title="Cerrar"
                >
                    <X className="w-4 h-4" />
                </button>
            )}
        </div>
    );
}
