import React, { useMemo, useRef, useState } from 'react';
import { Bot, Send, Sparkles, ShieldCheck, Workflow, HelpCircle } from 'lucide-react';
import Button from './ui/Button';

const STARTER_PROMPTS = [
    'Explícame qué módulos tiene Candidatic IA y para qué sirve cada uno.',
    '¿Qué skills podríamos crear primero para automatizar reclutamiento?',
    '¿Cómo funciona Brenda dentro del flujo de candidatos?',
    'Ayúdame a diseñar una automatización para detectar datos faltantes.'
];

const INITIAL_MESSAGES = [
    {
        role: 'assistant',
        content: 'Hola, soy Brenda Rodríguez en modo copiloto interno. Puedo ayudarte a entender la plataforma, ordenar ideas, proponer skills y convertir tareas de reclutamiento en flujos claros.'
    }
];

export default function CopilotSection() {
    const [messages, setMessages] = useState(INITIAL_MESSAGES);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const bottomRef = useRef(null);

    const canSend = input.trim().length > 0 && !loading;

    const visibleHistory = useMemo(() => (
        messages.map(({ role, content }) => ({ role, content }))
    ), [messages]);

    const scrollToBottom = () => {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
    };

    const sendMessage = async (text = input) => {
        const cleanText = text.trim();
        if (!cleanText || loading) return;

        const userMessage = { role: 'user', content: cleanText };
        const nextMessages = [...messages, userMessage];
        setMessages(nextMessages);
        setInput('');
        setLoading(true);
        scrollToBottom();

        try {
            const res = await fetch('/api/copilot/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: cleanText,
                    history: visibleHistory
                })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Error consultando a Brenda');
            }

            setMessages(prev => [...prev, { role: 'assistant', content: data.reply || 'No recibí respuesta.' }]);
        } catch (error) {
            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    content: `No pude responder en este momento. Revisa que la configuración de OpenAI esté activa. Detalle: ${error.message}`
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
        <div className="h-full min-h-[calc(100vh-180px)] flex flex-col gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-2xl shadow-lg shadow-blue-500/20 overflow-hidden">
                        <img src="/brenda/avatar-candidatic.png" alt="Brenda Rodriguez" className="w-full h-full object-cover" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight uppercase tracking-tight">
                            Copiloto Brenda
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Asistente interno para entender el sistema, proponer skills y ordenar tareas.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded-xl">
                        <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                        Consulta
                    </div>
                    <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded-xl">
                        <Workflow className="w-3.5 h-3.5 text-blue-500" />
                        Skills
                    </div>
                    <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded-xl">
                        <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
                        Sistema
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 flex-1 min-h-0">
                <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col min-h-[560px] overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                        {messages.map((message, index) => {
                            const isUser = message.role === 'user';
                            return (
                                <div key={`${message.role}-${index}`} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[86%] sm:max-w-[74%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                                        isUser
                                            ? 'bg-blue-600 text-white rounded-br-md'
                                            : 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100 rounded-bl-md'
                                    }`}>
                                        {message.content}
                                    </div>
                                </div>
                            );
                        })}

                        {loading && (
                            <div className="flex justify-start">
                                <div className="bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400 rounded-2xl rounded-bl-md px-4 py-3 text-sm flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 animate-pulse text-blue-500" />
                                    Brenda está pensando...
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>

                    <form onSubmit={handleSubmit} className="border-t border-gray-200 dark:border-gray-700 p-3 sm:p-4 bg-gray-50 dark:bg-gray-900/40">
                        <div className="flex gap-2">
                            <textarea
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault();
                                        sendMessage();
                                    }
                                }}
                                placeholder="Pregúntale a Brenda sobre el sistema, skills o tareas..."
                                rows={2}
                                className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50"
                            />
                            <Button
                                type="submit"
                                icon={Send}
                                disabled={!canSend}
                                loading={loading}
                                className="self-stretch rounded-xl px-4"
                            >
                                Enviar
                            </Button>
                        </div>
                    </form>
                </section>

                <aside className="space-y-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-tight mb-3">
                            Prueba con esto
                        </h3>
                        <div className="space-y-2">
                            {STARTER_PROMPTS.map((prompt) => (
                                <button
                                    key={prompt}
                                    type="button"
                                    onClick={() => sendMessage(prompt)}
                                    disabled={loading}
                                    className="w-full text-left text-xs leading-relaxed text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 rounded-xl p-3 transition-colors disabled:opacity-50"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-950/30 rounded-2xl border border-blue-100 dark:border-blue-900 p-4">
                        <p className="text-xs leading-relaxed text-blue-900 dark:text-blue-100">
                            Esta primera versión solo responde y propone. Para editar datos, mandar mensajes o crear automatizaciones, Brenda debe pedir confirmación antes de actuar.
                        </p>
                    </div>
                </aside>
            </div>
        </div>
    );
}
