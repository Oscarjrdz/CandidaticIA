import React, { useMemo, useRef, useState } from 'react';
import { ChevronRight, Loader2, MessageCircle, Minimize2, Send, Sparkles } from 'lucide-react';
import { useAuthContext } from '../contexts/AuthContext';

const MAX_INPUT_CHARS = 900;
const MAX_CLIENT_HISTORY = 8;
const GREETING_COOLDOWN_MS = 15 * 60 * 1000;

const SECTION_LABELS = {
    candidates: 'Candidatos',
    chat: 'Chat Web',
    bulks: 'Envios Masivos',
    'ads-stats': 'Estadisticas de Ads',
    'bot-ia': 'Bot IA',
    automations: 'Automatizaciones',
    vacancies: 'Vacantes',
    bolsa: 'Bolsa',
    notificaciones: 'Notificaciones',
    users: 'Usuarios',
    'media-library': 'Biblioteca',
    projects: 'Proyectos',
    'ia-copiloto': 'Brenda IA',
    settings: 'Configuracion'
};

function getSessionToken() {
    try {
        const raw = localStorage.getItem('candidatic_user_session');
        const user = raw ? JSON.parse(raw) : null;
        return user?.sessionToken || '';
    } catch {
        return '';
    }
}

function getMonterreyGreeting(name) {
    const hourText = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Monterrey',
        hour: '2-digit',
        hour12: false
    }).format(new Date());
    const hour = Number(hourText);
    const period = hour < 12 ? 'buenos dias' : hour < 19 ? 'buenas tardes' : 'buenas noches';
    return `Hola ${name || 'Oscar'}, ${period}.`;
}

function getGreetingKey(user) {
    return `brenda_ia_last_greeting_${user?.id || user?.whatsapp || 'superadmin'}`;
}

function shouldShowGreeting(user) {
    try {
        const lastGreetingAt = Number(localStorage.getItem(getGreetingKey(user)) || 0);
        return !lastGreetingAt || Date.now() - lastGreetingAt > GREETING_COOLDOWN_MS;
    } catch {
        return true;
    }
}

function markGreetingShown(user) {
    try {
        localStorage.setItem(getGreetingKey(user), String(Date.now()));
    } catch {
        // No-op: greeting memory is only a UX nicety.
    }
}

const FloatingCopilot = ({ onOpenSection, activeSection }) => {
    const { user } = useAuthContext();
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [usage, setUsage] = useState(null);
    const inputRef = useRef(null);
    const firstName = (user?.name || '').split(' ')[0] || 'Oscar';
    const currentSectionLabel = SECTION_LABELS[activeSection] || 'Candidatic';

    const compactHistory = useMemo(() => {
        return messages
            .filter((m) => m.role === 'assistant' || m.role === 'user')
            .slice(-MAX_CLIENT_HISTORY)
            .map((m) => ({
                role: m.role,
                content: String(m.content || '').slice(0, 700)
            }));
    }, [messages]);

    const sendMessage = async (overrideText) => {
        const clean = String(overrideText ?? input).replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT_CHARS);
        if (!clean || loading) return;

        setInput('');
        setLoading(true);
        const nextMessages = [...messages, { role: 'user', content: clean }];
        setMessages(nextMessages);

        try {
            const res = await fetch('/api/copilot/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getSessionToken()}`
                },
                body: JSON.stringify({
                    message: clean,
                    history: compactHistory,
                    appContext: {
                        activeSection,
                        sectionLabel: currentSectionLabel,
                        path: window.location.pathname
                    }
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'No se pudo contactar a Brenda');
            }
            setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }].slice(-12));
            setUsage(data.usage || null);
        } catch (error) {
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: `No pude responder ahorita: ${error.message}` }
            ].slice(-12));
        } finally {
            setLoading(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    };

    const handleOpen = () => {
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);

        if (messages.length > 0 || !shouldShowGreeting(user)) {
            return;
        }

        markGreetingShown(user);
        setMessages([{
            role: 'assistant',
            content: `${getMonterreyGreeting(firstName)} Estoy en ${currentSectionLabel}.`
        }]);
    };

    if (!open) {
        return (
            <button
                onClick={handleOpen}
                className="fixed left-5 bottom-6 z-[70] flex items-center gap-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-xl px-4 py-3 transition-all"
                title="Abrir Brenda IA"
            >
                <span className="relative w-9 h-9 rounded-full overflow-hidden bg-white/15 flex items-center justify-center">
                    <img src="/brenda/brenda-avatar.jpeg" alt="" className="w-full h-full object-cover" />
                </span>
                <span className="hidden sm:block text-sm font-bold">Brenda IA</span>
                <MessageCircle className="w-5 h-5" />
            </button>
        );
    }

    return (
        <section className="fixed left-5 bottom-6 z-[70] w-[min(390px,calc(100vw-2.5rem))] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl overflow-hidden">
            <header className="px-4 py-3 bg-blue-600 text-white flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-white/15 shrink-0">
                        <img src="/brenda/brenda-avatar.jpeg" alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-sm font-bold truncate">Brenda IA</h3>
                        <p className="text-[11px] text-blue-100 truncate">{currentSectionLabel}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={onOpenSection}
                        className="p-2 rounded-lg hover:bg-white/15 transition-colors"
                        title="Abrir Brenda IA"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setOpen(false)}
                        className="p-2 rounded-lg hover:bg-white/15 transition-colors"
                        title="Minimizar"
                    >
                        <Minimize2 className="w-4 h-4" />
                    </button>
                </div>
            </header>

            <div className="h-[380px] overflow-y-auto px-4 py-4 space-y-3 bg-gray-50 dark:bg-gray-950">
                {messages.map((message, index) => (
                    <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[82%] rounded-lg px-3 py-2 text-sm leading-relaxed border ${
                            message.role === 'user'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border-gray-200 dark:border-gray-700'
                        }`}>
                            {message.content}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex justify-start">
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-500 dark:text-gray-300 flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Pensando
                        </div>
                    </div>
                )}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                <div className="flex items-end gap-2">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(event) => setInput(event.target.value.slice(0, MAX_INPUT_CHARS))}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                sendMessage();
                            }
                        }}
                        placeholder="Preguntale a Brenda IA..."
                        rows={2}
                        className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-blue-500"
                    />
                    <button
                        onClick={() => sendMessage()}
                        disabled={loading || !input.trim()}
                        className="w-10 h-10 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white flex items-center justify-center transition-colors"
                        title="Enviar"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                </div>

                <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500">
                    <span>{input.length}/{MAX_INPUT_CHARS} caracteres</span>
                    {usage?.total_tokens ? (
                        <span className="flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            {usage.total_tokens} tokens
                        </span>
                    ) : null}
                </div>
            </div>
        </section>
    );
};

export default FloatingCopilot;
