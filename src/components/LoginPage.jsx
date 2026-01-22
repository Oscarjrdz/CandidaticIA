import React, { useState } from 'react';
import { MessageSquare, ArrowRight, UserPlus, ShieldCheck, Loader2 } from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';

// SVG Icons for WhatsApp and Facebook style
const WhatsAppIcon = () => (
    <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current text-white">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
);

export default function LoginPage({ onLogin }) {
    const [step, setStep] = useState('phone'); // phone, pin, register, pending
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Data
    const [phone, setPhone] = useState('');
    // PIN split state
    const [pinDigits, setPinDigits] = useState(['', '', '', '']);

    // Register vars
    const [name, setName] = useState('');

    // Refs for auto-focus
    const pinRefs = React.useRef([]);

    const cleanError = () => setError('');

    // 1. Check Phone -> Request PIN
    const handlePhoneSubmit = async (e) => {
        e.preventDefault();
        cleanError();

        if (phone.length < 10) {
            setError('Por favor ingresa un número válido de 10 dígitos.');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'request-pin', phone })
            });
            const data = await res.json();

            if (res.ok) {
                setStep('pin');
                // Optional: Store adminBypass flag if needed, but UI is same
            } else {
                setError(data.error || 'Error de conexión.');
            }
        } catch (err) {
            setError('No se pudo conectar con el servidor.');
        } finally {
            setLoading(false);
        }
    };

    // Handle PIN Change per digit
    const handlePinChange = (index, value) => {
        if (!/^\d*$/.test(value)) return;

        const newPin = [...pinDigits];
        newPin[index] = value;
        setPinDigits(newPin);

        // Auto-focus logic
        if (value && index < 3) {
            pinRefs.current[index + 1].focus();
        }

        // Auto-submit if full
        if (index === 3 && value) {
            const fullPin = newPin.slice(0, 3).join('') + value;
            submitPin(fullPin);
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
            pinRefs.current[index - 1].focus();
        }
    };

    // 2. Verify PIN
    const submitPin = async (fullPin) => {
        cleanError();
        setLoading(true);

        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'verify-pin', phone, pin: fullPin })
            });
            const data = await res.json();

            if (res.ok) {
                if (data.success) {
                    if (data.newUser) {
                        setStep('register');
                    } else {
                        localStorage.setItem('candidatic_user_session', JSON.stringify(data.user));
                        onLogin(data.user);
                    }
                }
            } else {
                setError(data.error || 'Código incorrecto. Intenta de nuevo.');
                // Reset PIN on error
                setPinDigits(['', '', '', '']);
                pinRefs.current[0].focus();
            }
        } catch (err) {
            setError('Error de conexión.');
        } finally {
            setLoading(false);
        }
    };

    // 3. Register
    const handleRegisterSubmit = async (e) => {
        e.preventDefault();
        cleanError();
        setLoading(true);

        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'register', phone, name, role: 'Recruiter' })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                setStep('pending');
            } else {
                setError(data.error || 'Error al registrar.');
            }
        } catch (err) {
            setError('Error de conexión.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4 py-8">
            <div className="max-w-[420px] w-full bg-white dark:bg-gray-800 rounded-3xl shadow-2xl overflow-hidden p-8 transition-all duration-300">

                {/* Modern Brand Header */}
                <div className="text-center mb-8">
                    <div className="relative inline-block">
                        <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-purple-700 rounded-2xl flex items-center justify-center shadow-lg transform rotate-3 mx-auto mb-4 hover:rotate-6 transition-transform duration-300">
                            <MessageSquare className="w-10 h-10 text-white" />
                        </div>
                        <div className="absolute -bottom-2 -right-2 bg-green-500 rounded-full p-1.5 border-4 border-white dark:border-gray-800">
                            <WhatsAppIcon />
                        </div>
                    </div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mt-4 tracking-tight">Candidatic IA</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2 font-medium">Acceso Seguro a tu Reclutamiento</p>
                </div>

                {/* ERROR ALERT */}
                {error && (
                    <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 text-red-600 dark:text-red-400 rounded-r-xl text-sm font-semibold shadow-sm animate-in shake">
                        {error}
                    </div>
                )}

                {/* STEP 1: PHONE */}
                {step === 'phone' && (
                    <form onSubmit={handlePhoneSubmit} className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="space-y-4">
                            <label className="block text-center text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-widest">
                                NÚMERO DE WHATSAPP
                            </label>

                            {/* ZUCKERBERG / FACEBOOK STYLE INPUT */}
                            <div className="relative">
                                <Input
                                    type="tel"
                                    placeholder="Tu número aquí"
                                    value={phone}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                                        setPhone(val);
                                    }}
                                    className="w-full h-16 text-3xl font-bold text-center tracking-widest text-gray-800 dark:text-white bg-transparent border-2 border-gray-300 dark:border-gray-600 rounded-xl focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:border-gray-400 dark:focus:border-gray-500 transition-all placeholder:text-gray-300 dark:placeholder:text-gray-600 placeholder:text-2xl placeholder:font-normal"
                                    maxLength={10}
                                    required
                                    autoFocus
                                />
                            </div>

                            <p className="text-xs text-center text-gray-400 font-medium">
                                Te enviaremos un código de verificación al instante.
                            </p>
                        </div>
                        <Button type="submit" className="w-full h-14 text-lg font-bold bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.02]" disabled={loading}>
                            {loading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : 'Continuar'}
                        </Button>
                    </form>
                )}

                {/* STEP 2: SPLIT PIN INPUT */}
                {step === 'pin' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
                        <div className="text-center">
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Código de Verificación</h2>
                            <p className="text-sm text-gray-500 mt-2">
                                Ingresa el código de 4 dígitos enviado a <br />
                                <span className="font-mono font-bold text-gray-800 dark:text-gray-200 text-base">{phone}</span>
                            </p>
                        </div>

                        <div className="flex justify-center gap-4">
                            {pinDigits.map((digit, idx) => (
                                <input
                                    key={idx}
                                    ref={el => pinRefs.current[idx] = el}
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={1}
                                    value={digit}
                                    onChange={(e) => handlePinChange(idx, e.target.value)}
                                    onKeyDown={(e) => handleKeyDown(idx, e)}
                                    className="w-16 h-20 text-center text-4xl font-bold bg-gray-50 dark:bg-gray-700 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:border-gray-400 dark:focus:border-gray-500 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700/50/10 outline-none transition-all caret-blue-500 shadow-inner"
                                    autoFocus={idx === 0}
                                />
                            ))}
                        </div>

                        <div className="space-y-4">
                            {loading && (
                                <div className="flex justify-center">
                                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={() => setStep('phone')}
                                className="w-full text-sm font-medium text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-2"
                            >
                                ¿Número incorrecto? Volver
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 3: REGISTER */}
                {step === 'register' && (
                    <form onSubmit={handleRegisterSubmit} className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                                <UserPlus className="w-8 h-8 text-green-600" />
                            </div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Crea tu Perfil</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                ¡Bienvenido! Solo necesitamos tu nombre.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">
                                Nombre Completo
                            </label>
                            <Input
                                placeholder="Ej. Ana García"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="h-14 text-lg border-2 rounded-xl"
                                required
                                autoFocus
                            />
                        </div>

                        <Button type="submit" className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700 rounded-xl shadow-lg shadow-green-500/30" disabled={loading}>
                            {loading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : 'Solicitar Acceso'}
                        </Button>
                    </form>
                )}

                {/* STEP 4: PENDING */}
                {step === 'pending' && (
                    <div className="text-center space-y-8 animate-in zoom-in duration-500 py-8">
                        <div className="relative">
                            <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto animate-pulse">
                                <ShieldCheck className="w-12 h-12 text-yellow-600" />
                            </div>
                            <div className="absolute top-0 right-1/3 bg-blue-500 rounded-full p-2 border-4 border-white">
                                <Loader2 className="w-4 h-4 text-white animate-spin" />
                            </div>
                        </div>

                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Solicitud Enviada</h2>
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-xl mt-4 mx-2">
                                <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium">
                                    Tu cuenta está en revisión. Te notificaremos por WhatsApp ({phone}) cuando esté activa.
                                </p>
                            </div>
                        </div>

                        <Button onClick={() => setStep('phone')} variant="outline" className="w-full h-12 rounded-xl border-2 hover:bg-gray-50">
                            Volver al inicio
                        </Button>
                    </div>
                )}

                {/* Footer Style */}
                <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700 text-center">
                    <p className="text-xs text-gray-400 font-medium">Secured by Candidatic IA • Verificación instantánea</p>
                </div>
            </div>
        </div>
    );
}
