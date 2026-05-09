import { useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, Maximize2, Send, Sparkles, X } from 'lucide-react';
import Button from './ui/Button';

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
            const data = await res.json();

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
                <div className="pointer-events-auto w-[calc(100vw-2.5rem)] max-w-[360px] h-[520px] rounded-[28px] overflow-hidden shadow-[0_24px_70px_rgba(15,23,42,0.28)] border border-white/70 dark:border-white/10 bg-white/85 dark:bg-gray-950/90 backdrop-blur-2xl flex flex-col">
                    <div className="relative px-4 py-4 bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-950 overflow-hidden">
                        <div className="absolute inset-x-0 bottom-0 h-px bg-white/20" />
                        <div className="relative flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <BrendaAvatar size="md" active />
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <h3 className="text-white text-sm font-black tracking-tight truncate">Brenda Rodriguez</h3>
                                        <Sparkles className="w-3.5 h-3.5 text-cyan-200" />
                                    </div>
                                    <p className="text-[11px] text-blue-100 font-medium truncate">Copiloto activo</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={onOpenFull}
                                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                                    title="Abrir copiloto completo"
                                >
                                    <Maximize2 className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setOpen(false)}
                                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                                    title="Minimizar"
                                >
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_34%),linear-gradient(180deg,rgba(248,250,252,0.9),rgba(255,255,255,0.9))] dark:bg-none dark:bg-gray-950">
                        {messages.map((message, index) => {
                            const isUser = message.role === 'user';
                            return (
                                <div key={`${message.role}-${index}`} className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                                    {!isUser && <BrendaAvatar size="sm" />}
                                    <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap shadow-sm ${
                                        isUser
                                            ? 'bg-blue-600 text-white rounded-br-md'
                                            : 'bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 border border-gray-100 dark:border-gray-800 rounded-bl-md'
                                    }`}>
                                        {message.content}
                                    </div>
                                </div>
                            );
                        })}

                        {loading && (
                            <div className="flex gap-2 justify-start">
                                <BrendaAvatar size="sm" active />
                                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px] text-gray-500 dark:text-gray-400 shadow-sm">
                                    Pensando...
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>

                    <form onSubmit={handleSubmit} className="p-3 bg-white/90 dark:bg-gray-950 border-t border-gray-100 dark:border-gray-800">
                        <div className="flex items-end gap-2 rounded-2xl bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-2">
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
                                placeholder="Pidele ayuda a Brenda..."
                                className="min-h-9 max-h-24 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none"
                            />
                            <Button
                                type="submit"
                                icon={Send}
                                disabled={!canSend}
                                loading={loading}
                                className="rounded-xl !px-3 !py-2"
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
