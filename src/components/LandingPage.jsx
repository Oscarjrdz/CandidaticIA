
import React, { useState, useRef, useEffect } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
    ArrowRight, CheckCircle, Users, Zap, Loader2, MessageSquare, BrainCircuit,
    Bot, Search, Send, BarChart3, Workflow, FileText, Shield, Clock,
    ChevronRight, Star, Play, Sparkles, Globe, Layers, Target, ArrowUpRight,
    MousePointerClick, Rocket, Check, X, Menu, ChevronDown, Smartphone
} from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';

/* ─── WhatsApp SVG Icon ─── */
const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`}>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
);

/* ─── Google Play triangle icon (para el badge "Próximamente") ─── */
const GooglePlayIcon = ({ className = "w-4 h-4" }) => (
    <svg viewBox="0 0 24 24" className={className}>
        <path fill="currentColor" d="M3.6 2.4c-.4.3-.6.8-.6 1.4v16.4c0 .6.2 1.1.6 1.4l.1.1L13 12.5v-.1L3.7 2.3l-.1.1z" />
        <path fill="currentColor" d="M16.1 15.6l-3.1-3.1v-.1l3.1-3.1 3.7 2.1c1 .6 1 1.5 0 2.1l-3.7 2.1z" />
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
            // Focus chat input for blinking cursor effect - desktop only to avoid keyboard jumps on mobile
            if (window.innerWidth >= 640) {
                chatInputRef.current?.focus({ preventScroll: true });
            }
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
    const [_showWhatsAppInput, _setShowWhatsAppInput] = useState(false);
    const [contactPhone, setContactPhone] = useState('');
    const [_contactLoading, setContactLoading] = useState(false);
    const [_contactStatus, setContactStatus] = useState(''); // 'success' | 'error' | ''
    const [_contactError, setContactError] = useState('');
    const [infoForm, setInfoForm] = useState({ nombre: '', empresa: '', wapp: '', correo: '' });
    const [infoFormStatus, setInfoFormStatus] = useState(''); // '' | 'loading' | 'success' | 'error'
    const [ctaForm, setCtaForm] = useState({ nombre: '', empresa: '', wapp: '', correo: '' });
    const [ctaFormStatus, setCtaFormStatus] = useState(''); // '' | 'loading' | 'success' | 'error'

    const _sendWhatsAppContact = async (e) => {
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

    const handleInfoForm = async (e) => {
        e.preventDefault();
        if (!infoForm.nombre || !infoForm.wapp) return;
        setInfoFormStatus('loading');
        try {
            await fetch('/api/public/info-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(infoForm),
            });
            setInfoFormStatus('success');
            setInfoForm({ nombre: '', wapp: '', correo: '' });
        } catch {
            setInfoFormStatus('error');
        }
    };

    const handleCtaForm = async (e) => {
        e.preventDefault();
        if (!ctaForm.nombre || !ctaForm.wapp) return;
        setCtaFormStatus('loading');
        try {
            await fetch('/api/public/info-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ctaForm),
            });
            setCtaFormStatus('success');
            setCtaForm({ nombre: '', empresa: '', wapp: '', correo: '' });
        } catch {
            setCtaFormStatus('error');
        }
    };

    /* ─── LOGIN DROPDOWN LOGIC ─── */
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [loginStep, setLoginStep] = useState('phone');
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [pinDigits, setPinDigits] = useState(['', '', '', '', '', '']);
    const pinRefs = useRef([]);
    const mobilePinRefs = useRef([]);
    const dropdownRef = useRef(null);

    // Hero particle network canvas
    const heroCanvasRef = useRef(null);
    useEffect(() => {
        const canvas = heroCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let animId;

        const resize = () => {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        const COUNT = 60;
        const MAX_DIST = 150;
        const particles = Array.from({ length: COUNT }, () => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.35,
            vy: (Math.random() - 0.5) * 0.35,
            r: Math.random() * 1.8 + 0.8,
        }));

        const draw = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
            });
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < MAX_DIST) {
                        ctx.strokeStyle = `rgba(139,92,246,${(1 - dist / MAX_DIST) * 0.2})`;
                        ctx.lineWidth = 0.7;
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.stroke();
                    }
                }
            }
            particles.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(139,92,246,0.45)';
                ctx.fill();
            });
            animId = requestAnimationFrame(draw);
        };
        draw();
        return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            // Exclude clicks inside the mobile login portal so it doesn't close on touch/clicks
            if (event.target.closest('.mobile-login-portal')) {
                return;
            }
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsLoginOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const cleanLogin = () => { setLoginError(''); setLoginLoading(false); };

    const handlePhoneSubmit = async (e) => {
        e?.preventDefault();
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

    const getActivePinRef = (i) => {
        const desk = pinRefs.current[i];
        if (desk && desk.getBoundingClientRect().width > 0) return desk;
        return mobilePinRefs.current[i];
    };

    const handlePinChange = (index, value) => {
        const digit = value.replace(/\D/g, '').slice(-1);
        const newPin = [...pinDigits];
        newPin[index] = digit;
        flushSync(() => setPinDigits(newPin));
        if (digit && index < 5) {
            getActivePinRef(index + 1)?.focus();
        }
        if (digit && index === 5) submitPin(newPin.join(''));
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !pinDigits[index] && index > 0) getActivePinRef(index - 1)?.focus();
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
                setPinDigits(['', '', '', '', '', '']);
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
        { q: '¿Qué es Candidatic IA?', a: 'Somos una agencia de reclutamiento masivo en Monterrey potenciada por inteligencia artificial. Usamos WhatsApp y un bot conversacional inteligente para buscar, filtrar y contactar candidatos, extrayendo datos y agendando citas automáticamente para tu empresa.' },
        { q: '¿Necesito contratar un reclutador interno?', a: 'No. Nosotros nos encargamos del proceso de reclutamiento por ti. Nuestro equipo y la IA trabajan juntos para encontrar candidatos, filtrar perfiles y reducir la carga operativa de tu empresa.' },
        { q: '¿Cómo encuentran a los candidatos?', a: 'Utilizamos inteligencia artificial para buscar en nuestra base de datos con lenguaje natural, rankear perfiles por afinidad con tu vacante y contactar candidatos por WhatsApp.' },
        { q: '¿Cómo contactan a los candidatos?', a: 'A través de WhatsApp con mensajes personalizados, un bot de IA que los pre-filtra automáticamente, y seguimiento en tiempo real. Todo profesional, rápido y con toque humano cuando se necesita.' },
        { q: '¿Cuánto tiempo tarda el proceso?', a: 'Gracias a nuestra tecnología de IA y WhatsApp, podemos entregar candidatos pre-filtrados en cuestión de días, no semanas. Nuestro bot trabaja 24/7 contactando y entrevistando candidatos por ti.' },
    ];

    /* ─── FEATURES DATA ─── */
    const features = [
        {
            icon: <BrainCircuit className="w-6 h-6" />,
            title: 'Reclutamiento con IA',
            desc: 'Nuestro bot con GPT conversa naturalmente con candidatos por WhatsApp, extrae sus datos (nombre, experiencia, ciudad) y agenda citas automáticamente para ti.',
            color: 'from-violet-500 to-purple-600',
            bgLight: 'bg-violet-50',
            textColor: 'text-violet-600'
        },
        {
            icon: <Search className="w-6 h-6" />,
            title: 'Búsqueda Inteligente',
            desc: 'Dinos qué perfil necesitas en lenguaje natural y nuestra IA busca en miles de candidatos, rankeando los mejores matches para tu vacante.',
            color: 'from-blue-500 to-cyan-500',
            bgLight: 'bg-blue-50',
            textColor: 'text-blue-600'
        },
        {
            icon: <Send className="w-6 h-6" />,
            title: 'Contacto Masivo por WhatsApp',
            desc: 'Contactamos a cientos de candidatos por WhatsApp con mensajes personalizados, seguimiento en tiempo real y respuestas inmediatas de nuestro bot IA.',
            color: 'from-emerald-500 to-green-600',
            bgLight: 'bg-emerald-50',
            textColor: 'text-emerald-600'
        },
        {
            icon: <Workflow className="w-6 h-6" />,
            title: 'Pre-filtrado Automático',
            desc: 'Nuestro bot filtra candidatos automáticamente según tus requisitos, zona y disponibilidad. Solo te presentamos a los mejores perfiles.',
            color: 'from-amber-500 to-orange-500',
            bgLight: 'bg-amber-50',
            textColor: 'text-amber-600'
        },
        {
            icon: <FileText className="w-6 h-6" />,
            title: 'Entrega de Candidatos',
            desc: 'Te entregamos candidatos pre-filtrados y listos para entrevista, con toda su información organizada y citas agendadas.',
            color: 'from-rose-500 to-pink-600',
            bgLight: 'bg-rose-50',
            textColor: 'text-rose-600'
        },
        {
            icon: <BarChart3 className="w-6 h-6" />,
            title: 'Proceso 24/7',
            desc: 'Nuestro bot y equipo trabajan las 24 horas. Mientras tú descansas, nosotros seguimos contactando, filtrando y agendando candidatos.',
            color: 'from-indigo-500 to-blue-700',
            bgLight: 'bg-indigo-50',
            textColor: 'text-indigo-600'
        },
    ];

    /* ─── HOW IT WORKS ─── */
    const steps = [
        { num: '01', title: 'Cuéntanos tu vacante', desc: 'Dinos qué perfil necesitas: puesto, experiencia, zona y requisitos. Nosotros nos encargamos del resto.', icon: <FileText className="w-6 h-6" /> },
        { num: '02', title: 'Activamos la IA', desc: 'Nuestro bot de WhatsApp con GPT comienza a contactar y entrevistar candidatos automáticamente, 24/7.', icon: <Bot className="w-6 h-6" /> },
        { num: '03', title: 'Filtramos por ti', desc: 'La IA pre-filtra candidatos según tus requisitos. Nuestro equipo valida y selecciona a los mejores perfiles.', icon: <Target className="w-6 h-6" /> },
        { num: '04', title: 'Recibe candidatos', desc: 'Te entregamos candidatos listos para entrevista con datos completos y citas agendadas. ¡Así de fácil!', icon: <WhatsAppIcon className="w-6 h-6" /> },
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
                {/* Tagline bar — full width */}
                <div className="w-full bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 py-1 text-center">
                    <span className="text-[10px] sm:text-xs font-bold tracking-[0.18em] text-white/90 uppercase">
                        Reclutamiento Masivo
                    </span>
                </div>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between relative">
                    <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 sm:w-9 sm:h-9 bg-gradient-to-br from-blue-600 to-violet-700 rounded-xl flex items-center justify-center shadow-lg shadow-violet-200">
                            <BrainCircuit className="w-4 h-4 sm:w-5 sm:h-5 text-white stroke-[1.5] rotate-90" />
                        </div>
                        <div className="flex flex-col leading-none">
                            <span className="text-lg sm:text-xl font-extrabold tracking-tight text-gray-900 flex items-center">
                                CANDIDATIC&nbsp;<span className="tracking-tighter bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">IΛ</span>
                            </span>
                            <span className="text-[9px] sm:text-[10px] font-semibold tracking-[0.15em] text-gray-400 uppercase mt-0.5">Reclutamiento Masivo</span>
                        </div>
                    </div>

                    <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-gray-600">
                        <a href="#features" className="hover:text-violet-600 transition-colors duration-300">Características</a>
                        <a href="#how-it-works" className="hover:text-violet-600 transition-colors duration-300">Cómo funciona</a>
                        <a href="#pricing" className="hover:text-violet-600 transition-colors duration-300">Precios</a>
                        <a href="#faq" className="hover:text-violet-600 transition-colors duration-300">FAQ</a>
                    </nav>

                    <div className="flex items-center space-x-2 sm:space-x-3">
                        <div className="relative" ref={dropdownRef}>
                            <Button
                                onClick={() => setIsLoginOpen(!isLoginOpen)}
                                className="rounded-full px-4 sm:px-7 py-2 sm:py-2.5 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white shadow-lg shadow-violet-200/50 hover:shadow-violet-300/60 transition-all duration-300 transform hover:-translate-y-0.5 text-xs sm:text-sm font-semibold"
                            >
                                Ingresar
                            </Button>

                            {/* LOGIN DROPDOWN — desktop only */}
                            {isLoginOpen && (
                                <div className="hidden sm:block absolute right-0 top-full mt-3 w-80 rounded-2xl shadow-2xl shadow-gray-300/60 p-5 z-[9999]" style={{ backgroundColor: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(56px) saturate(200%)', WebkitBackdropFilter: 'blur(56px) saturate(200%)' }}>
                                    <div className="absolute -top-2 right-6 w-4 h-4 transform rotate-45 shadow-[-2px_-2px_4px_rgba(0,0,0,0.06)]" style={{ backgroundColor: 'rgba(255,255,255,0.96)' }}></div>

                                    {/* Header compact */}
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-9 h-9 bg-gradient-to-tr from-blue-600 to-violet-700 rounded-xl flex items-center justify-center shadow-md shrink-0">
                                            <BrainCircuit className="w-5 h-5 text-white stroke-[1.5] rotate-90" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-extrabold text-gray-900 leading-tight">Bienvenido</p>
                                            <p className="text-xs text-gray-400">Accede a tu cuenta</p>
                                        </div>
                                    </div>

                                    {loginError && <div className="mb-3 p-2 bg-red-50 border border-red-100 text-red-600 text-xs rounded-lg text-center font-medium">{loginError}</div>}

                                    {(loginStep === 'phone' || loginStep === 'pin') ? (
                                        <div className="space-y-3">
                                            {/* Phone input */}
                                            <div className="flex items-center border-2 border-violet-400 rounded-xl bg-white">
                                                <div className="flex items-center gap-1 px-3 py-2.5 text-xs font-bold text-violet-500 shrink-0 border-r-2 border-violet-400">🇲🇽 +52</div>
                                                <input
                                                    type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={10} value={phone}
                                                    onChange={e => { if (loginStep === 'phone') { const v = e.target.value.replace(/\D/g,'').slice(0,10); setPhone(v); } }}
                                                    onKeyDown={e => { if (e.key === 'Enter' && loginStep === 'phone' && phone.length === 10) handlePhoneSubmit(); }}
                                                    placeholder="10 dígitos"
                                                    readOnly={loginStep === 'pin'}
                                                    className="min-w-0 flex-1 px-3 py-2.5 text-[15px] font-semibold text-gray-800 bg-transparent border-0 appearance-none placeholder:text-gray-300 placeholder:font-normal text-center"
                                                    style={{ outline: 'none', boxShadow: 'none' }}
                                                    autoFocus={loginStep === 'phone'}
                                                />
                                                {loginStep === 'phone' && phone.length === 10 && (
                                                    <span className="pr-3 shrink-0"><CheckCircle className="w-4 h-4 text-green-500" /></span>
                                                )}
                                                {loginStep === 'pin' && (
                                                    <button type="button" onClick={() => { setLoginStep('phone'); setPinDigits(['','','','','','']); }} className="text-xs text-violet-500 font-semibold pr-3 shrink-0 hover:underline">Cambiar</button>
                                                )}
                                            </div>

                                            {/* PIN inline — aparece debajo sin cambiar pantalla */}
                                            {loginStep === 'pin' && (
                                                <div>
                                                    <p className="text-xs text-gray-400 text-center mb-2">Código enviado por WhatsApp</p>
                                                    <div className="flex justify-center gap-2">
                                                        {pinDigits.map((d, i) => (
                                                            <input key={i} ref={el => pinRefs.current[i] = el}
                                                                type="tel" inputMode="numeric" pattern="[0-9]*" value={d} maxLength={1}
                                                                onChange={e => handlePinChange(i, e.target.value)}
                                                                onKeyDown={e => handleKeyDown(i, e)}
                                                                className={`w-10 h-10 text-center text-lg font-bold border-2 rounded-xl outline-none transition-all ${d ? 'border-violet-500 text-violet-700 bg-violet-50' : 'border-gray-200 bg-white focus:border-violet-400 focus:ring-2 focus:ring-violet-100'}`}
                                                                autoFocus={i === 0}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {loginStep === 'phone' && (
                                                <button onClick={handlePhoneSubmit} disabled={loginLoading || phone.length < 10}
                                                    className={`w-full py-2.5 text-sm font-bold rounded-xl transition-all text-white flex items-center justify-center ${phone.length === 10 ? 'bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 shadow-md shadow-violet-200/50' : 'bg-gray-300 cursor-not-allowed'}`}>
                                                    {loginLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar Código →'}
                                                </button>
                                            )}
                                        </div>
                                    ) : loginStep === 'register' ? (
                                        <form onSubmit={handleRegisterSubmit} className="space-y-3">
                                            <div className="text-center"><div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2"><Users className="w-6 h-6 text-green-600" /></div><h4 className="text-sm font-bold">Crea tu Perfil</h4><p className="text-xs text-gray-400 mt-1">Solo necesitamos tu nombre completo.</p></div>
                                            <Input placeholder="Ej. Ana García" value={name} onChange={e => setName(e.target.value)} className="h-10 text-sm text-center" required autoFocus />
                                            <button type="submit" className="w-full py-2.5 text-sm bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-md transition-all" disabled={loginLoading}>{loginLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Solicitar Acceso'}</button>
                                        </form>
                                    ) : (
                                        <div className="text-center space-y-3">
                                            <div className="w-14 h-14 bg-yellow-100 rounded-full flex items-center justify-center mx-auto animate-pulse"><Zap className="w-7 h-7 text-yellow-600" /></div>
                                            <div><h4 className="text-base font-bold">Solicitud Enviada</h4><p className="text-xs text-gray-500 mt-1">Te avisaremos por WhatsApp ({phone}) cuando esté activa.</p></div>
                                            <button onClick={() => setIsLoginOpen(false)} className="w-full py-2.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl transition-all">Cerrar</button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Mobile menu button */}
                        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors">
                            {mobileMenuOpen ? <X className="w-5 h-5 text-gray-700" /> : <Menu className="w-5 h-5 text-gray-700" />}
                        </button>
                    </div>
                </div>

                {/* Mobile menu */}
                {mobileMenuOpen && (
                    <div className="md:hidden bg-white/95 backdrop-blur-xl border-t border-gray-100 px-6 py-4 space-y-1">
                        <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-xl px-4 py-3 transition-all">Características</a>
                        <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-xl px-4 py-3 transition-all">Cómo funciona</a>
                        <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-xl px-4 py-3 transition-all">Precios</a>
                        <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-xl px-4 py-3 transition-all">FAQ</a>
                    </div>
                )}
            </header>

            {/* ═══ MOBILE LOGIN PORTAL — rendered outside header to bypass backdrop-filter stacking context ═══ */}
            {isLoginOpen && createPortal(
                <div className="sm:hidden mobile-login-portal fixed inset-0 z-[9999] overflow-y-auto flex flex-col justify-center p-6" style={{ backgroundColor: 'rgba(255,255,255,0.93)', backdropFilter: 'blur(32px) saturate(180%)', WebkitBackdropFilter: 'blur(32px) saturate(180%)' }}>
                    <button onClick={() => setIsLoginOpen(false)} className="absolute top-4 right-4 p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors z-20">
                        <X className="w-5 h-5 text-gray-600" />
                    </button>
                    <div className="max-w-xs mx-auto w-full">
                        {/* Header compact */}
                        <div className="flex items-center gap-3 mb-5">
                            <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-violet-700 rounded-xl flex items-center justify-center shadow-md shrink-0">
                                <BrainCircuit className="w-6 h-6 text-white stroke-[1.5] rotate-90" />
                            </div>
                            <div>
                                <p className="text-base font-extrabold text-gray-900 leading-tight">Bienvenido</p>
                                <p className="text-xs text-gray-400">Accede a tu cuenta</p>
                            </div>
                        </div>

                        {loginError && <div className="mb-3 p-2.5 bg-red-50 border border-red-100 text-red-600 text-xs rounded-xl text-center font-medium">{loginError}</div>}

                        {(loginStep === 'phone' || loginStep === 'pin') ? (
                            <div className="space-y-3">
                                {/* Phone input */}
                                <div className="flex items-center border-2 border-violet-400 rounded-xl bg-white pr-3">
                                    <div className="flex items-center gap-1 px-3 py-3 text-xs font-bold text-violet-500 shrink-0 border-r-2 border-violet-400">🇲🇽 +52</div>
                                    <input
                                        type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={10} value={phone}
                                        onChange={e => { if (loginStep === 'phone') { const v = e.target.value.replace(/\D/g,'').slice(0,10); setPhone(v); } }}
                                        onKeyDown={e => { if (e.key === 'Enter' && loginStep === 'phone' && phone.length === 10) handlePhoneSubmit(); }}
                                        placeholder="10 dígitos"
                                        readOnly={loginStep === 'pin'}
                                        className="min-w-0 flex-1 px-3 py-3 text-[15px] font-semibold text-gray-800 bg-transparent border-0 appearance-none placeholder:text-gray-300 placeholder:font-normal"
                                        style={{ outline: 'none', boxShadow: 'none' }}
                                        autoFocus={loginStep === 'phone'}
                                    />
                                    {loginStep === 'phone' && phone.length === 10 && (
                                        <span className="pr-3 shrink-0"><CheckCircle className="w-4 h-4 text-green-500" /></span>
                                    )}
                                    {loginStep === 'pin' && (
                                        <button type="button" onClick={() => { setLoginStep('phone'); setPinDigits(['','','','','','']); }} className="text-xs text-violet-500 font-semibold pr-3 shrink-0">Cambiar</button>
                                    )}
                                </div>

                                {/* PIN inline */}
                                {loginStep === 'pin' && (
                                    <div>
                                        <p className="text-xs text-gray-400 text-center mb-2">Código enviado por WhatsApp</p>
                                        <div className="flex justify-center gap-2.5">
                                            {pinDigits.map((d, i) => (
                                                <input key={i} ref={el => mobilePinRefs.current[i] = el}
                                                    type="tel" inputMode="numeric" pattern="[0-9]*" value={d} maxLength={1}
                                                    onChange={e => handlePinChange(i, e.target.value)}
                                                    onKeyDown={e => handleKeyDown(i, e)}
                                                    className={`w-11 h-11 text-center text-xl font-bold border-2 rounded-xl outline-none transition-all ${d ? 'border-violet-500 text-violet-700 bg-violet-50' : 'border-gray-200 bg-white focus:border-violet-400 focus:ring-2 focus:ring-violet-100'}`}
                                                    autoFocus={i === 0}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {loginStep === 'phone' && (
                                    <button onClick={handlePhoneSubmit} disabled={loginLoading || phone.length < 10}
                                        className={`w-full py-3 text-sm font-bold rounded-xl transition-all text-white flex items-center justify-center ${phone.length === 10 ? 'bg-gradient-to-r from-blue-600 to-violet-600 shadow-md shadow-violet-200/50' : 'bg-gray-300 cursor-not-allowed'}`}>
                                        {loginLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar Código →'}
                                    </button>
                                )}
                            </div>
                        ) : loginStep === 'register' ? (
                            <form onSubmit={handleRegisterSubmit} className="space-y-3">
                                <div className="text-center"><div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2"><Users className="w-6 h-6 text-green-600" /></div><h4 className="text-sm font-bold">Crea tu Perfil</h4><p className="text-xs text-gray-400 mt-1">Solo necesitamos tu nombre completo.</p></div>
                                <Input placeholder="Ej. Ana García" value={name} onChange={e => setName(e.target.value)} className="h-10 text-sm text-center" required autoFocus />
                                <button type="submit" className="w-full py-3 text-sm bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-md transition-all" disabled={loginLoading}>{loginLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Solicitar Acceso'}</button>
                            </form>
                        ) : (
                            <div className="text-center space-y-4">
                                <div className="w-14 h-14 bg-yellow-100 rounded-full flex items-center justify-center mx-auto animate-pulse"><Zap className="w-7 h-7 text-yellow-600" /></div>
                                <div><h4 className="text-base font-bold">Solicitud Enviada</h4><p className="text-xs text-gray-500 mt-1">Te avisaremos por WhatsApp ({phone}) cuando esté activa.</p></div>
                                <button onClick={() => setIsLoginOpen(false)} className="w-full py-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl transition-all">Cerrar</button>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}

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
                    @keyframes marquee {
                        0% { transform: translateX(0); }
                        100% { transform: translateX(-50%); }
                    }
                    .marquee-track { animation: marquee 35s linear infinite; }
                    .marquee-track:hover { animation-play-state: paused; }
                    @keyframes orbFloat1 {
                        0%, 100% { transform: translate(0px, 0px) scale(1); }
                        33% { transform: translate(40px, -30px) scale(1.05); }
                        66% { transform: translate(-20px, 20px) scale(0.97); }
                    }
                    @keyframes orbFloat2 {
                        0%, 100% { transform: translate(0px, 0px) scale(1); }
                        33% { transform: translate(-35px, 25px) scale(1.08); }
                        66% { transform: translate(30px, -20px) scale(0.95); }
                    }
                    @keyframes orbFloat3 {
                        0%, 100% { transform: translate(0px, 0px) scale(1); }
                        50% { transform: translate(20px, 35px) scale(1.06); }
                    }
                    .orb-1 { animation: orbFloat1 18s ease-in-out infinite; }
                    .orb-2 { animation: orbFloat2 22s ease-in-out infinite; }
                    .orb-3 { animation: orbFloat3 16s ease-in-out infinite; }
                    .orb-4 { animation: orbFloat1 26s ease-in-out infinite reverse; }
                `}</style>

                {/* ═══ HERO SECTION ═══ */}
                <section className="pt-28 sm:pt-32 pb-8 sm:pb-12 relative overflow-hidden">
                    {/* Dot grid pattern */}
                    <div className="absolute inset-0 pointer-events-none"
                        style={{
                            backgroundImage: 'radial-gradient(circle, #c4b5fd 1px, transparent 1px)',
                            backgroundSize: '28px 28px',
                            opacity: 0.35,
                            maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
                            WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
                        }}
                    />
                    {/* Particle network canvas */}
                    <canvas ref={heroCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }} />

                    {/* Gradient orbs — encima del dot grid (z-1), debajo del contenido (z-10) */}
                    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 2 }}>
                        {/* Orb 1 — violeta, top-left */}
                        <div className="orb-1 absolute rounded-full"
                            style={{ top: '-5%', left: '-8%', width: '45%', height: '55%', filter: 'blur(50px)',
                                background: 'radial-gradient(circle, rgba(139,92,246,0.22) 0%, rgba(109,40,217,0.10) 55%, transparent 100%)' }} />
                        {/* Orb 2 — uva, bottom-right */}
                        <div className="orb-2 absolute rounded-full"
                            style={{ bottom: '-10%', right: '-8%', width: '42%', height: '55%', filter: 'blur(55px)',
                                background: 'radial-gradient(circle, rgba(124,58,237,0.20) 0%, rgba(91,33,182,0.08) 55%, transparent 100%)' }} />
                        {/* Orb 3 — lavanda, centro del gap */}
                        <div className="orb-3 absolute rounded-full"
                            style={{ top: '15%', left: '42%', width: '38%', height: '60%', filter: 'blur(45px)',
                                background: 'radial-gradient(circle, rgba(167,139,250,0.20) 0%, rgba(139,92,246,0.08) 55%, transparent 100%)' }} />
                        {/* Orb 4 — índigo, top-center */}
                        <div className="orb-4 absolute rounded-full"
                            style={{ top: '-10%', left: '28%', width: '32%', height: '40%', filter: 'blur(40px)',
                                background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, rgba(79,70,229,0.06) 60%, transparent 100%)' }} />
                    </div>

                    <div className="max-w-7xl mx-auto w-full relative z-10">

                        {/* ── Super headline ── */}
                        <div className="mb-2 sm:mb-3 px-4 sm:px-6 text-center">
                            <p className="text-[11px] sm:text-xs font-bold uppercase tracking-[0.2em] text-violet-500 mb-1.5">
                                #1 en México
                            </p>
                            <h2
                                className="font-black tracking-tight leading-[1.08] whitespace-nowrap w-full text-center"
                                style={{ fontSize: 'clamp(1.2rem, 4vw, 3.25rem)' }}
                            >
                                <span className="text-gray-900">Especialistas en </span>
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600">
                                    Reclutamiento
                                </span>
                                <span className="text-gray-900"> Masivo </span>
                                <span className="relative inline-block">
                                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-pink-500">Operativo</span>
                                    <svg className="absolute -bottom-1 left-0 w-full" viewBox="0 0 300 12" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                                        <path d="M2 9 Q75 3 150 7 Q225 11 298 5" stroke="url(#ul)" strokeWidth="3" strokeLinecap="round"/>
                                        <defs>
                                            <linearGradient id="ul" x1="0" y1="0" x2="1" y2="0">
                                                <stop offset="0%" stopColor="#7c3aed"/>
                                                <stop offset="100%" stopColor="#ec4899"/>
                                            </linearGradient>
                                        </defs>
                                    </svg>
                                </span>
                            </h2>
                        </div>


                        <div className="grid lg:grid-cols-[2fr_1fr] gap-8 lg:gap-12 items-start pt-2 sm:pt-4 px-4 sm:px-6">

                            {/* ── LEFT: Hero Text ── */}
                            <div className="text-center lg:text-left lg:pr-8">
                                {/* Badge */}
                                <div className="hero-text-1 inline-flex items-center space-x-2 bg-violet-50/80 backdrop-blur-sm px-4 sm:px-5 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm font-semibold text-violet-700 mb-6 sm:mb-8 border border-violet-100/60">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                                    </span>
                                    <span>Agencia de reclutamiento con IA + WhatsApp</span>
                                </div>

                                {/* Headline */}
                                <h1 className="hero-text-2 text-3xl sm:text-4xl md:text-5xl lg:text-[3.5rem] xl:text-6xl font-extrabold tracking-tight text-gray-900 mb-4 sm:mb-6 leading-[1.1]">
                                    Tu Agencia de Reclutamiento masivo<br className="hidden sm:inline" />
                                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600">
                                        en una sola plataforma con IA
                                    </span>
                                </h1>

                                <p className="hero-text-3 text-sm sm:text-base lg:text-lg text-gray-500 max-w-lg mx-auto lg:mx-0 mb-6 sm:mb-8 leading-relaxed">
                                    Somos tu agencia de reclutamiento masivo con inteligencia artificial. Brenda, nuestra reclutadora IA, contacta candidatos por WhatsApp, gestiona grandes volúmenes de postulantes y te agenda entrevistas con IA.
                                </p>

                                {/* ── QR + Formulario ── */}
                                <div className="hero-text-4 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 sm:gap-6 items-start bg-white/70 backdrop-blur-md border border-violet-100 rounded-3xl p-5 shadow-xl shadow-violet-100/30 mt-[10px]">

                                    {/* QR */}
                                    <div className="flex flex-col items-center gap-2 sm:border-r sm:border-violet-100 sm:pr-6">
                                        <img
                                            src="/lp/Agencia_de_Reclutamiento_Masivo_7.svg"
                                            alt="QR de WhatsApp de Candidatic IA, agencia de reclutamiento masivo en Monterrey"
                                            className="w-24 h-24 rounded-xl"
                                        />
                                        <p className="text-[10px] text-gray-400 text-center font-medium leading-tight">Escanea y<br/>escríbenos</p>
                                    </div>

                                    {/* Formulario */}
                                    <div>
                                        <p className="text-xs font-bold text-violet-600 uppercase tracking-wider mb-3">¿Quieres más información?</p>
                                        {infoFormStatus === 'success' ? (
                                            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                                                <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                                                <p className="text-sm font-semibold text-green-800">¡Recibido! Te contactamos pronto.</p>
                                            </div>
                                        ) : (
                                            <form onSubmit={handleInfoForm} className="flex flex-col gap-2.5">
                                                <input
                                                    type="text"
                                                    placeholder="Nombre"
                                                    value={infoForm.nombre}
                                                    onChange={e => setInfoForm(f => ({ ...f, nombre: e.target.value }))}
                                                    required
                                                    className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                                                />
                                                <input
                                                    type="tel"
                                                    placeholder="WhatsApp (10 dígitos)"
                                                    value={infoForm.wapp}
                                                    onChange={e => setInfoForm(f => ({ ...f, wapp: e.target.value }))}
                                                    required
                                                    maxLength={10}
                                                    className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Empresa"
                                                    value={infoForm.empresa}
                                                    onChange={e => setInfoForm(f => ({ ...f, empresa: e.target.value }))}
                                                    className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                                                />
                                                <input
                                                    type="email"
                                                    placeholder="Correo electrónico"
                                                    value={infoForm.correo}
                                                    onChange={e => setInfoForm(f => ({ ...f, correo: e.target.value }))}
                                                    className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                                                />
                                                <button
                                                    type="submit"
                                                    disabled={infoFormStatus === 'loading'}
                                                    className="w-full bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white font-bold py-2.5 rounded-xl text-sm transition-all shadow-md shadow-violet-300/30 disabled:opacity-60 flex items-center justify-center gap-2"
                                                >
                                                    {infoFormStatus === 'loading' ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <><Send className="w-4 h-4" /> Enviar</>
                                                    )}
                                                </button>
                                                {infoFormStatus === 'error' && (
                                                    <p className="text-red-500 text-xs text-center">Error al enviar. Intenta de nuevo.</p>
                                                )}
                                            </form>
                                        )}
                                    </div>
                                </div>
                            </div>


                            {/* ── RIGHT: iPhone + WhatsApp CTA ── */}
                            <div className="flex flex-col items-center gap-5 mt-8 lg:mt-0">
                            <div className="flex justify-center w-full" style={{ perspective: '1200px' }}>
                                <div className="relative" style={{ animation: 'iphoneFloat 6s ease-in-out infinite' }}>
                                    {/* Glow behind phone */}
                                    <div className="absolute -inset-6 sm:-inset-8 bg-gradient-to-br from-violet-400/20 via-blue-400/15 to-pink-400/10 rounded-[4rem] blur-2xl iphone-glow"></div>

                                    {/* iPhone Frame */}
                                    <div className="relative w-[270px] sm:w-[320px] md:w-[340px] bg-gray-950 rounded-[2.5rem] sm:rounded-[3rem] p-[8px] sm:p-[10px] shadow-2xl shadow-gray-900/40" style={{
                                        border: '1px solid rgba(255,255,255,0.1)',
                                    }}>
                                        {/* Dynamic Island */}
                                        <div className="absolute top-[14px] left-1/2 -translate-x-1/2 w-[100px] h-[28px] bg-black rounded-full z-30 flex items-center justify-center">
                                            <div className="w-[10px] h-[10px] rounded-full bg-gray-800 border border-gray-700"></div>
                                        </div>

                                        {/* Screen */}
                                        <div className="relative bg-white rounded-[2rem] sm:rounded-[2.4rem] overflow-hidden" style={{ height: 'clamp(440px, 70vw, 560px)' }}>
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

                            {/* ── CTA WhatsApp — debajo del teléfono ── */}
                            <a
                                href="https://wa.me/528116038195"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-3 w-full bg-green-500 hover:bg-green-600 text-white font-bold px-6 py-3.5 rounded-2xl shadow-lg shadow-green-400/30 hover:shadow-green-500/40 transition-all duration-300 hover:-translate-y-0.5 text-sm"
                            >
                                <WhatsAppIcon className="w-5 h-5" />
                                ¿Te interesa? Escríbenos · 81 1603 8195
                            </a>

                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ BANNER — IMPLEMENTA CANDIDATIC EN TU EMPRESA ═══ */}
                <section className="px-4 sm:px-6 py-6 sm:py-10">
                    <div className="max-w-7xl mx-auto">
                        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 shadow-2xl shadow-violet-500/30">
                            {/* Glow / patrón decorativo estilo IA */}
                            <div className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-fuchsia-400/30 blur-3xl"></div>
                            <div className="pointer-events-none absolute -bottom-24 -left-16 w-72 h-72 rounded-full bg-cyan-400/25 blur-3xl"></div>
                            <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: 'radial-gradient(circle at center, #ffffff 1px, transparent 1px)', backgroundSize: '22px 22px' }}></div>

                            <div className="relative flex flex-col lg:flex-row items-center gap-6 lg:gap-8 px-6 sm:px-10 py-8 sm:py-10 text-center lg:text-left">
                                <div className="flex-1">
                                    <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/20 px-3 py-1 rounded-full text-[11px] sm:text-xs font-bold uppercase tracking-widest text-white/90 mb-4">
                                        <Sparkles className="w-3.5 h-3.5" />
                                        Para empresas
                                    </div>
                                    <h2 className="text-lg sm:text-2xl md:text-[1.7rem] lg:text-3xl font-extrabold text-white tracking-tight leading-tight whitespace-nowrap">
                                        ¿Quieres implementar <span className="text-cyan-200">Candidatic</span> en tu empresa?
                                    </h2>
                                    <p className="mt-3 text-xs sm:text-base md:text-[0.95rem] lg:text-lg text-white/85 font-medium whitespace-nowrap">
                                        Por un <span className="font-bold text-white">fee mensual</span> recibe cientos de candidatos al mes, filtrados y atendidos por IA.
                                    </p>
                                </div>

                                <a
                                    href="https://wa.me/5218116038195"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="group shrink-0 inline-flex items-center justify-center gap-2.5 w-full sm:w-auto bg-white text-violet-700 font-extrabold text-base sm:text-lg px-8 py-4 rounded-2xl shadow-xl shadow-black/20 hover:shadow-black/30 hover:-translate-y-0.5 hover:bg-violet-50 transition-all duration-300"
                                >
                                    <WhatsAppIcon className="w-5 h-5 text-green-500" />
                                    Contáctanos
                                </a>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ APPS — RECLUTADOR / CANDIDATO ═══ */}
                <section className="py-12 sm:py-20 px-4 sm:px-6">
                    <div className="max-w-7xl mx-auto">
                        <div className="text-center mb-10 sm:mb-14">
                            <div className="inline-flex items-center space-x-2 bg-violet-50 px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold text-violet-700 mb-4 border border-violet-100">
                                <Smartphone className="w-4 h-4" />
                                <span>Ya disponible en iOS</span>
                            </div>
                            <h2 className="text-2xl sm:text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
                                Candidatic también vive en tu celular
                            </h2>
                            <p className="text-sm sm:text-lg text-gray-500 max-w-2xl mx-auto px-2">
                                Una app para reclutadores, otra para candidatos — cada quien con lo que necesita.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                            {/* Reclutador */}
                            <div className="rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-6 sm:p-8 flex flex-col sm:flex-row items-center sm:items-start gap-5 sm:gap-6">
                                <img
                                    src="/lp/Candidatic_app_reclutador_icono.png"
                                    alt="Ícono de la app Candidatic Reclutador para App Store, plataforma de reclutamiento masivo en Monterrey"
                                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl shadow-lg shadow-blue-200/60 shrink-0"
                                />
                                <div className="text-center sm:text-left">
                                    <p className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-1">¿Eres reclutador?</p>
                                    <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 mb-2">Descarga la app y publica gratis</h3>
                                    <p className="text-sm text-gray-500 mb-4">Publica tus vacantes y recibe candidatos al instante, directo desde tu celular.</p>
                                    <a
                                        href="https://apps.apple.com/mx/app/id6776356939"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex hover:scale-[1.03] active:scale-95 transition-transform"
                                    >
                                        <img
                                            src="/lp/badge-app-store-es-mx.svg"
                                            alt="Descarga Candidatic Reclutador en el App Store"
                                            className="h-11"
                                        />
                                    </a>
                                </div>
                            </div>

                            {/* Candidato */}
                            <div className="rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-6 sm:p-8 flex flex-col sm:flex-row items-center sm:items-start gap-5 sm:gap-6">
                                <img
                                    src="/lp/Candidatic_app_candidato_icono.png"
                                    alt="Ícono de la app Candidatic Bolsa de Empleo para App Store y Google Play, agencia de reclutamiento masivo en Monterrey"
                                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl shadow-lg shadow-orange-200/60 shrink-0"
                                />
                                <div className="text-center sm:text-left">
                                    <p className="text-xs font-bold uppercase tracking-widest text-orange-600 mb-1">¿Eres candidato?</p>
                                    <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 mb-2">Descarga la app de Candidatic</h3>
                                    <p className="text-sm text-gray-500 mb-4">Explora vacantes, postúlate con un toque y contacta al reclutador por WhatsApp.</p>
                                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                                        <a
                                            href="https://apps.apple.com/mx/app/id6776012569"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex hover:scale-[1.03] active:scale-95 transition-transform"
                                        >
                                            <img
                                                src="/lp/badge-app-store-es-mx.svg"
                                                alt="Descarga Candidatic Bolsa de Empleo en el App Store"
                                                className="h-11"
                                            />
                                        </a>
                                        <span className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-gray-200 bg-gray-50 text-gray-400 text-xs font-semibold">
                                            <GooglePlayIcon className="w-4 h-4" />
                                            Google Play — Próximamente
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ LOGOS / SOCIAL PROOF ═══ */}
                <section className="py-8 sm:py-12">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6">
                        <p className="text-xs sm:text-sm font-semibold text-gray-400 uppercase tracking-widest text-center mb-6 sm:mb-8">
                            Empresas que ya reclutan con nosotros
                        </p>
                        <div className="relative overflow-hidden">
                            <div className="absolute left-0 top-0 bottom-0 w-12 sm:w-20 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
                            <div className="absolute right-0 top-0 bottom-0 w-12 sm:w-20 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />
                            <div className="flex">
                                <div className="marquee-track flex items-center gap-10 sm:gap-14">
                                    {[
                                        { name: 'CEMEX',            logo: '/lp/Agencia_de_Reclutamiento_Masivo_8.png' },
                                        { name: 'FEMSA',            logo: '/lp/Agencia_de_Reclutamiento_Masivo_9.svg' },
                                        { name: 'Banorte',          logo: '/lp/Agencia_de_Reclutamiento_Masivo_10.svg' },
                                        { name: 'ALFA',             logo: '/lp/Agencia_de_Reclutamiento_Masivo_11.svg' },
                                        { name: 'Vitro',            logo: '/lp/Agencia_de_Reclutamiento_Masivo_12.jpg' },
                                        { name: 'GRUMA',            logo: '/lp/Agencia_de_Reclutamiento_Masivo_13.svg' },
                                        { name: 'Arca Continental', logo: '/lp/Agencia_de_Reclutamiento_Masivo_14.svg' },
                                        { name: 'Softtek',          logo: '/lp/Agencia_de_Reclutamiento_Masivo_15.svg' },
                                        { name: 'Grupo Bimbo',      logo: '/lp/Agencia_de_Reclutamiento_Masivo_16.svg' },
                                        { name: 'Liverpool',        logo: '/lp/Agencia_de_Reclutamiento_Masivo_17.png' },
                                        { name: 'CEMEX',            logo: '/lp/Agencia_de_Reclutamiento_Masivo_8.png' },
                                        { name: 'FEMSA',            logo: '/lp/Agencia_de_Reclutamiento_Masivo_9.svg' },
                                        { name: 'Banorte',          logo: '/lp/Agencia_de_Reclutamiento_Masivo_10.svg' },
                                        { name: 'ALFA',             logo: '/lp/Agencia_de_Reclutamiento_Masivo_11.svg' },
                                        { name: 'Vitro',            logo: '/lp/Agencia_de_Reclutamiento_Masivo_12.jpg' },
                                        { name: 'GRUMA',            logo: '/lp/Agencia_de_Reclutamiento_Masivo_13.svg' },
                                        { name: 'Arca Continental', logo: '/lp/Agencia_de_Reclutamiento_Masivo_14.svg' },
                                        { name: 'Softtek',          logo: '/lp/Agencia_de_Reclutamiento_Masivo_15.svg' },
                                        { name: 'Grupo Bimbo',      logo: '/lp/Agencia_de_Reclutamiento_Masivo_16.svg' },
                                        { name: 'Liverpool',        logo: '/lp/Agencia_de_Reclutamiento_Masivo_17.png' },
                                    ].map((co, i) => (
                                        <div key={i} className="flex-shrink-0 opacity-40 hover:opacity-75 transition-opacity duration-300">
                                            <img
                                                src={co.logo}
                                                alt={`Logo de ${co.name}, empresa que recluta con Candidatic IA, agencia de reclutamiento masivo en Monterrey`}
                                                className="h-8 sm:h-10 w-auto max-w-[120px] object-contain grayscale"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ PRODUCTO / SCREENSHOTS ═══ */}
                <section className="py-12 sm:py-20 px-4 sm:px-6 bg-gray-50 relative overflow-hidden">
                    {/* Dot grid pattern — mismo patrón del hero */}
                    <div className="absolute inset-0 pointer-events-none"
                        style={{
                            backgroundImage: 'radial-gradient(circle, #c4b5fd 1px, transparent 1px)',
                            backgroundSize: '28px 28px',
                            opacity: 0.35,
                            maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
                            WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
                        }}
                    />
                    {/* Orbes flotantes — mismas animaciones/clases del hero, para que se vea "IA" y no un fondo estático */}
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        <div className="orb-2 absolute rounded-full"
                            style={{ top: '-10%', left: '-6%', width: '40%', height: '55%', filter: 'blur(50px)',
                                background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, rgba(91,33,182,0.07) 55%, transparent 100%)' }} />
                        <div className="orb-3 absolute rounded-full"
                            style={{ bottom: '-15%', right: '-6%', width: '42%', height: '60%', filter: 'blur(50px)',
                                background: 'radial-gradient(circle, rgba(59,130,246,0.16) 0%, rgba(37,99,235,0.06) 55%, transparent 100%)' }} />
                        <div className="orb-4 absolute rounded-full"
                            style={{ top: '30%', left: '38%', width: '30%', height: '40%', filter: 'blur(45px)',
                                background: 'radial-gradient(circle, rgba(167,139,250,0.15) 0%, rgba(139,92,246,0.05) 60%, transparent 100%)' }} />
                    </div>

                    <div className="max-w-7xl mx-auto relative z-10">
                        <div className="text-center mb-10 sm:mb-16">
                            <div className="inline-flex items-center space-x-2 bg-violet-50 px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold text-violet-700 mb-4 border border-violet-100">
                                <Sparkles className="w-4 h-4" />
                                <span>El sistema por dentro</span>
                            </div>
                            <h2 className="text-2xl sm:text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
                                Así trabaja tu equipo de<br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600">reclutamiento masivo en Monterrey</span>
                            </h2>
                            <p className="text-sm sm:text-lg text-gray-500 max-w-2xl mx-auto px-2">
                                Un dashboard real, con candidatos reales: así se ve Candidatic IA gestionando miles de conversaciones de WhatsApp al mismo tiempo.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
                            {[
                                {
                                    img: '/lp/Candidatic_reclutamiento_masivo_monterrey_1.png',
                                    alt: 'Dashboard de gestión de candidatos de WhatsApp en Candidatic IA, plataforma de reclutamiento masivo en Monterrey con miles de candidatos y captura automática de datos',
                                    title: 'Miles de candidatos, un solo dashboard',
                                    desc: 'Miles de candidatos capturados desde WhatsApp con nombre, municipio, categoría y escolaridad completados automáticamente.',
                                },
                                {
                                    img: '/lp/Candidatic_reclutamiento_masivo_monterrey_2.png',
                                    alt: 'Chat Web de Candidatic IA con Brenda, el bot de inteligencia artificial, conversando en vivo con un candidato y capturando sus datos por WhatsApp — reclutamiento masivo en Monterrey',
                                    title: 'Brenda IA captura los datos por ti',
                                    desc: 'Nuestro bot conversa 24/7 con cada candidato y llena su perfil solo — sin que un reclutador tenga que preguntar nada a mano.',
                                },
                                {
                                    img: '/lp/Candidatic_reclutamiento_masivo_monterrey_3.png',
                                    alt: 'Pantalla de envíos masivos de WhatsApp a candidatos en Candidatic IA, la plataforma de reclutamiento masivo en Monterrey para reactivar tu base de datos con un clic',
                                    title: 'Reactiva tu base con un clic',
                                    desc: 'Lanza campañas instantáneas con plantillas aprobadas por WhatsApp a cientos de candidatos a la vez.',
                                },
                            ].map((shot, i) => (
                                <div key={i} className="group">
                                    <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-lg shadow-gray-200/50 bg-white hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                                        <div className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 border-b border-gray-200">
                                            <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                                            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                                            <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                                        </div>
                                        <img
                                            src={shot.img}
                                            alt={shot.alt}
                                            loading="lazy"
                                            className="w-full h-auto object-cover object-top"
                                        />
                                    </div>
                                    <h3 className="text-base sm:text-lg font-bold text-gray-900 mt-4 mb-1">{shot.title}</h3>
                                    <p className="text-sm text-gray-500 leading-relaxed">{shot.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ═══ FEATURES SECTION ═══ */}
                <section id="features" className="py-12 sm:py-20 px-4 sm:px-6" ref={featuresRef}>
                    <div className="max-w-7xl mx-auto">
                        <div className={`text-center mb-10 sm:mb-16 transition-all duration-700 ${featuresVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                            <div className="inline-flex items-center space-x-2 bg-violet-50 px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold text-violet-700 mb-4 border border-violet-100">
                                <Sparkles className="w-4 h-4" />
                                <span>Funcionalidades</span>
                            </div>
                            <h2 className="text-2xl sm:text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
                                ¿Por qué somos la mejor<br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600">agencia de reclutamiento en Monterrey?</span>
                            </h2>
                            <p className="text-sm sm:text-lg text-gray-500 max-w-2xl mx-auto px-2">
                                Combinamos inteligencia artificial, WhatsApp y un equipo experto para encontrar al talento ideal para tu empresa.
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
                <section id="how-it-works" className="py-12 sm:py-20 px-4 sm:px-6 bg-gradient-to-b from-gray-50/50 to-white" ref={stepsRef}>
                    <div className="max-w-7xl mx-auto">
                        <div className={`text-center mb-10 sm:mb-16 transition-all duration-700 ${stepsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                            <div className="inline-flex items-center space-x-2 bg-blue-50 px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold text-blue-700 mb-4 border border-blue-100">
                                <Rocket className="w-4 h-4" />
                                <span>Proceso</span>
                            </div>
                            <h2 className="text-2xl sm:text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
                                Cómo funciona nuestro reclutamiento masivo
                            </h2>
                            <p className="text-sm sm:text-lg text-gray-500 max-w-2xl mx-auto px-2">
                                En solo 4 pasos te entregamos candidatos listos para entrevista en Monterrey y área metropolitana.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8">
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
                                    <div className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-100 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-50 transition-all duration-300 h-full">
                                        <div className="flex items-center space-x-3 mb-4 sm:mb-5">
                                            <span className="text-2xl sm:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600">{s.num}</span>
                                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/10 to-violet-500/10 flex items-center justify-center text-violet-600">
                                                {s.icon}
                                            </div>
                                        </div>
                                        <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-2">{s.title}</h3>
                                        <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ═══ LOCAL COVERAGE ═══ */}
                <section className="py-10 sm:py-14 px-4 sm:px-6 bg-white">
                    <div className="max-w-7xl mx-auto">
                        <div className="rounded-2xl border border-gray-100 bg-gray-50/70 px-5 py-7 sm:px-8 sm:py-8">
                            <div className="grid lg:grid-cols-[1.1fr_1.4fr] gap-6 items-center">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-500 mb-2">Cobertura local</p>
                                    <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">
                                        Reclutamiento masivo en Monterrey y área metropolitana
                                    </h2>
                                </div>
                                <div>
                                    <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
                                        Apoyamos procesos de reclutamiento operativo y administrativo en Monterrey, Apodaca, Guadalupe, San Nicolás de los Garza, General Escobedo, Santa Catarina, García y San Pedro Garza García.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ STATS SECTION ═══ */}
                <section className="py-12 sm:py-20 px-4 sm:px-6" ref={statsRef}>
                    <div className="max-w-7xl mx-auto">
                        <div className={`relative rounded-2xl sm:rounded-[2rem] overflow-hidden p-8 sm:p-12 md:p-16 transition-all duration-700 ${statsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{
                            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%)'
                        }}>
                            {/* Decorative elements */}
                            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                <div className="absolute top-[-20%] right-[-10%] w-[40%] h-[40%] bg-violet-500/20 rounded-full blur-3xl"></div>
                                <div className="absolute bottom-[-20%] left-[-10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-3xl"></div>
                            </div>

                            <div className="relative z-10">
                                <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white text-center mb-3 sm:mb-4 tracking-tight">
                                    Resultados de reclutamiento masivo en Monterrey
                                </h2>
                                <p className="text-violet-200 text-center mb-8 sm:mb-12 text-sm sm:text-lg">
                                    Resultados reales de empresas que reclutan con Candidatic IA
                                </p>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-8">
                                    <div className="text-center" ref={candidatesRef}>
                                        <div className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-1 sm:mb-2">
                                            {candidates.toLocaleString()}+
                                        </div>
                                        <div className="text-violet-300 text-xs sm:text-sm font-medium">Candidatos contactados</div>
                                    </div>
                                    <div className="text-center" ref={messagesRef}>
                                        <div className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-1 sm:mb-2">
                                            {messages.toLocaleString()}+
                                        </div>
                                        <div className="text-violet-300 text-xs sm:text-sm font-medium">Mensajes por WhatsApp</div>
                                    </div>
                                    <div className="text-center" ref={companiesRef}>
                                        <div className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-1 sm:mb-2">
                                            {companies}+
                                        </div>
                                        <div className="text-violet-300 text-xs sm:text-sm font-medium">Empresas confían en nosotros</div>
                                    </div>
                                    <div className="text-center" ref={automationsRef}>
                                        <div className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-1 sm:mb-2">
                                            {automations}%
                                        </div>
                                        <div className="text-violet-300 text-xs sm:text-sm font-medium">Automatización</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ PLATFORM PREVIEW ═══ */}
                <section className="py-12 sm:py-20 px-4 sm:px-6 bg-gradient-to-b from-white to-gray-50/50">
                    <div className="max-w-7xl mx-auto">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 sm:gap-16 items-center">
                            <div>
                                <div className="inline-flex items-center space-x-2 bg-emerald-50 px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold text-emerald-700 mb-4 border border-emerald-100">
                                    <MessageSquare className="w-4 h-4" />
                                    <span>WhatsApp Nativo</span>
                                </div>
                                <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight mb-4 sm:mb-6">
                                    Reclutamos vía{' '}
                                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-500 to-emerald-600">WhatsApp</span>
                                </h2>
                                <p className="text-sm sm:text-lg text-gray-500 mb-6 sm:mb-8 leading-relaxed">
                                    Nuestro bot de IA contacta candidatos directamente por WhatsApp, los entrevista 24/7, extrae sus datos automáticamente y escala a nuestro equipo humano cuando es necesario.
                                </p>
                                <div className="space-y-3 sm:space-y-4">
                                    {[
                                        'Bot de WhatsApp con GPT-4 que entrevista candidatos',
                                        'Extracción automática de datos del candidato',
                                        'Agendamiento de entrevistas sin intervención',
                                        'Equipo humano de respaldo para casos complejos',
                                        'Contacto masivo personalizado por WhatsApp'
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

                {/* ═══ PRICING SECTION — hidden ═══ */}
                <section id="pricing" className="hidden" ref={pricingRef}>
                    <div className="max-w-7xl mx-auto">
                        <div className={`text-center mb-10 sm:mb-16 transition-all duration-700 ${pricingVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                            <div className="inline-flex items-center space-x-2 bg-amber-50 px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold text-amber-700 mb-4 border border-amber-100">
                                <Zap className="w-4 h-4" />
                                <span>Planes</span>
                            </div>
                            <h2 className="text-2xl sm:text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
                                Planes a tu medida
                            </h2>
                            <p className="text-sm sm:text-lg text-gray-500 max-w-2xl mx-auto px-2">
                                Elige el servicio que mejor se adapte a tus necesidades de reclutamiento.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 max-w-5xl mx-auto">
                            {/* Starter */}
                            <div className={`bg-white rounded-2xl border border-gray-100 p-8 hover:border-gray-200 hover:shadow-lg transition-all duration-500 ${pricingVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '0ms' }}>
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-gray-900 mb-1">Básico</h3>
                                    <p className="text-sm text-gray-500">Para vacantes puntuales</p>
                                </div>
                                <div className="mb-6">
                                    <span className="text-4xl font-black text-gray-900">$2,999</span>
                                    <span className="text-gray-500 text-sm"> /vacante MXN</span>
                                </div>
                                <div className="space-y-3 mb-8">
                                    {['Contacto por WhatsApp con IA', 'Hasta 100 candidatos contactados', 'Pre-filtrado automático', 'Entrega de candidatos listos', 'Soporte por chat'].map((f, i) => (
                                        <div key={i} className="flex items-center space-x-2.5 text-sm">
                                            <Check className="w-4 h-4 text-green-500 shrink-0" />
                                            <span className="text-gray-600">{f}</span>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setIsLoginOpen(true)} className="w-full py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-semibold hover:border-violet-300 hover:text-violet-700 transition-all duration-300 text-sm">
                                    Solicitar servicio
                                </button>
                            </div>

                            {/* Pro — featured */}
                            <div className={`relative bg-gradient-to-b from-violet-600 to-indigo-700 rounded-2xl p-6 sm:p-8 text-white shadow-2xl shadow-violet-300/30 md:scale-105 transition-all duration-500 ${pricingVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '100ms' }}>
                                <div className="absolute top-0 right-6 -translate-y-1/2">
                                    <span className="bg-gradient-to-r from-amber-400 to-orange-400 text-gray-900 text-xs font-bold px-4 py-1.5 rounded-full shadow-lg">
                                        ⭐ Más popular
                                    </span>
                                </div>
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold mb-1">Agencia Pro</h3>
                                    <p className="text-sm text-violet-200">Para reclutamiento continuo</p>
                                </div>
                                <div className="mb-6">
                                    <span className="text-4xl font-black">$7,999</span>
                                    <span className="text-violet-200 text-sm"> /mes MXN</span>
                                </div>
                                <div className="space-y-3 mb-8">
                                    {['Vacantes ilimitadas', 'Contacto masivo por WhatsApp', 'Bot IA avanzado (GPT-4)', 'Pre-filtrado + validación humana', 'Candidatos entregados con cita agendada', 'Reportes semanales de avance', 'Reclutador dedicado a tu cuenta', 'Soporte prioritario'].map((f, i) => (
                                        <div key={i} className="flex items-center space-x-2.5 text-sm">
                                            <Check className="w-4 h-4 text-green-300 shrink-0" />
                                            <span className="text-violet-100">{f}</span>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setIsLoginOpen(true)} className="w-full py-3 rounded-xl bg-white text-violet-700 font-bold hover:bg-violet-50 transition-all duration-300 text-sm shadow-lg">
                                    Contratar agencia
                                </button>
                            </div>

                            {/* Enterprise */}
                            <div className={`bg-white rounded-2xl border border-gray-100 p-8 hover:border-gray-200 hover:shadow-lg transition-all duration-500 ${pricingVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '200ms' }}>
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-gray-900 mb-1">Enterprise</h3>
                                    <p className="text-sm text-gray-500">Para reclutamiento a gran escala</p>
                                </div>
                                <div className="mb-6">
                                    <span className="text-4xl font-black text-gray-900">Custom</span>
                                </div>
                                <div className="space-y-3 mb-8">
                                    {['Volumen ilimitado de vacantes', 'IA personalizada a tu empresa', 'Equipo dedicado de reclutadores', 'Integración con tu ATS', 'Reportes ejecutivos', 'SLA garantizado', 'Account manager exclusivo', 'Reclutamiento especializado'].map((f, i) => (
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
                <section id="faq" className="py-12 sm:py-20 px-4 sm:px-6 bg-gray-50/50">
                    <div className="max-w-3xl mx-auto">
                        <div className="text-center mb-8 sm:mb-12">
                            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight mb-4">
                                Preguntas frecuentes sobre reclutamiento masivo en Monterrey
                            </h2>
                            <p className="text-gray-500 text-sm sm:text-lg px-2">Todo lo que necesitas saber sobre nuestro servicio de reclutamiento.</p>
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
                <section className="py-12 sm:py-20 px-4 sm:px-6">
                    <div className="max-w-7xl mx-auto">
                        <div className="relative rounded-2xl sm:rounded-[2rem] overflow-hidden p-8 sm:p-12 md:p-16" style={{
                            background: 'linear-gradient(135deg, #EDE9FE 0%, #E0F2FE 50%, #F3E8FF 100%)'
                        }}>
                            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                <div className="absolute top-[-10%] left-[20%] w-[30%] h-[30%] bg-violet-400/10 rounded-full blur-3xl"></div>
                                <div className="absolute bottom-[-10%] right-[20%] w-[30%] h-[30%] bg-blue-400/10 rounded-full blur-3xl"></div>
                            </div>

                            <div className="relative z-10 max-w-5xl mx-auto">
                                {/* Header */}
                                <div className="text-center mb-8 sm:mb-10">
                                    <h2 className="text-2xl sm:text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
                                        ¿Listo para que reclutemos por ti?
                                    </h2>
                                    <p className="text-sm sm:text-lg text-gray-600 px-2">
                                        Únete a las empresas que ya encontraron al candidato ideal con nuestra agencia de reclutamiento con IA.
                                    </p>
                                </div>

                                {/* Form + WhatsApp */}
                                <div className="grid sm:grid-cols-[1fr_auto] gap-6 items-start">
                                    {/* Form */}
                                    <div className="bg-white/70 backdrop-blur-md border border-violet-100 rounded-3xl p-6 shadow-xl shadow-violet-100/30">
                                        <p className="text-xs font-bold text-violet-600 uppercase tracking-wider mb-4">Cuéntanos sobre tu empresa</p>
                                        {ctaFormStatus === 'success' ? (
                                            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-4">
                                                <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                                                <p className="text-sm font-semibold text-green-800">¡Recibido! Te contactamos pronto.</p>
                                            </div>
                                        ) : (
                                            <form onSubmit={handleCtaForm} className="flex flex-col gap-2.5">
                                                <div className="grid sm:grid-cols-2 gap-2.5">
                                                    <input
                                                        type="text"
                                                        placeholder="Nombre"
                                                        value={ctaForm.nombre}
                                                        onChange={e => setCtaForm(f => ({ ...f, nombre: e.target.value }))}
                                                        required
                                                        className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Empresa"
                                                        value={ctaForm.empresa}
                                                        onChange={e => setCtaForm(f => ({ ...f, empresa: e.target.value }))}
                                                        className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                                                    />
                                                </div>
                                                <div className="grid sm:grid-cols-2 gap-2.5">
                                                    <input
                                                        type="tel"
                                                        placeholder="WhatsApp (10 dígitos)"
                                                        value={ctaForm.wapp}
                                                        onChange={e => setCtaForm(f => ({ ...f, wapp: e.target.value }))}
                                                        required
                                                        maxLength={10}
                                                        className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                                                    />
                                                    <input
                                                        type="email"
                                                        placeholder="Correo electrónico"
                                                        value={ctaForm.correo}
                                                        onChange={e => setCtaForm(f => ({ ...f, correo: e.target.value }))}
                                                        className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                                                    />
                                                </div>
                                                <button
                                                    type="submit"
                                                    disabled={ctaFormStatus === 'loading'}
                                                    className="w-full bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white font-bold py-2.5 rounded-xl text-sm transition-all shadow-md shadow-violet-300/30 disabled:opacity-60 flex items-center justify-center gap-2"
                                                >
                                                    {ctaFormStatus === 'loading' ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <><Send className="w-4 h-4" /> Enviar</>
                                                    )}
                                                </button>
                                            </form>
                                        )}
                                    </div>

                                    {/* WhatsApp Ventas */}
                                    <a
                                        href="https://wa.me/528116038195"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex flex-col items-center justify-center gap-3 bg-white/70 backdrop-blur-md border border-green-200/60 rounded-3xl p-6 shadow-xl shadow-green-100/30 hover:bg-white/90 transition-all duration-300 group min-w-[160px]"
                                    >
                                        <div className="w-12 h-12 bg-green-500 rounded-2xl flex items-center justify-center shadow-md shadow-green-300/40 group-hover:scale-105 transition-transform">
                                            <WhatsAppIcon className="w-6 h-6 text-white" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-sm font-bold text-gray-900">Hablar con ventas</p>
                                            <p className="text-xs text-gray-500 mt-0.5">811 603 8195</p>
                                        </div>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            {/* ═══ FOOTER ═══ */}
            <footer className="bg-gray-950 text-gray-400 py-6 px-4 sm:px-6">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-xs sm:text-sm text-gray-600 text-center md:text-left">
                        © {new Date().getFullYear()} Candidatic IA. Todos los derechos reservados.
                    </p>
                    <div className="flex items-center space-x-6">
                        <a href="/privacy" className="text-gray-600 hover:text-violet-400 transition-colors text-xs sm:text-sm">Privacidad</a>
                        <a href="/terms" className="text-gray-600 hover:text-violet-400 transition-colors text-xs sm:text-sm">Términos</a>
                        <a href="mailto:contacto@candidatic.com" className="text-gray-600 hover:text-violet-400 transition-colors text-xs sm:text-sm">Contacto</a>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
