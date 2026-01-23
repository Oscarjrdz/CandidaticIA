
import React, { useState, useRef, useEffect } from 'react';
import { ArrowRight, CheckCircle, BarChart, Users, Zap, Loader2, MessageSquare } from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';

const WhatsAppIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
);

const LandingPage = ({ onLoginSuccess }) => {
    /* SEARCH LOGIC */
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState(null);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        setSearchResults(null);

        try {
            const res = await fetch('/api/public/ai-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: searchQuery })
            });
            const data = await res.json();
            if (data.success) {
                setSearchResults(data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsSearching(false);
        }
    };

    /* LOGIN DROPDOWN LOGIC */
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [loginStep, setLoginStep] = useState('phone'); // phone, pin
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [phone, setPhone] = useState('');
    const [pinDigits, setPinDigits] = useState(['', '', '', '']);
    const pinRefs = useRef([]);
    const dropdownRef = useRef(null);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsLoginOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const cleanLogin = () => {
        setLoginError('');
        setLoginLoading(false);
    }

    const handlePhoneSubmit = async (e) => {
        e.preventDefault();
        cleanLogin();
        if (phone.length < 10) {
            setLoginError('Número inválido (10 dígitos).');
            return;
        }

        setLoginLoading(true);
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'request-pin', phone })
            });
            const data = await res.json();
            if (res.ok) {
                setLoginStep('pin');
            } else {
                setLoginError(data.error || 'Error de conexión.');
            }
        } catch (err) {
            setLoginError('Error de red.');
        } finally {
            setLoginLoading(false);
        }
    };

    const handlePinChange = (index, value) => {
        if (!/^\d*$/.test(value)) return;
        const newPin = [...pinDigits];
        newPin[index] = value;
        setPinDigits(newPin);
        if (value && index < 3) pinRefs.current[index + 1]?.focus();
        if (index === 3 && value) {
            submitPin(newPin.slice(0, 3).join('') + value);
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
            pinRefs.current[index - 1]?.focus();
        }
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
                if (data.newUser) {
                    setLoginError('Registro requerido. Contacta admin.'); // Simple flow for dropdown
                } else {
                    onLoginSuccess(data.user);
                }
            } else {
                setLoginError('Código incorrecto.');
                setPinDigits(['', '', '', '']);
                pinRefs.current[0]?.focus();
            }
        } catch (err) {
            setLoginError('Error de conexión.');
        } finally {
            setLoginLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-blue-100 selection:text-blue-900">

            {/* Header */}
            <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between relative">
                    <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
                            C
                        </div>
                        <span className="text-xl font-bold tracking-tight text-gray-900">Candidatic IA</span>
                    </div>

                    <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-gray-600">
                        <a href="#features" className="hover:text-blue-600 transition-colors">Características</a>
                        <a href="#about" className="hover:text-blue-600 transition-colors">Nosotros</a>
                        <a href="#pricing" className="hover:text-blue-600 transition-colors">Precios</a>
                    </nav>

                    <div className="relative" ref={dropdownRef}>
                        <Button
                            onClick={() => setIsLoginOpen(!isLoginOpen)}
                            className="rounded-full px-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg shadow-blue-200 hover:shadow-purple-300 transition-all transform hover:-translate-y-0.5"
                        >
                            Ingresar
                        </Button>

                        {/* LOGIN DROPDOWN */}
                        {isLoginOpen && (
                            <div className="absolute right-0 top-full mt-6 w-[26rem] bg-white/60 backdrop-blur-2xl rounded-3xl shadow-[0_20px_50px_rgb(8_112_184_/_0.3)] border border-white/50 p-8 z-50 animate-in fade-in slide-in-from-top-4 duration-300 origin-top-right ring-1 ring-white/60">
                                {/* Decorator Arrow */}
                                <div className="absolute -top-3 right-8 w-6 h-6 bg-white/60 backdrop-blur-xl transform rotate-45 border-t border-l border-white/50"></div>

                                {/* Floating Gloss Effect */}
                                <div className="absolute inset-0 rounded-3xl bg-gradient-to-b from-white/40 to-transparent pointer-events-none"></div>

                                <div className="relative z-10">
                                    <div className="mb-6 text-center">
                                        <div className="relative inline-block mb-3">
                                            <div className="absolute inset-0 bg-blue-500 blur-xl opacity-20 rounded-full animate-pulse"></div>
                                            <div className="relative w-14 h-14 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg transform rotate-3 hover:rotate-6 transition-transform">
                                                <MessageSquare className="w-7 h-7 text-white" />
                                            </div>
                                            <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1 border-2 border-white">
                                                <div className="text-white w-3 h-3"><WhatsAppIcon /></div>
                                            </div>
                                        </div>
                                        <h3 className="text-xl font-bold text-gray-900 tracking-tight">Bienvenido</h3>
                                        <p className="text-sm text-gray-500 font-medium">Accede a tu cuenta</p>
                                    </div>

                                    {loginError && (
                                        <div className="mb-4 p-3 bg-red-50/50 border border-red-100 text-red-600 text-xs rounded-xl text-center font-semibold shadow-sm backdrop-blur-sm animate-in shake">
                                            {loginError}
                                        </div>
                                    )}

                                    {loginStep === 'phone' ? (
                                        <form onSubmit={handlePhoneSubmit} className="space-y-6">
                                            <div className="space-y-2">
                                                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-1">WhatsApp (10 dígitos)</label>
                                                <div className="flex justify-between gap-1">
                                                    {Array(10).fill(0).map((_, i) => (
                                                        <input
                                                            key={i}
                                                            id={`phone-${i}`}
                                                            type="text"
                                                            inputMode="numeric"
                                                            maxLength={1}
                                                            value={phone[i] || ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value.replace(/\D/g, '');
                                                                if (!val && !e.target.value) {
                                                                    // Handle clear
                                                                    const newPhone = phone.split('');
                                                                    newPhone[i] = '';
                                                                    setPhone(newPhone.join(''));
                                                                    return;
                                                                }
                                                                if (val) {
                                                                    const newPhone = phone.split('');
                                                                    newPhone[i] = val;
                                                                    setPhone(newPhone.join(''));
                                                                    if (i < 9) document.getElementById(`phone-${i + 1}`).focus();
                                                                }
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Backspace' && !phone[i] && i > 0) {
                                                                    document.getElementById(`phone-${i - 1}`).focus();
                                                                }
                                                            }}
                                                            onFocus={(e) => e.target.select()}
                                                            className={`w-8 h-10 text-center text-lg font-bold rounded-lg border-2 outline-none transition-all duration-300 shadow-sm
                                                            ${phone[i]
                                                                    ? 'border-green-500 text-green-600 bg-green-50/50 shadow-[0_0_10px_rgba(34,197,94,0.2)] transform scale-105'
                                                                    : 'border-gray-200 text-gray-400 bg-white/50 focus:border-blue-400 focus:bg-white'
                                                                }
                                                        `}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            <Button
                                                type="submit"
                                                className={`w-full h-12 text-base font-bold shadow-lg rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98]
                                                ${phone.length === 10
                                                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-green-500/25 text-white'
                                                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                                    }
                                            `}
                                                disabled={loginLoading || phone.length < 10}
                                            >
                                                {loginLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Enviar Código'}
                                            </Button>
                                        </form>
                                    ) : (
                                        <div className="space-y-6">
                                            <div className="text-center">
                                                <p className="text-sm text-gray-500 font-medium bg-gray-50 inline-block px-3 py-1 rounded-full border border-gray-100">
                                                    Código enviado a <b className="text-gray-800">{phone}</b>
                                                </p>
                                            </div>

                                            <div className="flex justify-center gap-2">
                                                {pinDigits.map((d, i) => (
                                                    <input
                                                        key={i}
                                                        ref={el => pinRefs.current[i] = el}
                                                        type="text"
                                                        value={d}
                                                        maxLength={1}
                                                        onChange={(e) => handlePinChange(i, e.target.value)}
                                                        onKeyDown={(e) => handleKeyDown(i, e)}
                                                        className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-100 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none bg-white/50 shadow-sm transition-all text-gray-800 caret-blue-500"
                                                        autoFocus={i === 0}
                                                    />
                                                ))}
                                            </div>

                                            {loginLoading && (
                                                <div className="flex justify-center">
                                                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                                                </div>
                                            )}

                                            <button
                                                onClick={() => setLoginStep('phone')}
                                                className="block w-full text-xs text-blue-600 hover:text-blue-700 font-semibold hover:underline text-center transition-colors"
                                            >
                                                ¿Número incorrecto? Volver
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <main className="pt-32 pb-20 px-6">
                <div className="max-w-7xl mx-auto">

                    {/* Hero Section - Gradient Card */}
                    <div className="relative rounded-[2.5rem] overflow-hidden bg-gradient-to-br from-[#E0F2FE] via-[#EBE9FE] to-[#F3E8FF] p-12 md:p-24 text-center">

                        {/* Background Decorative Blurs */}
                        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/20 rounded-full blur-3xl"></div>
                            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-400/20 rounded-full blur-3xl"></div>
                        </div>

                        <div className="relative z-10 max-w-4xl mx-auto">
                            <div className="inline-flex items-center space-x-2 bg-white/60 backdrop-blur-sm px-4 py-1.5 rounded-full text-sm font-medium text-blue-800 mb-8 border border-white/50 shadow-sm">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                </span>
                                <span>Nueva versión 2.0 disponible</span>
                            </div>

                            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-gray-900 mb-8 leading-[1.1]">
                                Revoluciona tu <br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
                                    Reclutamiento con IA
                                </span>
                            </h1>



                            {/* AI SEARCH BAR */}
                            <div className="max-w-2xl mx-auto mb-12 relative z-20">
                                <form onSubmit={handleSearch} className="relative group">
                                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                                    <div className="relative flex items-center bg-white rounded-full shadow-xl p-2 pr-2">
                                        <div className="pl-4 pr-2 text-gray-400">
                                            <Zap className="w-5 h-5 text-purple-500" />
                                        </div>
                                        <input
                                            type="text"
                                            className="flex-1 bg-transparent border-none focus:ring-0 text-gray-800 placeholder-gray-400 text-lg outline-none"
                                            placeholder="Ej. Busco contador con experiencia en Monterrey..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                        <button
                                            type="submit"
                                            disabled={isSearching}
                                            className="bg-black text-white rounded-full px-6 py-3 font-medium hover:bg-gray-800 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSearching ? (
                                                <span className="animate-spin text-xl">⟳</span>
                                            ) : (
                                                <>
                                                    <span>Buscar</span>
                                                    <ArrowRight className="w-4 h-4" />
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </form>

                                {/* SEARCH RESULTS POPUP */}
                                {searchResults && (
                                    <div className="mt-6 bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/50 p-6 text-left animate-in slide-in-from-bottom-4 duration-500">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                                                    <span>🎉</span>
                                                    Encontramos <span className="text-blue-600">{searchResults.matches_count}</span> candidatos
                                                </h3>
                                                <p className="text-gray-600 mt-1">
                                                    Coinciden con tu búsqueda. Regístrate para ver sus perfiles completos y contactarlos.
                                                </p>
                                            </div>
                                            <Button onClick={() => setIsLoginOpen(true)} size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                                                Ver Perfiles
                                            </Button>
                                        </div>

                                        {/* Anonymous Preview Tags */}
                                        <div className="flex flex-wrap gap-2 mt-4">
                                            {searchResults.preview.map((p, i) => (
                                                <span key={i} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                                                    {p.role} • {p.location}
                                                </span>
                                            ))}
                                            {searchResults.matches_count > 10 && (
                                                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100">
                                                    +{searchResults.matches_count - 10} más
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>


                        </div>
                    </div>



                </div>
            </main>

            <footer className="bg-gray-50 border-t border-gray-200 py-12">
                <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center bg-transparent">
                    <div className="flex items-center space-x-2 mb-4 md:mb-0">
                        <div className="w-6 h-6 bg-gray-300 rounded-md flex items-center justify-center text-white text-xs font-bold">
                            C
                        </div>
                        <span className="font-semibold text-gray-700">Candidatic IA</span>
                    </div>
                    <p className="text-gray-500 text-sm">
                        © {new Date().getFullYear()} Candidatic IA. Todos los derechos reservados.
                    </p>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
