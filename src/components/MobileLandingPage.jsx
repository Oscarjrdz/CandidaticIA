
import React, { useState, useRef, useEffect } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
    BrainCircuit, CheckCircle, Loader2, Send, ArrowRight,
    Bot, Target, FileText, BarChart3, X, Users, Zap, ChevronDown, ChevronUp, Sparkles
} from 'lucide-react';

const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`}>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
);

const MobileLandingPage = ({ onLoginSuccess }) => {
    /* ── LOGIN STATE ── */
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [loginStep, setLoginStep] = useState('phone');
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [pinDigits, setPinDigits] = useState(['', '', '', '', '', '']);
    const pinRefs = useRef([]);

    /* ── INFO FORM STATE ── */
    const [form, setForm] = useState({ nombre: '', empresa: '', wapp: '' });
    const [formStatus, setFormStatus] = useState('');

    /* ── FAQ STATE ── */
    const [openFaq, setOpenFaq] = useState(null);

    /* ── HIDE STICKY BUTTON AT BOTTOM ── */
    const [showSticky, setShowSticky] = useState(true);
    const footerRef = useRef(null);
    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => setShowSticky(!entry.isIntersecting),
            { threshold: 0.1 }
        );
        if (footerRef.current) observer.observe(footerRef.current);
        return () => observer.disconnect();
    }, []);

    const handlePhoneSubmit = async () => {
        if (phone.length < 10) { setLoginError('Número inválido (10 dígitos).'); return; }
        setLoginLoading(true); setLoginError('');
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'request-pin', phone })
            });
            const data = await res.json();
            if (data.success) { setLoginStep('pin'); }
            else { setLoginError(data.error || 'Error al enviar PIN'); }
        } catch { setLoginError('Error de conexión'); }
        finally { setLoginLoading(false); }
    };

    const handlePinChange = (index, value) => {
        const digit = value.replace(/\D/g, '').slice(-1);
        const newPin = [...pinDigits];
        newPin[index] = digit;
        flushSync(() => setPinDigits(newPin));
        if (digit && index < 5) pinRefs.current[index + 1]?.focus();
        if (digit && index === 5) submitPin(newPin.join(''));
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !pinDigits[index] && index > 0) pinRefs.current[index - 1]?.focus();
    };

    const submitPin = async (fullPin) => {
        setLoginLoading(true);
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'verify-pin', phone, pin: fullPin })
            });
            const data = await res.json();
            if (data.success && data.user) { onLoginSuccess(data.user); }
            else if (data.needsRegistration) { setLoginStep('register'); }
            else { setLoginError(data.error || 'PIN incorrecto'); setPinDigits(['','','','','','']); pinRefs.current[0]?.focus(); }
        } catch { setLoginError('Error de conexión'); }
        finally { setLoginLoading(false); }
    };

    const handleRegisterSubmit = async (e) => {
        e.preventDefault();
        setLoginLoading(true);
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'register', phone, name, role: 'Recruiter' })
            });
            const data = await res.json();
            if (data.success) setLoginStep('pending');
            else setLoginError(data.error || 'Error');
        } catch { setLoginError('Error de conexión'); }
        finally { setLoginLoading(false); }
    };

    const handleForm = async (e) => {
        e.preventDefault();
        if (!form.nombre || !form.wapp) return;
        setFormStatus('loading');
        try {
            await fetch('/api/public/info-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            setFormStatus('success');
        } catch { setFormStatus('error'); }
    };

    const features = [
        { icon: <Bot className="w-5 h-5" />, title: 'IA 24/7', desc: 'Bot de WhatsApp que entrevista y filtra candidatos sin parar', color: 'bg-violet-50 text-violet-600' },
        { icon: <Target className="w-5 h-5" />, title: 'Pre-filtrado', desc: 'Solo te mandamos candidatos que cumplen tus requisitos', color: 'bg-blue-50 text-blue-600' },
        { icon: <WhatsAppIcon className="w-5 h-5" />, title: 'WhatsApp', desc: 'Contacto masivo directo al celular de cada candidato', color: 'bg-green-50 text-green-600' },
        { icon: <BarChart3 className="w-5 h-5" />, title: 'Reportes', desc: 'Seguimiento en tiempo real de todo el proceso', color: 'bg-rose-50 text-rose-600' },
    ];

    const steps = [
        { num: '1', title: 'Cuéntanos tu vacante', desc: 'Dinos el puesto, experiencia y requisitos que necesitas.' },
        { num: '2', title: 'Activamos la IA', desc: 'Nuestro bot contacta candidatos por WhatsApp automáticamente.' },
        { num: '3', title: 'Filtramos por ti', desc: 'La IA pre-filtra y nuestro equipo valida los mejores perfiles.' },
        { num: '4', title: 'Recibes candidatos', desc: 'Candidatos listos para entrevista con datos completos.' },
    ];

    const faqs = [
        { q: '¿Qué es Candidatic IA?', a: 'Somos una agencia de reclutamiento masivo en Monterrey potenciada por inteligencia artificial. Usamos WhatsApp y un bot conversacional inteligente para buscar, filtrar y contactar candidatos, extrayendo datos y agendando citas automáticamente para tu empresa.' },
        { q: '¿Necesito contratar un reclutador interno?', a: 'No. Nosotros nos encargamos del proceso de reclutamiento por ti. Nuestro equipo y la IA trabajan juntos para encontrar candidatos, filtrar perfiles y reducir la carga operativa de tu empresa.' },
        { q: '¿Cómo encuentran a los candidatos?', a: 'Utilizamos inteligencia artificial para buscar en nuestra base de datos con lenguaje natural, rankear perfiles por afinidad con tu vacante y contactar candidatos por WhatsApp.' },
        { q: '¿Cómo contactan a los candidatos?', a: 'A través de WhatsApp con mensajes personalizados, un bot de IA que los pre-filtra automáticamente, y seguimiento en tiempo real. Todo profesional, rápido y con toque humano cuando se necesita.' },
        { q: '¿Cuánto tiempo tarda el proceso?', a: 'Gracias a nuestra tecnología de IA y WhatsApp, podemos entregar candidatos pre-filtrados en cuestión de días, no semanas. Nuestro bot trabaja 24/7 contactando y entrevistando candidatos por ti.' },
    ];

    return (
        <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">

            {/* ── HEADER ── */}
            <header className="fixed top-0 w-full z-50 bg-white/95 backdrop-blur-xl border-b border-gray-100">
                <div className="w-full bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 py-1 text-center">
                    <span className="text-[10px] font-bold tracking-[0.18em] text-white/90 uppercase">Reclutamiento Masivo con IA</span>
                </div>
                <div className="px-4 h-14 flex items-center justify-center">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-violet-700 rounded-xl flex items-center justify-center shadow-md shrink-0">
                            <BrainCircuit className="w-4 h-4 text-white stroke-[1.5] rotate-90" />
                        </div>
                        <div className="flex flex-col leading-none">
                            <span className="text-base font-extrabold tracking-tight text-gray-900">
                                CANDIDATIC&nbsp;<span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">IΛ</span>
                            </span>
                            <span className="text-[9px] font-semibold tracking-[0.15em] text-gray-400 uppercase mt-0.5">Reclutamiento Masivo</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* ── LOGIN PORTAL ── */}
            {isLoginOpen && createPortal(
                <div className="fixed inset-0 z-[9999] flex flex-col justify-center p-6" style={{ backgroundColor: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)' }}>
                    <button onClick={() => { setIsLoginOpen(false); setLoginStep('phone'); setLoginError(''); setPhone(''); setPinDigits(['','','','']); }}
                        className="absolute top-4 right-4 p-2 rounded-full bg-gray-100">
                        <X className="w-5 h-5 text-gray-600" />
                    </button>
                    <div className="max-w-xs mx-auto w-full">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-violet-700 rounded-xl flex items-center justify-center shadow-md">
                                <BrainCircuit className="w-5 h-5 text-white stroke-[1.5] rotate-90" />
                            </div>
                            <div>
                                <p className="text-base font-extrabold text-gray-900">Bienvenido</p>
                                <p className="text-xs text-gray-400">Accede a tu cuenta</p>
                            </div>
                        </div>

                        {loginError && <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl text-center">{loginError}</div>}

                        {(loginStep === 'phone' || loginStep === 'pin') && (
                            <div className="space-y-4">
                                <div className="flex items-center border-2 border-violet-400 rounded-xl bg-white">
                                    <div className="flex items-center gap-1 px-3 py-3 text-xs font-bold text-violet-500 shrink-0 border-r-2 border-violet-400">🇲🇽 +52</div>
                                    <input
                                        type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={10}
                                        value={phone}
                                        onChange={e => { if (loginStep === 'phone') setPhone(e.target.value.replace(/\D/g,'').slice(0,10)); }}
                                        placeholder="10 dígitos"
                                        readOnly={loginStep === 'pin'}
                                        className="flex-1 min-w-0 px-3 py-3 text-[15px] font-semibold text-gray-800 bg-transparent border-0 appearance-none placeholder:text-gray-300 text-center"
                                        style={{ outline: 'none', boxShadow: 'none' }}
                                        autoFocus
                                    />
                                    {loginStep === 'phone' && phone.length === 10 && (
                                        <span className="pr-3 shrink-0"><CheckCircle className="w-4 h-4 text-green-500" /></span>
                                    )}
                                    {loginStep === 'pin' && (
                                        <button type="button" onClick={() => { setLoginStep('phone'); setPinDigits(['','','','']); }}
                                            className="text-xs text-violet-500 font-semibold pr-3 shrink-0">Cambiar</button>
                                    )}
                                </div>

                                {loginStep === 'pin' && (
                                    <div>
                                        <p className="text-xs text-gray-400 text-center mb-3">Código enviado por WhatsApp</p>
                                        <div className="flex justify-center gap-3">
                                            {pinDigits.map((d, i) => (
                                                <input key={i} ref={el => pinRefs.current[i] = el}
                                                    type="tel" inputMode="numeric" pattern="[0-9]*" value={d} maxLength={1}
                                                    onChange={e => handlePinChange(i, e.target.value)}
                                                    onKeyDown={e => handleKeyDown(i, e)}
                                                    className={`w-14 h-14 text-center text-2xl font-bold border-2 rounded-xl transition-all ${d ? 'border-violet-500 text-violet-700 bg-violet-50' : 'border-gray-200 bg-white'}`}
                                                    style={{ outline: 'none', boxShadow: 'none' }}
                                                    autoFocus={i === 0}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {loginStep === 'phone' && (
                                    <button onClick={handlePhoneSubmit} disabled={loginLoading || phone.length < 10}
                                        className={`w-full py-3 text-sm font-bold rounded-xl text-white flex items-center justify-center transition-all ${phone.length === 10 ? 'bg-gradient-to-r from-blue-600 to-violet-600' : 'bg-gray-300 cursor-not-allowed'}`}>
                                        {loginLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar Código →'}
                                    </button>
                                )}
                            </div>
                        )}

                        {loginStep === 'register' && (
                            <form onSubmit={handleRegisterSubmit} className="space-y-4">
                                <div className="text-center">
                                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2">
                                        <Users className="w-6 h-6 text-green-600" />
                                    </div>
                                    <h4 className="font-bold">Crea tu Perfil</h4>
                                    <p className="text-xs text-gray-400 mt-1">Solo necesitamos tu nombre completo.</p>
                                </div>
                                <input placeholder="Ej. Ana García" value={name} onChange={e => setName(e.target.value)}
                                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-center outline-none" required autoFocus />
                                <button type="submit" disabled={loginLoading}
                                    className="w-full py-3 text-sm bg-green-600 text-white font-bold rounded-xl">
                                    {loginLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Solicitar Acceso'}
                                </button>
                            </form>
                        )}

                        {loginStep === 'pending' && (
                            <div className="text-center space-y-4">
                                <div className="w-14 h-14 bg-yellow-100 rounded-full flex items-center justify-center mx-auto animate-pulse">
                                    <Zap className="w-7 h-7 text-yellow-600" />
                                </div>
                                <div>
                                    <h4 className="font-bold">Solicitud Enviada</h4>
                                    <p className="text-xs text-gray-500 mt-1">Te avisaremos por WhatsApp cuando esté activa.</p>
                                </div>
                                <button onClick={() => setIsLoginOpen(false)} className="w-full py-3 text-sm bg-gray-100 text-gray-800 font-bold rounded-xl">Cerrar</button>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}

            <main className="pt-[88px]">

                {/* ── HERO ── */}
                <section className="px-5 pt-8 pb-10 text-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-violet-50/60 to-white pointer-events-none" />
                    <div className="relative z-10">
                        <div className="inline-flex items-center gap-2 bg-violet-50 border border-violet-100 px-4 py-1.5 rounded-full mb-4">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                            </span>
                            <span className="text-xs font-semibold text-violet-700">#1 Reclutamiento Masivo México</span>
                        </div>

                        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-3 leading-[1.15]">
                            Agencia de Reclutamiento<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600">en Monterrey con IA</span>
                        </h1>

                        <p className="text-sm text-gray-600 leading-relaxed mb-6 max-w-sm mx-auto">
                            Somos tu agencia de reclutamiento masivo con inteligencia artificial. Brenda, nuestra reclutadora IA, contacta candidatos por WhatsApp, gestiona grandes volúmenes de postulantes y te agenda entrevistas con IA.
                        </p>

                        {/* Form */}
                        <div className="bg-white border border-violet-100 rounded-2xl p-5 shadow-lg shadow-violet-100/40 text-left">
                            <p className="text-xs font-bold text-violet-600 uppercase tracking-wider mb-3">¿Quieres más información?</p>
                            {formStatus === 'success' ? (
                                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                                    <p className="text-sm font-semibold text-green-800">¡Recibido! Te contactamos pronto.</p>
                                </div>
                            ) : (
                                <form onSubmit={handleForm} className="flex flex-col gap-2.5">
                                    <input type="text" placeholder="Nombre" value={form.nombre}
                                        onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} required
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none" />
                                    <input type="text" placeholder="Empresa" value={form.empresa}
                                        onChange={e => setForm(f => ({ ...f, empresa: e.target.value }))}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none" />
                                    <input type="tel" placeholder="WhatsApp (10 dígitos)" value={form.wapp}
                                        onChange={e => setForm(f => ({ ...f, wapp: e.target.value }))} required maxLength={10}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none" />
                                    <button type="submit" disabled={formStatus === 'loading'}
                                        className="w-full bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-violet-300/30 disabled:opacity-60">
                                        {formStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Enviar</>}
                                    </button>
                                </form>
                            )}
                        </div>

                    </div>
                </section>

                {/* ── BANNER — IMPLEMENTA CANDIDATIC EN TU EMPRESA ── */}
                <section className="px-5 py-6">
                    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 shadow-xl shadow-violet-500/30 px-6 py-8 text-center">
                        <div className="pointer-events-none absolute -top-16 -right-10 w-48 h-48 rounded-full bg-fuchsia-400/30 blur-3xl"></div>
                        <div className="pointer-events-none absolute -bottom-16 -left-10 w-48 h-48 rounded-full bg-cyan-400/25 blur-3xl"></div>
                        <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: 'radial-gradient(circle at center, #ffffff 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>

                        <div className="relative">
                            <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm border border-white/20 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest text-white/90 mb-3">
                                <Sparkles className="w-3 h-3" />
                                Para empresas
                            </div>
                            <h2 className="text-xl font-extrabold text-white leading-snug">
                                ¿Quieres implementar <span className="text-cyan-200">Candidatic</span> en tu empresa?
                            </h2>
                            <p className="mt-2 text-sm text-white/85 font-medium">
                                Por un <span className="font-bold text-white">fee mensual</span> recibe cientos de candidatos al mes.
                            </p>
                            <a
                                href="https://wa.me/5218116038195"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-5 inline-flex items-center justify-center gap-2 w-full bg-white text-violet-700 font-extrabold text-base px-6 py-3.5 rounded-2xl shadow-lg shadow-black/20 active:scale-95 transition-transform"
                            >
                                <WhatsAppIcon className="w-5 h-5 text-green-500" />
                                Contáctanos
                            </a>
                        </div>
                    </div>
                </section>

                {/* ── APPS — RECLUTADOR / CANDIDATO ── */}
                <section className="px-5 py-9 bg-white">
                    <div className="text-center mb-6">
                        <div className="inline-flex items-center gap-2 bg-violet-50 border border-violet-100 px-3 py-1 rounded-full mb-3">
                            <span className="text-[10px] font-semibold text-violet-700">Ya disponible en iOS</span>
                        </div>
                        <h2 className="text-xl font-extrabold text-gray-900">Candidatic también vive en tu celular</h2>
                    </div>

                    <div className="space-y-4">
                        {/* Reclutador */}
                        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 flex items-center gap-4">
                            <img
                                src="/lp/Candidatic_app_reclutador_icono.png"
                                alt="Ícono de la app Candidatic Reclutador para App Store, plataforma de reclutamiento masivo en Monterrey"
                                className="w-16 h-16 rounded-2xl shadow-md shadow-blue-200/60 shrink-0"
                            />
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600 mb-0.5">¿Eres reclutador?</p>
                                <p className="text-sm font-bold text-gray-900 mb-2">Descarga la app y publica gratis</p>
                                <a href="https://apps.apple.com/mx/app/id6776356939" target="_blank" rel="noopener noreferrer" className="inline-flex">
                                    <img src="/lp/badge-app-store-es-mx.svg" alt="Descarga Candidatic Reclutador en el App Store" className="h-9" />
                                </a>
                            </div>
                        </div>

                        {/* Candidato */}
                        <div className="rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-4 flex items-center gap-4">
                            <img
                                src="/lp/Candidatic_app_candidato_icono.png"
                                alt="Ícono de la app Candidatic Bolsa de Empleo para App Store y Google Play, agencia de reclutamiento masivo en Monterrey"
                                className="w-16 h-16 rounded-2xl shadow-md shadow-orange-200/60 shrink-0"
                            />
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600 mb-0.5">¿Eres candidato?</p>
                                <p className="text-sm font-bold text-gray-900 mb-2">Descarga la app de Candidatic</p>
                                <div className="flex flex-wrap items-center gap-2">
                                    <a href="https://apps.apple.com/mx/app/id6776012569" target="_blank" rel="noopener noreferrer" className="inline-flex">
                                        <img src="/lp/badge-app-store-es-mx.svg" alt="Descarga Candidatic Bolsa de Empleo en el App Store" className="h-9" />
                                    </a>
                                    <span className="inline-flex items-center h-9 px-2.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-400 text-[10px] font-semibold">
                                        Google Play — Próximamente
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── CLIENTES MARQUEE ── */}
                <section className="py-6 bg-white overflow-hidden">
                    <style>{`
                        @keyframes marquee-mobile { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
                        .marquee-mobile { animation: marquee-mobile 28s linear infinite; }
                        .marquee-mobile:hover { animation-play-state: paused; }
                    `}</style>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest text-center mb-4">
                        Empresas que ya reclutan con nosotros
                    </p>
                    <div className="relative overflow-hidden">
                        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
                        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />
                        <div className="flex">
                            <div className="marquee-mobile flex items-center gap-8">
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
                                    <div key={i} className="flex-shrink-0 opacity-40">
                                        <img
                                            src={co.logo}
                                            alt={`Logo de ${co.name}, empresa que recluta con Candidatic IA, agencia de reclutamiento masivo en Monterrey`}
                                            className="h-7 w-auto max-w-[90px] object-contain grayscale"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── PRODUCTO / SCREENSHOTS ── */}
                <section className="px-5 py-9 bg-gray-50 relative overflow-hidden">
                    <style>{`
                        @keyframes orbFloatMobile1 {
                            0%, 100% { transform: translate(0px, 0px) scale(1); }
                            33% { transform: translate(20px, -15px) scale(1.05); }
                            66% { transform: translate(-10px, 10px) scale(0.97); }
                        }
                        @keyframes orbFloatMobile2 {
                            0%, 100% { transform: translate(0px, 0px) scale(1); }
                            50% { transform: translate(-15px, 20px) scale(1.06); }
                        }
                        .orb-mobile-1 { animation: orbFloatMobile1 16s ease-in-out infinite; }
                        .orb-mobile-2 { animation: orbFloatMobile2 20s ease-in-out infinite; }
                    `}</style>
                    <div className="absolute inset-0 pointer-events-none"
                        style={{
                            backgroundImage: 'radial-gradient(circle, #c4b5fd 1px, transparent 1px)',
                            backgroundSize: '22px 22px',
                            opacity: 0.3,
                            maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
                            WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
                        }}
                    />
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        <div className="orb-mobile-1 absolute rounded-full"
                            style={{ top: '-10%', left: '-10%', width: '55%', height: '35%', filter: 'blur(40px)',
                                background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, rgba(91,33,182,0.07) 55%, transparent 100%)' }} />
                        <div className="orb-mobile-2 absolute rounded-full"
                            style={{ bottom: '-10%', right: '-10%', width: '55%', height: '35%', filter: 'blur(40px)',
                                background: 'radial-gradient(circle, rgba(59,130,246,0.16) 0%, rgba(37,99,235,0.06) 55%, transparent 100%)' }} />
                    </div>

                    <div className="relative z-10">
                        <div className="text-center mb-6">
                            <div className="inline-flex items-center gap-2 bg-violet-50 border border-violet-100 px-3 py-1 rounded-full mb-3">
                                <span className="text-[10px] font-semibold text-violet-700">El sistema por dentro</span>
                            </div>
                            <h2 className="text-xl font-extrabold text-gray-900">
                                Así trabaja tu equipo de reclutamiento masivo en Monterrey
                            </h2>
                        </div>

                        <div className="space-y-6">
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
                                <div key={i}>
                                    <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-md bg-white">
                                        <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 border-b border-gray-200">
                                            <span className="w-2 h-2 rounded-full bg-red-400" />
                                            <span className="w-2 h-2 rounded-full bg-yellow-400" />
                                            <span className="w-2 h-2 rounded-full bg-green-400" />
                                        </div>
                                        <img src={shot.img} alt={shot.alt} loading="lazy" className="w-full h-auto object-cover object-top" />
                                    </div>
                                    <h3 className="text-sm font-bold text-gray-900 mt-3 mb-1">{shot.title}</h3>
                                    <p className="text-xs text-gray-500 leading-relaxed">{shot.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ── STATS ── */}
                <section className="px-5 py-8 bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600">
                    <div className="grid grid-cols-3 gap-4 text-center text-white">
                        {[
                            { val: '+5,000', label: 'Candidatos' },
                            { val: '24/7', label: 'Operación' },
                            { val: '3 días', label: 'Entrega' },
                        ].map((s, i) => (
                            <div key={i}>
                                <div className="text-2xl font-extrabold">{s.val}</div>
                                <div className="text-[10px] font-medium text-white/70 uppercase tracking-wider mt-0.5">{s.label}</div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ── FEATURES ── */}
                <section className="px-5 py-10">
                    <h2 className="text-xl font-extrabold text-gray-900 text-center mb-6">¿Por qué somos la mejor agencia de reclutamiento en Monterrey?</h2>
                    <div className="grid grid-cols-2 gap-3">
                        {features.map((f, i) => (
                            <div key={i} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                                <div className={`w-9 h-9 ${f.color} rounded-xl flex items-center justify-center mb-3`}>
                                    {f.icon}
                                </div>
                                <p className="text-sm font-bold text-gray-900 mb-1">{f.title}</p>
                                <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ── HOW IT WORKS ── */}
                <section className="px-5 py-10 bg-gray-50">
                    <h2 className="text-xl font-extrabold text-gray-900 text-center mb-6">Cómo funciona nuestro reclutamiento masivo</h2>
                    <div className="space-y-4">
                        {steps.map((s, i) => (
                            <div key={i} className="flex items-start gap-4 bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-violet-600 rounded-full flex items-center justify-center text-white text-sm font-extrabold shrink-0">
                                    {s.num}
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-gray-900">{s.title}</p>
                                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{s.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ── COBERTURA LOCAL ── */}
                <section className="px-5 py-9 bg-white">
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-500 mb-2">Cobertura local</p>
                        <h2 className="text-xl font-extrabold text-gray-900 mb-3">
                            Reclutamiento masivo en Monterrey y área metropolitana
                        </h2>
                        <p className="text-sm text-gray-600 leading-relaxed">
                            Atendemos empresas en Monterrey, Apodaca, Guadalupe, San Nicolás de los Garza, General Escobedo, Santa Catarina, García y San Pedro Garza García.
                        </p>
                    </div>
                </section>

                {/* ── FAQ ── */}
                <section className="px-5 py-10">
                    <h2 className="text-xl font-extrabold text-gray-900 text-center mb-6">Preguntas frecuentes</h2>
                    <div className="space-y-3">
                        {faqs.map((faq, i) => (
                            <div key={i} className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                                    className="w-full flex items-center justify-between px-4 py-3.5 text-left bg-white">
                                    <span className="text-sm font-semibold text-gray-900">{faq.q}</span>
                                    {openFaq === i ? <ChevronUp className="w-4 h-4 text-violet-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                                </button>
                                {openFaq === i && (
                                    <div className="px-4 pb-4 bg-white">
                                        <p className="text-sm text-gray-500 leading-relaxed">{faq.a}</p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </section>

                {/* ── CTA ── */}
                <section className="px-5 py-10" style={{ background: 'linear-gradient(135deg, #EDE9FE 0%, #E0F2FE 50%, #F3E8FF 100%)' }}>
                    <div className="text-center mb-6">
                        <h2 className="text-2xl font-extrabold text-gray-900 mb-2">¿Listo para que reclutemos por ti?</h2>
                        <p className="text-sm text-gray-600">Únete a las empresas que ya encontraron al candidato ideal.</p>
                    </div>
                    <a href="https://wa.me/5218116038195" target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-3 w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-green-300/40 mb-3 transition-all">
                        <WhatsAppIcon className="w-5 h-5" />
                        Hablar con ventas · 811 603 8195
                    </a>
                </section>

                {/* ── FOOTER ── */}
                <footer ref={footerRef} className="bg-gray-950 text-gray-400 px-5 py-8">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-violet-600 rounded-lg flex items-center justify-center">
                            <BrainCircuit className="w-4 h-4 text-white stroke-[1.5] rotate-90" />
                        </div>
                        <span className="text-base font-extrabold text-white">
                            CANDIDATIC&nbsp;<span className="text-violet-400">IΛ</span>
                        </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                        Agencia de reclutamiento potenciada por inteligencia artificial y WhatsApp para el mercado latinoamericano.
                    </p>
                    <div className="flex gap-4 text-xs text-gray-500 mb-4">
                        <a href="/privacy" className="hover:text-violet-400">Privacidad</a>
                        <a href="/terms" className="hover:text-violet-400">Términos</a>
                        <a href="mailto:contacto@candidatic.com" className="hover:text-violet-400">Contacto</a>
                        <button onClick={() => setIsLoginOpen(true)} className="hover:text-violet-400">Ingresar</button>
                    </div>
                    <p className="text-xs text-gray-600">© {new Date().getFullYear()} Candidatic IA. Todos los derechos reservados.</p>
                </footer>
            </main>

            {/* ── STICKY BOTTOM CTA ── */}
            <div className={`fixed bottom-0 left-0 right-0 z-40 p-4 bg-white/90 backdrop-blur-md border-t border-gray-100 transition-all duration-300 ${showSticky ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}>
                <a href="https://wa.me/5218116038195" target="_blank" rel="noopener noreferrer"
                    className="w-full bg-green-500 text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-green-300/40 flex items-center justify-center gap-2 text-sm">
                    <WhatsAppIcon className="w-5 h-5" />
                    Mandar WhatsApp
                </a>
            </div>
        </div>
    );
};

export default MobileLandingPage;
