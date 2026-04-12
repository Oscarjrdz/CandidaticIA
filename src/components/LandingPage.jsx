
import React, { useState, useRef, useEffect } from 'react';
import {
    ArrowRight, CheckCircle, Users, Zap, Loader2, MessageSquare, BrainCircuit,
    Bot, Search, Send, BarChart3, Workflow, FileText, Shield, Clock,
    ChevronRight, Star, Play, Sparkles, Globe, Layers, Target, ArrowUpRight,
    MousePointerClick, Rocket, Check, X, Menu, ChevronDown
} from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';

/* ─── WhatsApp SVG Icon ─── */
const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`}>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
);

/* ─── Animated Counter Hook ─── */
const useCountUp = (end, duration = 2000, startOnView = true) => {
    const [count, setCount] = useState(0);
    const ref = useRef(null);
    const started = useRef(false);

    useEffect(() => {
        if (!startOnView) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !started.current) {
                    started.current = true;
                    let start = 0;
                    const increment = end / (duration / 16);
                    const timer = setInterval(() => {
                        start += increment;
                        if (start >= end) {
                            setCount(end);
                            clearInterval(timer);
                        } else {
                            setCount(Math.floor(start));
                        }
                    }, 16);
                }
            },
            { threshold: 0.3 }
        );
        if (ref.current) observer.observe(ref.current);
        return () => observer.disconnect();
    }, [end, duration, startOnView]);

    return [count, ref];
};

/* ─── Scroll Reveal Hook ─── */
const useScrollReveal = () => {
    const ref = useRef(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                }
            },
            { threshold: 0.1 }
        );
        if (ref.current) observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);

    return [ref, isVisible];
};

/* ═══════════════════════════════════════════════════
   LANDING PAGE — FULL ONE-PAGE
   ═══════════════════════════════════════════════════ */
const LandingPage = ({ onLoginSuccess }) => {
    /* ─── MOBILE NAV ─── */
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    /* ─── BRENDA CHAT LOGIC ─── */
    const [brendaMessages, setBrendaMessages] = useState([
        { from: 'brenda', text: '¡Hola, hola! 👋 Soy la Lic. Brenda, reclutadora de Candidatic.', time: new Date() },
    ]);
    const [brendaInput, setBrendaInput] = useState('');
    const [brendaTyping, setBrendaTyping] = useState(false);
    const chatEndRef = useRef(null);
    const chatInputRef = useRef(null);
    // Focus chat input for blinking cursor effect
    useEffect(() => {
        const focusTimer = setTimeout(() => {
            chatInputRef.current?.focus({ preventScroll: true });
        }, 2000);
        return () => clearTimeout(focusTimer);
    }, []);

    // Auto-scroll chat (inside iPhone only, don't move page)
    useEffect(() => {
        const el = chatEndRef.current;
        if (el?.parentElement) {
            el.parentElement.scrollTop = el.parentElement.scrollHeight;
        }
    }, [brendaMessages, brendaTyping]);

    const sendBrendaMessage = async (e) => {
        e?.preventDefault();
        const msg = brendaInput.trim();
        if (!msg || brendaTyping) return;
        const userMsg = { from: 'user', text: msg, time: new Date() };
        setBrendaMessages(prev => [...prev, userMsg]);
        setBrendaInput('');
        setBrendaTyping(true);
        try {
            const res = await fetch('/api/public/chat-brenda', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: msg,
                    history: [...brendaMessages, userMsg].slice(-10)
                })
            });
            const data = await res.json();
            const replyText = data.reply || '¡Ups! Intenta de nuevo 😅';
            // Split multi-bubble responses (same as WhatsApp bot)
            const bubbles = replyText.split('[MSG_SPLIT]').map(b => b.trim()).filter(Boolean);
            for (let i = 0; i < bubbles.length; i++) {
                await new Promise(r => setTimeout(r, 600 + Math.random() * 800));
                setBrendaTyping(false);
                setBrendaMessages(prev => [...prev, { from: 'brenda', text: bubbles[i], time: new Date() }]);
                if (i < bubbles.length - 1) {
                    await new Promise(r => setTimeout(r, 400));
                    setBrendaTyping(true);
                }
            }
        } catch {
            setBrendaTyping(false);
            setBrendaMessages(prev => [...prev, { from: 'brenda', text: 'Hmm, tuve un problema de conexión. ¿Puedes intentar de nuevo? 😊', time: new Date() }]);
        }
        chatInputRef.current?.focus({ preventScroll: true });
    };

    /* ─── WHATSAPP CONTACT LOGIC ─── */
    const [showWhatsAppInput, setShowWhatsAppInput] = useState(false);
    const [contactPhone, setContactPhone] = useState('');
    const [contactLoading, setContactLoading] = useState(false);
    const [contactStatus, setContactStatus] = useState(''); // 'success' | 'error' | ''
    const [contactError, setContactError] = useState('');

    const sendWhatsAppContact = async (e) => {
        e?.preventDefault();
        const cleanPhone = contactPhone.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            setContactError('Ingresa un número válido de 10 dígitos');
            return;
        }
        setContactLoading(true);
        setContactError('');
        setContactStatus('');
        try {
            const res = await fetch('/api/public/contact-brenda', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: cleanPhone })
            });
            const data = await res.json();
            if (data.success) {
                setContactStatus('success');
                setContactPhone('');
            } else {
                throw new Error(data.error || 'Error');
            }
        } catch (err) {
            setContactStatus('error');
            setContactError(err.message || 'Error al enviar. Intenta de nuevo.');
        } finally {
            setContactLoading(false);
        }
    };

    /* ─── LOGIN DROPDOWN LOGIC ─── */
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [loginStep, setLoginStep] = useState('phone');
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [pinDigits, setPinDigits] = useState(['', '', '', '']);
    const pinRefs = useRef([]);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsLoginOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const cleanLogin = () => { setLoginError(''); setLoginLoading(false); };

    const handlePhoneSubmit = async (e) => {
        e.preventDefault();
        cleanLogin();
        if (phone.length < 10) { setLoginError('Número inválido (10 dígitos).'); return; }
        setLoginLoading(true);
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'request-pin', phone })
            });
            const data = await res.json();
            if (res.ok) { setLoginStep('pin'); } else { setLoginError(data.error || 'Error de conexión.'); }
        } catch { setLoginError('Error de red.'); }
        finally { setLoginLoading(false); }
    };

    const handlePinChange = (index, value) => {
        if (!/^\d*$/.test(value)) return;
        const newPin = [...pinDigits];
        newPin[index] = value;
        setPinDigits(newPin);
        if (value && index < 3) pinRefs.current[index + 1]?.focus();
        if (index === 3 && value) submitPin(newPin.slice(0, 3).join('') + value);
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !pinDigits[index] && index > 0) pinRefs.current[index - 1]?.focus();
    };

    const submitPin = async (fullPin) => {
        cleanLogin();
        setLoginLoading(true);
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'verify-pin', phone, pin: fullPin })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                if (data.newUser) setLoginStep('register');
                else onLoginSuccess(data.user);
            } else {
                setLoginError('Código incorrecto.');
                setPinDigits(['', '', '', '']);
                pinRefs.current[0]?.focus();
            }
        } catch { setLoginError('Error de conexión.'); }
        finally { setLoginLoading(false); }
    };

    const handleRegisterSubmit = async (e) => {
        e.preventDefault();
        cleanLogin();
        if (!name.trim()) { setLoginError('Nombre requerido.'); return; }
        setLoginLoading(true);
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'register', phone, name, role: 'Recruiter' })
            });
            const data = await res.json();
            if (res.ok && data.success) setLoginStep('pending');
            else setLoginError(data.error || 'Error al registrar.');
        } catch { setLoginError('Error de conexión.'); }
        finally { setLoginLoading(false); }
    };

    /* ─── COUNTERS ─── */
    const [candidates, candidatesRef] = useCountUp(15000, 2500);
    const [messages, messagesRef] = useCountUp(250000, 2500);
    const [companies, companiesRef] = useCountUp(120, 2000);
    const [automations, automationsRef] = useCountUp(98, 2000);

    /* ─── FAQ ─── */
    const [openFaq, setOpenFaq] = useState(null);
    const faqs = [
        { q: '¿Qué es Candidatic IA?', a: 'Es una plataforma de reclutamiento potenciada por inteligencia artificial que automatiza la búsqueda, filtrado y contacto de candidatos a través de WhatsApp, con un bot conversacional inteligente que extrae datos y programa citas automáticamente.' },
        { q: '¿Necesito conocimientos técnicos?', a: 'No. La plataforma está diseñada para reclutadores. Todo se maneja desde un dashboard visual intuitivo, sin necesidad de código o configuraciones técnicas.' },
        { q: '¿Cómo funciona la búsqueda con IA?', a: 'Escribes en lenguaje natural lo que buscas (ej. "Contador con 3 años de experiencia en Monterrey") y la IA busca en toda tu base de candidatos, rankeando los mejores matches semánticamente.' },
        { q: '¿Puedo enviar mensajes masivos?', a: 'Sí. El módulo de Bulks te permite enviar mensajes personalizados a cientos de candidatos con protección anti-ban, delays inteligentes y personalización automática por nombre.' },
        { q: '¿Se integra con WhatsApp Business?', a: 'Usamos una integración directa multi-instancia que permite manejar múltiples líneas de WhatsApp simultáneamente, con routing determinístico de candidatos.' },
    ];

    /* ─── FEATURES DATA ─── */
    const features = [
        {
            icon: <BrainCircuit className="w-6 h-6" />,
            title: 'Bot IA Conversacional',
            desc: 'Chatbot con GPT que conversa naturalmente, extrae datos del candidato (nombre, experiencia, ciudad) y agenda citas automáticamente.',
            color: 'from-violet-500 to-purple-600',
            bgLight: 'bg-violet-50',
            textColor: 'text-violet-600'
        },
        {
            icon: <Search className="w-6 h-6" />,
            title: 'Búsqueda Semántica',
            desc: 'Busca candidatos con lenguaje natural. La IA entiende contexto, sinónimos y requisitos complejos para encontrar el match perfecto.',
            color: 'from-blue-500 to-cyan-500',
            bgLight: 'bg-blue-50',
            textColor: 'text-blue-600'
        },
        {
            icon: <Send className="w-6 h-6" />,
            title: 'Envíos Masivos',
            desc: 'Manda mensajes a cientos de candidatos con personalización inteligente, delays anti-ban y seguimiento en tiempo real.',
            color: 'from-emerald-500 to-green-600',
            bgLight: 'bg-emerald-50',
            textColor: 'text-emerald-600'
        },
        {
            icon: <Workflow className="w-6 h-6" />,
            title: 'ByPass Intelligence',
            desc: 'Routing automático de candidatos a reclutadores específicos basado en reglas inteligentes, zona y disponibilidad.',
            color: 'from-amber-500 to-orange-500',
            bgLight: 'bg-amber-50',
            textColor: 'text-amber-600'
        },
        {
            icon: <FileText className="w-6 h-6" />,
            title: 'Vacantes & Proyectos',
            desc: 'Gestiona vacantes con editor visual, asigna candidatos a proyectos y trackea el pipeline de reclutamiento completo.',
            color: 'from-rose-500 to-pink-600',
            bgLight: 'bg-rose-50',
            textColor: 'text-rose-600'
        },
        {
            icon: <BarChart3 className="w-6 h-6" />,
            title: 'Automatizaciones',
            desc: 'Reglas de extracción automática de datos, recordatorios programados y flujos de trabajo que eliminan toda tarea manual.',
            color: 'from-indigo-500 to-blue-700',
            bgLight: 'bg-indigo-50',
            textColor: 'text-indigo-600'
        },
    ];

    /* ─── HOW IT WORKS ─── */
    const steps = [
        { num: '01', title: 'Conecta tu WhatsApp', desc: 'Escanea el QR y vincula tu línea en segundos. Soportamos múltiples instancias simultáneas.', icon: <WhatsAppIcon className="w-6 h-6" /> },
        { num: '02', title: 'Configura tu Bot IA', desc: 'Define el tono, preguntas y flujo de conversación. El bot extrae datos automáticamente de cada candidato.', icon: <Bot className="w-6 h-6" /> },
        { num: '03', title: 'Publica y Atrae', desc: 'Crea posts atractivos con el Post Maker, compártelos en redes y deja que los candidatos te contacten.', icon: <Globe className="w-6 h-6" /> },
        { num: '04', title: 'Recluta Inteligentemente', desc: 'Busca con IA, filtra por perfil, envía masivos y gestiona todo desde un solo dashboard.', icon: <Target className="w-6 h-6" /> },
    ];

    /* ─── SCROLL REVEAL ─── */
    const [featuresRef, featuresVisible] = useScrollReveal();
    const [stepsRef, stepsVisible] = useScrollReveal();
    const [statsRef, statsVisible] = useScrollReveal();
    const [pricingRef, pricingVisible] = useScrollReveal();

    /* ────────────────────────────────────────────── */
    return (
        <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-violet-100 selection:text-violet-900 overflow-x-hidden">

            {/* ═══ HEADER ═══ */}
            <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100/80">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between relative">
                    <div className="flex items-center space-x-2.5">
                        <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-violet-700 rounded-xl flex items-center justify-center shadow-lg shadow-violet-200">
                            <BrainCircuit className="w-5 h-5 text-white stroke-[1.5]" />
                        </div>
                        <span className="text-xl font-extrabold tracking-tight text-gray-900 flex items-center">
                            CANDIDATIC&nbsp;<span className="tracking-tighter bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">IΛ</span>
                        </span>
                    </div>

                    <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-gray-600">
                        <a href="#features" className="hover:text-violet-600 transition-colors duration-300">Características</a>
                        <a href="#how-it-works" className="hover:text-violet-600 transition-colors duration-300">Cómo funciona</a>
                        <a href="#pricing" className="hover:text-violet-600 transition-colors duration-300">Precios</a>
                        <a href="#faq" className="hover:text-violet-600 transition-colors duration-300">FAQ</a>
                    </nav>

                    <div className="flex items-center space-x-3">
                        <div className="relative" ref={dropdownRef}>
                            <Button
                                onClick={() => setIsLoginOpen(!isLoginOpen)}
                                className="rounded-full px-7 py-2.5 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white shadow-lg shadow-violet-200/50 hover:shadow-violet-300/60 transition-all duration-300 transform hover:-translate-y-0.5 text-sm font-semibold"
                            >
                                Ingresar
                            </Button>

                            {/* LOGIN DROPDOWN */}
                            {isLoginOpen && (
                                <div className="absolute right-0 top-full mt-6 w-[38rem] bg-white/95 backdrop-blur-3xl rounded-3xl shadow-[0_20px_50px_rgb(109_40_217_/_0.2)] border border-white/50 p-8 z-50 animate-in zoom-in-95 slide-in-from-top-4 ease-out origin-top-right ring-1 ring-violet-100/60">
                                    <div className="absolute -top-3 right-8 w-6 h-6 bg-white/95 backdrop-blur-3xl transform rotate-45 border-t border-l border-violet-100/50"></div>
                                    <div className="absolute inset-0 rounded-3xl bg-gradient-to-b from-violet-50/30 to-transparent pointer-events-none"></div>
                                    <div className="relative z-10">
                                        <div className="mb-8 text-center">
                                            <div className="relative inline-block mb-4">
                                                <div className="absolute inset-0 bg-violet-500 blur-xl opacity-20 rounded-full animate-pulse"></div>
                                                <div className="relative w-16 h-16 bg-gradient-to-tr from-blue-600 to-violet-800 rounded-2xl flex items-center justify-center shadow-lg transform rotate-3 hover:rotate-6 transition-transform ring-4 ring-violet-50">
                                                    <BrainCircuit className="w-10 h-10 text-white stroke-[1.5]" />
                                                </div>
                                            </div>
                                            <h3 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-1">Bienvenido</h3>
                                            <p className="text-base text-gray-500 font-medium">Accede a tu cuenta</p>
                                        </div>

                                        {loginError && (
                                            <div className="mb-4 p-3 bg-red-50/50 border border-red-100 text-red-600 text-xs rounded-xl text-center font-semibold shadow-sm backdrop-blur-sm">
                                                {loginError}
                                            </div>
                                        )}

                                        {loginStep === 'phone' ? (
                                            <form onSubmit={handlePhoneSubmit} className="space-y-6">
                                                <div className="space-y-2 text-center">
                                                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">WhatsApp (10 dígitos)</label>
                                                    <div className="flex justify-center gap-1.5">
                                                        {Array(10).fill(0).map((_, i) => (
                                                            <input key={i} id={`phone-${i}`} type="text" inputMode="numeric" maxLength={1}
                                                                value={phone[i] || ''}
                                                                onChange={(e) => {
                                                                    const val = e.target.value.replace(/\D/g, '');
                                                                    if (!val && !e.target.value) { const np = phone.split(''); np[i] = ''; setPhone(np.join('')); return; }
                                                                    if (val) { const np = phone.split(''); np[i] = val; setPhone(np.join('')); if (i < 9) document.getElementById(`phone-${i + 1}`).focus(); }
                                                                }}
                                                                onKeyDown={(e) => { if (e.key === 'Backspace' && !phone[i] && i > 0) document.getElementById(`phone-${i - 1}`).focus(); }}
                                                                onFocus={(e) => e.target.select()}
                                                                className={`w-12 h-14 text-center text-2xl font-bold rounded-lg border-2 outline-none transition-all duration-300 shadow-sm ${phone[i] ? 'border-green-500 text-green-600 bg-green-50/50 shadow-[0_0_10px_rgba(34,197,94,0.2)] transform scale-105' : 'border-gray-200 text-gray-400 bg-white/50 focus:border-violet-400 focus:bg-white'}`}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                                <button type="submit" className={`w-full h-12 text-base font-bold shadow-lg rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] inline-flex items-center justify-center text-white ${phone.length === 10 ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-green-500/25 cursor-pointer' : 'bg-gray-400 cursor-not-allowed'}`} disabled={loginLoading || phone.length < 10}>
                                                    {loginLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Enviar Código'}
                                                </button>
                                            </form>
                                        ) : loginStep === 'pin' ? (
                                            <div className="space-y-6">
                                                <div className="text-center">
                                                    <p className="text-sm text-gray-500 font-medium bg-gray-50 inline-block px-3 py-1 rounded-full border border-gray-100">
                                                        Código enviado a <b className="text-gray-800">{phone}</b>
                                                    </p>
                                                </div>
                                                <div className="flex justify-center gap-2">
                                                    {pinDigits.map((d, i) => (
                                                        <input key={i} ref={el => pinRefs.current[i] = el} type="text" value={d} maxLength={1}
                                                            onChange={(e) => handlePinChange(i, e.target.value)}
                                                            onKeyDown={(e) => handleKeyDown(i, e)}
                                                            className={`w-12 h-14 text-center text-2xl font-bold border-2 rounded-xl outline-none transition-all duration-300 shadow-sm ${d ? 'border-green-500 text-green-600 bg-green-50/50 shadow-[0_0_10px_rgba(34,197,94,0.2)] transform scale-105' : 'border-gray-100 text-gray-400 bg-white/50 focus:border-violet-500 focus:ring-4 focus:ring-violet-100 focus:bg-white'}`}
                                                            autoFocus={i === 0}
                                                        />
                                                    ))}
                                                </div>
                                                <button onClick={() => setLoginStep('phone')} className="block w-full text-xs text-violet-600 hover:text-violet-700 font-semibold hover:underline text-center">
                                                    ¿Número incorrecto? Volver
                                                </button>
                                            </div>
                                        ) : loginStep === 'register' ? (
                                            <form onSubmit={handleRegisterSubmit} className="space-y-6">
                                                <div className="text-center">
                                                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                                        <Users className="w-8 h-8 text-green-600" />
                                                    </div>
                                                    <h4 className="text-xl font-bold">Crea tu Perfil</h4>
                                                    <p className="text-sm text-gray-500">Solo necesitamos tu nombre completo.</p>
                                                </div>
                                                <Input placeholder="Ej. Ana García" value={name} onChange={(e) => setName(e.target.value)} className="h-12 text-lg text-center" required autoFocus />
                                                <button type="submit" className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg transition-all transform hover:scale-[1.02]" disabled={loginLoading}>
                                                    {loginLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Solicitar Acceso'}
                                                </button>
                                            </form>
                                        ) : (
                                            <div className="text-center space-y-6">
                                                <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                                                    <Zap className="w-10 h-10 text-yellow-600" />
                                                </div>
                                                <div>
                                                    <h4 className="text-2xl font-bold">Solicitud Enviada</h4>
                                                    <p className="text-sm text-gray-600 mt-2">Tu cuenta está en revisión. Te avisaremos por WhatsApp ({phone}) cuando esté activa.</p>
                                                </div>
                                                <button onClick={() => setIsLoginOpen(false)} className="w-full h-12 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl active:scale-95 transition-all">Cerrar</button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Mobile menu button */}
                        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors">
                            <Menu className="w-5 h-5 text-gray-700" />
                        </button>
                    </div>
                </div>

                {/* Mobile menu */}
                {mobileMenuOpen && (
                    <div className="md:hidden bg-white border-t border-gray-100 px-6 py-4 space-y-3 animate-in slide-in-from-top-2">
                        <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-violet-600 py-2">Características</a>
                        <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-violet-600 py-2">Cómo funciona</a>
                        <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-violet-600 py-2">Precios</a>
                        <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-violet-600 py-2">FAQ</a>
                    </div>
                )}
            </header>

            <main>
                {/* ═══ iPhone CSS Animations ═══ */}
                <style>{`
                    @keyframes iphoneFloat {
                        0%, 100% { transform: translateY(0px) rotateY(-5deg) rotateX(2deg); }
                        50% { transform: translateY(-12px) rotateY(-5deg) rotateX(2deg); }
                    }
                    @keyframes msgSlideIn {
                        from { opacity: 0; transform: translateY(12px) scale(0.95); }
                        to { opacity: 1; transform: translateY(0) scale(1); }
                    }
                    @keyframes typingBounce {
                        0%, 60%, 100% { transform: translateY(0); }
                        30% { transform: translateY(-4px); }
                    }
                    @keyframes glowPulse {
                        0%, 100% { box-shadow: 0 0 20px rgba(124, 58, 237, 0.15), 0 0 60px rgba(124, 58, 237, 0.05); }
                        50% { box-shadow: 0 0 30px rgba(124, 58, 237, 0.25), 0 0 80px rgba(124, 58, 237, 0.1); }
                    }
                    @keyframes heroTextReveal {
                        from { opacity: 0; transform: translateY(30px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    .msg-appear { animation: msgSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
                    .typing-dot { animation: typingBounce 1.4s infinite; }
                    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
                    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
                    .iphone-glow { animation: glowPulse 3s ease-in-out infinite; }
                    .hero-text-1 { animation: heroTextReveal 0.8s 0.2s cubic-bezier(0.16, 1, 0.3, 1) both; }
                    .hero-text-2 { animation: heroTextReveal 0.8s 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; }
                    .hero-text-3 { animation: heroTextReveal 0.8s 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
                    .hero-text-4 { animation: heroTextReveal 0.8s 0.8s cubic-bezier(0.16, 1, 0.3, 1) both; }
                `}</style>

                {/* ═══ HERO SECTION ═══ */}
                <section className="pt-32 pb-16 px-6 relative overflow-hidden">
                    {/* Background gradient blobs */}
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        <div className="absolute top-[-20%] left-[-15%] w-[60%] h-[60%] bg-blue-400/8 rounded-full blur-3xl animate-float"></div>
                        <div className="absolute bottom-[-20%] right-[-15%] w-[55%] h-[55%] bg-violet-400/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '3s' }}></div>
                        <div className="absolute top-[40%] left-[50%] w-[30%] h-[30%] bg-pink-300/8 rounded-full blur-3xl"></div>
                    </div>

                    <div className="max-w-7xl mx-auto w-full relative z-10">
                        <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-8 lg:gap-6 items-start pt-8">

                            {/* ── LEFT: Hero Text ── */}
                            <div className="text-left lg:pr-8">
                                {/* Badge */}
                                <div className="hero-text-1 inline-flex items-center space-x-2 bg-violet-50/80 backdrop-blur-sm px-5 py-2.5 rounded-full text-sm font-semibold text-violet-700 mb-8 border border-violet-100/60">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                                    </span>
                                    <span>Conoce a Brenda, tu reclutadora IA</span>
                                </div>

                                {/* Headline */}
                                <h1 className="hero-text-2 text-4xl sm:text-5xl lg:text-[3.5rem] xl:text-6xl font-extrabold tracking-tight text-gray-900 mb-6 leading-[1.08]">
                                    Revoluciona tu{' '}<br className="hidden sm:inline" />
                                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600">
                                        Reclutamiento con IA
                                    </span>
                                </h1>

                                <p className="hero-text-3 text-base lg:text-lg text-gray-500 max-w-lg mb-8 leading-relaxed">
                                    Brenda es tu bot de reclutamiento con GPT. Conversa con candidatos, extrae datos automáticamente y agenda entrevistas. ¡Pruébala ahora mismo! →
                                </p>

                                {/* CTA Buttons */}
                                <div className="hero-text-4 flex flex-col sm:flex-row gap-4">
                                    <button
                                        onClick={() => setIsLoginOpen(true)}
                                        className="group inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white font-bold rounded-2xl shadow-xl shadow-violet-300/30 hover:shadow-violet-400/40 transition-all duration-300 transform hover:-translate-y-0.5 text-base"
                                    >
                                        Empezar gratis
                                        <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                                    </button>
                                    <button
                                        onClick={() => { setShowWhatsAppInput(!showWhatsAppInput); setContactStatus(''); setContactError(''); }}
                                        className="group inline-flex items-center justify-center px-8 py-4 bg-white hover:bg-gray-50 border-2 border-gray-200 hover:border-green-400 text-gray-800 font-bold rounded-2xl transition-all duration-300 text-base"
                                    >
                                        <WhatsAppIcon className="w-5 h-5 text-green-600 mr-2" />
                                        Hablar con Brenda
                                    </button>
                                </div>

                                {/* Trust badges — below buttons */}
                                <div className="hero-text-4 mt-4 flex flex-wrap items-center gap-5 text-xs text-gray-400">
                                    <div className="flex items-center space-x-1.5">
                                        <Shield className="w-3.5 h-3.5 text-green-500" />
                                        <span>Conexión segura</span>
                                    </div>
                                    <div className="flex items-center space-x-1.5">
                                        <Clock className="w-3.5 h-3.5 text-blue-500" />
                                        <span>Setup en 5 min</span>
                                    </div>
                                    <div className="flex items-center space-x-1.5">
                                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                                        <span>Sin tarjeta de crédito</span>
                                    </div>
                                </div>

                                {/* WhatsApp Phone Input */}
                                {showWhatsAppInput && (
                                    <div className="hero-text-4 mt-4 msg-appear">
                                        {contactStatus === 'success' ? (
                                            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-5 py-4">
                                                <CheckCircle className="w-6 h-6 text-green-500 shrink-0" />
                                                <div>
                                                    <p className="font-bold text-green-800 text-sm">¡Listo! Revisa tu WhatsApp 📱</p>
                                                    <p className="text-green-600 text-xs mt-0.5">Brenda te está escribiendo en este momento.</p>
                                                </div>
                                            </div>
                                        ) : (
                                            <form onSubmit={sendWhatsAppContact} className="relative">
                                                <div className="flex items-center bg-white rounded-2xl shadow-lg shadow-green-100/40 border-2 border-green-200 p-1.5 gap-2">
                                                    <div className="pl-3 text-gray-400 flex items-center gap-1.5">
                                                        <span className="text-sm font-bold text-gray-500">🇲🇽 +52</span>
                                                    </div>
                                                    <input
                                                        type="tel"
                                                        value={contactPhone}
                                                        onChange={(e) => { setContactPhone(e.target.value); setContactError(''); }}
                                                        placeholder="Tu número a 10 dígitos"
                                                        className="flex-1 bg-transparent border-none text-gray-800 placeholder-gray-400 text-sm outline-none min-w-0 py-2"
                                                        maxLength={10}
                                                    />
                                                    <button
                                                        type="submit"
                                                        disabled={contactLoading || contactPhone.replace(/\D/g, '').length < 10}
                                                        className="bg-green-500 hover:bg-green-600 text-white rounded-xl px-5 py-2.5 font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
                                                    >
                                                        {contactLoading ? (
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                        ) : (
                                                            <>
                                                                <Send className="w-4 h-4" />
                                                                <span>Enviar</span>
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                                {contactError && (
                                                    <p className="text-red-500 text-xs mt-2 pl-2">{contactError}</p>
                                                )}
                                            </form>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* ── CENTER: QR Code ── */}
                            <div className="hidden lg:flex flex-col items-center justify-center">
                                <a href="https://wa.me/528120622870?text=Hola%20Brenda" target="_blank" rel="noopener noreferrer"
                                   className="group flex flex-col items-center gap-3 bg-white/80 backdrop-blur rounded-2xl px-5 py-5 border border-gray-100 hover:border-green-300 hover:shadow-xl hover:shadow-green-100/30 transition-all cursor-pointer">
                                    <img
                                        src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https%3A%2F%2Fwa.me%2F528120622870%3Ftext%3DHola%2520Brenda&color=25D366&bgcolor=FFFFFF&format=svg"
                                        alt="QR WhatsApp Brenda"
                                        className="w-24 h-24 rounded-lg"
                                    />
                                    <div className="text-center">
                                        <p className="font-bold text-gray-800 text-xs group-hover:text-green-700 transition-colors">Escanea y habla<br/>con Brenda</p>
                                        <p className="text-[10px] text-gray-400 flex items-center justify-center gap-1 mt-1">
                                            <WhatsAppIcon className="w-3 h-3 text-green-500" />
                                            WhatsApp
                                        </p>
                                    </div>
                                </a>
                            </div>

                            {/* ── RIGHT: iPhone 17 Pro Max Mockup ── */}
                            <div className="flex justify-center lg:justify-end" style={{ perspective: '1200px' }}>
                                <div className="relative" style={{ animation: 'iphoneFloat 6s ease-in-out infinite' }}>
                                    {/* Glow behind phone */}
                                    <div className="absolute -inset-8 bg-gradient-to-br from-violet-400/20 via-blue-400/15 to-pink-400/10 rounded-[4rem] blur-2xl iphone-glow"></div>

                                    {/* iPhone Frame */}
                                    <div className="relative w-[320px] sm:w-[340px] bg-gray-950 rounded-[3rem] p-[10px] shadow-2xl shadow-gray-900/40" style={{
                                        border: '1px solid rgba(255,255,255,0.1)',
                                    }}>
                                        {/* Dynamic Island */}
                                        <div className="absolute top-[14px] left-1/2 -translate-x-1/2 w-[100px] h-[28px] bg-black rounded-full z-30 flex items-center justify-center">
                                            <div className="w-[10px] h-[10px] rounded-full bg-gray-800 border border-gray-700"></div>
                                        </div>

                                        {/* Screen */}
                                        <div className="relative bg-white rounded-[2.4rem] overflow-hidden" style={{ height: '560px' }}>
                                            {/* WhatsApp Header */}
                                            <div className="bg-gradient-to-r from-violet-600 to-blue-600 px-4 pt-14 pb-3 flex items-center space-x-3">
                                                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                                                    <Bot className="w-6 h-6 text-white" />
                                                </div>
                                                <div className="flex-1">
                                                    <p className="font-bold text-white text-sm">Brenda • Reclutadora IA</p>
                                                    <p className="text-[11px] text-white/70 flex items-center gap-1">
                                                        <span className="w-1.5 h-1.5 bg-green-400 rounded-full inline-block"></span>
                                                        en línea
                                                    </p>
                                                </div>
                                                <div className="flex items-center space-x-3 text-white/70">
                                                    <Sparkles className="w-4 h-4" />
                                                </div>
                                            </div>

                                            {/* Chat Area */}
                                            <div className="flex flex-col h-[calc(100%-140px)]">
                                                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" style={{
                                                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                                                    backgroundColor: '#f0f0f0'
                                                }}>
                                                    {/* Date chip */}
                                                    <div className="flex justify-center mb-2">
                                                        <span className="text-[10px] bg-white/80 rounded-lg px-3 py-1 text-gray-500 shadow-sm">Hoy</span>
                                                    </div>

                                                    {/* Messages */}
                                                    {brendaMessages.map((msg, i) => (
                                                        <div key={i} className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'} msg-appear`}>
                                                            <div className={`max-w-[82%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed shadow-sm relative ${
                                                                msg.from === 'user'
                                                                    ? 'bg-gradient-to-br from-violet-500 to-blue-600 text-white rounded-br-md'
                                                                    : 'bg-white text-gray-800 rounded-bl-md'
                                                            }`} style={{ whiteSpace: 'pre-wrap' }}>
                                                                {msg.text}
                                                                <span className={`block text-[9px] mt-0.5 text-right ${msg.from === 'user' ? 'text-white/60' : 'text-gray-400'}`}>
                                                                    {msg.time ? new Date(msg.time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''}
                                                                    {msg.from === 'user' && ' ✓✓'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}

                                                    {/* Typing indicator */}
                                                    {brendaTyping && (
                                                        <div className="flex justify-start msg-appear">
                                                            <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-md shadow-sm flex items-center space-x-1.5">
                                                                <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot"></div>
                                                                <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot"></div>
                                                                <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot"></div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div ref={chatEndRef}></div>
                                                </div>

                                                {/* Input Area */}
                                                <div className="px-2 py-2 bg-white border-t border-gray-100">
                                                    <form onSubmit={sendBrendaMessage} className="flex items-center gap-2">
                                                        <input
                                                            ref={chatInputRef}
                                                            type="text"
                                                            value={brendaInput}
                                                            onChange={(e) => setBrendaInput(e.target.value)}
                                                            placeholder="Escribe un mensaje..."
                                                            className="flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-violet-200 transition-all text-gray-800 placeholder-gray-400"
                                                        />
                                                        <button
                                                            type="submit"
                                                            disabled={!brendaInput.trim() || brendaTyping}
                                                            className="w-9 h-9 rounded-full bg-gradient-to-r from-violet-500 to-blue-600 flex items-center justify-center shrink-0 disabled:opacity-30 hover:scale-105 active:scale-95 transition-all shadow-md"
                                                        >
                                                            <Send className="w-4 h-4 text-white translate-x-[1px]" />
                                                        </button>
                                                    </form>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Home indicator */}
                                        <div className="flex justify-center mt-2 mb-1">
                                            <div className="w-28 h-1 bg-white/20 rounded-full"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ LOGOS / SOCIAL PROOF ═══ */}
                <section className="py-12 px-6">
                    <div className="max-w-5xl mx-auto text-center">
                        <p className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-8">Empresas que ya confían en nosotros</p>
                        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 opacity-40">
                            {['Grupo Monterrey', 'TalentoMX', 'RecruiterPro', 'HRTech Labs', 'FastHire'].map((name, i) => (
                                <span key={i} className="text-xl font-bold text-gray-400 tracking-tight whitespace-nowrap">{name}</span>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ═══ FEATURES SECTION ═══ */}
                <section id="features" className="py-20 px-6" ref={featuresRef}>
                    <div className="max-w-7xl mx-auto">
                        <div className={`text-center mb-16 transition-all duration-700 ${featuresVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                            <div className="inline-flex items-center space-x-2 bg-violet-50 px-4 py-1.5 rounded-full text-sm font-semibold text-violet-700 mb-4 border border-violet-100">
                                <Sparkles className="w-4 h-4" />
                                <span>Funcionalidades</span>
                            </div>
                            <h2 className="text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
                                Todo lo que necesitas para<br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600">reclutar mejor</span>
                            </h2>
                            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
                                Una suite completa de herramientas potenciadas por inteligencia artificial, diseñadas para reclutadores modernos.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {features.map((f, i) => (
                                <div
                                    key={i}
                                    className={`group relative bg-white rounded-2xl border border-gray-100 p-8 hover:border-violet-200 hover:shadow-xl hover:shadow-violet-100/50 transition-all duration-500 cursor-default ${
                                        featuresVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
                                    }`}
                                    style={{ transitionDelay: `${i * 100}ms` }}
                                >
                                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-white mb-5 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                                        {f.icon}
                                    </div>
                                    <h3 className="text-xl font-bold text-gray-900 mb-2">{f.title}</h3>
                                    <p className="text-gray-500 leading-relaxed text-sm">{f.desc}</p>
                                    <div className="mt-5 flex items-center space-x-1 text-sm font-semibold text-violet-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                        <span>Explorar</span>
                                        <ArrowRight className="w-4 h-4" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ═══ HOW IT WORKS ═══ */}
                <section id="how-it-works" className="py-20 px-6 bg-gradient-to-b from-gray-50/50 to-white" ref={stepsRef}>
                    <div className="max-w-7xl mx-auto">
                        <div className={`text-center mb-16 transition-all duration-700 ${stepsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                            <div className="inline-flex items-center space-x-2 bg-blue-50 px-4 py-1.5 rounded-full text-sm font-semibold text-blue-700 mb-4 border border-blue-100">
                                <Rocket className="w-4 h-4" />
                                <span>Proceso</span>
                            </div>
                            <h2 className="text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
                                ¿Cómo funciona?
                            </h2>
                            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
                                En solo 4 pasos automatiza completamente tu proceso de reclutamiento.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                            {steps.map((s, i) => (
                                <div
                                    key={i}
                                    className={`relative transition-all duration-700 ${stepsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
                                    style={{ transitionDelay: `${i * 150}ms` }}
                                >
                                    {/* Connector line */}
                                    {i < 3 && (
                                        <div className="hidden lg:block absolute top-10 left-[calc(100%+0.5rem)] w-[calc(100%-3rem)] h-px bg-gradient-to-r from-violet-300 to-transparent"></div>
                                    )}
                                    <div className="bg-white rounded-2xl p-8 border border-gray-100 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-50 transition-all duration-300 h-full">
                                        <div className="flex items-center space-x-3 mb-5">
                                            <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600">{s.num}</span>
                                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/10 to-violet-500/10 flex items-center justify-center text-violet-600">
                                                {s.icon}
                                            </div>
                                        </div>
                                        <h3 className="text-lg font-bold text-gray-900 mb-2">{s.title}</h3>
                                        <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ═══ STATS SECTION ═══ */}
                <section className="py-20 px-6" ref={statsRef}>
                    <div className="max-w-7xl mx-auto">
                        <div className={`relative rounded-[2rem] overflow-hidden p-12 md:p-16 transition-all duration-700 ${statsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{
                            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%)'
                        }}>
                            {/* Decorative elements */}
                            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                <div className="absolute top-[-20%] right-[-10%] w-[40%] h-[40%] bg-violet-500/20 rounded-full blur-3xl"></div>
                                <div className="absolute bottom-[-20%] left-[-10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-3xl"></div>
                            </div>

                            <div className="relative z-10">
                                <h2 className="text-3xl md:text-4xl font-extrabold text-white text-center mb-4 tracking-tight">
                                    Números que hablan por sí solos
                                </h2>
                                <p className="text-violet-200 text-center mb-12 text-lg">
                                    Resultados reales de empresas que usan Candidatic IA
                                </p>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                                    <div className="text-center" ref={candidatesRef}>
                                        <div className="text-4xl md:text-5xl font-black text-white mb-2">
                                            {candidates.toLocaleString()}+
                                        </div>
                                        <div className="text-violet-300 text-sm font-medium">Candidatos gestionados</div>
                                    </div>
                                    <div className="text-center" ref={messagesRef}>
                                        <div className="text-4xl md:text-5xl font-black text-white mb-2">
                                            {messages.toLocaleString()}+
                                        </div>
                                        <div className="text-violet-300 text-sm font-medium">Mensajes enviados</div>
                                    </div>
                                    <div className="text-center" ref={companiesRef}>
                                        <div className="text-4xl md:text-5xl font-black text-white mb-2">
                                            {companies}+
                                        </div>
                                        <div className="text-violet-300 text-sm font-medium">Empresas activas</div>
                                    </div>
                                    <div className="text-center" ref={automationsRef}>
                                        <div className="text-4xl md:text-5xl font-black text-white mb-2">
                                            {automations}%
                                        </div>
                                        <div className="text-violet-300 text-sm font-medium">Automatización</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ PLATFORM PREVIEW ═══ */}
                <section className="py-20 px-6 bg-gradient-to-b from-white to-gray-50/50">
                    <div className="max-w-7xl mx-auto">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                            <div>
                                <div className="inline-flex items-center space-x-2 bg-emerald-50 px-4 py-1.5 rounded-full text-sm font-semibold text-emerald-700 mb-4 border border-emerald-100">
                                    <MessageSquare className="w-4 h-4" />
                                    <span>WhatsApp Nativo</span>
                                </div>
                                <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight mb-6">
                                    Chat integrado con{' '}
                                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-500 to-emerald-600">WhatsApp</span>
                                </h2>
                                <p className="text-lg text-gray-500 mb-8 leading-relaxed">
                                    Conversa directamente con tus candidatos desde la plataforma. El bot IA responde 24/7, extrae datos automáticamente y escala a un humano cuando es necesario.
                                </p>
                                <div className="space-y-4">
                                    {[
                                        'Respuestas automáticas con GPT-4',
                                        'Extracción inteligente de datos del candidato',
                                        'Agendamiento automático de citas',
                                        'Handover a reclutador cuando se necesita',
                                        'Multi-instancia con routing inteligente'
                                    ].map((item, i) => (
                                        <div key={i} className="flex items-center space-x-3">
                                            <div className="w-6 h-6 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center shrink-0">
                                                <Check className="w-3.5 h-3.5 text-white" />
                                            </div>
                                            <span className="text-gray-700 font-medium text-sm">{item}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Mock Chat Widget */}
                            <div className="relative">
                                <div className="absolute -inset-4 bg-gradient-to-r from-green-400/20 to-emerald-400/20 rounded-3xl blur-2xl"></div>
                                <div className="relative bg-white rounded-2xl shadow-2xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                                    {/* Chat header */}
                                    <div className="bg-gradient-to-r from-green-600 to-emerald-600 p-4 flex items-center space-x-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                            <Bot className="w-5 h-5 text-white" />
                                        </div>
                                        <div>
                                            <p className="text-white font-bold text-sm">Candidatic Bot</p>
                                            <p className="text-green-100 text-xs">● En línea</p>
                                        </div>
                                    </div>
                                    {/* Chat messages */}
                                    <div className="p-5 space-y-4 bg-[#ECE5DD] min-h-[280px]">
                                        <div className="flex justify-start">
                                            <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[75%] shadow-sm">
                                                <p className="text-sm text-gray-800">¡Hola! 👋 Soy el asistente de reclutamiento. ¿Buscas empleo?</p>
                                                <p className="text-[10px] text-gray-400 mt-1 text-right">10:30</p>
                                            </div>
                                        </div>
                                        <div className="flex justify-end">
                                            <div className="bg-[#DCF8C6] rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[75%] shadow-sm">
                                                <p className="text-sm text-gray-800">Sí, soy contador con 5 años de experiencia en Monterrey</p>
                                                <p className="text-[10px] text-gray-400 mt-1 text-right">10:31</p>
                                            </div>
                                        </div>
                                        <div className="flex justify-start">
                                            <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[75%] shadow-sm">
                                                <p className="text-sm text-gray-800">¡Perfecto! 🎯 Tenemos vacantes ideales para ti. Déjame agendar una entrevista. ¿Qué día te queda mejor?</p>
                                                <p className="text-[10px] text-gray-400 mt-1 text-right">10:31</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-2 text-gray-500">
                                            <div className="flex space-x-1">
                                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                            </div>
                                            <span className="text-xs text-gray-400 italic">Bot extrayendo datos...</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ PRICING SECTION ═══ */}
                <section id="pricing" className="py-20 px-6" ref={pricingRef}>
                    <div className="max-w-7xl mx-auto">
                        <div className={`text-center mb-16 transition-all duration-700 ${pricingVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                            <div className="inline-flex items-center space-x-2 bg-amber-50 px-4 py-1.5 rounded-full text-sm font-semibold text-amber-700 mb-4 border border-amber-100">
                                <Zap className="w-4 h-4" />
                                <span>Planes</span>
                            </div>
                            <h2 className="text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
                                Elige el plan ideal para ti
                            </h2>
                            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
                                Sin contratos. Sin letras pequeñas. Escala cuando quieras.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                            {/* Starter */}
                            <div className={`bg-white rounded-2xl border border-gray-100 p-8 hover:border-gray-200 hover:shadow-lg transition-all duration-500 ${pricingVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '0ms' }}>
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-gray-900 mb-1">Starter</h3>
                                    <p className="text-sm text-gray-500">Para equipos pequeños</p>
                                </div>
                                <div className="mb-6">
                                    <span className="text-4xl font-black text-gray-900">$1,499</span>
                                    <span className="text-gray-500 text-sm"> /mes MXN</span>
                                </div>
                                <div className="space-y-3 mb-8">
                                    {['1 línea de WhatsApp', '500 candidatos', 'Bot IA básico', 'Búsqueda semántica', 'Soporte por chat'].map((f, i) => (
                                        <div key={i} className="flex items-center space-x-2.5 text-sm">
                                            <Check className="w-4 h-4 text-green-500 shrink-0" />
                                            <span className="text-gray-600">{f}</span>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setIsLoginOpen(true)} className="w-full py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-semibold hover:border-violet-300 hover:text-violet-700 transition-all duration-300 text-sm">
                                    Empezar gratis
                                </button>
                            </div>

                            {/* Pro — featured */}
                            <div className={`relative bg-gradient-to-b from-violet-600 to-indigo-700 rounded-2xl p-8 text-white shadow-2xl shadow-violet-300/30 scale-105 transition-all duration-500 ${pricingVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '100ms' }}>
                                <div className="absolute top-0 right-6 -translate-y-1/2">
                                    <span className="bg-gradient-to-r from-amber-400 to-orange-400 text-gray-900 text-xs font-bold px-4 py-1.5 rounded-full shadow-lg">
                                        ⭐ Más popular
                                    </span>
                                </div>
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold mb-1">Pro</h3>
                                    <p className="text-sm text-violet-200">Para reclutadores serios</p>
                                </div>
                                <div className="mb-6">
                                    <span className="text-4xl font-black">$3,499</span>
                                    <span className="text-violet-200 text-sm"> /mes MXN</span>
                                </div>
                                <div className="space-y-3 mb-8">
                                    {['3 líneas de WhatsApp', 'Candidatos ilimitados', 'Bot IA avanzado (GPT-4)', 'Envíos masivos', 'ByPass Intelligence', 'Vacantes & Proyectos', 'Post Maker', 'Soporte prioritario'].map((f, i) => (
                                        <div key={i} className="flex items-center space-x-2.5 text-sm">
                                            <Check className="w-4 h-4 text-green-300 shrink-0" />
                                            <span className="text-violet-100">{f}</span>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setIsLoginOpen(true)} className="w-full py-3 rounded-xl bg-white text-violet-700 font-bold hover:bg-violet-50 transition-all duration-300 text-sm shadow-lg">
                                    Comenzar ahora
                                </button>
                            </div>

                            {/* Enterprise */}
                            <div className={`bg-white rounded-2xl border border-gray-100 p-8 hover:border-gray-200 hover:shadow-lg transition-all duration-500 ${pricingVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '200ms' }}>
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-gray-900 mb-1">Enterprise</h3>
                                    <p className="text-sm text-gray-500">Para agencias de reclutamiento</p>
                                </div>
                                <div className="mb-6">
                                    <span className="text-4xl font-black text-gray-900">Custom</span>
                                </div>
                                <div className="space-y-3 mb-8">
                                    {['Líneas ilimitadas', 'Candidatos ilimitados', 'IA personalizada', 'Todas las funcionalidades', 'API dedicada', 'White-label', 'SLA garantizado', 'Account manager'].map((f, i) => (
                                        <div key={i} className="flex items-center space-x-2.5 text-sm">
                                            <Check className="w-4 h-4 text-green-500 shrink-0" />
                                            <span className="text-gray-600">{f}</span>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => window.open('https://wa.me/528112345678', '_blank')} className="w-full py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-semibold hover:border-violet-300 hover:text-violet-700 transition-all duration-300 text-sm">
                                    Contactar ventas
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ FAQ SECTION ═══ */}
                <section id="faq" className="py-20 px-6 bg-gray-50/50">
                    <div className="max-w-3xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight mb-4">
                                Preguntas frecuentes
                            </h2>
                            <p className="text-gray-500 text-lg">Todo lo que necesitas saber sobre la plataforma.</p>
                        </div>

                        <div className="space-y-3">
                            {faqs.map((faq, i) => (
                                <div
                                    key={i}
                                    className="bg-white rounded-xl border border-gray-100 overflow-hidden hover:border-violet-200 transition-colors duration-300"
                                >
                                    <button
                                        onClick={() => setOpenFaq(openFaq === i ? null : i)}
                                        className="w-full flex items-center justify-between p-5 text-left"
                                    >
                                        <span className="font-semibold text-gray-900 text-sm pr-4">{faq.q}</span>
                                        <ChevronDown className={`w-5 h-5 text-gray-400 shrink-0 transition-transform duration-300 ${openFaq === i ? 'rotate-180' : ''}`} />
                                    </button>
                                    <div className={`overflow-hidden transition-all duration-300 ${openFaq === i ? 'max-h-48 pb-5' : 'max-h-0'}`}>
                                        <p className="px-5 text-sm text-gray-500 leading-relaxed">{faq.a}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ═══ CTA SECTION ═══ */}
                <section className="py-20 px-6">
                    <div className="max-w-7xl mx-auto">
                        <div className="relative rounded-[2rem] overflow-hidden p-12 md:p-16 text-center" style={{
                            background: 'linear-gradient(135deg, #EDE9FE 0%, #E0F2FE 50%, #F3E8FF 100%)'
                        }}>
                            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                <div className="absolute top-[-10%] left-[20%] w-[30%] h-[30%] bg-violet-400/10 rounded-full blur-3xl"></div>
                                <div className="absolute bottom-[-10%] right-[20%] w-[30%] h-[30%] bg-blue-400/10 rounded-full blur-3xl"></div>
                            </div>

                            <div className="relative z-10 max-w-2xl mx-auto">
                                <h2 className="text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
                                    ¿Listo para revolucionar tu reclutamiento?
                                </h2>
                                <p className="text-lg text-gray-600 mb-8">
                                    Únete a las empresas que ya reclutan 10x más rápido con inteligencia artificial.
                                </p>
                                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                                    <button
                                        onClick={() => setIsLoginOpen(true)}
                                        className="px-8 py-3.5 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white font-bold rounded-full shadow-lg shadow-violet-300/40 hover:shadow-violet-400/50 transition-all duration-300 transform hover:-translate-y-0.5 flex items-center space-x-2"
                                    >
                                        <span>Empezar ahora</span>
                                        <ArrowRight className="w-4 h-4" />
                                    </button>
                                    <a
                                        href="https://wa.me/528112345678"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-8 py-3.5 bg-white/80 backdrop-blur-sm border border-gray-200 text-gray-700 font-semibold rounded-full hover:bg-white hover:border-gray-300 transition-all duration-300 flex items-center space-x-2"
                                    >
                                        <WhatsAppIcon className="w-4 h-4 text-green-600" />
                                        <span>Hablar con ventas</span>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            {/* ═══ FOOTER ═══ */}
            <footer className="bg-gray-950 text-gray-400 py-16 px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
                        {/* Brand */}
                        <div className="md:col-span-1">
                            <div className="flex items-center space-x-2.5 mb-4">
                                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-violet-600 rounded-lg flex items-center justify-center">
                                    <BrainCircuit className="w-4.5 h-4.5 text-white stroke-[1.5]" />
                                </div>
                                <span className="text-lg font-extrabold text-white tracking-tight flex items-center">
                                    CANDIDATIC&nbsp;<span className="tracking-tighter text-violet-400">IΛ</span>
                                </span>
                            </div>
                            <p className="text-sm text-gray-500 leading-relaxed">
                                Plataforma de reclutamiento potenciada por inteligencia artificial para el mercado latinoamericano.
                            </p>
                        </div>

                        {/* Links */}
                        <div>
                            <h4 className="text-white font-semibold mb-4 text-sm">Producto</h4>
                            <div className="space-y-2.5">
                                {['Características', 'Precios', 'Integraciones', 'Changelog'].map((l, i) => (
                                    <a key={i} href="#" className="block text-sm text-gray-500 hover:text-violet-400 transition-colors">{l}</a>
                                ))}
                            </div>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4 text-sm">Recursos</h4>
                            <div className="space-y-2.5">
                                {['Documentación', 'API', 'Guías', 'Blog'].map((l, i) => (
                                    <a key={i} href="#" className="block text-sm text-gray-500 hover:text-violet-400 transition-colors">{l}</a>
                                ))}
                            </div>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4 text-sm">Compañía</h4>
                            <div className="space-y-2.5">
                                {['Nosotros', 'Contacto', 'Privacidad', 'Términos'].map((l, i) => (
                                    <a key={i} href="#" className="block text-sm text-gray-500 hover:text-violet-400 transition-colors">{l}</a>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
                        <p className="text-sm text-gray-600">
                            © {new Date().getFullYear()} Candidatic IA. Todos los derechos reservados.
                        </p>
                        <div className="flex items-center space-x-6">
                            <a href="#" className="text-gray-600 hover:text-violet-400 transition-colors text-sm">Privacidad</a>
                            <a href="#" className="text-gray-600 hover:text-violet-400 transition-colors text-sm">Términos</a>
                            <a href="#" className="text-gray-600 hover:text-violet-400 transition-colors text-sm">Cookies</a>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
